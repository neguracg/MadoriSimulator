import { describe, expect, it } from 'vitest';
import { DEFAULT_TYPES, defaultDoc } from '../constants';
import type { Doc } from '../types';
import { acceptDoc, normalizeDoc } from './migrate';

/** A document exactly as the current app writes it (every field filled in). */
function normalDoc(): Doc {
  return {
    version: 1,
    floors: {
      1: {
        rooms: [
          { id: 'r1', name: 'LDK', typeId: 'ldk', cells: ['2,2', '3,2', '2,3', '3,3'], z: 1 },
          { id: 'r2', name: '寝室', typeId: 'living', cells: ['4,2', '4,3'], z: 2, colorOverride: '#112233' },
        ],
        openings: [
          { id: 'o1', kind: 'door', cx: 3, cy: 2, side: 'N', size: 800 },
          { id: 'o2', kind: 'window', cx: 4, cy: 3, side: 'E', size: 1650 },
        ],
        furniture: [{ id: 'f1', name: 'ソファ', x: 1000, y: 1500, w: 1800, h: 900, color: '#8a9ba8' }],
      },
      2: { rooms: [{ id: 'r3', name: '子供部屋', typeId: 'living', cells: ['0,0', '1,0'], z: 1 }], openings: [], furniture: [] },
    },
    roomTypes: DEFAULT_TYPES.map((t) => ({ ...t })),
    settings: { cellMm: 500, wallMm: 150 },
  };
}

/** Old-format data: no openings / furniture, no second floor, no types and settings. */
function legacyRaw(): unknown {
  return {
    version: 1,
    floors: { 1: { rooms: [{ id: 'r', name: '旧部屋', typeId: 'living', cells: ['2,2', '3,2'], z: 1 }] } },
  };
}

