// Guard for one mechanism: a number the user types must go through NumberField / parseNumberInRange. A numeric entry wired
// straight to the browser (type="number", Number(e.target.value), parseInt, window.prompt read with Number) lets empty,
// half-typed, out-of-range and full-width text through, or rewrites what is being typed. It was fixed for the furniture
// size first and left in the settings and the door width (BUGLOG: numeric input). This test fails when a source file
// does the forbidden thing again; the one rule lives in components/NumberField.tsx.
import { readFileSync, readdirSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

interface Violation {
  line: number;
  what: string;
}

const FORBIDDEN: { re: RegExp; what: string }[] = [
  { re: /type\s*=\s*\{?\s*["']number["']/, what: 'type="number" input' },
  { re: /\bparse(Int|Float)\s*\(/, what: 'parseInt / parseFloat (reads "1000x" as 1000)' },
  { re: /\.valueAsNumber\b/, what: 'valueAsNumber' },
  { re: /Number\s*\(\s*[\w.]*\.target\.value\s*\)/, what: 'Number(e.target.value)' },
];

export function findNumericInputViolations(text: string): Violation[] {
  const out: Violation[] = [];
  text.split('\n').forEach((raw, i) => {
    const t = raw.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return; // comments may name the forbidden things
    for (const { re, what } of FORBIDDEN) if (re.test(raw)) out.push({ line: i + 1, what });
  });
  return out;
}

describe('findNumericInputViolations (the detector itself)', () => {
  it('ブラウザへ直結した数値入力を検出する', () => {
    const bad = [
      '<input type="number" value={n} />',
      "<input type='number' />",
      '<input type={"number"} />',
      'onChange={(e) => set(Number(e.target.value) || 0)}',
      'const n = parseInt(v, 10);',
      'const n = parseFloat(v);',
      'const n = e.target.valueAsNumber;',
    ].join('\n');
    expect(findNumericInputViolations(bad).map((v) => v.line)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('NumberField の利用・コメントでの言及・数値でない入力は検出しない', () => {
    const good = [
      '<NumberField value={n} min={1} onCommit={set} />',
      '<input type="text" inputMode="numeric" />',
      '<input type="color" />',
      '// type="number" is not used: see NumberField',
      ' * Number(e.target.value) is the wrong way',
      'const n = parseNumberInRange(v, 1, 9);',
    ].join('\n');
    expect(findNumericInputViolations(good)).toEqual([]);
  });
});

describe('src 全体', () => {
  it('数値入力をブラウザへ直結しているソースが無い', () => {
    const srcDir = fileURLToPath(new URL('..', import.meta.url));
    const files = readdirSync(srcDir, { recursive: true, encoding: 'utf8' })
      .map((p) => p.split(sep).join('/'))
      .filter((p) => /\.tsx?$/.test(p) && !p.endsWith('.test.ts') && !p.endsWith('.test.tsx'));
    expect(files.length).toBeGreaterThan(10); // the scan really found the sources
    const found = files.flatMap((f) => findNumericInputViolations(readFileSync(join(srcDir, f), 'utf8')).map((v) => `${f}:${v.line} ${v.what}`));
    expect(found).toEqual([]);
  });
});
