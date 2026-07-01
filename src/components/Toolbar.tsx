import type { CellAction, Mode } from '../types';

interface Props {
  mode: Mode;
  cellAction: CellAction;
  setMode: (m: Mode) => void;
  hasPending: boolean;
  furnitureArmed: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onCreateRoom: () => void;
  onArmFurniture: () => void;
  onUndo: () => void;
  onRedo: () => void;
}

export default function Toolbar(props: Props) {
  const hint =
    props.furnitureArmed
      ? 'キャンバスをドラッグして家具（四角）を作成。作成後は選択して移動・四隅でサイズ変更・右で寸法入力。'
      : props.mode === 'move'
      ? '部屋をドラッグして移動。重なりは許容され、編集モードに戻った時点で確定（上のレイヤーが優先）。'
      : props.cellAction === 'expand'
        ? '追加するマスをドラッグ／クリックで選んでください。'
        : props.cellAction === 'shrink'
          ? '削除するマスをドラッグ／クリックで選んでください。'
          : '空きマスをドラッグして範囲選択 →「部屋を作成」。部屋をクリックで選択し、角・辺をつかんで伸縮。';

  return (
    <div className="toolbar">
      <div className="toolbar-modes">
        <button
          className={`mode-btn ${props.mode === 'edit' ? 'active' : ''}`}
          onClick={() => props.setMode('edit')}
        >
          編集
        </button>
        <button
          className={`mode-btn ${props.mode === 'move' ? 'active' : ''}`}
          onClick={() => props.setMode('move')}
        >
          移動
        </button>
      </div>

      <div className="toolbar-actions">
        <button
          className="primary"
          disabled={!props.hasPending || props.mode !== 'edit'}
          onClick={props.onCreateRoom}
          title="選択したマスから部屋を作成"
        >
          ＋ 部屋を作成
        </button>
        <button
          className={props.furnitureArmed ? 'active' : ''}
          disabled={props.mode !== 'edit'}
          onClick={props.onArmFurniture}
          title="押してからキャンバスをドラッグして家具を作成"
        >
          🪑 家具を作成
        </button>
        <span className="sep" />
        <button disabled={!props.canUndo} onClick={props.onUndo} title="Ctrl+Z">↶ Undo</button>
        <button disabled={!props.canRedo} onClick={props.onRedo} title="Ctrl+Y">↷ Redo</button>
      </div>

      <div className="mode-hint">
        <span className="mode-tag">{props.mode === 'move' ? '移動モード' : '編集モード'}</span>
        {hint}
      </div>
    </div>
  );
}
