import {
  cellKey,
  type CellKey,
  type Doc,
  type FloorData,
  type Opening,
  type Room,
  type RoomType,
  type Settings,
  type Side,
} from '../types';
import { connectedComponents } from '../utils/geometry';
import { GRID_H, GRID_W, nextAutoColor, uid } from '../constants';

function mapFloor(doc: Doc, floor: number, fn: (f: FloorData) => FloorData): Doc {
  return { ...doc, floors: { ...doc.floors, [floor]: fn(doc.floors[floor]) } };
}

/** Split disconnected rooms, drop empty ones. Idempotent for connected rooms. */
function normalize(f: FloorData): FloorData {
  const rooms: Room[] = [];
  for (const r of f.rooms) {
    const comps = connectedComponents(r.cells);
    if (comps.length === 0) continue;
    if (comps.length === 1) {
      rooms.push({ ...r, cells: comps[0] });
    } else {
      comps
        .sort((a, b) => b.length - a.length)
        .forEach((cells, i) => {
          rooms.push({ ...r, id: i === 0 ? r.id : uid(), name: `${r.name} ${i + 1}`, cells });
        });
    }
  }
  return { ...f, rooms };
}

/** Add cells to a room, removing them from any other room on the floor. */
function assignCells(f: FloorData, roomId: string, add: CellKey[]): FloorData {
  const addSet = new Set(add);
  const rooms = f.rooms.map((r) => {
    if (r.id === roomId) {
      const merged = new Set(r.cells);
      for (const c of addSet) merged.add(c);
      return { ...r, cells: [...merged] };
    }
    if (r.cells.some((c) => addSet.has(c))) {
      return { ...r, cells: r.cells.filter((c) => !addSet.has(c)) };
    }
    return r;
  });
  return normalize({ ...f, rooms });
}

export function createRoom(
  doc: Doc,
  floor: number,
  name: string,
  typeId: string,
  cells: CellKey[],
): Doc {
  const z = Math.max(0, ...doc.floors[floor].rooms.map((r) => r.z)) + 1;
  const room: Room = { id: uid(), name, typeId, cells: [...new Set(cells)], z };
  return mapFloor(doc, floor, (f) => assignCells({ ...f, rooms: [...f.rooms, room] }, room.id, cells));
}

export function deleteRoom(doc: Doc, floor: number, roomId: string): Doc {
  return mapFloor(doc, floor, (f) => ({ ...f, rooms: f.rooms.filter((r) => r.id !== roomId) }));
}

export function patchRoom(doc: Doc, floor: number, roomId: string, patch: Partial<Room>): Doc {
  return mapFloor(doc, floor, (f) => ({
    ...f,
    rooms: f.rooms.map((r) => (r.id === roomId ? { ...r, ...patch } : r)),
  }));
}

export function expandRoom(doc: Doc, floor: number, roomId: string, cells: CellKey[]): Doc {
  return mapFloor(doc, floor, (f) => assignCells(f, roomId, cells));
}

export function shrinkRoom(doc: Doc, floor: number, roomId: string, cells: CellKey[]): Doc {
  const rm = new Set(cells);
  return mapFloor(doc, floor, (f) =>
    normalize({
      ...f,
      rooms: f.rooms.map((r) =>
        r.id === roomId ? { ...r, cells: r.cells.filter((c) => !rm.has(c)) } : r,
      ),
    }),
  );
}

/**
 * Move a room by (dx,dy). Overlaps with other rooms are ALLOWED and preserved —
 * they are only resolved later by resolveOverlaps (when leaving move mode).
 * The moved room is brought to the front so it wins on resolution.
 */
export function translateRoom(doc: Doc, floor: number, roomId: string, dx: number, dy: number): Doc {
  return mapFloor(doc, floor, (f) => {
    const room = f.rooms.find((r) => r.id === roomId);
    if (!room) return f;
    const maxZ = Math.max(0, ...f.rooms.map((r) => r.z));
    const moved = [
      ...new Set(
        room.cells.map((c) => {
          const [x, y] = c.split(',').map(Number);
          const nx = Math.min(GRID_W - 1, Math.max(0, x + dx));
          const ny = Math.min(GRID_H - 1, Math.max(0, y + dy));
          return cellKey(nx, ny);
        }),
      ),
    ];
    return { ...f, rooms: f.rooms.map((r) => (r.id === roomId ? { ...r, z: maxZ + 1, cells: moved } : r)) };
  });
}

