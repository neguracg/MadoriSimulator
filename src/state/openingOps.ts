// @owns 開口部(ドア/窓)と壁の対応: ホスト判定・部屋の形の変更への追随・孤立除去
//
// An opening is stored as an edge of a cell: (cx, cy) plus the side of that cell. It belongs to no room by id; it is
// "on a wall" because a room owns the cell on one side of the edge. So when a room changes shape or goes away, nothing
// keeps its openings on its walls unless this module does it.
import { cellKey, parseCell, type CellKey, type FloorData, type Opening, type Side } from '../types';
import { cellOwnerMap, edgeSegment, neighborCell } from '../utils/geometry';

/** A room that has the opening on its boundary, and the side of that room (seen from inside it) the opening is on. */
export interface Host {
  roomId: string;
  dir: Side;
}

type Owner = Map<CellKey, string>;

const OPPOSITE: Record<Side, Side> = { N: 'S', S: 'N', E: 'W', W: 'E' };

/** Every room that owns the cell on either side of the opening's edge (the cell it is stored on comes first). */
function hostsIn(owner: Owner, o: Opening): Host[] {
  const a = owner.get(cellKey(o.cx, o.cy));
  const [nx, ny] = neighborCell(o.cx, o.cy, o.side);
  const b = owner.get(cellKey(nx, ny));
  const hosts: Host[] = [];
  if (a !== undefined) hosts.push({ roomId: a, dir: o.side });
  if (b !== undefined && b !== a) hosts.push({ roomId: b, dir: OPPOSITE[o.side] });
  return hosts;
}

/**
 * The room the opening is on a wall of, and the side of that room it is on. The room that owns the cell the opening
 * is stored on comes first, then the room across the edge (a wall shared by two rooms has both as hosts: the first is
 * returned). null when no room owns either side: the opening hangs in empty space.
 */
export function hostOf(f: FloorData, o: Opening): Host | null {
  return hostsIn(cellOwnerMap(f.rooms), o)[0] ?? null;
}

/** An edge is a wall when the two sides have different owners (a room and nothing, or two rooms). */
function isWall(owner: Owner, o: Opening): boolean {
  const [nx, ny] = neighborCell(o.cx, o.cy, o.side);
  return owner.get(cellKey(o.cx, o.cy)) !== owner.get(cellKey(nx, ny));
}

/** Gridline of an edge and its position along that line: the same pair whichever of its two cells names it. */
function edgeAt(cx: number, cy: number, side: Side): { line: number; pos: number } {
  const [x1, y1] = edgeSegment(cx, cy, side);
  return side === 'N' || side === 'S' ? { line: y1, pos: x1 } : { line: x1, pos: y1 };
}

const lexLess = (a: number[], b: number[]): boolean => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
};

/**
 * The edge of the room that faces `dir` and lies closest to `from`: the distance across the wall first (how far the
 * wall moved), then the distance along it. Ties go to the smaller position, so the answer never depends on cell order.
 * Returned as the room's own cell and `dir`; null when the room has no cells.
 */
function nearestEdge(cells: CellKey[], dir: Side, from: { line: number; pos: number }): { cx: number; cy: number } | null {
  const own = new Set(cells);
  let best: { cx: number; cy: number; key: number[] } | null = null;
  for (const c of cells) {
    const [x, y] = parseCell(c);
    const [nx, ny] = neighborCell(x, y, dir);
    if (own.has(cellKey(nx, ny))) continue; // an inner edge of the room, not its boundary
    const e = edgeAt(x, y, dir);
    const key = [Math.abs(e.line - from.line), Math.abs(e.pos - from.pos), e.pos, e.line];
    if (!best || lexLess(key, best.key)) best = { cx: x, cy: y, key };
  }
  return best && { cx: best.cx, cy: best.cy };
}

/**
 * The openings of `after` once room `roomId` has changed shape from `before` to `after`.
 * An opening that was on a wall of the room and is no longer a wall of any room (the wall moved past it, or the edge
 * ended up inside the room or in the open) goes with the room: it moves to the closest boundary edge of the room
 * on the same side (see nearestEdge), or is deleted when the room has none. An opening that is still a wall
 * (a shared wall whose neighbour stays) and every opening of another room are left alone.
 * Returns `after.openings` itself when nothing moves.
 */
export function reconcileOpenings(before: FloorData, after: FloorData, roomId: string): Opening[] {
  const ownerBefore = cellOwnerMap(before.rooms);
  const ownerAfter = cellOwnerMap(after.rooms);
  const cells = after.rooms.find((r) => r.id === roomId)?.cells ?? [];
  let changed = false;
  const out: Opening[] = [];
  for (const o of after.openings) {
    const held = hostsIn(ownerBefore, o).find((h) => h.roomId === roomId);
    if (!held || !isWall(ownerBefore, o) || isWall(ownerAfter, o)) {
      out.push(o);
      continue;
    }
    changed = true;
    const to = nearestEdge(cells, held.dir, edgeAt(o.cx, o.cy, o.side));
    if (to) out.push({ ...o, cx: to.cx, cy: to.cy, side: held.dir });
  }
  return changed ? out : after.openings;
}

/** The floor without the openings that no room owns either side of any more. Returns `f` itself when none is dropped. */
export function pruneOrphans(f: FloorData): FloorData {
  const owner = cellOwnerMap(f.rooms);
  const kept = f.openings.filter((o) => hostsIn(owner, o).length > 0);
  return kept.length === f.openings.length ? f : { ...f, openings: kept };
}
