import { FURNITURE_MIN_MM } from '../constants';
import type { Furniture } from '../types';
import NumberField from './NumberField';

interface Props {
  item: Furniture;
  onPatch: (patch: Partial<Furniture>) => void;
  onDelete: () => void;
}

export default function FurniturePanel({ item, onPatch, onDelete }: Props) {
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
          <NumberField key={`w-${item.id}`} value={item.w} min={FURNITURE_MIN_MM} onCommit={(n) => onPatch({ w: n })} />
        </label>
        <label>
          奥行 (mm)
          <NumberField key={`h-${item.id}`} value={item.h} min={FURNITURE_MIN_MM} onCommit={(n) => onPatch({ h: n })} />
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
