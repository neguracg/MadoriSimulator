// Guard for one mechanism: a document that comes from outside (stored project, imported file, share link) is let in by
// ONE door, acceptDoc (state/migrate.ts). Each entrance used to check the document on its own, so the shape checks
// missed openings and the 2nd floor (white screen) and later nobody settled rooms left overlapping by move mode.
// An entrance that calls normalizeDoc directly gets the shape but not the rest; this test fails when one does.
import { readFileSync, readdirSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** The only files that may name normalizeDoc: its own module and the tests of the shape rules. */
const ALLOWED = new Set(['state/migrate.ts', 'state/migrate.test.ts', 'lint/docEntrance.test.ts']);

export function findDirectNormalizeDoc(text: string): number[] {
  const lines: number[] = [];
  text.split('\n').forEach((raw, i) => {
    const t = raw.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return; // comments may name it
    if (/\bnormalizeDoc\b/.test(raw)) lines.push(i + 1);
  });
  return lines;
}

describe('findDirectNormalizeDoc (the detector itself)', () => {
  it('import と呼び出しを検出し、コメントでの言及は検出しない', () => {
    const src = [
      "import { normalizeDoc } from '../state/migrate';",
      '// normalizeDoc is the shape check',
      ' * see normalizeDoc',
      'const doc = normalizeDoc(raw);',
      "import { acceptDoc } from '../state/migrate';",
    ].join('\n');
    expect(findDirectNormalizeDoc(src)).toEqual([1, 4]);
  });
});

describe('src 全体', () => {
  it('外から入る文書を normalizeDoc で直接受けているソースが無い（入口は acceptDoc だけ）', () => {
    const srcDir = fileURLToPath(new URL('..', import.meta.url));
    const files = readdirSync(srcDir, { recursive: true, encoding: 'utf8' })
      .map((p) => p.split(sep).join('/'))
      .filter((p) => /\.tsx?$/.test(p) && !ALLOWED.has(p));
    expect(files.length).toBeGreaterThan(10); // the scan really found the sources
    const found = files.flatMap((f) => findDirectNormalizeDoc(readFileSync(join(srcDir, f), 'utf8')).map((n) => `${f}:${n}`));
    expect(found).toEqual([]);
  });
});
