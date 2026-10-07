// @owns 表示範囲の自動調整: 内容の外接矩形・「全体」表示のズームとスクロール位置・印刷で描く範囲
import { BASE_CELL_PX, GRID_H, GRID_W } from '../constants';
import { parseCell, type FloorData } from '../types';

/** Zoom limits of the canvas (the zoom buttons and the fit use the same). */
export const ZOOM_MIN = 0.4;
export const ZOOM_MAX = 2.5;

/** Empty cells kept around the content: the edge-length labels sit outside the outer wall. */
export const FIT_MARGIN_CELLS = 1;

/** A rectangle in cell units. Not whole cells: furniture is placed in mm. */
export interface CellBox {
  minX: number;
  minY: number;
  w: number;
  h: number;
}

/**
 * The box that holds everything drawn on a floor: rooms, doors/windows and furniture, as far as they are on the grid
 * (the canvas draws nothing outside it). null when there is nothing to show.
 */
export function contentBox(f: FloorData, cellMm: number): CellBox | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const grow = (x0: number, y0: number, x1: number, y1: number) => {
    const [a, b, c, d] = [Math.max(0, x0), Math.max(0, y0), Math.min(GRID_W, x1), Math.min(GRID_H, y1)];
    if (a >= c || b >= d) return; // wholly outside the grid
    minX = Math.min(minX, a);
    minY = Math.min(minY, b);
    maxX = Math.max(maxX, c);
    maxY = Math.max(maxY, d);
  };
  for (const r of f.rooms) {
    for (const c of r.cells) {
      const [x, y] = parseCell(c);
      grow(x, y, x + 1, y + 1);
    }
  }
  for (const o of f.openings) grow(o.cx, o.cy, o.cx + 1, o.cy + 1);
  for (const it of f.furniture) grow(it.x / cellMm, it.y / cellMm, (it.x + it.w) / cellMm, (it.y + it.h) / cellMm);
  return minX === Infinity ? null : { minX, minY, w: maxX - minX, h: maxY - minY };
}

/** `box` grown by `pad` cells on every side. */
export function padBox(box: CellBox, pad: number = FIT_MARGIN_CELLS): CellBox {
  return { minX: box.minX - pad, minY: box.minY - pad, w: box.w + 2 * pad, h: box.h + 2 * pad };
}

export const clampZoom = (z: number): number => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

/**
 * The zoom at which `box` (with its margin) fits a view of viewW x viewH px: the largest one, rounded down to 1% so
 * it surely fits, held to the zoom limits. A view that has no size (not shown) gives 1.
 */
export function fitZoom(box: CellBox, viewW: number, viewH: number): number {
  const p = padBox(box);
  const z = Math.min(viewW / (p.w * BASE_CELL_PX), viewH / (p.h * BASE_CELL_PX));
  return Number.isFinite(z) && z > 0 ? clampZoom(Math.floor(z * 100) / 100) : 1;
}

/**
 * The scroll position that puts the centre of `box` in the middle of the view. `origin` is where the drawing starts
 * inside the scrolled area (its padding). Never negative; the browser holds it to the end of the scrollable area.
 */
export function scrollToBox(
  box: CellBox,
  zoom: number,
  view: { w: number; h: number },
  origin: { x: number; y: number },
): { left: number; top: number } {
  const cell = BASE_CELL_PX * zoom;
  return {
    left: Math.max(0, origin.x + (box.minX + box.w / 2) * cell - view.w / 2),
    top: Math.max(0, origin.y + (box.minY + box.h / 2) * cell - view.h / 2),
  };
}
