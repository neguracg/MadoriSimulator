// Guard for one mechanism: a development server that opens a browser by itself. Tests, sub-agents and the preview tool
// start `vite` / `vite preview` over and over, and every start used to put a tab into the user's own Chrome (about 20
// tabs on 2026-10-07: `vite preview` inherits server.open from the config, so each E2E prod run opened one).
// The only place that may open a browser is 起動.bat (the user's double-click), by passing --open to `npm run dev`.
// This test fails when vite.config.ts turns auto-open on again, and when 起動.bat loses its --open (the double-click
// would then open nothing).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (name: string) => readFileSync(fileURLToPath(new URL(`../../${name}`, import.meta.url)), 'utf8');

/** The value text of every `open: <value>` written in the source (comment lines skipped). */
export function findOpenSettings(text: string): string[] {
  const values: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const t = raw.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue; // comments may name it
    for (const m of t.matchAll(/\bopen\s*:\s*([^,}\s]+)/g)) values.push(m[1]);
  }
  return values;
}

describe('findOpenSettings (the detector itself)', () => {
  it('open の設定値を拾い、コメント行の言及は拾わない', () => {
    const src = [
      '    // open: true would open a tab',
      '    server: { port, strictPort: true, open: !process.env.PORT },',
      '    preview: { open: false },',
    ].join('\n');
    expect(findOpenSettings(src)).toEqual(['!process.env.PORT', 'false']);
  });
});

describe('ブラウザの自動オープン', () => {
  it('vite.config.ts は dev も preview も自動で開かない（open は全部 false）', () => {
    const values = findOpenSettings(read('vite.config.ts'));
    expect(values.length).toBeGreaterThanOrEqual(2); // server.open と preview.open の両方が書かれている
    expect(values.filter((v) => v !== 'false')).toEqual([]);
  });

  it('起動.bat（腱さんのダブルクリック）だけが --open を付けて開く', () => {
    const lines = read('起動.bat')
      .split(/\r?\n/)
      .filter((l) => /^\s*call\s+npm\s+run\s+dev\b/i.test(l));
    expect(lines.length).toBe(1);
    expect(lines[0]).toMatch(/\s--open\b/);
  });
});
