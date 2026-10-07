import { CELL_MM_RANGE, WALL_MM_RANGE } from '../constants';
import type { RoomType, Settings } from '../types';
import NumberField from './NumberField';

interface Props {
  roomTypes: RoomType[];
  settings: Settings;
  onPatchType: (id: string, patch: Partial<RoomType>) => void;
  onAddType: (name: string) => void;
  onPatchSettings: (patch: Partial<Settings>) => void;
  onClose: () => void;
}

export default function SettingsDialog(props: Props) {
  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <h3>設定</h3>

        <section>
          <h4>壁厚・グリッド（概算表示用）</h4>
          <div className="settings-row">
            <label>
              壁厚 (mm)
              <NumberField
                value={props.settings.wallMm}
                min={WALL_MM_RANGE.min}
                max={WALL_MM_RANGE.max}
                onCommit={(n) => props.onPatchSettings({ wallMm: n })}
              />
            </label>
            <label>
              1マス (mm)
              <NumberField
                value={props.settings.cellMm}
                min={CELL_MM_RANGE.min}
                max={CELL_MM_RANGE.max}
                onCommit={(n) => props.onPatchSettings({ cellMm: n })}
              />
            </label>
          </div>
        </section>

        <section>
          <h4>種別と色</h4>
          <div className="type-list">
            {props.roomTypes.map((t) => (
              <div className="type-item" key={t.id}>
                <input
                  type="color"
                  value={t.color}
                  onChange={(e) => props.onPatchType(t.id, { color: e.target.value })}
                />
                <input
                  className="type-name"
                  value={t.name}
                  onChange={(e) => props.onPatchType(t.id, { name: e.target.value })}
                />
              </div>
            ))}
          </div>
          <button
            className="link"
            onClick={() => {
              const n = window.prompt('追加する種別名を入力してください');
              if (n && n.trim()) props.onAddType(n.trim());
            }}
          >
            ＋ 種別を追加
          </button>
        </section>

        <div className="modal-actions">
          <button className="primary" onClick={props.onClose}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
