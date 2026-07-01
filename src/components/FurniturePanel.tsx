import type { Furniture } from '../types';

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
          <input
            type="number"
            min={20}
            value={Math.round(item.w)}
            onChange={(e) => onPatch({ w: Math.max(20, Number(e.target.value) || 0) })}
          />
        </label>
        <label>
          奥行 (mm)
          <input
            type="number"
            min={20}
            value={Math.round(item.h)}
            onChange={(e) => onPatch({ h: Math.max(20, Number(e.target.value) || 0) })}
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
