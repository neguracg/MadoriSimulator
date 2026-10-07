import {
  cellKey,
  parseCell,
  type CellKey,
  type Doc,
  type FloorData,
  type Furniture,
  type Opening,
  type Room,
  type RoomPatch,
  type RoomType,
  type Settings,
  type Side,
} from '../types';
import { cellOwnerMap, clampRoomDelta, connectedComponents, inGrid, neighborCell } from '../utils/geometry';
import { GRID_H, GRID_W, nextAutoColor, uid } from '../constants';
import { pruneOrphans, reconcileOpenings } from './openingOps';

function mapFloor(doc: Doc, floor: number, fn: (f: FloorData) => FloorData): Doc {
  return { ...doc, floors: { ...doc.floors, [floor]: fn(doc.floors[floor]) } };
}

const onGrid = (c: CellKey): boolean => inGrid(...parseCell(c));

/**
 * Split disconnected rooms, drop empty ones, and drop cells outside the grid (they exist nowhere: they are not
 * drawn and are not read back from storage). Every shape operation ends here, so no caller can leave the grid.
 * Idempotent for connected rooms.
 */
function normalize(f: FloorData): FloorData {
  const rooms: Room[] = [];
  for (const r of f.rooms) {
    const comps = connectedComponents(r.cells.filter(onGrid));
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

/** Doors/windows that no room is on a wall of any more go with the room (openingOps.pruneOrphans). */
export function deleteRoom(doc: Doc, floor: number, roomId: string): Doc {
  return mapFloor(doc, floor, (f) => pruneOrphans({ ...f, rooms: f.rooms.filter((r) => r.id !== roomId) }));
}

export function patchRoom(doc: Doc, floor: number, roomId: string, patch: RoomPatch): Doc {
  return mapFloor(doc, floor, (f) => ({
    ...f,
    rooms: f.rooms.map((r) => (r.id === roomId ? { ...r, ...patch } : r)),
  }));
}

/**
 * After one room changed shape, its doors/windows follow the walls that moved (openingOps.reconcileOpenings).
 * Every operation that changes the cells of one room on purpose ends here: expand, shrink and set-shape.
 */
function followShape(before: FloorData, after: FloorData, roomId: string): FloorData {
  const openings = reconcileOpenings(before, after, roomId);
  return openings === after.openings ? after : { ...after, openings };
}

export function expandRoom(doc: Doc, floor: number, roomId: string, cells: CellKey[]): Doc {
  return mapFloor(doc, floor, (f) => followShape(f, assignCells(f, roomId, cells), roomId));
}

export function shrinkRoom(doc: Doc, floor: number, roomId: string, cells: CellKey[]): Doc {
  const rm = new Set(cells);
  return mapFloor(doc, floor, (f) =>
    followShape(
      f,
      normalize({
        ...f,
        rooms: f.rooms.map((r) => (r.id === roomId ? { ...r, cells: r.cells.filter((c) => !rm.has(c)) } : r)),
      }),
      roomId,
    ),
  );
}

/**
 * Doors/windows and furniture that travel with a room when it is moved. The ONE rule, used both by
 * translateRoom (the commit) and by the canvas (the drag preview). Judged on the state BEFORE the move.
 *  - An opening travels only when the room owns one side of its edge and the other side is the same room
 *    or empty (an exterior wall of the room). An opening on a wall shared with another room stays behind.
 *  - A furniture item travels when its centre cell lies inside the room's cells.
 */
export function linkedToRoomMove(
  f: FloorData,
  roomId: string,
  cellMm: number,
): { openingIds: Set<string>; furnitureIds: Set<string> } {
  const openingIds = new Set<string>();
  const furnitureIds = new Set<string>();
  const room = f.rooms.find((r) => r.id === roomId);
  if (!room) return { openingIds, furnitureIds };
  const owner = cellOwnerMap(f.rooms);
  for (const o of f.openings) {
    const a = owner.get(cellKey(o.cx, o.cy)) ?? null;
    const [nx, ny] = neighborCell(o.cx, o.cy, o.side);
    const b = owner.get(cellKey(nx, ny)) ?? null;
    if ((a === roomId || b === roomId) && (a === roomId || a === null) && (b === roomId || b === null)) {
      openingIds.add(o.id);
    }
  }
  const cells = new Set(room.cells);
  for (const item of f.furniture ?? []) {
    const ccx = Math.floor((item.x + item.w / 2) / cellMm);
    const ccy = Math.floor((item.y + item.h / 2) / cellMm);
    if (cells.has(cellKey(ccx, ccy))) furnitureIds.add(item.id);
  }
  return { openingIds, furnitureIds };
}

/**
 * Move a room by (dx,dy), held to the grid as a whole (clampRoomDelta: the shift is cut back, the shape is kept).
 * Overlaps with other rooms are ALLOWED and preserved — they are only resolved later by resolveOverlaps
 * (when leaving move mode). The moved room is brought to the front so it wins on resolution.
 *
 * The openings and furniture listed by linkedToRoomMove move along with it by the SAME shift. They are not
 * clamped on their own: that would pull them off the wall / out of the room they belong to.
 * A move that cannot go anywhere (the shift is cut back to 0) changes nothing.
 */
export function translateRoom(doc: Doc, floor: number, roomId: string, dx: number, dy: number): Doc {
  return mapFloor(doc, floor, (f) => {
    const room = f.rooms.find((r) => r.id === roomId);
    if (!room) return f;
    const shift = clampRoomDelta(room.cells, dx, dy);
    if (shift.dx === 0 && shift.dy === 0) return f;
    const maxZ = Math.max(0, ...f.rooms.map((r) => r.z));
    const cellMm = doc.settings.cellMm;
    const { openingIds, furnitureIds } = linkedToRoomMove(f, roomId, cellMm); // judged before the move

    const moved = room.cells.map((c) => {
      const [x, y] = parseCell(c);
      return cellKey(x + shift.dx, y + shift.dy);
    });
    const rooms = f.rooms.map((r) => (r.id === roomId ? { ...r, z: maxZ + 1, cells: moved } : r));

    const openings = f.openings.map((o) =>
      openingIds.has(o.id) ? { ...o, cx: o.cx + shift.dx, cy: o.cy + shift.dy } : o,
    );

    const furniture = (f.furniture ?? []).map((item) =>
      furnitureIds.has(item.id) ? { ...item, x: item.x + shift.dx * cellMm, y: item.y + shift.dy * cellMm } : item,
    );

    return { ...f, rooms, openings, furniture };
  });
}

/**
 * Resolve overlapping cells: each contested cell is kept only by the highest-z
 * room. Lower rooms lose those cells and may split. Doors/windows that no room is on a wall of any
 * more (left behind by moves, or on cells that were lost) are dropped (openingOps.pruneOrphans).
 * Returns the same doc when there is nothing to resolve.
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
  const settled = kept === total ? f : normalize({ ...f, rooms: f.rooms.map((r) => ({ ...r, cells: keep.get(r.id)! })) });
  const pruned = pruneOrphans(settled);
  return pruned === f ? doc : mapFloor(doc, floor, () => pruned); // nothing to resolve or prune -> no change
}

/** Replace a room's cells exactly (used by corner/edge drag). Steals cells from others. */
export function setRoomShape(doc: Doc, floor: number, roomId: string, cells: CellKey[]): Doc {
  const uniq = [...new Set(cells)];
  if (uniq.length === 0) return doc;
  const cset = new Set(uniq);
  return mapFloor(doc, floor, (f) =>
    followShape(
      f,
      normalize({
        ...f,
        rooms: f.rooms.map((r) => {
          if (r.id === roomId) return { ...r, cells: uniq };
          if (r.cells.some((c) => cset.has(c))) return { ...r, cells: r.cells.filter((c) => !cset.has(c)) };
          return r;
        }),
      }),
      roomId,
    ),
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
  size: number,
): Doc {
  const op: Opening = { id: uid(), kind, cx, cy, side, size };
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

export function addFurniture(doc: Doc, floor: number, item: Furniture): Doc {
  return mapFloor(doc, floor, (f) => ({ ...f, furniture: [...(f.furniture ?? []), item] }));
}

export function patchFurniture(doc: Doc, floor: number, id: string, patch: Partial<Furniture>): Doc {
  return mapFloor(doc, floor, (f) => ({
    ...f,
    furniture: (f.furniture ?? []).map((x) => (x.id === id ? { ...x, ...patch } : x)),
  }));
}

export function removeFurniture(doc: Doc, floor: number, id: string): Doc {
  return mapFloor(doc, floor, (f) => ({ ...f, furniture: (f.furniture ?? []).filter((x) => x.id !== id) }));
}

/**
 * Paste a copied room onto a floor with a new id, offset by whole cells. The offset is cut back
 * (clampRoomDelta) so the pasted room keeps its shape and stays on the grid.
 */
export function pasteRoom(
  doc: Doc,
  floor: number,
  room: Room,
  type: RoomType | null,
  id: string,
  dcx: number,
  dcy: number,
): Doc {
  let d = doc;
  if (type && !d.roomTypes.some((t) => t.id === type.id)) {
    d = { ...d, roomTypes: [...d.roomTypes, type] };
  }
  const z = Math.max(0, ...d.floors[floor].rooms.map((r) => r.z)) + 1;
  const { dx, dy } = clampRoomDelta(room.cells, dcx, dcy);
  const cells = room.cells.map((c) => {
    const [x, y] = parseCell(c);
    return cellKey(x + dx, y + dy);
  });
  const nr: Room = { ...room, id, cells, z };
  return mapFloor(d, floor, (f) => ({ ...f, rooms: [...f.rooms, nr] }));
}

/** Paste a copied furniture onto a floor with a new id, offset in mm and kept inside the grid (top-left at 0 when it is larger than the grid). */
export function pasteFurniture(doc: Doc, floor: number, item: Furniture, id: string, dx: number, dy: number): Doc {
  const inside = (v: number, size: number, cells: number) => Math.max(0, Math.min(v, cells * doc.settings.cellMm - size));
  const nf: Furniture = { ...item, id, x: inside(item.x + dx, item.w, GRID_W), y: inside(item.y + dy, item.h, GRID_H) };
  return mapFloor(doc, floor, (f) => ({ ...f, furniture: [...(f.furniture ?? []), nf] }));
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
