import { describe, expect, it } from 'vitest';
import { MERGE_WINDOW_MS, commitState, initialHistory, redoState, undoState, type HistoryState } from './useHistory';
import { mergeKeyFor } from './mergeKeys';

type S = HistoryState<string>;
const start = (v = 'v0'): S => initialHistory(v);

describe('commitState: 連続入力のまとめ（B7）', () => {
  it('キー無しのコミットは、いつも新しい履歴を1つ積む', () => {
    let s = start();
    s = commitState(s, 'a', undefined, 0);
    s = commitState(s, 'b', undefined, 10);
    expect(s.past).toEqual(['v0', 'a']);
    expect(s.present).toBe('b');
  });

  it('同じキーが窓(1500ms)以内に続く間は1つにまとまる。窓は直前のコミットから測る', () => {
    let s = start();
    s = commitState(s, 'a', 'name:1', 0);
    s = commitState(s, 'ab', 'name:1', 1000);
    s = commitState(s, 'abc', 'name:1', 2400); // 1400ms after the previous one: still the same run
    expect(s.past).toEqual(['v0']);
    expect(s.present).toBe('abc');
    s = commitState(s, 'abcd', 'name:1', 2400 + MERGE_WINDOW_MS + 1); // a pause: a new entry
    expect(s.past).toEqual(['v0', 'abc']);
    expect(s.present).toBe('abcd');
  });

  it('ちょうど窓の長さだけ空いても、まだ続きとして扱う', () => {
    let s = start();
    s = commitState(s, 'a', 'k', 0);
    s = commitState(s, 'b', 'k', MERGE_WINDOW_MS);
    expect(s.past).toEqual(['v0']);
  });

  it('別のキー・キー無しのコミットが間に入ったら、同じキーでも続きにならない', () => {
    let s = start();
    s = commitState(s, 'a', 'k', 0);
    s = commitState(s, 'b', 'other', 100);
    s = commitState(s, 'c', 'k', 200);
    expect(s.past).toEqual(['v0', 'a', 'b']);
    s = commitState(s, 'd', undefined, 300);
    s = commitState(s, 'e', 'k', 400);
    expect(s.past).toEqual(['v0', 'a', 'b', 'c', 'd']);
  });

  it('1つにまとめた後の Undo は、入力を始める前の状態へ戻る。Redo で最後の入力へ戻る', () => {
    let s = start();
    for (const [i, ch] of ['a', 'ab', 'abc'].entries()) s = commitState(s, ch, 'k', i * 100);
    s = undoState(s);
    expect(s.present).toBe('v0');
    expect(s.future).toEqual(['abc']);
    s = redoState(s);
    expect(s.present).toBe('abc');
  });

  it('Undo / Redo の後は、同じキーでも新しい履歴になる（キーを忘れる）', () => {
    let s = start();
    s = commitState(s, 'a', 'k', 0);
    s = undoState(s);
    s = redoState(s);
    s = commitState(s, 'b', 'k', 50);
    expect(s.past).toEqual(['v0', 'a']);
    let t = commitState(start(), 'a', 'k', 0);
    t = undoState(t);
    t = commitState(t, 'x', 'k', 50);
    expect(t.past).toEqual(['v0']);
    expect(t.future).toEqual([]);
  });

  it('初期化（reset）後は、前のキーを引き継がない', () => {
    const s = commitState(start(), 'a', 'k', 0);
    const fresh = initialHistory('loaded');
    expect(fresh.mark).toBeNull();
    expect(commitState(fresh, 'b', 'k', 10).past).toEqual(['loaded']);
    expect(s.mark).not.toBeNull();
  });

  it('何も変わらないコミットは何もしない（同じ状態を返す）。まとめの窓も延びない', () => {
    let s = start();
    s = commitState(s, 'a', 'k', 0);
    expect(commitState(s, 'a', 'k', 1000)).toBe(s);
    s = commitState(s, 'b', 'k', 1400); // 1400ms after the first one: joins
    expect(s.past).toEqual(['v0']);
    const t = commitState(commitState(start(), 'a', 'k', 0), 'a', 'k', 1400); // no change at 1400: the window is not extended
    expect(commitState(t, 'b', 'k', 1600).past).toEqual(['v0', 'a']); // 1600 after the last real change: a new entry
  });

  it('履歴の上限(200)を超えたら古いものから捨てる', () => {
    let s = start('0');
    for (let i = 1; i <= 250; i++) s = commitState(s, String(i), undefined, i);
    expect(s.past.length).toBe(200);
    expect(s.past[0]).toBe('50');
    expect(s.present).toBe('250');
  });

  it('同じ入力から同じ結果になり、入力を書き換えない（更新関数が2回走っても同じ）', () => {
    const s: S = { past: ['v0'], present: 'a', future: [], mark: { key: 'k', at: 0 } };
    for (const part of [s.past, s.future, s.mark, s]) Object.freeze(part); // a write to any of them would throw
    const once = commitState(s, 'b', 'k', 100);
    const twice = commitState(s, 'b', 'k', 100);
    expect(twice).toEqual(once);
    expect(s.past).toEqual(['v0']);
  });
});

describe('mergeKeyFor', () => {
  it('連続入力の項目には、項目名と対象の id を含むキーを付ける', () => {
    expect(mergeKeyFor('room', 'r1', { name: 'LDK' })).toBe('room-name:r1');
    expect(mergeKeyFor('room', 'r1', { colorOverride: '#ffffff' })).toBe('room-colorOverride:r1');
    expect(mergeKeyFor('furniture', 'f1', { w: 1200 })).toBe('furniture-w:f1');
    expect(mergeKeyFor('furniture', 'f1', { h: 800 })).toBe('furniture-h:f1');
    expect(mergeKeyFor('type', 't1', { color: '#000000' })).toBe('type-color:t1');
    expect(mergeKeyFor('settings', 'doc', { wallMm: 150 })).toBe('settings-wallMm:doc');
    expect(mergeKeyFor('settings', 'doc', { cellMm: 500 })).toBe('settings-cellMm:doc');
  });

  it('対象が違えばキーも違う（別の部屋の入力を1つにまとめない）', () => {
    expect(mergeKeyFor('room', 'r1', { name: 'a' })).not.toBe(mergeKeyFor('room', 'r2', { name: 'a' }));
    expect(mergeKeyFor('room', 'r1', { name: 'a' })).not.toBe(mergeKeyFor('room', 'r1', { colorOverride: 'x' }));
  });

  it('1回で決まる操作（一覧から種別を選ぶ・複数項目を同時に変える）には付けない', () => {
    expect(mergeKeyFor('room', 'r1', { typeId: 'ldk' })).toBeUndefined();
    expect(mergeKeyFor('room', 'r1', { name: 'a', typeId: 'ldk' })).toBeUndefined();
    expect(mergeKeyFor('furniture', 'f1', { x: 1, y: 2, w: 3, h: 4 })).toBeUndefined();
    expect(mergeKeyFor('room', 'r1', {})).toBeUndefined();
  });
});
