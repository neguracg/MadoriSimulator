// Guard for one mechanism: a state updater function must be pure. React may run an updater later or twice
// (StrictMode), so a side effect inside it (committing to the parent, mutating history, storage) is dropped
// or doubled. This is how drag commits were lost and double-counted (BUGLOG: Canvas drag). New drags must
// commit from the pointerup handler (see hooks/useLiveValue.ts); this test fails when any source file does
// the forbidden thing again.
import { readFileSync, readdirSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

interface Violation {
  line: number;
  call: string;
}

// updater hosts: React state setters, and useHistory commit (its function form runs inside a setState updater)
const isUpdaterHost = (name: string) => /^set(?!Timeout$|Interval$|Immediate$)[A-Z]/.test(name) || name === 'commit';
// calls that must not run inside an updater: handlers from the parent, history/state mutations, storage, dialogs
const FORBIDDEN = /^(props\.)?on[A-Z]|^(commit|reset|undo|redo|saveProject|alert|confirm|prompt)$|^set[A-Z]|^(localStorage|sessionStorage)\./;

export function findUpdaterSideEffects(fileName: string, text: string): Violation[] {
  const kind = fileName.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.ES2020, true, kind);
  const out: Violation[] = [];

  const checkBody = (body: ts.Node) => {
    const walk = (n: ts.Node) => {
      if (ts.isCallExpression(n)) {
        const call = n.expression.getText(sf);
        if (FORBIDDEN.test(call)) out.push({ line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, call });
      }
      ts.forEachChild(n, walk);
    };
    walk(body);
  };

  const scan = (n: ts.Node) => {
    if (ts.isCallExpression(n) && n.arguments.length > 0) {
      const callee = n.expression;
      const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : '';
      const first = n.arguments[0];
      if (isUpdaterHost(name) && (ts.isArrowFunction(first) || ts.isFunctionExpression(first))) checkBody(first.body);
    }
    ts.forEachChild(n, scan);
  };
  scan(sf);
  return out;
}

describe('findUpdaterSideEffects (the detector itself)', () => {
  it('state updater 内で親のハンドラ・commit・別の setter・storage を呼ぶと検出する', () => {
    const bad = `
      setHandlePreview((prev) => {
        if (prev) props.onSetShape(id, prev);
        return null;
      });
      setA(function (a) { onChange(a); return a; });
      commit((d) => { commit(d); return d; });
      setB((b) => { setC(1); return b; });
      setD((d) => { localStorage.setItem('k', 'v'); return d; });
    `;
    expect(findUpdaterSideEffects('bad.tsx', bad).map((v) => v.call)).toEqual([
      'props.onSetShape',
      'onChange',
      'commit',
      'setC',
      'localStorage.setItem',
    ]);
  });

  it('純粋な updater と、updater の外での確定は検出しない', () => {
    const good = `
      setPlans((ps) => ps.map((p) => (p.id === id ? { ...p, doc } : p)).concat(added));
      setZoom((z) => Math.max(0.4, +(z - 0.2).toFixed(2)));
      commit((d) => ops.removeFurniture(d, floor, id));
      const onUp = () => {
        const prev = ref.current;
        if (prev) props.onSetShape(id, prev);
        setPreview(null);
      };
      setState((s) => (typeof next === 'function' ? (next as (c: T) => T)(s.present) : next));
      setTimeout(() => setCopied(false), 1500);
    `;
    expect(findUpdaterSideEffects('good.tsx', good)).toEqual([]);
  });
});

describe('src 全体', () => {
  it('state updater の中に副作用を書いたソースが無い', () => {
    const srcDir = fileURLToPath(new URL('..', import.meta.url));
    const files = readdirSync(srcDir, { recursive: true, encoding: 'utf8' })
      .map((p) => p.split(sep).join('/'))
      .filter((p) => /\.tsx?$/.test(p) && !p.endsWith('.test.ts') && !p.endsWith('.test.tsx'));
    expect(files.length).toBeGreaterThan(10); // the scan really found the sources
    const found = files.flatMap((f) =>
      findUpdaterSideEffects(f, readFileSync(join(srcDir, f), 'utf8')).map((v) => `${f}:${v.line} ${v.call}`),
    );
    expect(found).toEqual([]);
  });
});
