export type CellKey = string; // "x,y"
export type Side = 'N' | 'E' | 'S' | 'W';
export type Mode = 'edit' | 'move';
/** In edit mode, what a cell drag does. */
export type CellAction = 'none' | 'expand' | 'shrink';

export interface RoomType {
  id: string;
  name: string;
  color: string;
}

export interface Room {
  id: string;
  name: string;
  typeId: string;
  cells: CellKey[];
  z: number; // layer order; higher = front
  colorOverride?: string;
}

export interface Opening {
  id: string;
  kind: 'door' | 'window';
  cx: number; // cell column the edge belongs to
  cy: number; // cell row the edge belongs to
  side: Side; // which edge of the cell
  size: number; // mm
}

/** Free-placed rectangular object (furniture) — positioned/sized in mm, not grid-locked. */
export interface Furniture {
  id: string;
  name: string;
  x: number; // mm, top-left
  y: number; // mm, top-left
  w: number; // mm
  h: number; // mm
  color: string;
}

export interface FloorData {
  rooms: Room[];
  openings: Opening[];
  furniture: Furniture[];
}

export interface Settings {
  cellMm: number;
  wallMm: number;
}

/** The undoable document. */
export interface Doc {
  version: number;
  floors: Record<number, FloorData>;
  roomTypes: RoomType[];
  settings: Settings;
}

export const cellKey = (x: number, y: number): CellKey => `${x},${y}`;
export const parseCell = (k: CellKey): [number, number] => {
  const i = k.indexOf(',');
  return [Number(k.slice(0, i)), Number(k.slice(i + 1))];
};
