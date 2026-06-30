import type { Doc, RoomType } from './types';

export const TATAMI_M2 = 1.62; // 不動産表示規約: 1畳 = 1.62m²
export const TSUBO_M2 = 3.305785; // 1坪

export const GRID_W = 64; // grid columns (455mm cells)
export const GRID_H = 64; // grid rows
export const BASE_CELL_PX = 22; // base pixel size of one 455mm cell

export const FLOORS = [1, 2] as const;

export const DEFAULT_TYPES: RoomType[] = [
  { id: 'living', name: '居室', color: '#7FB3D5' },
  { id: 'ldk', name: 'LDK', color: '#F5B041' },
  { id: 'water', name: '水回り', color: '#76D7C4' },
  { id: 'storage', name: '収納', color: '#BB8FCE' },
  { id: 'entrance', name: '玄関', color: '#F1948A' },
  { id: 'hall', name: '廊下', color: '#D7DBDD' },
  { id: 'stairs', name: '階段', color: '#F7DC6F' },
  { id: 'other', name: 'その他', color: '#AEB6BF' },
];

// palette used when auto-assigning a color to a newly added room type
export const AUTO_PALETTE = [
  '#85C1E9', '#F8C471', '#82E0AA', '#C39BD3', '#F1948A',
  '#73C6B6', '#F0B27A', '#A9CCE3', '#D2B4DE', '#7DCEA0',
  '#E59866', '#48C9B0', '#5DADE2', '#EC7063', '#AF7AC5',
];

export function nextAutoColor(usedCount: number): string {
  return AUTO_PALETTE[usedCount % AUTO_PALETTE.length];
}

export function emptyFloor() {
  return { rooms: [], openings: [] };
}

export function defaultDoc(): Doc {
  return {
    version: 1,
    floors: { 1: emptyFloor(), 2: emptyFloor() },
    roomTypes: DEFAULT_TYPES.map((t) => ({ ...t })),
    settings: { cellMm: 455, wallMm: 120 },
  };
}

export const uid = (): string =>
  (crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2)}`);

/** Area helpers (input: number of cells, cell size in mm). */
export function cellsToM2(cells: number, cellMm: number): number {
  const m = cellMm / 1000;
  return cells * m * m;
}
export function m2ToJou(m2: number): number {
  return m2 / TATAMI_M2;
}
export function m2ToTsubo(m2: number): number {
  return m2 / TSUBO_M2;
}
