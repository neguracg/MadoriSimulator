import { describe, expect, it } from 'vitest';
import type { Room } from '../types';
import { cellOwnerMap } from './geometry';

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
