import { useEffect, useState } from 'react';
import type { Furniture } from '../types';

interface Props {
  item: Furniture;
  onPatch: (patch: Partial<Furniture>) => void;
  onDelete: () => void;
}

const MIN_MM = 20;

export default function FurniturePanel({ item, onPatch, onDelete }: Props) {
  // Local string state so the field can be freely edited (emptied, partial, etc.)
  // and only committed when it parses to a valid size.
  const [wStr, setWStr] = useState(String(Math.round(item.w)));
  const [hStr, setHStr] = useState(String(Math.round(item.h)));

  // sync when the item changes externally (drag/resize, or selecting another item)
  useEffect(() => setWStr(String(Math.round(item.w))), [item.id, item.w]);
  useEffect(() => setHStr(String(Math.round(item.h))), [item.id, item.h]);

  const handle = (
    raw: string,
    setLocal: (s: string) => void,
    key: 'w' | 'h',
  ) => {
    setLocal(raw); // always let the user type (including empty)
    const n = Number(raw);
    if (raw.trim() !== '' && Number.isFinite(n) && n >= MIN_MM) onPatch({ [key]: n });
  };

  const blur = (raw: string, setLocal: (s: string) => void, current: number) => {
    const n = Number(raw);
    if (raw.trim() === '' || !Number.isFinite(n) || n < MIN_MM) setLocal(String(Math.round(current)));
  };

  return (
    <div className="panel">
      <h4>家具</h4>
      <label>
        名前
        <input value={item.name} onChange={(e) => onPatch({ name: e.target.value })} />
      </label>
      <div className="dim-row">
        <label>
          幅 (mm)
          <input
            type="text"
            inputMode="numeric"
            value={wStr}
            onChange={(e) => handle(e.target.value, setWStr, 'w')}
            onBlur={() => blur(wStr, setWStr, item.w)}
          />
        </label>
        <label>
          奥行 (mm)
          <input
            type="text"
            inputMode="numeric"
            value={hStr}
            onChange={(e) => handle(e.target.value, setHStr, 'h')}
            onBlur={() => blur(hStr, setHStr, item.h)}
          />
        </label>
      </div>
      <label>
        色
        <div className="color-row">
          <input type="color" value={item.color} onChange={(e) => onPatch({ color: e.target.value })} />
        </div>
      </label>

      <div className="area-box">
        <div className="area-row">
          <span>{(item.w / 1000).toFixed(2)}</span>m ×<span>{(item.h / 1000).toFixed(2)}</span>m
        </div>
        <div className="area-row muted">{((item.w * item.h) / 1_000_000).toFixed(2)} ㎡</div>
      </div>

      <button className="danger" onClick={onDelete}>
        この家具を削除
      </button>
    </div>
  );
}
