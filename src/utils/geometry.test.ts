import { describe, expect, it } from 'vitest';
import { GRID_H, GRID_W } from '../constants';
import type { Room } from '../types';
import { applyRunDrag, boundaryRuns, cellOwnerMap, clampRoomDelta, inGrid } from './geometry';

const room = (id: string, z: number, cells: string[]): Room => ({ id, name: id, typeId: 'living', cells, z });

describe('cellOwnerMap', () => {
  it('部屋が無ければ空', () => {
    expect(cellOwnerMap([]).size).toBe(0);
  });

  it('重ならない部屋は各マスの持ち主になる', () => {
    const m = cellOwnerMap([room('a', 1, ['0,0', '1,0']), room('b', 2, ['5,5'])]);
    expect([...m.entries()].sort()).toEqual([['0,0', 'a'], ['1,0', 'a'], ['5,5', 'b']]);
  });

  it('重なったマスは z の高い部屋のもの（並び順に依らない）', () => {
    const lo = room('lo', 1, ['2,2', '3,2']);
    const hi = room('hi', 5, ['3,2', '4,2']);
    for (const rooms of [[lo, hi], [hi, lo]]) {
      const m = cellOwnerMap(rooms);
      expect(m.get('2,2')).toBe('lo');
      expect(m.get('3,2')).toBe('hi');
      expect(m.get('4,2')).toBe('hi');
    }
  });

  it('z が同じなら後ろの部屋が勝つ', () => {
    expect(cellOwnerMap([room('first', 1, ['0,0']), room('second', 1, ['0,0'])]).get('0,0')).toBe('second');
  });

  it('渡した配列の並びを変えない', () => {
    const rooms = [room('hi', 9, ['0,0']), room('lo', 1, ['0,0'])];
    cellOwnerMap(rooms);
    expect(rooms.map((r) => r.id)).toEqual(['hi', 'lo']);
  });
});

describe('clampRoomDelta', () => {
  const rect = (x0: number, y0: number, x1: number, y1: number) => {
    const out: string[] = [];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push(`${x},${y}`);
    return out;
  };

  it('収まる移動量はそのまま返す', () => {
    expect(clampRoomDelta(rect(5, 5, 8, 7), 3, -4)).toEqual({ dx: 3, dy: -4 });
  });

  it('外接矩形が端に着くところまで切り詰める（左上・右下）', () => {
    expect(clampRoomDelta(rect(1, 1, 4, 3), -3, -9)).toEqual({ dx: -1, dy: -1 });
    expect(clampRoomDelta(rect(60, 60, 62, 62), 5, 9)).toEqual({ dx: 1, dy: 1 });
  });

  it('軸ごとに独立して切り詰める', () => {
    expect(clampRoomDelta(rect(0, 10, 2, 12), -4, 6)).toEqual({ dx: 0, dy: 6 });
  });

  it('L字など穴のある形も外接矩形で判断する', () => {
    const l = ['2,2', '2,3', '2,4', '3,4', '4,4']; // bbox x 2..4, y 2..4
    expect(clampRoomDelta(l, 100, 100)).toEqual({ dx: GRID_W - 1 - 4, dy: GRID_H - 1 - 4 });
  });

  it('端にある部屋の 0 は +0（-0 を返さない）', () => {
    const r = clampRoomDelta(rect(0, 0, 1, 1), -3, -3);
    expect(Object.is(r.dx, 0)).toBe(true);
    expect(Object.is(r.dy, 0)).toBe(true);
  });

  it('マスが無ければ制限しない', () => {
    expect(clampRoomDelta([], 7, -7)).toEqual({ dx: 7, dy: -7 });
  });
});

describe('inGrid / applyRunDrag のグリッド端', () => {
  it('inGrid は 0..GRID-1 の範囲', () => {
    expect(inGrid(0, 0)).toBe(true);
    expect(inGrid(GRID_W - 1, GRID_H - 1)).toBe(true);
    expect(inGrid(-1, 0)).toBe(false);
    expect(inGrid(0, GRID_H)).toBe(false);
  });

  it('端の辺を外へドラッグしても、グリッドの外にマスを作らない', () => {
    const cells = ['0,0', '1,0', '0,1', '1,1'];
    const top = boundaryRuns(cells).find((r) => r.dir === 'N')!;
    expect(applyRunDrag(cells, top, 3).sort()).toEqual([...cells].sort()); // nothing above row 0
    const left = boundaryRuns(cells).find((r) => r.dir === 'W')!;
    expect(applyRunDrag(cells, left, 2).sort()).toEqual([...cells].sort());
  });

  it('端の手前までは伸びる（残りの分だけ）', () => {
    const cells = ['2,5', '3,5'];
    const top = boundaryRuns(cells).find((r) => r.dir === 'N')!;
    expect(applyRunDrag(cells, top, 9).sort()).toEqual(['2,0', '2,1', '2,2', '2,3', '2,4', '2,5', '3,0', '3,1', '3,2', '3,3', '3,4', '3,5']);
  });
});