/**
 * Resolve overlapping cells: each contested cell is kept only by the highest-z
 * room. Lower rooms lose those cells and may split. Returns the same doc when
 * there is nothing to resolve.
 */
export function resolveOverlaps(doc: Doc, floor: number): Doc {
  const f = doc.floors[floor];
  const byZdesc = [...f.rooms].sort((a, b) => b.z - a.z);
  const claimed = new Set<CellKey>();
  const keep = new Map<string, CellKey[]>();
  let total = 0;
  let kept = 0;
  for (const r of byZdesc) {
    total += r.cells.length;
    const mine = r.cells.filter((c) => !claimed.has(c));
    for (const c of mine) claimed.add(c);
    keep.set(r.id, mine);
    kept += mine.length;
  }
  if (kept === total) return doc; // no overlaps -> no change
  const rooms = f.rooms.map((r) => ({ ...r, cells: keep.get(r.id)! }));
  return mapFloor(doc, floor, () => normalize({ ...f, rooms }));
}

/** Replace a room's cells exactly (used by corner/edge drag). Steals cells from others. */
export function setRoomShape(doc: Doc, floor: number, roomId: string, cells: CellKey[]): Doc {
  const uniq = [...new Set(cells)];
  if (uniq.length === 0) return doc;
  const cset = new Set(uniq);
  return mapFloor(doc, floor, (f) =>
    normalize({
      ...f,
      rooms: f.rooms.map((r) => {
        if (r.id === roomId) return { ...r, cells: uniq };
        if (r.cells.some((c) => cset.has(c))) return { ...r, cells: r.cells.filter((c) => !cset.has(c)) };
        return r;
      }),
    }),
  );
}

type ZAction = 'front' | 'back' | 'forward' | 'backward';
export function reorderRoom(doc: Doc, floor: number, roomId: string, action: ZAction): Doc {
  return mapFloor(doc, floor, (f) => {
    const sorted = [...f.rooms].sort((a, b) => a.z - b.z);
    const idx = sorted.findIndex((r) => r.id === roomId);
    if (idx < 0) return f;
    if (action === 'forward' && idx < sorted.length - 1) {
      [sorted[idx], sorted[idx + 1]] = [sorted[idx + 1], sorted[idx]];
    } else if (action === 'backward' && idx > 0) {
      [sorted[idx], sorted[idx - 1]] = [sorted[idx - 1], sorted[idx]];
    } else if (action === 'front') {
      sorted.push(sorted.splice(idx, 1)[0]);
    } else if (action === 'back') {
      sorted.unshift(sorted.splice(idx, 1)[0]);
    }
    const rooms = sorted.map((r, i) => ({ ...r, z: i + 1 }));
    return { ...f, rooms };
  });
}

export function addOpening(
  doc: Doc,
  floor: number,
  kind: 'door' | 'window',
  cx: number,
  cy: number,
  side: Side,
): Doc {
  const op: Opening = { id: uid(), kind, cx, cy, side, size: kind === 'door' ? 800 : 1200 };
  return mapFloor(doc, floor, (f) => ({ ...f, openings: [...f.openings, op] }));
}

export function patchOpening(doc: Doc, floor: number, id: string, patch: Partial<Opening>): Doc {
  return mapFloor(doc, floor, (f) => ({
    ...f,
    openings: f.openings.map((o) => (o.id === id ? { ...o, ...patch } : o)),
  }));
}

export function removeOpening(doc: Doc, floor: number, id: string): Doc {
  return mapFloor(doc, floor, (f) => ({ ...f, openings: f.openings.filter((o) => o.id !== id) }));
}

export function addRoomType(doc: Doc, name: string): { doc: Doc; type: RoomType } {
  const type: RoomType = { id: uid(), name, color: nextAutoColor(doc.roomTypes.length) };
  return { doc: { ...doc, roomTypes: [...doc.roomTypes, type] }, type };
}

export function updateRoomType(doc: Doc, id: string, patch: Partial<RoomType>): Doc {
  return { ...doc, roomTypes: doc.roomTypes.map((t) => (t.id === id ? { ...t, ...patch } : t)) };
}

export function updateSettings(doc: Doc, patch: Partial<Settings>): Doc {
  return { ...doc, settings: { ...doc.settings, ...patch } };
}
