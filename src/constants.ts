import type { Doc, Room, RoomType } from './types';

export const TATAMI_M2 = 1.62; // 不動産表示規約: 1畳 = 1.62m²
export const TSUBO_M2 = 3.305785; // 1坪

export const GRID_W = 64; // grid columns (455mm cells)
export const GRID_H = 64; // grid rows
export const BASE_CELL_PX = 22; // base pixel size of one 455mm cell

export const FLOORS = [1, 2] as const;

// Where the app is published (GitHub Pages). Everything that depends on this address reads it from here:
//  - vite.config.ts takes the production build's base path from it (APP_BASE_PATH);
//  - a share link made from a local run points here (utils/share.ts): a link to localhost opens nothing on another device;
//  - scripts/ui_lib.py reads this very line to start the preview server under the same base path.
export const PUBLIC_APP_URL = 'https://neguracg.github.io/MadoriSimulator/';
export const APP_BASE_PATH = new URL(PUBLIC_APP_URL).pathname; // '/MadoriSimulator/'

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

// door / window default colors and common widths (mm)
export const DOOR_COLOR = '#c0392b';
export const WINDOW_COLOR = '#2e86de';
export const DOOR_SIZES = [600, 700, 750, 800, 900, 1200];
export const WINDOW_SIZES = [600, 900, 1200, 1650, 1690, 1800];
export const DEFAULT_DOOR_SIZE = 800;
export const DEFAULT_WINDOW_SIZE = 1650;

export const DEFAULT_FURNITURE_COLOR = '#8a9ba8';

// Valid size limits (mm). normalizeDoc accepts/rejects stored data by these; numeric inputs should share them.
export const CELL_MM_RANGE = { min: 100, max: 1000 } as const;
export const WALL_MM_RANGE = { min: 50, max: 400 } as const;
export const OPENING_MM_RANGE = { min: 100, max: 4000 } as const;
export const FURNITURE_MIN_MM = 20;

export function emptyFloor() {
  return { rooms: [], openings: [], furniture: [] };
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

/** The colour a room is drawn in: its own override, else the colour of its type (grey when the type is gone). One rule for the canvas, the property panel and the printout. */
export function roomColor(room: Room, types: RoomType[]): string {
  return room.colorOverride ?? types.find((t) => t.id === room.typeId)?.color ?? '#bbbbbb';
}

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
