import { useState } from 'react';
import { DEFAULT_DOOR_SIZE, DEFAULT_WINDOW_SIZE, DOOR_COLOR, DOOR_SIZES, WINDOW_COLOR, WINDOW_SIZES } from '../constants';

interface Props {
  onConfirm: (kind: 'door' | 'window', size: number) => void;
  onCancel: () => void;
}

export default function OpeningDialog(props: Props) {
  const [kind, setKind] = useState<'door' | 'window'>('door');
  const [custom, setCustom] = useState<string>(String(kind === 'door' ? DEFAULT_DOOR_SIZE : DEFAULT_WINDOW_SIZE));

  const sizes = kind === 'door' ? DOOR_SIZES : WINDOW_SIZES;
  const color = kind === 'door' ? DOOR_COLOR : WINDOW_COLOR;

  const switchKind = (k: 'door' | 'window') => {
    setKind(k);
    setCustom(String(k === 'door' ? DEFAULT_DOOR_SIZE : DEFAULT_WINDOW_SIZE));
  };

  return (
    <div className="modal-backdrop" onClick={props.onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>ドア／窓を追加</h3>

        <div className="kind-toggle">
          <button className={kind === 'door' ? 'active' : ''} onClick={() => switchKind('door')}>
            <span className="swatch" style={{ background: DOOR_COLOR }} /> ドア
          </button>
          <button className={kind === 'window' ? 'active' : ''} onClick={() => switchKind('window')}>
            <span className="swatch" style={{ background: WINDOW_COLOR }} /> 窓
          </button>
        </div>

        <h4>幅を選択（クリックで配置へ）</h4>
        <div className="size-grid">
          {sizes.map((s) => (
            <button key={s} style={{ borderColor: color }} onClick={() => props.onConfirm(kind, s)}>
              {s}mm
            </button>
          ))}
        </div>

        <h4>カスタム幅</h4>
        <div className="custom-size">
          <input
            type="number"
            min={100}
            max={4000}
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
          />
          <span>mm</span>
          <button
            className="primary"
            onClick={() => {
              const n = Number(custom);
              if (n >= 100) props.onConfirm(kind, n);
            }}
          >
            この幅で配置
          </button>
        </div>

        <div className="modal-actions">
          <button onClick={props.onCancel}>キャンセル</button>
        </div>
      </div>
    </div>
  );
}
