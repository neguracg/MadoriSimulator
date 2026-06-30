import { cellsToM2, m2ToJou, m2ToTsubo } from '../constants';
import type { CellAction, Room, RoomType } from '../types';

interface Props {
  room: Room | null;
  roomTypes: RoomType[];
  cellMm: number;
  cellAction: CellAction;
  onPatch: (patch: Partial<Room>) => void;
  onAddType: (name: string) => string;
  onDelete: () => void;
  onSetCellAction: (a: CellAction) => void;
}

export default function PropertyPanel(props: Props) {
  const { room, roomTypes, cellMm, cellAction } = props;
  if (!room) {
    return (
      <div className="panel">
        <h4>プロパティ</h4>
        <p className="muted">部屋を選択すると、ここで名前・種別・色の変更や、マス追加・マス削除ができます。</p>
      </div>
    );
  }

  const type = roomTypes.find((t) => t.id === room.typeId);
  const color = room.colorOverride ?? type?.color ?? '#cccccc';
  const m2 = cellsToM2(room.cells.length, cellMm);

  const handleType = (v: string) => {
    if (v === '__add__') {
      const n = window.prompt('追加する種別名を入力してください');
      if (n && n.trim()) props.onPatch({ typeId: props.onAddType(n.trim()) });
      return;
    }
    props.onPatch({ typeId: v });
  };

  return (
    <div className="panel">
      <h4>プロパティ</h4>
      <label>
        部屋名
        <input value={room.name} onChange={(e) => props.onPatch({ name: e.target.value })} />
      </label>
      <label>
        種別
        <select value={room.typeId} onChange={(e) => handleType(e.target.value)}>
          {roomTypes.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
          <option value="__add__">＋ 種別を追加…</option>
        </select>
      </label>
      <label>
        色（この部屋のみ）
        <div className="color-row">
          <input
            type="color"
            value={color}
            onChange={(e) => props.onPatch({ colorOverride: e.target.value })}
          />
          {room.colorOverride && (
            <button className="link" onClick={() => props.onPatch({ colorOverride: undefined })}>
              種別色に戻す
            </button>
          )}
        </div>
      </label>

      <div className="area-box">
        <div className="area-row big">
          <span>{m2.toFixed(2)}</span>㎡
        </div>
        <div className="area-row">
          <span>{m2ToJou(m2).toFixed(2)}</span>畳
          <span className="dot" />
          <span>{m2ToTsubo(m2).toFixed(2)}</span>坪
        </div>
        <div className="area-row muted">{room.cells.length} マス</div>
      </div>

      <div className="room-ops">
        <button
          className={cellAction === 'expand' ? 'active' : ''}
          onClick={() => props.onSetCellAction(cellAction === 'expand' ? 'none' : 'expand')}
        >
          ＋ マス追加
        </button>
        <button
          className={cellAction === 'shrink' ? 'active' : ''}
          onClick={() => props.onSetCellAction(cellAction === 'shrink' ? 'none' : 'shrink')}
        >
          － マス削除
        </button>
      </div>
      {cellAction !== 'none' && (
        <p className="op-hint">
          {cellAction === 'expand' ? '追加するマスを選んでください' : '削除するマスを選んでください'}
        </p>
      )}

      <button className="danger" onClick={props.onDelete}>
        この部屋を削除
      </button>
    </div>
  );
}
