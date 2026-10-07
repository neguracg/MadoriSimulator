import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_TYPES, defaultDoc } from '../constants';
import type { Doc } from '../types';
import {
  BACKUP_PREV_KEY,
  CORRUPT_KEY_PREFIX,
  OLD_DOC_KEY,
  PROJECT_KEY,
  addPlans,
  backupFileName,
  buildProject,
  copyPlan,
  exportProject,
  loadProject,
  makePlan,
  parseImportFile,
  saveProject,
  type Plan,
  type Project,
  type StorageLike,
} from './projectStore';

/** In-memory stand-in for localStorage. */
class MemoryStorage implements StorageLike {
  private m = new Map<string, string>();
  failWrites = false;
  get length() {
    return this.m.size;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    if (this.failWrites) throw new Error('QuotaExceededError');
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  keys() {
    return [...this.m.keys()];
  }
}

const corruptKeys = (s: MemoryStorage) => s.keys().filter((k) => k.startsWith(CORRUPT_KEY_PREFIX)).sort();

/** Old-format document (no openings / furniture, no 2nd floor, no types / settings). */
const legacyDoc = () => ({
  version: 1,
  floors: { 1: { rooms: [{ id: 'r', name: '旧部屋', typeId: 'living', cells: ['2,2', '3,2'], z: 1 }] } },
});

function roomDoc(): Doc {
  const d = defaultDoc();
  d.floors[1].rooms.push({ id: 'room-1', name: 'LDK', typeId: 'ldk', cells: ['1,1', '2,1'], z: 1 });
  return d;
}

/**
 * A document saved while still in move mode: B (on top, z2) sits on two cells of A (z1), and a door hangs in the open.
 * Settled, B keeps (3,2) (3,3) (4,2) (4,3); A is left with (2,2) (2,3); the door on A's outer wall stays, the stray one goes.
 */
function overlappingDoc(): Doc {
  const d = defaultDoc();
  d.floors[1].rooms.push(
    { id: 'A', name: 'A', typeId: 'living', cells: ['2,2', '3,2', '2,3', '3,3'], z: 1 },
    { id: 'B', name: 'B', typeId: 'ldk', cells: ['3,2', '4,2', '3,3', '4,3'], z: 2 },
  );
  d.floors[1].openings.push(
    { id: 'wall', kind: 'door', cx: 2, cy: 2, side: 'W', size: 800 },
    { id: 'stray', kind: 'door', cx: 20, cy: 20, side: 'N', size: 800 },
  );
  return d;
}
const cellsOf = (d: Doc, id: string) => [...d.floors[1].rooms.find((r) => r.id === id)!.cells].sort();

function sampleProject(): Project {
  return {
    version: 1,
    activePlanId: 'p2',
    plans: [
      { id: 'p1', name: '案A', doc: defaultDoc() },
      { id: 'p2', name: '案B', doc: roomDoc() },
    ],
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-07T01:00:00.000Z'));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('loadProject', () => {
  it('何も保存されていなければ新しいプロジェクト（何も書き込まない）', () => {
    const s = new MemoryStorage();
    const p = loadProject(s);
    expect(p.plans).toHaveLength(1);
    expect(p.plans[0].name).toBe('間取り 1');
    expect(p.activePlanId).toBe(p.plans[0].id);
    expect(p.plans[0].doc).toEqual(defaultDoc());
    expect(s.keys()).toEqual([]);
  });

  it('正常なプロジェクトはそのまま読み込み、読む前に生の文字列を backup-prev へ写す', () => {
    const s = new MemoryStorage();
    const raw = JSON.stringify(sampleProject());
    s.setItem(PROJECT_KEY, raw);
    expect(loadProject(s)).toEqual(sampleProject());
    expect(s.getItem(BACKUP_PREV_KEY)).toBe(raw);
    expect(s.getItem(PROJECT_KEY)).toBe(raw);
    expect(corruptKeys(s)).toEqual([]);
  });

  it('旧形式の文書を含むプロジェクトも正規化して読み込め、元の文字列は backup-prev に残る', () => {
    const s = new MemoryStorage();
    const raw = JSON.stringify({ version: 1, activePlanId: 'p1', plans: [{ id: 'p1', name: '旧', doc: legacyDoc() }] });
    s.setItem(PROJECT_KEY, raw);
    const p = loadProject(s);
    const doc = p.plans[0].doc;
    expect(p.plans[0]).toMatchObject({ id: 'p1', name: '旧' });
    expect(doc.floors[1].openings).toEqual([]);
    expect(doc.floors[1].furniture).toEqual([]);
    expect(doc.floors[2]).toEqual({ rooms: [], openings: [], furniture: [] });
    expect(doc.roomTypes).toEqual(DEFAULT_TYPES);
    expect(s.getItem(BACKUP_PREV_KEY)).toBe(raw);
    expect(corruptKeys(s)).toEqual([]); // 補完しただけで捨てたものは無い
  });

  it('JSON として読めなければ新しいプロジェクトで起動し、生データは corrupt-<ISO> へ退避する', () => {
    const s = new MemoryStorage();
    s.setItem(PROJECT_KEY, '{broken');
    const p = loadProject(s);
    expect(p.plans).toHaveLength(1);
    expect(corruptKeys(s)).toEqual([`${CORRUPT_KEY_PREFIX}2026-10-07T01:00:00.000Z`]);
    expect(s.getItem(corruptKeys(s)[0])).toBe('{broken');
    expect(s.getItem(BACKUP_PREV_KEY)).toBe('{broken');
    expect(s.getItem(PROJECT_KEY)).toBe('{broken'); // 読み込みは本体のキーを書き換えない
  });

  it('plans が配列でなくても同じ（退避して新規）', () => {
    for (const raw of ['{}', '[]', '"x"', 'null', '{"plans":"x"}']) {
      const s = new MemoryStorage();
      s.setItem(PROJECT_KEY, raw);
      expect(loadProject(s).plans).toHaveLength(1);
      expect(corruptKeys(s)).toHaveLength(1);
    }
  });

  it('文書の無い間取りだけ捨て、残りは使う。捨てた時は生データを退避する', () => {
    const s = new MemoryStorage();
    const raw = JSON.stringify({
      version: 1,
      activePlanId: 'bad',
      plans: [
        { id: 'bad', name: '壊れ', doc: { nothing: true } },
        { id: 'ok', name: '無事', doc: legacyDoc() },
        { id: 'none', name: '文書なし' },
        null,
      ],
    });
    s.setItem(PROJECT_KEY, raw);
    const p = loadProject(s);
    expect(p.plans.map((x) => x.id)).toEqual(['ok']);
    expect(p.activePlanId).toBe('ok'); // 選択中だった間取りが無くなれば先頭
    expect(corruptKeys(s)).toHaveLength(1);
    expect(s.getItem(corruptKeys(s)[0])).toBe(raw);
  });

  it('全部の間取りが使えなければ新しいプロジェクト（退避あり）。空の plans は退避しない', () => {
    const s1 = new MemoryStorage();
    s1.setItem(PROJECT_KEY, JSON.stringify({ plans: [{ id: 'a', doc: 1 }, { id: 'b' }] }));
    expect(loadProject(s1).plans).toHaveLength(1);
    expect(corruptKeys(s1)).toHaveLength(1);

    const s2 = new MemoryStorage();
    s2.setItem(PROJECT_KEY, JSON.stringify({ version: 1, activePlanId: 'x', plans: [] }));
    expect(loadProject(s2).plans).toHaveLength(1);
    expect(corruptKeys(s2)).toEqual([]);
  });

  it('activePlanId が存在しなければ先頭の間取り。id の重複は振り直す', () => {
    const s = new MemoryStorage();
    const proj = sampleProject();
    proj.activePlanId = 'nope';
    proj.plans[1].id = 'p1';
    s.setItem(PROJECT_KEY, JSON.stringify(proj));
    const p = loadProject(s);
    expect(p.activePlanId).toBe('p1');
    expect(new Set(p.plans.map((x) => x.id)).size).toBe(2);
  });
});

describe('loadProject: 重なったまま保存された文書', () => {
  it('移動モードのまま閉じて重なっていた部屋は、読み込む時に上の部屋が勝つ形で解消する（元の文字列は backup-prev に残る）', () => {
    const s = new MemoryStorage();
    const raw = JSON.stringify({ version: 1, activePlanId: 'p1', plans: [{ id: 'p1', name: '案', doc: overlappingDoc() }] });
    s.setItem(PROJECT_KEY, raw);
    const doc = loadProject(s).plans[0].doc;
    expect(cellsOf(doc, 'B')).toEqual(['3,2', '3,3', '4,2', '4,3']);
    expect(cellsOf(doc, 'A')).toEqual(['2,2', '2,3']);
    expect(doc.floors[1].openings.map((o) => o.id)).toEqual(['wall']);
    expect(s.getItem(BACKUP_PREV_KEY)).toBe(raw); // 重なっていた元のデータは失われない
    expect(corruptKeys(s)).toEqual([]); // 解消は破損ではない
  });

  it('重なりが無い文書は何も変わらない（部屋・開口部・家具とも同値）', () => {
    const s = new MemoryStorage();
    s.setItem(PROJECT_KEY, JSON.stringify(sampleProject()));
    expect(loadProject(s)).toEqual(sampleProject());
  });

  it('旧キーの文書・取り込むファイルも同じく解消する（文書の入口は全部 acceptDoc を通る）', () => {
    const s = new MemoryStorage();
    s.setItem(OLD_DOC_KEY, JSON.stringify(overlappingDoc()));
    expect(cellsOf(loadProject(s).plans[0].doc, 'A')).toEqual(['2,2', '2,3']);
    expect(cellsOf(parseImportFile(JSON.stringify(overlappingDoc()), 'x.json')[0].doc, 'A')).toEqual(['2,2', '2,3']);
    const proj = { version: 1, activePlanId: 'p', plans: [{ id: 'p', name: 'P', doc: overlappingDoc() }] };
    expect(cellsOf(parseImportFile(JSON.stringify(proj), 'all.json')[0].doc, 'A')).toEqual(['2,2', '2,3']);
  });
});

describe('loadProject: 旧キーからの移行・退避の上限', () => {
  it('旧キー madori-simulator-doc-v1 の文書を1つの間取りとして移行する（正規化つき）', () => {
    const s = new MemoryStorage();
    s.setItem(OLD_DOC_KEY, JSON.stringify(legacyDoc()));
    const p = loadProject(s);
    expect(p.plans).toHaveLength(1);
    expect(p.plans[0].name).toBe('間取り 1');
    expect(p.plans[0].doc.floors[1].rooms[0].name).toBe('旧部屋');
    expect(p.plans[0].doc.floors[2]).toBeDefined();
    expect(s.getItem(PROJECT_KEY)).toBeNull(); // 読み込みは書き込まない
  });

  it('旧キーが読めなければ新規。本体のキーが壊れていて旧キーが生きていれば旧キーを使う', () => {
    const s1 = new MemoryStorage();
    s1.setItem(OLD_DOC_KEY, 'garbage');
    expect(loadProject(s1).plans[0].doc).toEqual(defaultDoc());

    const s2 = new MemoryStorage();
    s2.setItem(PROJECT_KEY, '{broken');
    s2.setItem(OLD_DOC_KEY, JSON.stringify(legacyDoc()));
    expect(loadProject(s2).plans[0].doc.floors[1].rooms[0].name).toBe('旧部屋');
    expect(corruptKeys(s2)).toHaveLength(1);
  });

  it('本体のキーが正常なら旧キーは見ない', () => {
    const s = new MemoryStorage();
    s.setItem(PROJECT_KEY, JSON.stringify(sampleProject()));
    s.setItem(OLD_DOC_KEY, JSON.stringify(legacyDoc()));
    expect(loadProject(s).plans.map((x) => x.name)).toEqual(['案A', '案B']);
  });

  it('同じ壊れたデータを何度読んでも退避は1つだけ（起動のたびに増えない）', () => {
    const s = new MemoryStorage();
    s.setItem(PROJECT_KEY, '{broken');
    for (let i = 0; i < 4; i++) {
      vi.advanceTimersByTime(1000);
      loadProject(s);
    }
    expect(corruptKeys(s)).toHaveLength(1);
  });

  it('異なる壊れたデータは最新の3件まで残す', () => {
    const s = new MemoryStorage();
    for (let i = 1; i <= 5; i++) {
      s.setItem(PROJECT_KEY, `{broken-${i}`);
      vi.advanceTimersByTime(1000);
      loadProject(s);
    }
    const keys = corruptKeys(s);
    expect(keys).toHaveLength(3);
    expect(keys.map((k) => s.getItem(k))).toEqual(['{broken-3', '{broken-4', '{broken-5']);
  });

  it('保存領域にさわれなくても起動できる（localStorage が使えない／読み出しで例外）', () => {
    expect(loadProject(null).plans).toHaveLength(1);
    const throwing: StorageLike = {
      length: 0,
      key: () => null,
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {},
      removeItem: () => {},
    };
    expect(loadProject(throwing).plans).toHaveLength(1);
  });

  it('backup-prev を書けなくても読み込みは続く', () => {
    const s = new MemoryStorage();
    s.setItem(PROJECT_KEY, JSON.stringify(sampleProject()));
    s.failWrites = true;
    expect(loadProject(s)).toEqual(sampleProject());
  });
});

describe('saveProject', () => {
  it('書けたら true・本体のキーに JSON が入る', () => {
    const s = new MemoryStorage();
    expect(saveProject(sampleProject(), s)).toBe(true);
    expect(JSON.parse(s.getItem(PROJECT_KEY)!)).toEqual(sampleProject());
  });

  it('ブラウザが書き込みを拒んだら false（握りつぶさない）', () => {
    const s = new MemoryStorage();
    s.failWrites = true;
    expect(saveProject(sampleProject(), s)).toBe(false);
    expect(saveProject(sampleProject(), null)).toBe(false);
  });
});

describe('parseImportFile', () => {
  it('Doc のファイルは1件の間取りになり、名前はファイル名から拡張子を除いたもの', () => {
    const plans = parseImportFile(JSON.stringify(roomDoc()), '我が家 案3.json');
    expect(plans).toHaveLength(1);
    expect(plans[0].name).toBe('我が家 案3');
    expect(plans[0].doc).toEqual(roomDoc());
    expect(plans[0].id).toBeTruthy();
  });

  it('旧形式の Doc も取り込める。ファイル名が拡張子だけ・拡張子なしでも名前が決まる', () => {
    const [a] = parseImportFile(JSON.stringify(legacyDoc()), 'old.plan.json');
    expect(a.name).toBe('old.plan');
    expect(a.doc.floors[2]).toBeDefined();
    expect(parseImportFile(JSON.stringify(legacyDoc()), '.json')[0].name).toBe('読み込んだ間取り');
    expect(parseImportFile(JSON.stringify(legacyDoc()), 'noext')[0].name).toBe('noext');
  });

  it('Project のファイルは全部の間取りになる。id は必ず新規採番で、使えない間取りは除く', () => {
    const proj = sampleProject();
    const raw = JSON.stringify({ ...proj, plans: [...proj.plans, { id: 'p3', name: '壊れ', doc: {} }, { id: 'p4', doc: legacyDoc() }] });
    const plans = parseImportFile(raw, 'backup.json');
    expect(plans.map((p) => p.name)).toEqual(['案A', '案B', 'backup 4']);
    expect(plans.map((p) => p.doc.floors[1].rooms.length)).toEqual([0, 1, 1]);
    const ids = plans.map((p) => p.id);
    expect(new Set(ids).size).toBe(3);
    for (const id of ids) expect(['p1', 'p2', 'p3', 'p4']).not.toContain(id);
  });

  it('使えない内容は空配列', () => {
    for (const bad of ['not json', '', '[]', '{}', 'null', '"x"', '{"plans":[]}', '{"plans":[{"doc":{}}]}', '{"floors":"x"}']) {
      expect(parseImportFile(bad, 'x.json')).toEqual([]);
    }
  });

  it('exportProject の出力を読み戻せる（文書は同じ・id は新しい）', () => {
    const proj = sampleProject();
    const plans = parseImportFile(exportProject(proj), 'all.json');
    expect(plans.map((p) => p.name)).toEqual(['案A', '案B']);
    expect(plans.map((p) => p.doc)).toEqual(proj.plans.map((p) => p.doc));
    expect(plans.map((p) => p.id)).not.toEqual(proj.plans.map((p) => p.id));
  });
});

describe('makePlan', () => {
  it('呼ぶたびに別の id・別の既定文書', () => {
    const a = makePlan('A');
    const b = makePlan('B');
    expect(a.id).not.toBe(b.id);
    expect(a.doc).toEqual(defaultDoc());
    expect(a.doc).not.toBe(b.doc);
  });
});

describe('copyPlan', () => {
  it('名前は「<名前> のコピー」・id は新規・文書は深いコピー（元と何も共有しない）', () => {
    const src: Plan = { id: 'p2', name: '案B', doc: roomDoc() };
    const copy = copyPlan(src);
    expect(copy.name).toBe('案B のコピー');
    expect(copy.id).not.toBe('p2');
    expect(copy.doc).toEqual(src.doc);
    expect(copy.doc).not.toBe(src.doc);
    expect(copy.doc.floors[1].rooms[0]).not.toBe(src.doc.floors[1].rooms[0]);
    expect(copy.doc.floors[1].rooms[0].cells).not.toBe(src.doc.floors[1].rooms[0].cells);
    copy.doc.floors[1].rooms[0].cells.push('9,9'); // 複製を触っても元は変わらない
    copy.doc.settings.cellMm = 500;
    expect(src.doc.floors[1].rooms[0].cells).toEqual(['1,1', '2,1']);
    expect(src.doc.settings.cellMm).toBe(455);
  });

  it('文書を渡せばそれを複製する（移動モード中に重なりを解消した文書など）', () => {
    const src: Plan = { id: 'p1', name: '案A', doc: defaultDoc() };
    expect(copyPlan(src, roomDoc()).doc).toEqual(roomDoc());
  });
});

describe('addPlans', () => {
  const plan = (id: string, name = id): Plan => ({ id, name, doc: defaultDoc() });

  it('追加した間取りは最後に並ぶ。id が既にある間取りは2つにならない', () => {
    const base = [plan('a'), plan('b')];
    expect(addPlans(base, [plan('c'), plan('a', '別の中身'), plan('d')]).map((p) => p.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(addPlans(base, [plan('a', '別の中身')])[0].name).toBe('a'); // 既存の間取りは置き換えない
  });

  it('追加するものが無ければ同じ配列を返す', () => {
    const base = [plan('a')];
    expect(addPlans(base, [])).toBe(base);
    expect(addPlans(base, [plan('a')])).toBe(base);
  });

  it('離れる間取りの文書を、その間取りのタブへ保管してから追加する', () => {
    const base = [plan('a'), plan('b')];
    const out = addPlans(base, [plan('c')], { id: 'b', doc: roomDoc() });
    expect(out.map((p) => p.id)).toEqual(['a', 'b', 'c']);
    expect(out[1].doc).toEqual(roomDoc());
    expect(out[0]).toBe(base[0]); // 触らない間取りは同じオブジェクト
    expect(base[1].doc).toEqual(defaultDoc()); // 入力は書き換えない
  });
});

describe('buildProject', () => {
  it('選択中の間取りは画面の文書（履歴の現在値）で、他の間取りは保存されている文書のまま', () => {
    const plans: Plan[] = [{ id: 'p1', name: '案A', doc: defaultDoc() }, { id: 'p2', name: '案B', doc: defaultDoc() }];
    const p = buildProject(plans, 'p2', roomDoc());
    expect(p).toEqual({ version: 1, activePlanId: 'p2', plans: [plans[0], { id: 'p2', name: '案B', doc: roomDoc() }] });
    expect(plans[1].doc).toEqual(defaultDoc()); // 入力は書き換えない
    expect(parseImportFile(exportProject(p), 'x.json').map((x) => x.name)).toEqual(['案A', '案B']); // 書き出した形を読み戻せる
  });
});

describe('backupFileName', () => {
  it('ローカルの日付で madori-backup-YYYY-MM-DD.json（1桁の月日は 0 埋め）', () => {
    expect(backupFileName(new Date(2026, 9, 7, 23, 59))).toBe('madori-backup-2026-10-07.json');
    expect(backupFileName(new Date(2027, 0, 5))).toBe('madori-backup-2027-01-05.json');
  });
});
