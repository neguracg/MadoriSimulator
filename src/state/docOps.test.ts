import { describe, expect, it } from 'vitest';
import { defaultDoc } from '../constants';
import type { Doc, FloorData } from '../types';
import { linkedToRoomMove, translateRoom } from './docOps';

const CELL = 455;

/**
 * Floor 1:  A = x 2..4, y 2..3 (z1)   B = x 5..6, y 2..3 (z2), right next to A
 *   o-ext    door on the outer wall of A (top of 2,2)        -> travels with A
 *   o-in     window between two cells of A (right of 2,2)    -> travels with A (same room on both sides)
 *   o-shared door on the wall between A and B (right of 4,2) -> travels with neither
 *   o-far    window that is on no room                       -> stays
 *   f-in     centre inside A                                 -> travels with A
 *   f-edge   overlaps A but its centre is outside            -> stays
 *   f-out    far away                                        -> stays
 */
function floor(): FloorData {
  const a = ['2,2', '3,2', '4,2', '2,3', '3,3', '4,3'];
  const b = ['5,2', '6,2', '5,3', '6,3'];
  return {
    rooms: [
      { id: 'A', name: 'A', typeId: 'living', cells: a, z: 1 },
      { id: 'B', name: 'B', typeId: 'living', cells: b, z: 2 },
    ],
    openings: [
      { id: 'o-ext', kind: 'door', cx: 2, cy: 2, side: 'N', size: 800 },
      { id: 'o-in', kind: 'window', cx: 2, cy: 2, side: 'E', size: 900 },
      { id: 'o-shared', kind: 'door', cx: 4, cy: 2, side: 'E', size: 800 },
      { id: 'o-far', kind: 'window', cx: 20, cy: 20, side: 'N', size: 900 },
    ],
    furniture: [
      { id: 'f-in', name: 'in', x: 3 * CELL, y: 2 * CELL, w: 400, h: 400, color: '#888888' },
      { id: 'f-edge', name: 'edge', x: 0, y: 2 * CELL, w: 1000, h: 400, color: '#888888' },
      { id: 'f-out', name: 'out', x: 30 * CELL, y: 30 * CELL, w: 400, h: 400, color: '#888888' },
    ],
  };
}

const docWith = (f: FloorData): Doc => ({ ...defaultDoc(), floors: { 1: f, 2: { rooms: [], openings: [], furniture: [] } } });

describe('linkedToRoomMove', () => {
  it('外壁・部屋の内側の壁のドア/窓と、中心がその部屋にある家具が一緒に動く', () => {
    const r = linkedToRoomMove(floor(), 'A', CELL);
    expect([...r.openingIds].sort()).toEqual(['o-ext', 'o-in']);
    expect([...r.furnitureIds]).toEqual(['f-in']);
  });

  it('共有壁のドアはどちらの部屋が動いても置いていく', () => {
    expect(linkedToRoomMove(floor(), 'B', CELL).openingIds.has('o-shared')).toBe(false);
    expect(linkedToRoomMove(floor(), 'A', CELL).openingIds.has('o-shared')).toBe(false);
  });

  it('隣の部屋が無くなって外壁になったドアは動く', () => {
    const f = floor();
    f.rooms = f.rooms.filter((r) => r.id === 'A');
    expect(linkedToRoomMove(f, 'A', CELL).openingIds.has('o-shared')).toBe(true);
  });

  it('マスが重なっている時は z の高い部屋が持ち主として判定される', () => {
    const f = floor();
    f.rooms[1] = { ...f.rooms[1], cells: ['4,2', '5,2'] }; // B (z2) also covers 4,2, so it owns both sides of o-shared
    expect(linkedToRoomMove(f, 'B', CELL).openingIds.has('o-shared')).toBe(true);
    expect(linkedToRoomMove(f, 'A', CELL).openingIds.has('o-shared')).toBe(false);
  });

  it('存在しない部屋なら何も動かない', () => {
    const r = linkedToRoomMove(floor(), 'nope', CELL);
    expect(r.openingIds.size).toBe(0);
    expect(r.furnitureIds.size).toBe(0);
  });

  it('furniture が無い古い形の階でも落ちない', () => {
    const f = { ...floor(), furniture: undefined } as unknown as FloorData;
    expect(linkedToRoomMove(f, 'A', CELL).furnitureIds.size).toBe(0);
  });
});

describe('translateRoom (linkedToRoomMove を使う)', () => {
  it('部屋と、一緒に動くドア/窓・家具だけが移動量ぶん動く。動かした部屋は最前面になる', () => {
    const before = docWith(floor());
    const out = translateRoom(before, 1, 'A', 1, 2).floors[1];
    const byId = <T extends { id: string }>(xs: T[]) => Object.fromEntries(xs.map((x) => [x.id, x]));
    const rooms = byId(out.rooms);
    expect([...rooms.A.cells].sort()).toEqual(['3,4', '4,4', '5,4', '3,5', '4,5', '5,5'].sort());
    expect(rooms.A.z).toBe(3);
    expect(rooms.B).toEqual(before.floors[1].rooms[1]);
    const o = byId(out.openings);
    expect(o['o-ext']).toMatchObject({ cx: 3, cy: 4 });
    expect(o['o-in']).toMatchObject({ cx: 3, cy: 4 });
    expect(o['o-shared']).toMatchObject({ cx: 4, cy: 2 });
    expect(o['o-far']).toMatchObject({ cx: 20, cy: 20 });
    const f = byId(out.furniture);
    expect(f['f-in']).toMatchObject({ x: 3 * CELL + CELL, y: 2 * CELL + 2 * CELL });
    expect(f['f-edge']).toMatchObject({ x: 0, y: 2 * CELL });
    expect(f['f-out']).toMatchObject({ x: 30 * CELL, y: 30 * CELL });
  });

  it('元の文書を書き換えない。存在しない部屋なら同じ階をそのまま返す', () => {
    const before = docWith(floor());
    const snapshot = JSON.stringify(before);
    translateRoom(before, 1, 'A', 3, 3);
    expect(JSON.stringify(before)).toBe(snapshot);
    expect(translateRoom(before, 1, 'nope', 1, 1).floors[1]).toBe(before.floors[1]);
  });

  it('マスの大きさ(settings.cellMm)に合わせて家具を動かす', () => {
    const doc = docWith(floor());
    doc.settings = { cellMm: 500, wallMm: 120 };
    doc.floors[1].furniture = [{ id: 'f-in', name: 'in', x: 1000, y: 1000, w: 100, h: 100, color: '#888888' }]; // centre cell (2,2) at 500mm
    expect(translateRoom(doc, 1, 'A', 2, 0).floors[1].furniture[0]).toMatchObject({ x: 2000, y: 1000 });
  });
});
