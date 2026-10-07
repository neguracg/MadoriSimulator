// @owns 数値の自由入力欄（途中の入力を許し、範囲内の有効な値だけを反映する）と、その入力文字列の検査
import { useEffect, useState } from 'react';

/**
 * The number a typed text means, or null when it is not a plain number inside [min, max] (both inclusive).
 * Whole-text match: "1000あ" and "1e3" are not numbers. Full-width digits (an IME) are read as half-width.
 * The one rule for every numeric entry of the app (the input field below, and the window.prompt of the opening width).
 */
export function parseNumberInRange(raw: string, min: number, max = Infinity): number | null {
  const s = raw
    .trim()
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/．/g, '.');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return n >= min && n <= max ? n : null;
}

const show = (n: number) => String(Math.round(n));

interface Props {
  value: number; // the committed value
  min: number;
  max?: number;
  onCommit: (n: number) => void; // called with valid values only
  className?: string;
}

/**
 * A number the user can type freely: the field may be emptied or hold a half-typed value while typing, and the document
 * only ever sees valid numbers (onCommit). Leaving the field with an invalid text puts the committed value back.
 * type="text" inputMode="numeric" on purpose (type="number" fights the keyboard and rewrites what is typed).
 * To make it start over for another thing (another item selected) give it a different React key.
 */
export default function NumberField({ value, min, max, onCommit, className }: Props) {
  const [text, setText] = useState(show(value));

  // follow the committed value when it changes from outside; keep the text when it already means that value
  useEffect(() => {
    setText((t) => (parseNumberInRange(t, min, max) === value ? t : show(value)));
  }, [value, min, max]);

  const parsed = parseNumberInRange(text, min, max);
  return (
    <input
      type="text"
      inputMode="numeric"
      className={className}
      value={text}
      aria-invalid={parsed === null}
      title={max === undefined ? `${min} 以上` : `${min}〜${max}`}
      onChange={(e) => {
        setText(e.target.value);
        const n = parseNumberInRange(e.target.value, min, max);
        if (n !== null) onCommit(n);
      }}
      onBlur={() => setText(parsed === null ? show(value) : String(parsed))}
    />
  );
}