function deepFreeze<T>(o: T): T {
  if (typeof o === 'object' && o !== null) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

describe('normalizeDoc: 正常文書は同値', () => {
  it('同じ内容の新しいオブジェクトを返す', () => {
    const src = normalDoc();
    const out = normalizeDoc(src);
    expect(out).toEqual(src);
    expect(out).not.toBe(src);
    expect(out!.floors[1]).not.toBe(src.floors[1]);
    expect(out!.floors[1].rooms[0]).not.toBe(src.floors[1].rooms[0]);
  });

  it('JSON を往復した文書（キーが文字列になる）も同値', () => {
    const src = normalDoc();
    expect(normalizeDoc(JSON.parse(JSON.stringify(src)))).toEqual(src);
  });

  it('既定の文書は同値', () => {
    expect(normalizeDoc(defaultDoc())).toEqual(defaultDoc());
  });

  it('入力を書き換えない（凍結した入力でも通る）', () => {
    const src = deepFreeze(normalDoc());
    const before = JSON.stringify(src);
    expect(normalizeDoc(src)).toEqual(normalDoc());
    expect(JSON.stringify(src)).toBe(before);
  });
});

describe('normalizeDoc: 旧形式（openings 無し・2階無し）', () => {
  it('1階・2階の両方と、rooms/openings/furniture の配列がそろう', () => {
    const out = normalizeDoc(legacyRaw())!;
    expect(out).not.toBeNull();
    for (const f of [1, 2]) {
      expect(Array.isArray(out.floors[f].rooms)).toBe(true);
      expect(Array.isArray(out.floors[f].openings)).toBe(true);
      expect(Array.isArray(out.floors[f].furniture)).toBe(true);
    }
    expect(out.floors[1].rooms).toHaveLength(1);
    expect(out.floors[1].rooms[0]).toMatchObject({ id: 'r', name: '旧部屋', cells: ['2,2', '3,2'], z: 1 });
    expect(out.floors[2]).toEqual({ rooms: [], openings: [], furniture: [] });
  });

  it('roomTypes・settings が無ければ既定値になる（既定の配列はコピーで共有しない）', () => {
    const out = normalizeDoc(legacyRaw())!;
    expect(out.roomTypes).toEqual(DEFAULT_TYPES);
    expect(out.roomTypes).not.toBe(DEFAULT_TYPES);
    expect(out.roomTypes[0]).not.toBe(DEFAULT_TYPES[0]);
    expect(out.settings).toEqual({ cellMm: 455, wallMm: 120 });
  });

  it('floors が空オブジェクトでも空の2階建てになる', () => {
    const out = normalizeDoc({ floors: {} })!;
    expect(out.floors[1]).toEqual({ rooms: [], openings: [], furniture: [] });
    expect(out.floors[2]).toEqual({ rooms: [], openings: [], furniture: [] });
  });

  it('version は常に 1 に固定する', () => {
    expect(normalizeDoc({ ...normalDoc(), version: 99 })!.version).toBe(1);
    expect(normalizeDoc({ floors: {} })!.version).toBe(1);
  });
});

describe('normalizeDoc: 壊れた入力', () => {
  it('floors が無い／オブジェクトでなければ null', () => {
    for (const bad of [null, undefined, 'x', 5, true, [], {}, { floors: null }, { floors: 'x' }, { floors: [] }, { plans: [] }]) {
      expect(normalizeDoc(bad)).toBeNull();
    }
  });

  it('cells は "x,y" 形式でグリッド内のものだけ残し、重複は除く', () => {
    const raw = {
      floors: {
        1: {
          rooms: [
            { id: 'a', name: 'A', typeId: 'living', z: 1, cells: ['2,2', 'x,y', '64,0', '0,64', '-1,0', '1.5,2', '2, 3', 5, null, '2,2', '63,63', '0,0'] },
            { id: 'b', name: 'B', typeId: 'living', z: 2, cells: ['99,99', 'zz'] }, // no valid cell: the room is dropped
            { id: 'c', name: 'C', typeId: 'living', z: 3, cells: 'not-an-array' },
            'not-a-room',
            null,
          ],
        },
      },
    };
    const out = normalizeDoc(raw)!;
    expect(out.floors[1].rooms.map((r) => r.id)).toEqual(['a']);
    expect(out.floors[1].rooms[0].cells).toEqual(['2,2', '63,63', '0,0']);
  });

  it('z が数値でない部屋は、既存の最大 z の後ろへ順番に付番する（重ならない）', () => {
    const cells = ['0,0'];
    const out = normalizeDoc({
      floors: {
        1: {
          rooms: [
            { id: 'a', cells, z: 5 },
            { id: 'b', cells },
            { id: 'c', cells, z: 'x' },
            { id: 'd', cells, z: 2 },
          ],
        },
      },
    })!;
    expect(out.floors[1].rooms.map((r) => r.z)).toEqual([5, 6, 7, 2]);
  });

  it('z が全部無ければ 1,2,3… の順番になる', () => {
    const out = normalizeDoc({ floors: { 1: { rooms: [{ id: 'a', cells: ['0,0'] }, { id: 'b', cells: ['1,0'] }] } } })!;
    expect(out.floors[1].rooms.map((r) => r.z)).toEqual([1, 2]);
  });

  it('name / typeId は文字列にする。id が無ければ振る', () => {
    const out = normalizeDoc({ floors: { 1: { rooms: [{ cells: ['0,0'], name: 12, typeId: null, colorOverride: 7 }] } } })!;
    const r = out.floors[1].rooms[0];
    expect(r.name).toBe('12');
    expect(r.typeId).toBe('');
    expect(r.id).toBeTruthy();
    expect('colorOverride' in r).toBe(false);
  });

  it('settings: 範囲外・数値でない値は既定（455 / 120）に戻し、境界の値は残す', () => {
    const s = (settings: unknown) => normalizeDoc({ floors: {}, settings })!.settings;
    expect(s({ cellMm: 9, wallMm: 0 })).toEqual({ cellMm: 455, wallMm: 120 });
    expect(s({ cellMm: 5000, wallMm: 401 })).toEqual({ cellMm: 455, wallMm: 120 });
    expect(s({ cellMm: '500', wallMm: NaN })).toEqual({ cellMm: 455, wallMm: 120 });
    expect(s({ cellMm: 99, wallMm: 49 })).toEqual({ cellMm: 455, wallMm: 120 });
    expect(s({ cellMm: 100, wallMm: 50 })).toEqual({ cellMm: 100, wallMm: 50 });
    expect(s({ cellMm: 1000, wallMm: 400 })).toEqual({ cellMm: 1000, wallMm: 400 });
    expect(s(null)).toEqual({ cellMm: 455, wallMm: 120 });
  });
});

describe('normalizeDoc: 開口部・家具・種別', () => {
  it('openings: cx/cy が整数・side が N/E/S/W・size が 100 以上のものだけ残す', () => {
    const base = { id: 'o', kind: 'door', cx: 1, cy: 1, side: 'N', size: 800 };
    const out = normalizeDoc({
      floors: {
        1: {
          openings: [
            { ...base, id: 'ok' },
            { ...base, id: 'frac', cx: 1.5 },
            { ...base, id: 'str', cy: '1' },
            { ...base, id: 'side', side: 'X' },
            { ...base, id: 'small', size: 99 },
            { ...base, id: 'edge', size: 100, kind: 'window' },
            { ...base, id: 'nan', size: NaN },
            null,
          ],
        },
      },
    })!;
    expect(out.floors[1].openings.map((o) => o.id)).toEqual(['ok', 'edge']);
    expect(out.floors[1].openings[1].kind).toBe('window');
  });

  it('furniture: x/y/w/h が数値で w,h が 20 以上のものだけ残す', () => {
    const base = { id: 'f', name: 'table', x: 0, y: 0, w: 400, h: 300, color: '#abcdef' };
    const out = normalizeDoc({
      floors: {
        1: {
          furniture: [
            { ...base, id: 'ok' },
            { ...base, id: 'thin', w: 19 },
            { ...base, id: 'flat', h: 0 },
            { ...base, id: 'min', w: 20, h: 20 },
            { ...base, id: 'str', x: '5' },
            { ...base, id: 'inf', y: Infinity },
          ],
        },
      },
    })!;
    expect(out.floors[1].furniture.map((f) => f.id)).toEqual(['ok', 'min']);
  });

  it('furniture: name / color が無ければ既定の名前・色になる', () => {
    const out = normalizeDoc({ floors: { 1: { furniture: [{ id: 'f', x: 0, y: 0, w: 100, h: 100 }] } } })!;
    expect(out.floors[1].furniture[0]).toMatchObject({ name: '家具', color: '#8a9ba8' });
  });

  it('roomTypes が配列でなければ既定のコピー、使える要素が無くても既定', () => {
    for (const bad of [undefined, null, 'x', {}, [], [null, 3, { name: 'id なし' }]]) {
      expect(normalizeDoc({ floors: {}, roomTypes: bad })!.roomTypes).toEqual(DEFAULT_TYPES);
    }
  });

  it('roomTypes: 使える要素だけ残す', () => {
    const out = normalizeDoc({ floors: {}, roomTypes: [{ id: 'a', name: 'A', color: '#fff' }, { id: 'b' }, 'x'] })!;
    expect(out.roomTypes).toEqual([
      { id: 'a', name: 'A', color: '#fff' },
      { id: 'b', name: '', color: '#AEB6BF' },
    ]);
  });

  it('1階と2階の外の階は取り込まない', () => {
    const out = normalizeDoc({ floors: { 1: {}, 2: {}, 3: { rooms: [{ cells: ['0,0'] }] } } })!;
    expect(Object.keys(out.floors)).toEqual(['1', '2']);
  });
});

describe('acceptDoc: 外から入る文書の入口（形の補完 + 重なりの解消）', () => {
  /** B (z2) covers (1,0) of A (z1); a door on A's wall and one in the open. */
  const overlapped = () => ({
    floors: {
      1: {
        rooms: [
          { id: 'A', name: 'A', typeId: 'living', cells: ['0,0', '1,0'], z: 1 },
          { id: 'B', name: 'B', typeId: 'ldk', cells: ['1,0', '2,0'], z: 2 },
          { id: 'C', name: 'C', typeId: 'living', cells: ['5,5'], z: 0 },
          { id: 'D', name: 'D', typeId: 'living', cells: ['5,5'], z: 1 }, // C (z0) lies wholly under D (z1): it loses its only cell
        ],
        openings: [
          { id: 'wall', kind: 'door', cx: 0, cy: 0, side: 'W', size: 800 },
          { id: 'stray', kind: 'window', cx: 30, cy: 30, side: 'S', size: 900 },
        ],
      },
    },
  });

  it('重なった部屋は上（z が大きい方）が勝ち、全部のマスを失った部屋は消え、宙に浮いた開口部も消える', () => {
    const out = acceptDoc(overlapped())!;
    const byId = Object.fromEntries(out.floors[1].rooms.map((r) => [r.id, r.cells]));
    expect(byId.A).toEqual(['0,0']);
    expect(byId.B).toEqual(['1,0', '2,0']);
    expect(byId.D).toEqual(['5,5']);
    expect('C' in byId).toBe(false);
    expect(out.floors[1].openings.map((o) => o.id)).toEqual(['wall']);
  });

  it('重なりの無い文書は normalizeDoc と同値（既存の入力は変わらない）', () => {
    expect(acceptDoc(normalDoc())).toEqual(normalizeDoc(normalDoc()));
    expect(acceptDoc(JSON.parse(JSON.stringify(legacyRaw())))).toEqual(normalizeDoc(legacyRaw()));
  });

  it('1階も2階も解消する。入力は書き換えない。文書でなければ null', () => {
    const raw = overlapped() as { floors: Record<number, unknown> };
    raw.floors[2] = { rooms: [{ id: 'X', cells: ['0,0'], z: 1 }, { id: 'Y', cells: ['0,0', '1,0'], z: 2 }] };
    const frozen = deepFreeze(raw);
    const out = acceptDoc(frozen)!;
    expect(out.floors[2].rooms.map((r) => [r.id, r.cells])).toEqual([['Y', ['0,0', '1,0']]]);
    expect(acceptDoc(null)).toBeNull();
    expect(acceptDoc({ floors: 'x' })).toBeNull();
  });
});
