import { describe, expect, it } from 'vitest';
import { BASE_CELL_PX, GRID_H, GRID_W } from '../constants';
import type { FloorData } from '../types';
import { ZOOM_MAX, ZOOM_MIN, contentBox, fitZoom, padBox, scrollToBox } from './viewFit';

const CELL_MM = 455;
const floor = (over: Partial<FloorData> = {}): FloorData => ({ rooms: [], openings: [], furniture: [], ...over });
const room = (id: string, cells: string[]) => ({ id, name: id, typeId: 'living', cells, z: 1 });

describe('contentBox', () => {
  it('何も無い階は null', () => {
    expect(contentBox(floor(), CELL_MM)).toBeNull();
  });

  it('部屋のマス全体の外接矩形（セル単位。最後のマスの右下まで）', () => {
    const f = floor({ rooms: [room('a', ['2,3', '3,3']), room('b', ['6,5'])] });
    expect(contentBox(f, CELL_MM)).toEqual({ minX: 2, minY: 3, w: 5, h: 3 });
  });

  it('家具（mm 指定）も含み、グリッドの外にはみ出した分は含めない。完全に外なら無視する', () => {
    const f = floor({
      rooms: [room('a', ['10,10'])],
      furniture: [
        { id: 'f1', name: 'f', x: 2 * CELL_MM, y: 3 * CELL_MM, w: CELL_MM * 2, h: CELL_MM, color: '#000' },
        { id: 'f2', name: 'out', x: -5000, y: 1000, w: 100, h: 100, color: '#000' },
        { id: 'f3', name: 'edge', x: (GRID_W - 1) * CELL_MM, y: (GRID_H - 1) * CELL_MM, w: CELL_MM * 5, h: CELL_MM * 5, color: '#000' },
      ],
    });
    expect(contentBox(f, CELL_MM)).toEqual({ minX: 2, minY: 3, w: GRID_W - 2, h: GRID_H - 3 });
  });

  it('家具だけの階でも箱が出る。開口部のマスも含める', () => {
    const f = floor({
      furniture: [{ id: 'f', name: 'f', x: 0, y: 0, w: CELL_MM, h: CELL_MM, color: '#000' }],
      openings: [{ id: 'o', kind: 'door', cx: 7, cy: 8, side: 'N', size: 800 }],
    });
    expect(contentBox(f, CELL_MM)).toEqual({ minX: 0, minY: 0, w: 8, h: 9 });
  });
});

describe('fitZoom', () => {
  const box = { minX: 0, minY: 0, w: 10, h: 10 }; // 12 x 12 cells with the margin

  it('余白つきの箱が表示域に収まる最大の拡大率（1% 単位で切り捨て）', () => {
    expect(fitZoom(box, 528, 528)).toBe(2); // 528 / (12 * 22)
    expect(fitZoom(box, 440, 900)).toBe(1.66); // 440 / 264 = 1.666…: the width limits
    expect(fitZoom(box, 900, 440)).toBe(1.66); // the height limits
    expect(fitZoom(box, 440, 440) * 12 * BASE_CELL_PX).toBeLessThanOrEqual(440); // it really fits
  });

  it('拡大率の上限・下限に収める。大きさの無い表示域は 1', () => {
    expect(fitZoom({ minX: 0, minY: 0, w: 1, h: 1 }, 2000, 2000)).toBe(ZOOM_MAX);
    expect(fitZoom({ minX: 0, minY: 0, w: 60, h: 60 }, 300, 300)).toBe(ZOOM_MIN);
    expect(fitZoom(box, 0, 0)).toBe(1);
    expect(fitZoom(box, NaN, 300)).toBe(1);
  });
});

describe('scrollToBox / padBox', () => {
  it('箱の中心が表示域の中心に来る位置。負にはならない', () => {
    const view = { w: 400, h: 300 };
    const origin = { x: 20, y: 20 };
    const box = { minX: 30, minY: 20, w: 10, h: 10 };
    const cell = BASE_CELL_PX * 2;
    expect(scrollToBox(box, 2, view, origin)).toEqual({ left: 20 + 35 * cell - 200, top: 20 + 25 * cell - 150 });
    expect(scrollToBox({ minX: 0, minY: 0, w: 2, h: 2 }, 1, view, origin)).toEqual({ left: 0, top: 0 });
  });

  it('padBox は四方に余白を足す', () => {
    expect(padBox({ minX: 3, minY: 4, w: 5, h: 6 }, 2)).toEqual({ minX: 1, minY: 2, w: 9, h: 10 });
  });
});
