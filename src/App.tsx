import { useEffect, useState } from 'react';
import Canvas from './components/Canvas';
import Toolbar from './components/Toolbar';
import PropertyPanel from './components/PropertyPanel';
import SummaryPanel from './components/SummaryPanel';
import RoomDialog from './components/RoomDialog';
import SettingsDialog from './components/SettingsDialog';
import PlanTabs from './components/PlanTabs';
import ShareDialog from './components/ShareDialog';
import { cellsToM2, defaultDoc, FLOORS, m2ToJou, m2ToTsubo, uid } from './constants';
import type { CellAction, CellKey, Doc, Mode, Room } from './types';
import { useHistory } from './state/useHistory';
import * as ops from './state/docOps';
import { buildShareUrl, clearShareHash, readSharedFromHash } from './utils/share';

const PROJECT_KEY = 'madori-simulator-project-v1';
const OLD_DOC_KEY = 'madori-simulator-doc-v1';

interface Plan {
  id: string;
  name: string;
  doc: Doc;
}
interface Project {
  version: number;
  activePlanId: string;
  plans: Plan[];
}

function makePlan(name: string, doc?: Doc): Plan {
  return { id: uid(), name, doc: doc ?? defaultDoc() };
}

function loadProject(): Project {
  try {
    const raw = localStorage.getItem(PROJECT_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Project;
      if (p.plans?.length && p.plans.every((pl) => pl.doc?.floors)) {
        if (!p.plans.find((pl) => pl.id === p.activePlanId)) p.activePlanId = p.plans[0].id;
        return p;
      }
    }
    // migrate a single legacy doc, if any
    const old = localStorage.getItem(OLD_DOC_KEY);
    if (old) {
      const doc = JSON.parse(old) as Doc;
      if (doc.floors && doc.roomTypes) {
        const plan = makePlan('間取り 1', doc);
        return { version: 1, activePlanId: plan.id, plans: [plan] };
      }
    }
  } catch {
    /* ignore */
  }
  const plan = makePlan('間取り 1');
  return { version: 1, activePlanId: plan.id, plans: [plan] };
}

