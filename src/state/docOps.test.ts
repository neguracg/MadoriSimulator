import { describe, expect, it } from 'vitest';
import { GRID_H, GRID_W, defaultDoc } from '../constants';
import type { Doc, FloorData, Furniture, Room } from '../types';
import { linkedToRoomMove, pasteFurniture, pasteRoom, resolveAllOverlaps, translateRoom } from './docOps';

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

// ---- B3: a move is held to the grid as a whole ----------------------------------------------------------------

/** Cell keys of the rectangle x0..x1 × y0..y1 (inclusive). */
function rect(x0: number, y0: number, x1: number, y1: number): string[] {
  const out: string[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push(`${x},${y}`);
  return out;
}
const sorted = (xs: string[]) => [...xs].sort();
const room = (id: string, cells: string[], z = 1): Room => ({ id, name: id, typeId: 'living', cells, z });
const solo = (cells: string[], extra: Partial<FloorData> = {}): Doc =>
  docWith({ rooms: [room('A', cells)], openings: [], furniture: [], ...extra });
const cellsOf = (doc: Doc, id = 'A') => sorted(doc.floors[1].rooms.find((r) => r.id === id)!.cells);

describe('translateRoom: 端の外へ動かしても形を保つ（B3）', () => {
  it('4x3 の部屋を左へ3マス頼むと、入る分(1マス)だけ動いて12マスのまま', () => {
    const out = translateRoom(solo(rect(1, 1, 4, 3)), 1, 'A', -3, 0);
    expect(cellsOf(out)).toEqual(sorted(rect(0, 1, 3, 3)));
  });

  it('右下の端でも同じ。軸ごとに切り詰める（x は入る分、y は端まで）', () => {
    const out = translateRoom(solo(rect(60, 10, 62, 12)), 1, 'A', 100, 100);
    expect(cellsOf(out)).toEqual(sorted(rect(61, 61, 63, 63)));
  });

  it('片方の軸だけが端に当たっても、もう一方は頼んだ量のまま動く', () => {
    const out = translateRoom(solo(rect(5, 0, 6, 1)), 1, 'A', -3, -2);
    expect(cellsOf(out)).toEqual(sorted(rect(2, 0, 3, 1)));
  });

  it('動けない（切り詰めて 0）なら何も変えない。最前面にもしない', () => {
    const before = solo(rect(0, 0, 3, 3));
    const out = translateRoom(before, 1, 'A', -5, -5);
    expect(out.floors[1]).toBe(before.floors[1]);
  });

  it('ドア/窓と家具は、部屋と同じ（切り詰めた後の）移動量で動く。それぞれの個別クランプはしない', () => {
    const before = solo(rect(1, 1, 4, 3), {
      openings: [
        { id: 'top', kind: 'door', cx: 2, cy: 1, side: 'N', size: 800 },
        { id: 'right', kind: 'window', cx: 4, cy: 2, side: 'E', size: 900 },
      ],
      furniture: [{ id: 'f', name: 'f', x: 2 * CELL + 50, y: 2 * CELL, w: 400, h: 400, color: '#888888' }],
    });
    const out = translateRoom(before, 1, 'A', -3, 0).floors[1];
    expect(out.rooms[0].cells.length).toBe(12);
    expect(out.openings[0]).toMatchObject({ cx: 1, cy: 1, side: 'N' }); // moved by -1, not clamped to 0
    expect(out.openings[1]).toMatchObject({ cx: 3, cy: 2, side: 'E' });
    expect(out.furniture[0]).toMatchObject({ x: 2 * CELL + 50 - CELL, y: 2 * CELL });
  });

  it('外側のマスを持ち主にしたドア（隣が部屋）も、部屋の壁から離れない', () => {
    // the door is stored on the empty cell (63,5), side W: it is the east wall of the room at x 60..62
    const before = solo(rect(60, 5, 62, 6), { openings: [{ id: 'o', kind: 'door', cx: 63, cy: 5, side: 'W', size: 800 }] });
    expect(linkedToRoomMove(before.floors[1], 'A', CELL).openingIds.has('o')).toBe(true);
    const after = translateRoom(before, 1, 'A', 9, 0); // asked 9, only 1 fits
    expect(cellsOf(after)).toEqual(sorted(rect(61, 5, 63, 6)));
    expect(after.floors[1].openings[0]).toMatchObject({ cx: 64, cy: 5, side: 'W' }); // still the east wall (a per-door clamp gave cx 63)
    expect(linkedToRoomMove(after.floors[1], 'A', CELL).openingIds.has('o')).toBe(true);
  });

  it('部屋からはみ出した家具も部屋と一緒に動く（0 で止めて相対位置をずらさない）', () => {
    const before = solo(rect(1, 1, 2, 1), {
      furniture: [{ id: 'f', name: 'f', x: 300, y: CELL, w: 400, h: 200, color: '#888888' }], // centre cell (1,1): sticks out of the room on the left
    });
    const out = translateRoom(before, 1, 'A', -5, 0).floors[1];
    expect(out.rooms[0].cells).toEqual(['0,1', '1,1']);
    expect(out.furniture[0].x).toBe(300 - CELL);
  });
});

describe('pasteRoom: グリッドの内側へ、形を保ってずらす（B12）', () => {
  const src = (cells: string[]): Room => room('src', cells, 3);
  const paste = (cells: string[], dcx: number, dcy: number) =>
    pasteRoom(solo(['0,0']), 1, src(cells), null, 'new', dcx, dcy).floors[1].rooms.find((r) => r.id === 'new')!;

  it('収まる時は頼んだ量のままずらす', () => {
    expect(sorted(paste(rect(2, 2, 4, 3), 1, 1).cells)).toEqual(sorted(rect(3, 3, 5, 4)));
  });

  it('右下の端では入る分だけずらす（形は同じ・範囲外のマスは作らない）', () => {
    const p = paste(rect(61, 60, 63, 62), 1, 1);
    expect(sorted(p.cells)).toEqual(sorted(rect(61, 61, 63, 63)));
  });

  it('角でずらす余地が無ければ、そのままの位置（元の部屋の上）に貼る。新しい id・最前面', () => {
    const out = pasteRoom(solo(['0,0']), 1, src(rect(62, 62, 63, 63)), null, 'new', 1, 1).floors[1];
    const p = out.rooms.find((r) => r.id === 'new')!;
    expect(sorted(p.cells)).toEqual(sorted(rect(62, 62, 63, 63)));
    expect(p.z).toBe(Math.max(...out.rooms.map((r) => r.z)));
  });

  it('端の近くのどんな位置・向きでも、貼った部屋は全マスがグリッド内で、元と同じ形（同じ相対位置）', () => {
    for (const [x0, y0] of [[0, 0], [62, 0], [0, 62], [60, 60], [63, 63], [31, 62]]) {
      for (const [dx, dy] of [[1, 1], [0, 0], [3, 2], [-1, 0]]) {
        const cells = rect(x0, y0, Math.min(x0 + 2, GRID_W - 1), Math.min(y0 + 1, GRID_H - 1));
        const p = paste(cells, dx, dy).cells.map((c) => c.split(',').map(Number));
        expect(p.every(([x, y]) => x >= 0 && y >= 0 && x < GRID_W && y < GRID_H)).toBe(true);
        const o = cells.map((c) => c.split(',').map(Number));
        const shift = [p[0][0] - o[0][0], p[0][1] - o[0][1]];
        expect(p.every(([x, y], i) => x - o[i][0] === shift[0] && y - o[i][1] === shift[1])).toBe(true);
      }
    }
  });

  it('未知の種別は貼り付け先に足す（従来どおり）', () => {
    const type = { id: 'extra', name: '追加', color: '#123456' };
    const out = pasteRoom(solo(['0,0']), 1, src(['5,5']), type, 'new', 0, 0);
    expect(out.roomTypes.some((t) => t.id === 'extra')).toBe(true);
  });
});

describe('pasteFurniture: グリッド内に収める（B12）', () => {
  const item = (x: number, y: number, w = 400, h = 300): Furniture => ({ id: 's', name: 's', x, y, w, h, color: '#888888' });
  const paste = (it: Furniture, dx: number, dy: number, cellMm = CELL) => {
    const doc = solo(['0,0']);
    doc.settings = { cellMm, wallMm: 120 };
    return pasteFurniture(doc, 1, it, 'new', dx, dy).floors[1].furniture.find((f) => f.id === 'new')!;
  };

  it('収まる時は頼んだ量のままずらす', () => {
    expect(paste(item(1000, 2000), CELL, CELL)).toMatchObject({ x: 1000 + CELL, y: 2000 + CELL, w: 400, h: 300 });
  });

  it('右端・下端では、はみ出さない位置（端 - 大きさ）に止める', () => {
    const p = paste(item(GRID_W * CELL - 400, GRID_H * CELL - 300), CELL, CELL);
    expect(p).toMatchObject({ x: GRID_W * CELL - 400, y: GRID_H * CELL - 300 });
  });

  it('負の位置は 0 に。グリッドより大きい家具は左上を 0 に置く', () => {
    expect(paste(item(-200, -50), 0, 0)).toMatchObject({ x: 0, y: 0 });
    expect(paste(item(0, 0, 100000, 100000), 0, 0)).toMatchObject({ x: 0, y: 0 });
  });

  it('マスの大きさ(settings.cellMm)に合わせた端で止める', () => {
    expect(paste(item(3000, 0), 5000, 0, 100).x).toBe(GRID_W * 100 - 400);
  });
});

describe('resolveAllOverlaps: 全部の階の重なりを解消する', () => {
  const room = (id: string, cells: string[], z: number): Room => ({ id, name: id, typeId: 'living', cells, z });

  it('1階も2階も、上の部屋が重なったマスを取る。何も無ければ同じ文書を返す', () => {
    const d = defaultDoc();
    d.floors[1].rooms.push(room('a', ['0,0', '1,0'], 1), room('b', ['1,0', '2,0'], 2));
    d.floors[2].rooms.push(room('c', ['0,0', '0,1'], 2), room('d', ['0,1', '0,2'], 1));
    const out = resolveAllOverlaps(d);
    expect(out.floors[1].rooms.map((r) => [r.id, r.cells])).toEqual([['a', ['0,0']], ['b', ['1,0', '2,0']]]);
    expect(out.floors[2].rooms.map((r) => [r.id, r.cells])).toEqual([['c', ['0,0', '0,1']], ['d', ['0,2']]]);

    expect(resolveAllOverlaps(out)).toBe(out); // 解消済み（部屋も開口部も触るものが無い）
    expect(resolveAllOverlaps(defaultDoc())).toEqual(defaultDoc());
  });
});
