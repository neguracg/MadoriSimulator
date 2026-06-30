interface PlanMeta {
  id: string;
  name: string;
}

interface Props {
  plans: PlanMeta[];
  activeId: string;
  onSwitch: (id: string) => void;
  onAdd: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}

export default function PlanTabs(props: Props) {
  return (
    <div className="plan-tabs">
      {props.plans.map((p) => (
        <div
          key={p.id}
          className={`plan-tab ${p.id === props.activeId ? 'active' : ''}`}
          onClick={() => props.onSwitch(p.id)}
          onDoubleClick={() => {
            const n = window.prompt('間取り名を変更', p.name);
            if (n && n.trim()) props.onRename(p.id, n.trim());
          }}
          title="クリックで切替・ダブルクリックで名前変更"
        >
          <span className="plan-tab-name">{p.name}</span>
          {props.plans.length > 1 && (
            <button
              className="plan-tab-close"
              title="この間取りを削除"
              onClick={(e) => {
                e.stopPropagation();
                if (window.confirm(`「${p.name}」を削除しますか？`)) props.onDelete(p.id);
              }}
            >
              ×
            </button>
          )}
        </div>
      ))}
      <button className="plan-tab-add" title="新しい間取りを追加" onClick={props.onAdd}>
        ＋
      </button>
    </div>
  );
}
