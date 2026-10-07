import { describe, expect, it } from 'vitest';
import { defaultDoc, emptyFloor } from '../constants';
import type { Doc, FloorData, Opening, Room, Side } from '../types';
import { deleteRoom, expandRoom, resolveOverlaps, setRoomShape, shrinkRoom, translateRoom } from './docOps';
import { hostOf, pruneOrphans, reconcileOpenings } from './openingOps';

/** Cell keys of the rectangle x0..x1 × y0..y1 (inclusive). */
function rect(x0: number, y0: number, x1: number, y1: number): string[] {
  const out: string[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push(`${x},${y}`);
  return out;
}
const room = (id: string, cells: string[], z = 1): Room => ({ id, name: id, typeId: 'living', cells, z });
const op = (id: string, cx: number, cy: number, side: Side, kind: 'door' | 'window' = 'door'): Opening => ({ id, kind, cx, cy, side, size: 800 });
const floorOf = (rooms: Room[], openings: Opening[]): FloorData => ({ rooms, openings, furniture: [] });
const docOf = (f: FloorData): Doc => ({ ...defaultDoc(), floors: { 1: f, 2: emptyFloor() } });
const at = (d: Doc, id: string) => d.floors[1].openings.find((o) => o.id === id);
const pos = (o: Opening | undefined) => (o ? `${o.cx},${o.cy},${o.side}` : undefined);

describe('hostOf', () => {
  const f = floorOf([room('A', rect(2, 2, 4, 4))], []);

  it('部屋のマスに付いたドアは、その部屋とその部屋から見た向き', () => {
    expect(hostOf(f, op('d', 3, 2, 'N'))).toEqual({ roomId: 'A', dir: 'N' });
    expect(hostOf(f, op('d', 4, 3, 'E'))).toEqual({ roomId: 'A', dir: 'E' });
  });

  it('外側の空きマスに付いて隣が部屋なら、反対向き', () => {
    expect(hostOf(f, op('d', 3, 1, 'S'))).toEqual({ roomId: 'A', dir: 'N' });
    expect(hostOf(f, op('d', 5, 3, 'W'))).toEqual({ roomId: 'A', dir: 'E' });
  });

  it('どの部屋にも属さなければ null', () => {
    expect(hostOf(f, op('d', 10, 10, 'N'))).toBeNull();
    expect(hostOf(f, op('d', 3, 0, 'N'))).toBeNull();
  });

  it('2部屋の共有壁は、付いているマスの側の部屋が先', () => {
    const shared = floorOf([room('A', rect(2, 2, 3, 3)), room('B', rect(4, 2, 5, 3))], []);
    expect(hostOf(shared, op('d', 3, 2, 'E'))).toEqual({ roomId: 'A', dir: 'E' });
    expect(hostOf(shared, op('d', 4, 2, 'W'))).toEqual({ roomId: 'B', dir: 'W' });
  });

  it('マスが重なっている時は z の高い部屋が持ち主', () => {
    const over = floorOf([room('lo', rect(2, 2, 4, 4), 1), room('hi', rect(3, 2, 6, 4), 2)], []);
    expect(hostOf(over, op('d', 3, 2, 'N'))).toEqual({ roomId: 'hi', dir: 'N' });
  });
});

describe('reconcileOpenings: 部屋の形が変わるとドア/窓が壁に追随する（F6）', () => {
  const A = rect(2, 2, 7, 6); // x 2..7, y 2..6
  const start = (openings: Opening[], extra: Room[] = []) => docOf(floorOf([room('A', A), ...extra], openings));

  it('辺を外へ2マス伸ばすと、ドアは新しい壁の同じ位置へ移る', () => {
    const d = start([op('d', 3, 2, 'N')]);
    expect(pos(at(setRoomShape(d, 1, 'A', rect(2, 0, 7, 6)), 'd'))).toBe('3,0,N');
    expect(pos(at(expandRoom(d, 1, 'A', rect(2, 0, 7, 1)), 'd'))).toBe('3,0,N'); // マス追加でも同じ
  });

  it('矩形の角ドラッグ: 外へ広げると辺上の窓は同じ向きの新しい辺へ、動かなかった壁の窓はそのまま', () => {
    const d = start([op('e', 7, 4, 'E', 'window'), op('n', 3, 2, 'N', 'window')]);
    const out = setRoomShape(d, 1, 'A', rect(2, 2, 9, 8)); // bottom-right corner to (9,8)
    expect(pos(at(out, 'e'))).toBe('9,4,E');
    expect(pos(at(out, 'n'))).toBe('3,2,N'); // the north wall did not move
  });

  it('矩形の角ドラッグ: 内側へ縮めて壁が窓を通り過ぎたら、同じ向きの壁のいちばん近い位置へ', () => {
    const d = start([op('n', 3, 2, 'N', 'window'), op('e', 7, 4, 'E', 'window')]);
    const out = setRoomShape(d, 1, 'A', rect(4, 4, 7, 6)); // top-left corner to (4,4)
    expect(pos(at(out, 'n'))).toBe('4,4,N'); // column 3 is gone: the nearest column of the new north wall
    expect(pos(at(out, 'e'))).toBe('7,4,E'); // the east wall did not move
  });

  it('追随先が複数ある時は、壁をまたぐ距離（垂直方向）が近い辺を選び、同じなら辺方向が近いものを選ぶ', () => {
    // before: x 2..7, y 3..6 with the door on its top wall at column 6. after: a tall right part and a short left part.
    const before = floorOf([room('A', rect(2, 3, 7, 6))], [op('d', 6, 3, 'N')]);
    const after = floorOf([room('A', [...rect(5, 1, 7, 6), ...rect(2, 4, 4, 6)])], before.openings);
    const out = reconcileOpenings(before, after, 'A');
    // top edges: right part at gridline 1 (2 away from the door's gridline 3), left part at gridline 4 (1 away)
    expect(pos(out[0])).toBe('4,4,N'); // the left part wins on the wall distance, the column nearest to 6 is 4
  });

  it('壁をまたぐ距離が同じなら辺方向の近い方。それも同じなら小さい位置（セルの並びに依らない）', () => {
    const before = floorOf([room('A', rect(2, 3, 8, 6))], [op('d', 5, 3, 'N')]);
    const cols = (...c: string[][]) => c.flat();
    const afterA = floorOf([room('A', cols(rect(3, 3, 3, 6), rect(7, 3, 7, 6)))], before.openings);
    expect(pos(reconcileOpenings(before, afterA, 'A')[0])).toBe('3,3,N'); // columns 3 and 7 are both 2 away: the smaller wins
    const afterB = floorOf([room('A', cols(rect(7, 3, 7, 6), rect(3, 3, 3, 6)))], before.openings); // same cells, other order
    expect(pos(reconcileOpenings(before, afterB, 'A')[0])).toBe('3,3,N');
  });

  it('候補が無ければ削除する（部屋が無くなった）', () => {
    const d = start([op('d', 3, 2, 'N')]);
    expect(shrinkRoom(d, 1, 'A', A).floors[1].openings).toEqual([]);
  });

  it('他の部屋のドア/窓は触らない', () => {
    const d = start([op('mine', 3, 2, 'N'), op('theirs', 11, 10, 'N')], [room('C', rect(10, 10, 12, 12), 2)]);
    const out = setRoomShape(d, 1, 'A', rect(2, 0, 7, 6));
    expect(pos(at(out, 'mine'))).toBe('3,0,N');
    expect(at(out, 'theirs')).toBe(d.floors[1].openings[1]); // the very same object
  });

  it('壁のまま変わらないものがあるなら、配列そのものを返す', () => {
    const before = floorOf([room('A', A)], [op('d', 3, 2, 'N')]);
    const after = floorOf([room('A', rect(2, 2, 7, 8))], before.openings); // grows to the south only
    expect(reconcileOpenings(before, after, 'A')).toBe(after.openings);
  });

  it('共有壁のドアは、片方が離れても隣の部屋の壁として残る（動かさない）', () => {
    const d = docOf(floorOf([room('A', rect(2, 2, 3, 3)), room('B', rect(4, 2, 5, 3), 2)], [op('d', 3, 2, 'E')]));
    const out = shrinkRoom(d, 1, 'A', ['3,2', '3,3']); // A pulls back from the shared wall
    expect(pos(at(out, 'd'))).toBe('3,2,E');
  });

  it('隣の部屋が共有壁を飲み込んだら、飲み込んだ部屋の新しい壁（同じ向き）へ移る', () => {
    const d = docOf(floorOf([room('A', rect(2, 2, 3, 3)), room('B', rect(4, 2, 5, 3), 2)], [op('d', 3, 2, 'E')]));
    const out = expandRoom(d, 1, 'B', rect(2, 2, 3, 3)); // B takes the cells of A: the door is inside B now
    expect(out.floors[1].rooms.map((r) => r.id)).toEqual(['B']);
    expect(pos(at(out, 'd'))).toBe('2,2,W'); // seen from B the door was on its west side
  });

  it('もとから部屋の内側にあった窓は、その部屋の形を変えても動かさない', () => {
    const d = docOf(floorOf([room('A', rect(2, 2, 4, 3))], [op('w', 3, 2, 'E', 'window')])); // between two cells of A
    const out = expandRoom(d, 1, 'A', ['5,2']);
    expect(pos(at(out, 'w'))).toBe('3,2,E');
  });

  it('入力を書き換えない', () => {
    const before = floorOf([room('A', A)], [op('d', 3, 2, 'N')]);
    const after = floorOf([room('A', rect(2, 0, 7, 6))], before.openings);
    const snap = JSON.stringify([before, after]);
    reconcileOpenings(before, after, 'A');
    expect(JSON.stringify([before, after])).toBe(snap);
  });

  it('無作為な矩形への変形を何度繰り返しても、ドア/窓は壁に付いたまま（宙に浮かない・本数が変わらない）', () => {
    let seed = 12345;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    for (let i = 0; i < 300; i++) {
      const x0 = 3 + rnd(8);
      const y0 = 3 + rnd(8);
      const x1 = x0 + 1 + rnd(8);
      const y1 = y0 + 1 + rnd(8);
      const sides: Side[] = ['N', 'S', 'W', 'E'];
      const openings: Opening[] = sides.map((s, k) => {
        const cx = s === 'W' ? x0 : s === 'E' ? x1 : x0 + rnd(x1 - x0 + 1);
        const cy = s === 'N' ? y0 : s === 'S' ? y1 : y0 + rnd(y1 - y0 + 1);
        return op(`o${k}`, cx, cy, s);
      });
      const d = docOf(floorOf([room('A', rect(x0, y0, x1, y1))], openings));
      const nx0 = 1 + rnd(12);
      const ny0 = 1 + rnd(12);
      const out = setRoomShape(d, 1, 'A', rect(nx0, ny0, nx0 + rnd(10), ny0 + rnd(10)));
      const f = out.floors[1];
      expect(f.openings.length).toBe(4);
      for (const o of f.openings) expect(hostOf(f, o), `iteration ${i}: ${pos(o)}`).not.toBeNull();
    }
  });
});

describe('pruneOrphans / 部屋を消した時の孤立除去（B11）', () => {
  it('部屋を削除すると、その部屋だけの壁にあったドア/窓も消える（外側マスに付いたものも）', () => {
    const d = docOf(floorOf([room('A', rect(2, 2, 4, 4))], [op('own', 3, 2, 'N'), op('outer', 3, 1, 'S'), op('side', 4, 3, 'E')]));
    expect(deleteRoom(d, 1, 'A').floors[1].openings).toEqual([]);
  });

  it('共有壁のドアは、隣の部屋が残る限り消えない。最後の部屋が消えたら消える', () => {
    const d = docOf(floorOf([room('A', rect(2, 2, 3, 3)), room('B', rect(4, 2, 5, 3), 2)], [op('d', 3, 2, 'E')]));
    const onlyB = deleteRoom(d, 1, 'A');
    expect(pos(at(onlyB, 'd'))).toBe('3,2,E');
    expect(deleteRoom(onlyB, 1, 'B').floors[1].openings).toEqual([]);
  });

  it('他の部屋の（内側にある窓を含む）ドア/窓は消さない', () => {
    const d = docOf(floorOf([room('A', rect(2, 2, 4, 4)), room('C', rect(10, 10, 12, 12), 2)], [op('inner', 11, 10, 'E', 'window'), op('mine', 3, 2, 'N')]));
    const out = deleteRoom(d, 1, 'A');
    expect(out.floors[1].openings.map((o) => o.id)).toEqual(['inner']);
  });

  it('pruneOrphans は何も落とさない時、同じ階を返す', () => {
    const f = floorOf([room('A', rect(2, 2, 4, 4))], [op('d', 3, 2, 'N')]);
    expect(pruneOrphans(f)).toBe(f);
    expect(pruneOrphans(floorOf([], [op('x', 1, 1, 'N')])).openings).toEqual([]);
  });

  it('どの部屋にも属さないドア/窓は、重なり解決（編集へ戻る時）で消える。何も無ければ同じ文書を返す', () => {
    const f = floorOf([room('A', rect(2, 2, 3, 3))], [op('d', 3, 2, 'N')]);
    const d = docOf(f);
    expect(resolveOverlaps(d, 1)).toBe(d);
    const out = resolveOverlaps(docOf({ ...f, openings: [...f.openings, op('lost', 20, 20, 'N')] }), 1);
    expect(out.floors[1].openings.map((o) => o.id)).toEqual(['d']);
  });

  it('重なりで部屋がマスを失っても、勝った部屋が持つ壁のドアは消えない', () => {
    const d = docOf(floorOf([room('B', rect(6, 2, 7, 3), 2), room('A', rect(4, 2, 6, 3), 3)], [op('d', 6, 2, 'N')]));
    const out = resolveOverlaps(d, 1);
    expect(out.floors[1].rooms.find((r) => r.id === 'B')!.cells.sort()).toEqual(['7,2', '7,3']);
    expect(pos(at(out, 'd'))).toBe('6,2,N');
  });

  it('共有壁のドアは、片方が動き去っても動かず、残った隣の部屋が動くと外壁として一緒に動く（既存の連動ルール）', () => {
    const d = docOf(floorOf([room('A', rect(2, 2, 3, 3)), room('B', rect(4, 2, 5, 3), 2)], [op('d', 3, 2, 'E')]));
    const aGone = translateRoom(d, 1, 'A', 0, 10);
    expect(pos(at(aGone, 'd'))).toBe('3,2,E'); // stays on the wall of B
    expect(pos(at(translateRoom(aGone, 1, 'B', 0, 10), 'd'))).toBe('3,12,E'); // now an outer wall of B: goes with it
  });
});
