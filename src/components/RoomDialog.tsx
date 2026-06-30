import { useEffect, useRef, useState } from 'react';
import type { RoomType } from '../types';

interface Props {
  roomTypes: RoomType[];
  cellCount: number;
  areaLabel: string;
  onCreate: (name: string, typeId: string) => void;
  onCancel: () => void;
  onAddType: (name: string) => string; // returns new type id
}

export default function RoomDialog(props: Props) {
  const [name, setName] = useState('');
  const [typeId, setTypeId] = useState(props.roomTypes[0]?.id ?? '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleTypeChange = (v: string) => {
    if (v === '__add__') {
      const n = window.prompt('追加する種別名を入力してください');
      if (n && n.trim()) {
        const id = props.onAddType(n.trim());
        setTypeId(id);
      }
      return;
    }
    setTypeId(v);
  };

  const submit = () => {
    const finalName = name.trim() || props.roomTypes.find((t) => t.id === typeId)?.name || '部屋';
    props.onCreate(finalName, typeId);
  };

  return (
    <div className="modal-backdrop" onClick={props.onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>部屋を作成</h3>
        <p className="modal-area">
          {props.cellCount} マス ・ {props.areaLabel}
        </p>
        <label>
          部屋名
          <input
            ref={inputRef}
            value={name}
            placeholder="例: 俺の部屋 / LDK / 寝室"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
              if (e.key === 'Escape') props.onCancel();
            }}
          />
        </label>
        <label>
          種別
          <select value={typeId} onChange={(e) => handleTypeChange(e.target.value)}>
            {props.roomTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
            <option value="__add__">＋ 種別を追加…</option>
          </select>
        </label>
        <div className="modal-actions">
          <button onClick={props.onCancel}>キャンセル</button>
          <button className="primary" onClick={submit}>
            作成
          </button>
        </div>
      </div>
    </div>
  );
}
