// @owns 間取り文書(Doc)の妥当性検査と旧形式からの移行（外から入る Doc は必ずここを通す）
import {
  CELL_MM_RANGE,
  DEFAULT_FURNITURE_COLOR,
  DEFAULT_TYPES,
  FLOORS,
  FURNITURE_MIN_MM,
  GRID_H,
  GRID_W,
  OPENING_MM_RANGE,
  WALL_MM_RANGE,
  defaultDoc,
  emptyFloor,
  uid,
} from '../constants';
import {
  cellKey,
  type CellKey,
  type Doc,
  type FloorData,
  type Furniture,
  type Opening,
  type Room,
  type RoomType,
  type Settings,
  type Side,
} from '../types';
import { resolveAllOverlaps } from './docOps';

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isSide = (v: unknown): v is Side => v === 'N' || v === 'E' || v === 'S' || v === 'W';
const inRange = (v: unknown, r: { min: number; max: number }): v is number => isNum(v) && v >= r.min && v <= r.max;

/** string as is; number/boolean stringified; anything else (null, objects) -> ''. */
const toStr = (v: unknown): string =>
  typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '';

const CELL_RE = /^(\d+),(\d+)$/;

/** Keep only "x,y" keys inside the grid; drop duplicates (first occurrence wins). */
function normalizeCells(v: unknown): CellKey[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<CellKey>();
  const out: CellKey[] = [];
  for (const c of v) {
    const m = typeof c === 'string' ? CELL_RE.exec(c) : null;
    if (!m) continue;
    const x = Number(m[1]);
    const y = Number(m[2]);
    if (x >= GRID_W || y >= GRID_H) continue;
    const k = cellKey(x, y);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
  }
  return out;
}

function normalizeRooms(v: unknown): Room[] {
  const kept: { r: Obj; cells: CellKey[] }[] = [];
  for (const r of Array.isArray(v) ? v : []) {
    if (!isObj(r)) continue;
    const cells = normalizeCells(r.cells);
    if (cells.length > 0) kept.push({ r, cells }); // a room without any valid cell is dropped
  }
  // rooms without a numeric z are numbered after the highest existing z, in order
  let nextZ = Math.max(0, ...kept.map(({ r }) => (isNum(r.z) ? r.z : 0))) + 1;
  return kept.map(({ r, cells }) => {
    const room: Room = {
      id: toStr(r.id) || uid(),
      name: toStr(r.name),
      typeId: toStr(r.typeId),
      cells,
      z: isNum(r.z) ? r.z : nextZ++,
    };
    if (typeof r.colorOverride === 'string') room.colorOverride = r.colorOverride;
    return room;
  });
}

function normalizeOpenings(v: unknown): Opening[] {
  const out: Opening[] = [];
  for (const o of Array.isArray(v) ? v : []) {
    if (!isObj(o)) continue;
    const { cx, cy, side, size } = o;
    if (!isInt(cx) || !isInt(cy) || !isSide(side) || !isNum(size) || size < OPENING_MM_RANGE.min) continue;
    out.push({ id: toStr(o.id) || uid(), kind: o.kind === 'window' ? 'window' : 'door', cx, cy, side, size });
  }
  return out;
}

function normalizeFurniture(v: unknown): Furniture[] {
  const out: Furniture[] = [];
  for (const f of Array.isArray(v) ? v : []) {
    if (!isObj(f)) continue;
    const { x, y, w, h } = f;
    if (!isNum(x) || !isNum(y) || !isNum(w) || !isNum(h) || w < FURNITURE_MIN_MM || h < FURNITURE_MIN_MM) continue;
    out.push({
      id: toStr(f.id) || uid(),
      name: typeof f.name === 'string' ? f.name : '家具',
      x,
      y,
      w,
      h,
      color: typeof f.color === 'string' ? f.color : DEFAULT_FURNITURE_COLOR,
    });
  }
  return out;
}

function normalizeFloor(v: unknown): FloorData {
  if (!isObj(v)) return emptyFloor();
  return { rooms: normalizeRooms(v.rooms), openings: normalizeOpenings(v.openings), furniture: normalizeFurniture(v.furniture) };
}

/** Entries without a usable id are dropped; no usable entry at all -> the default types. */
function normalizeRoomTypes(v: unknown): RoomType[] {
  const out: RoomType[] = [];
  for (const t of Array.isArray(v) ? v : []) {
    if (!isObj(t)) continue;
    const id = toStr(t.id);
    if (id) out.push({ id, name: toStr(t.name), color: typeof t.color === 'string' ? t.color : '#AEB6BF' });
  }
  return out.length > 0 ? out : DEFAULT_TYPES.map((t) => ({ ...t }));
}

function normalizeSettings(v: unknown): Settings {
  const s: Obj = isObj(v) ? v : {};
  const d = defaultDoc().settings;
  return {
    cellMm: inRange(s.cellMm, CELL_MM_RANGE) ? s.cellMm : d.cellMm,
    wallMm: inRange(s.wallMm, WALL_MM_RANGE) ? s.wallMm : d.wallMm,
  };
}

/**
 * Validate / repair a Doc coming from outside (localStorage, an imported file, a share link).
 * Returns a NEW object (the input is never modified), or null when `floors` is missing or not an object.
 * Old-format data is completed: both floors exist, every floor has rooms/openings/furniture arrays,
 * invalid cells / openings / furniture are dropped, out-of-range settings fall back to the defaults.
 */
export function normalizeDoc(raw: unknown): Doc | null {
  if (!isObj(raw) || !isObj(raw.floors)) return null;
  const src = raw.floors;
  const floors: Record<number, FloorData> = {};
  for (const f of FLOORS) floors[f] = normalizeFloor(src[f]);
  return { version: 1, floors, roomTypes: normalizeRoomTypes(raw.roomTypes), settings: normalizeSettings(raw.settings) };
}

/**
 * THE door for a document that comes from outside (a stored project, an imported file, a share link): every entrance
 * calls this and nothing else (src/lint/docEntrance.test.ts fails when one calls normalizeDoc directly).
 * normalizeDoc validates and repairs the shape; then the rooms are settled. A document at rest holds no overlapping
 * rooms, but one saved while still in move mode (tab closed or page reloaded before leaving it) does: it is settled
 * exactly as leaving move mode would (the room on top keeps a contested cell, doors/windows no room has go).
 * null when it is not a document at all.
 */
export function acceptDoc(raw: unknown): Doc | null {
  const doc = normalizeDoc(raw);
  return doc && resolveAllOverlaps(doc);
}