export default function App() {
  const [boot] = useState(loadProject);
  const activeDoc0 = boot.plans.find((p) => p.id === boot.activePlanId)!.doc;
  const { present: doc, presentRef, commit, undo, redo, reset, canUndo, canRedo } = useHistory<Doc>(activeDoc0);

  const [plans, setPlans] = useState<Plan[]>(boot.plans);
  const [activePlanId, setActivePlanId] = useState(boot.activePlanId);

  const [floor, setFloor] = useState(1);
  const [mode, setModeState] = useState<Mode>('edit');
  const [cellAction, setCellAction] = useState<CellAction>('none');
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [pendingCells, setPendingCells] = useState<CellKey[]>([]);
  const [zoom, setZoom] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);

  const floorData = doc.floors[floor];
  const selectedRoom: Room | null = floorData.rooms.find((r) => r.id === selectedRoomId) ?? null;
  const activePlanName = plans.find((p) => p.id === activePlanId)?.name ?? '間取り';

  // outer-wall cells of the OTHER floor, shown as a ghost for alignment
  const ghostWallCells: CellKey[] = (() => {
    const other = floor === 1 ? 2 : 1;
    const set = new Set<CellKey>();
    for (const r of doc.floors[other].rooms) for (const c of r.cells) set.add(c);
    return [...set];
  })();

  // autosave the whole project (active plan mirrors current doc)
  useEffect(() => {
    const project: Project = {
      version: 1,
      activePlanId,
      plans: plans.map((p) => (p.id === activePlanId ? { ...p, doc } : p)),
    };
    try {
      localStorage.setItem(PROJECT_KEY, JSON.stringify(project));
    } catch {
      /* ignore */
    }
  }, [doc, plans, activePlanId]);

  const resetUi = () => {
    setSelectedRoomId(null);
    setPendingCells([]);
    setCellAction('none');
  };

  const setMode = (m: Mode) => {
    if (mode === 'move' && m !== 'move') commit((d) => ops.resolveOverlaps(d, floor));
    setModeState(m);
    setCellAction('none');
    setPendingCells([]);
  };

  // ---- plan tabs ----
  const switchPlan = (id: string) => {
    if (id === activePlanId) return;
    if (mode === 'move') commit((d) => ops.resolveOverlaps(d, floor));
    const saved = presentRef.current;
    setPlans((ps) => ps.map((p) => (p.id === activePlanId ? { ...p, doc: saved } : p)));
    const target = plans.find((p) => p.id === id);
    if (target) {
      reset(target.doc);
      setActivePlanId(id);
      setFloor(1);
      setModeState('edit');
      resetUi();
    }
  };
  const addPlan = () => {
    const saved = presentRef.current;
    const np = makePlan(`間取り ${plans.length + 1}`);
    setPlans((ps) => ps.map((p) => (p.id === activePlanId ? { ...p, doc: saved } : p)).concat(np));
    reset(np.doc);
    setActivePlanId(np.id);
    setFloor(1);
    setModeState('edit');
    resetUi();
  };
  const importSharedPlan = (name: string, sdoc: Doc) => {
    const saved = presentRef.current;
    const np = makePlan(name, sdoc);
    setPlans((ps) => ps.map((p) => (p.id === activePlanId ? { ...p, doc: saved } : p)).concat(np));
    reset(np.doc);
    setActivePlanId(np.id);
    setFloor(1);
    setModeState('edit');
    resetUi();
  };

  // import a plan shared via URL hash (#p=...) on first load
  useEffect(() => {
    const shared = readSharedFromHash();
    if (shared) {
      importSharedPlan(shared.name, shared.doc);
      clearShareHash();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const renamePlan = (id: string, name: string) => setPlans((ps) => ps.map((p) => (p.id === id ? { ...p, name } : p)));
  const deletePlan = (id: string) => {
    if (plans.length <= 1) return;
    const remaining = plans.filter((p) => p.id !== id);
    setPlans(remaining);
    if (id === activePlanId) {
      const next = remaining[0];
      reset(next.doc);
      setActivePlanId(next.id);
      setFloor(1);
      setModeState('edit');
      resetUi();
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (ctrl && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
        e.preventDefault();
        redo();
      } else if (e.key === 'Escape') {
        setCellAction('none');
        setPendingCells([]);
      } else if (e.key === 'Delete' && selectedRoomId) {
        commit((d) => ops.deleteRoom(d, floor, selectedRoomId));
        setSelectedRoomId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, commit, floor, selectedRoomId]);

  const addType = (name: string): string => {
    const { doc: nd, type } = ops.addRoomType(presentRef.current, name);
    commit(nd);
    return type.id;
  };

  const switchFloor = (f: number) => {
    if (mode === 'move') commit((d) => ops.resolveOverlaps(d, floor));
    setFloor(f);
    resetUi();
  };

  const deleteSelected = () => {
    if (selectedRoomId) {
      commit((d) => ops.deleteRoom(d, floor, selectedRoomId));
      setSelectedRoomId(null);
    }
  };

  const exportJson = () => {
    const name = plans.find((p) => p.id === activePlanId)?.name ?? 'madori';
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const importJson = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const d = JSON.parse(String(reader.result)) as Doc;
        if (!d.floors || !d.roomTypes || !d.settings) throw new Error('invalid');
        reset(d);
        resetUi();
      } catch {
        alert('JSONの読み込みに失敗しました。');
      }
    };
    reader.readAsText(file);
  };

  const pendingM2 = cellsToM2(pendingCells.length, doc.settings.cellMm);
  const pendingAreaLabel = `${pendingM2.toFixed(2)}㎡ / ${m2ToJou(pendingM2).toFixed(1)}畳 / ${m2ToTsubo(pendingM2).toFixed(2)}坪`;

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">🏠 間取りシミュレーター</div>
        <div className="floor-tabs">
          {FLOORS.map((f) => (
            <button key={f} className={`floor-tab ${floor === f ? 'active' : ''}`} onClick={() => switchFloor(f)}>
              {f}階
            </button>
          ))}
        </div>
        <div className="header-right">
          <div className="zoom">
            <button onClick={() => setZoom((z) => Math.max(0.4, +(z - 0.2).toFixed(2)))}>－</button>
            <span>{Math.round(zoom * 100)}%</span>
            <button onClick={() => setZoom((z) => Math.min(2.5, +(z + 0.2).toFixed(2)))}>＋</button>
          </div>
          <button onClick={() => setSettingsOpen(true)}>⚙ 設定</button>
          <button onClick={() => setShareOpen(true)}>🔗 共有</button>
          <button onClick={exportJson}>エクスポート</button>
          <label className="file-btn">
            インポート
            <input
              type="file"
              accept="application/json"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importJson(f);
                e.target.value = '';
              }}
            />
          </label>
        </div>
      </header>

      <PlanTabs
        plans={plans.map((p) => ({ id: p.id, name: p.name }))}
        activeId={activePlanId}
        onSwitch={switchPlan}
        onAdd={addPlan}
        onRename={renamePlan}
        onDelete={deletePlan}
      />

      <div className="body">
        <aside className="left">
          <Toolbar
            mode={mode}
            cellAction={cellAction}
            setMode={setMode}
            hasPending={pendingCells.length > 0}
            canUndo={canUndo}
            canRedo={canRedo}
            onCreateRoom={() => pendingCells.length > 0 && setDialogOpen(true)}
            onUndo={undo}
            onRedo={redo}
          />
        </aside>

        <main className="center">
          <Canvas
            floorData={floorData}
            roomTypes={doc.roomTypes}
            cellMm={doc.settings.cellMm}
            wallMm={doc.settings.wallMm}
            mode={mode}
            cellAction={cellAction}
            zoom={zoom}
            selectedRoomId={selectedRoomId}
            pendingCells={pendingCells}
            ghostWallCells={ghostWallCells}
            onSelectRoom={(id) => {
              setSelectedRoomId(id);
              setPendingCells([]);
              if (cellAction !== 'none' && id === null) setCellAction('none');
            }}
            onPendingChange={setPendingCells}
            onExpand={(cells) => selectedRoomId && commit((d) => ops.expandRoom(d, floor, selectedRoomId, cells))}
            onShrink={(cells) => selectedRoomId && commit((d) => ops.shrinkRoom(d, floor, selectedRoomId, cells))}
            onTranslate={(roomId, dx, dy) => commit((d) => ops.translateRoom(d, floor, roomId, dx, dy))}
            onSetShape={(roomId, cells) => commit((d) => ops.setRoomShape(d, floor, roomId, cells))}
            onContextRoom={(id, x, y) => setMenu({ id, x, y })}
          />
        </main>

        <aside className="right">
          <PropertyPanel
            room={selectedRoom}
            roomTypes={doc.roomTypes}
            cellMm={doc.settings.cellMm}
            cellAction={cellAction}
            onPatch={(patch) => selectedRoomId && commit((d) => ops.patchRoom(d, floor, selectedRoomId, patch))}
            onAddType={addType}
            onDelete={deleteSelected}
            onSetCellAction={setCellAction}
          />
          <SummaryPanel floors={doc.floors} currentFloor={floor} cellMm={doc.settings.cellMm} />
        </aside>
      </div>

      {dialogOpen && (
        <RoomDialog
          roomTypes={doc.roomTypes}
          cellCount={pendingCells.length}
          areaLabel={pendingAreaLabel}
          onAddType={addType}
          onCancel={() => setDialogOpen(false)}
          onCreate={(name, typeId) => {
            commit((d) => ops.createRoom(d, floor, name, typeId, pendingCells));
            setDialogOpen(false);
            setPendingCells([]);
          }}
        />
      )}

      {settingsOpen && (
        <SettingsDialog
          roomTypes={doc.roomTypes}
          settings={doc.settings}
          onPatchType={(id, patch) => commit((d) => ops.updateRoomType(d, id, patch))}
          onAddType={(name) => addType(name)}
          onPatchSettings={(patch) => commit((d) => ops.updateSettings(d, patch))}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {shareOpen && (
        <ShareDialog
          url={buildShareUrl(activePlanName, doc)}
          planName={activePlanName}
          onClose={() => setShareOpen(false)}
        />
      )}

      {menu && (
        <>
          <div className="menu-layer" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }} />
          <div className="context-menu" style={{ left: menu.x, top: menu.y }}>
            <button onClick={() => { commit((d) => ops.reorderRoom(d, floor, menu.id, 'front')); setMenu(null); }}>前面へ</button>
            <button onClick={() => { commit((d) => ops.reorderRoom(d, floor, menu.id, 'forward')); setMenu(null); }}>1つ前へ</button>
            <button onClick={() => { commit((d) => ops.reorderRoom(d, floor, menu.id, 'backward')); setMenu(null); }}>1つ後ろへ</button>
            <button onClick={() => { commit((d) => ops.reorderRoom(d, floor, menu.id, 'back')); setMenu(null); }}>背面へ</button>
            <hr />
            <button className="danger" onClick={() => { commit((d) => ops.deleteRoom(d, floor, menu.id)); if (selectedRoomId === menu.id) setSelectedRoomId(null); setMenu(null); }}>削除</button>
          </div>
        </>
      )}
    </div>
  );
}
