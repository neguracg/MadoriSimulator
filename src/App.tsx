import { useEffect, useRef, useState } from 'react';
import Canvas from './components/Canvas';
import Toolbar from './components/Toolbar';
import PropertyPanel from './components/PropertyPanel';
import SummaryPanel from './components/SummaryPanel';
import RoomDialog from './components/RoomDialog';
import SettingsDialog from './components/SettingsDialog';
import PlanTabs from './components/PlanTabs';
import ShareDialog from './components/ShareDialog';
import OpeningDialog from './components/OpeningDialog';
import FurniturePanel from './components/FurniturePanel';
import FileMenu from './components/FileMenu';
import { useAutosave } from './hooks/useAutosave';
import { useFitView } from './hooks/useFitView';
import { useNotice } from './hooks/useNotice';
import { useStorageSync } from './hooks/useStorageSync';
import { cellsToM2, DEFAULT_FURNITURE_COLOR, FLOORS, m2ToJou, m2ToTsubo, OPENING_MM_RANGE, uid } from './constants';
import { parseNumberInRange } from './components/NumberField';
import type { CellAction, CellKey, Doc, Furniture, Mode, Room, RoomType } from './types';
import { useHistory } from './state/useHistory';
import { mergeKeyFor } from './state/mergeKeys';
import * as ops from './state/docOps';
import {
  addPlans,
  backupFileName,
  buildProject,
  copyPlan,
  downloadText,
  exportProject,
  loadProject,
  makePlan,
  parseImportFile,
  type Plan,
} from './state/projectStore';
import { buildShareUrl, clearShareHash, isLocalPage, readSharedFromHash } from './utils/share';
import { ZOOM_MAX, ZOOM_MIN } from './utils/viewFit';

/** The open context menu or dropdown. A file menu hangs under its button (x = the side it is anchored to). */
type MenuState =
  | { kind: 'room' | 'opening'; id: string; x: number; y: number }
  | { kind: 'file'; x: number; y: number; alignRight: boolean };

export default function App() {
  const [boot] = useState(loadProject);
  const activeDoc0 = boot.plans.find((p) => p.id === boot.activePlanId)!.doc;
  const { present: doc, presentRef, commit, undo, redo, reset, canUndo, canRedo } = useHistory<Doc>(activeDoc0);

  const [plans, setPlans] = useState<Plan[]>(boot.plans);
  const [activePlanId, setActivePlanId] = useState(boot.activePlanId);
  const { saveError, skipNextSave } = useAutosave(plans, activePlanId, doc); // saveError: the last autosave was refused by the browser
  const [notice, notify] = useNotice(); // a short message that goes away by itself
  // Every plan id this tab has held. Ids of deleted plans stay in: a plan deleted here must not come back from another tab's copy.
  const [seenPlanIds] = useState(() => new Set(boot.plans.map((p) => p.id)));
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [floor, setFloor] = useState(1);
  const [mode, setModeState] = useState<Mode>('edit');
  const [cellAction, setCellAction] = useState<CellAction>('none');
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [pendingCells, setPendingCells] = useState<CellKey[]>([]);
  const [zoom, setZoom] = useState(1);
  const centerRef = useRef<HTMLElement>(null); // the scrolled area that holds the canvas
  const [dialogOpen, setDialogOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [openingDialogOpen, setOpeningDialogOpen] = useState(false);
  const [placingOpening, setPlacingOpening] = useState<{ kind: 'door' | 'window'; size: number } | null>(null);
  const [selectedOpeningId, setSelectedOpeningId] = useState<string | null>(null);
  const [selectedFurnitureId, setSelectedFurnitureId] = useState<string | null>(null);
  const [furnitureArmed, setFurnitureArmed] = useState(false);

  // clipboard for copy/cut/paste — app-level so it survives floor & plan switches
  type Clip =
    | { kind: 'room'; room: Room; type: RoomType | null; srcFloor: number; srcPlan: string }
    | { kind: 'furniture'; item: Furniture; srcFloor: number; srcPlan: string };
  const clipboardRef = useRef<Clip | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);

  const floorData = doc.floors[floor];
  const furnitureList = floorData.furniture ?? [];
  const selectedRoom: Room | null = floorData.rooms.find((r) => r.id === selectedRoomId) ?? null;
  const selectedFurniture: Furniture | null = furnitureList.find((f) => f.id === selectedFurnitureId) ?? null;
  const activePlanName = plans.find((p) => p.id === activePlanId)?.name ?? '間取り';

  const fitAll = useFitView(centerRef, floorData, doc.settings.cellMm, zoom, setZoom);

  // outer-wall cells of the OTHER floor, shown as a ghost for alignment
  const ghostWallCells: CellKey[] = (() => {
    const other = floor === 1 ? 2 : 1;
    const set = new Set<CellKey>();
    for (const r of doc.floors[other].rooms) for (const c of r.cells) set.add(c);
    return [...set];
  })();


  const resetUi = () => {
    setSelectedRoomId(null);
    setSelectedOpeningId(null);
    setSelectedFurnitureId(null);
    setPendingCells([]);
    setCellAction('none');
    setPlacingOpening(null);
    setFurnitureArmed(false);
  };

  const setMode = (m: Mode) => {
    if (mode === 'move' && m !== 'move') commit((d) => ops.resolveOverlaps(d, floor));
    setModeState(m);
    setCellAction('none');
    setPendingCells([]);
  };

  // ---- plan tabs ----
  // The document as it must be parked when this view stops showing it (another tab, a new tab, an import).
  // Move mode still holds overlapping rooms that are only settled on leaving the mode, so they are settled here, and
  // synchronously: the result of a commit() cannot be read back yet (presentRef follows the next render).
  // Every route that leaves the document goes through here (setMode and switchFloor stay on it and commit the settling).
  const leaveCurrentDoc = (): Doc => (mode === 'move' ? ops.resolveOverlaps(presentRef.current, floor) : presentRef.current);

  const switchPlan = (id: string) => {
    if (id === activePlanId) return;
    const target = plans.find((p) => p.id === id);
    if (!target) return;
    const saved = leaveCurrentDoc();
    setPlans((ps) => ps.map((p) => (p.id === activePlanId ? { ...p, doc: saved } : p)));
    reset(target.doc);
    setActivePlanId(id);
    setFloor(1);
    setModeState('edit');
    resetUi();
  };
  // Every route that adds plans (new tab, copy, shared link, imported file, another tab's plans) comes through here.
  // `select` (the default): park the current document in its own tab, then open the first added plan.
  // Without it the plans only join the tab list and what is on screen stays.
  const appendPlans = (added: Plan[], select = true) => {
    if (added.length === 0) return;
    for (const p of added) seenPlanIds.add(p.id);
    if (!select) {
      setPlans((ps) => addPlans(ps, added));
      return;
    }
    const saved = leaveCurrentDoc();
    setPlans((ps) => addPlans(ps, added, { id: activePlanId, doc: saved }));
    reset(added[0].doc);
    setActivePlanId(added[0].id);
    setFloor(1);
    setModeState('edit');
    resetUi();
  };
  const addPlan = () => appendPlans([makePlan(`間取り ${plans.length + 1}`)]);
  // Plans another tab saved that this tab never had join the tab list (nothing is selected, and nothing is written back).
  useStorageSync(
    (id) => seenPlanIds.has(id),
    (fresh) => {
      skipNextSave();
      appendPlans(fresh, false);
      notify(`別のタブの間取りを${fresh.length}件追加しました`);
    },
  );
  // A copy of the plan on screen (its document as it will be parked: move mode's overlaps settled), opened at once.
  const duplicatePlan = () => {
    const src = plans.find((p) => p.id === activePlanId);
    if (src) appendPlans([copyPlan(src, leaveCurrentDoc())]);
  };
  const importSharedPlan = (name: string, sdoc: Doc) => appendPlans([makePlan(name, sdoc)]);

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

  // A dialog or the context menu is open: it owns the keyboard. No shortcut reaches the page behind it
  // (Delete used to delete the room behind the share dialog), and Esc closes it.
  // A NEW dialog or menu must be added to overlayOpen and to closeOverlays.
  const overlayOpen = dialogOpen || settingsOpen || shareOpen || openingDialogOpen || menu !== null;
  const closeOverlays = () => {
    setDialogOpen(false);
    setSettingsOpen(false);
    setShareOpen(false);
    setOpeningDialogOpen(false);
    setMenu(null);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (overlayOpen) {
        if (e.key === 'Escape' && !e.isComposing) closeOverlays(); // also from inside a field of the dialog
        return;
      }
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
        setPlacingOpening(null);
        setFurnitureArmed(false);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedFurnitureId) {
          commit((d) => ops.removeFurniture(d, floor, selectedFurnitureId));
          setSelectedFurnitureId(null);
        } else if (selectedOpeningId) {
          commit((d) => ops.removeOpening(d, floor, selectedOpeningId));
          setSelectedOpeningId(null);
        } else if (selectedRoomId) {
          commit((d) => ops.deleteRoom(d, floor, selectedRoomId));
          setSelectedRoomId(null);
        }
      } else if (ctrl && (e.key.toLowerCase() === 'c' || e.key.toLowerCase() === 'x')) {
        // copy / cut the selected object (room or furniture)
        const d0 = presentRef.current;
        const fd = d0.floors[floor];
        const selFurn = selectedFurnitureId ? (fd.furniture ?? []).find((f) => f.id === selectedFurnitureId) : null;
        const selRoom = selectedRoomId ? fd.rooms.find((r) => r.id === selectedRoomId) : null;
        if (selFurn) {
          clipboardRef.current = { kind: 'furniture', item: { ...selFurn }, srcFloor: floor, srcPlan: activePlanId };
          e.preventDefault();
          if (e.key.toLowerCase() === 'x') {
            commit((d) => ops.removeFurniture(d, floor, selFurn.id));
            setSelectedFurnitureId(null);
          }
        } else if (selRoom) {
          const type = d0.roomTypes.find((t) => t.id === selRoom.typeId) ?? null;
          clipboardRef.current = { kind: 'room', room: { ...selRoom }, type, srcFloor: floor, srcPlan: activePlanId };
          e.preventDefault();
          if (e.key.toLowerCase() === 'x') {
            commit((d) => ops.deleteRoom(d, floor, selRoom.id));
            setSelectedRoomId(null);
          }
        }
      } else if (ctrl && e.key.toLowerCase() === 'v') {
        const clip = clipboardRef.current;
        if (!clip) return;
        e.preventDefault();
        const sameSpot = clip.srcFloor === floor && clip.srcPlan === activePlanId;
        const id = uid();
        if (clip.kind === 'furniture') {
          const off = sameSpot ? presentRef.current.settings.cellMm : 0;
          commit((d) => ops.pasteFurniture(d, floor, clip.item, id, off, off));
          setSelectedRoomId(null);
          setSelectedOpeningId(null);
          setSelectedFurnitureId(id);
        } else {
          const off = sameSpot ? 1 : 0;
          commit((d) => ops.pasteRoom(d, floor, clip.room, clip.type, id, off, off));
          setSelectedFurnitureId(null);
          setSelectedOpeningId(null);
          setSelectedRoomId(id);
          setMode('move'); // it may sit on other rooms: move it away; overlaps are settled when going back to edit
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, commit, floor, activePlanId, selectedRoomId, selectedOpeningId, selectedFurnitureId, presentRef, overlayOpen]);

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

  // Ask for a new width of an opening. window.prompt hands back any text: only a number inside the allowed range is applied.
  const changeOpeningWidth = (id: string) => {
    const cur = floorData.openings.find((o) => o.id === id);
    const v = window.prompt(`幅 (mm) を入力（${OPENING_MM_RANGE.min}〜${OPENING_MM_RANGE.max}）`, String(cur?.size ?? 800));
    if (v === null || v.trim() === '') return; // cancelled
    const n = parseNumberInRange(v, OPENING_MM_RANGE.min, OPENING_MM_RANGE.max);
    if (n === null) window.alert(`幅は ${OPENING_MM_RANGE.min}〜${OPENING_MM_RANGE.max} mm の数字で入力してください。`);
    else commit((d) => ops.patchOpening(d, floor, id, { size: n }));
  };

  const deleteSelected = () => {
    if (selectedRoomId) {
      commit((d) => ops.deleteRoom(d, floor, selectedRoomId));
      setSelectedRoomId(null);
    }
  };

  // ---- the file menu: write out this plan / back up everything / read a file in
  const exportPlan = () => downloadText(`${activePlanName}.json`, JSON.stringify(doc, null, 2));
  const backupAll = () => downloadText(backupFileName(), exportProject(buildProject(plans, activePlanId, doc)));
  // An imported file is ADDED as new tab(s) and selected; the plan being edited is never replaced.
  const importJson = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const added = parseImportFile(String(reader.result), file.name);
      if (added.length === 0) {
        alert('JSONの読み込みに失敗しました。');
        return;
      }
      appendPlans(added);
      notify(`${added.length}件の間取りを追加しました`);
    };
    reader.onerror = () => alert('JSONの読み込みに失敗しました。');
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
            <button onClick={() => setZoom((z) => Math.max(ZOOM_MIN, +(z - 0.2).toFixed(2)))}>－</button>
            <span>{Math.round(zoom * 100)}%</span>
            <button onClick={() => setZoom((z) => Math.min(ZOOM_MAX, +(z + 0.2).toFixed(2)))}>＋</button>
            <button className="zoom-fit" title="内容の全体が見える大きさと位置に合わせる" onClick={fitAll}>
              全体
            </button>
          </div>
          <button onClick={() => setSettingsOpen(true)}>⚙ 設定</button>
          <button onClick={() => setShareOpen(true)}>🔗 共有</button>
          <button
            aria-haspopup="menu"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              const alignRight = r.left > window.innerWidth / 2; // a button on the right half: the menu grows leftwards
              setMenu({ kind: 'file', x: alignRight ? r.right : r.left, y: r.bottom + 4, alignRight });
            }}
          >
            💾 ファイル ▾
          </button>
          <input
            ref={fileInputRef}
            type="file"
            hidden
            accept="application/json,.json"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importJson(f);
              e.target.value = '';
            }}
          />
        </div>
      </header>

      {saveError && (
        <div className="save-error" role="alert">
          保存に失敗しました。ファイルへ書き出して退避してください
        </div>
      )}
      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}

      <PlanTabs
        plans={plans.map((p) => ({ id: p.id, name: p.name }))}
        activeId={activePlanId}
        onSwitch={switchPlan}
        onAdd={addPlan}
        onDuplicate={duplicatePlan}
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
            furnitureArmed={furnitureArmed}
            canUndo={canUndo}
            canRedo={canRedo}
            onCreateRoom={() => pendingCells.length > 0 && setDialogOpen(true)}
            onAddOpening={() => setOpeningDialogOpen(true)}
            onArmFurniture={() => {
              setFurnitureArmed((a) => !a);
              setCellAction('none');
              setPendingCells([]);
              setSelectedRoomId(null);
              setSelectedOpeningId(null);
            }}
            onUndo={undo}
            onRedo={redo}
          />
        </aside>

        <main className="center" ref={centerRef}>
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
            openings={floorData.openings}
            placingOpening={placingOpening}
            selectedOpeningId={selectedOpeningId}
            furniture={furnitureList}
            selectedFurnitureId={selectedFurnitureId}
            furnitureArmed={furnitureArmed}
            onSelectRoom={(id) => {
              setSelectedRoomId(id);
              setSelectedOpeningId(null);
              setSelectedFurnitureId(null);
              setPendingCells([]);
              if (cellAction !== 'none' && id === null) setCellAction('none');
            }}
            onPendingChange={setPendingCells}
            onExpand={(cells) => selectedRoomId && commit((d) => ops.expandRoom(d, floor, selectedRoomId, cells))}
            onShrink={(cells) => selectedRoomId && commit((d) => ops.shrinkRoom(d, floor, selectedRoomId, cells))}
            onTranslate={(roomId, dx, dy) => commit((d) => ops.translateRoom(d, floor, roomId, dx, dy))}
            onSetShape={(roomId, cells) => commit((d) => ops.setRoomShape(d, floor, roomId, cells))}
            onContextRoom={(id, x, y) => setMenu({ kind: 'room', id, x, y })}
            onAddOpening={(kind, cx, cy, side, size) => {
              commit((d) => ops.addOpening(d, floor, kind, cx, cy, side, size));
              setPlacingOpening(null);
            }}
            onPatchOpening={(id, patch) => commit((d) => ops.patchOpening(d, floor, id, patch))}
            onSelectOpening={(id) => {
              setSelectedOpeningId(id);
              if (id) { setSelectedRoomId(null); setSelectedFurnitureId(null); }
            }}
            onContextOpening={(id, x, y) => setMenu({ kind: 'opening', id, x, y })}
            onCreateFurniture={(x, y, w, h) => {
              const id = uid();
              commit((d) => ops.addFurniture(d, floor, { id, name: '家具', x, y, w, h, color: DEFAULT_FURNITURE_COLOR }));
              setFurnitureArmed(false);
              setSelectedRoomId(null);
              setSelectedOpeningId(null);
              setSelectedFurnitureId(id);
            }}
            onSelectFurniture={(id) => {
              setSelectedFurnitureId(id);
              if (id) { setSelectedRoomId(null); setSelectedOpeningId(null); }
            }}
            onPatchFurniture={(id, patch) => commit((d) => ops.patchFurniture(d, floor, id, patch))}
          />
          {placingOpening && (
            <div className="place-banner">
              {placingOpening.kind === 'door' ? 'ドア' : '窓'}（{placingOpening.size}mm）をどこに配置しますか？
              壁の上でクリックで確定・Escで中止
              <button onClick={() => setPlacingOpening(null)}>中止</button>
            </div>
          )}
        </main>

        <aside className="right">
          {selectedFurniture ? (
            <FurniturePanel
              item={selectedFurniture}
              onPatch={(patch) =>
                commit((d) => ops.patchFurniture(d, floor, selectedFurniture.id, patch), mergeKeyFor('furniture', selectedFurniture.id, patch))
              }
              onDelete={() => {
                commit((d) => ops.removeFurniture(d, floor, selectedFurniture.id));
                setSelectedFurnitureId(null);
              }}
            />
          ) : (
            <PropertyPanel
              room={selectedRoom}
              roomTypes={doc.roomTypes}
              cellMm={doc.settings.cellMm}
              cellAction={cellAction}
              onPatch={(patch) =>
                selectedRoomId && commit((d) => ops.patchRoom(d, floor, selectedRoomId, patch), mergeKeyFor('room', selectedRoomId, patch))
              }
              onAddType={addType}
              onDelete={deleteSelected}
              onSetCellAction={setCellAction}
            />
          )}
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
          onPatchType={(id, patch) => commit((d) => ops.updateRoomType(d, id, patch), mergeKeyFor('type', id, patch))}
          onAddType={(name) => addType(name)}
          onPatchSettings={(patch) => commit((d) => ops.updateSettings(d, patch), mergeKeyFor('settings', 'doc', patch))}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {shareOpen && (
        <ShareDialog
          url={buildShareUrl(activePlanName, doc)}
          planName={activePlanName}
          publicBase={isLocalPage()}
          onClose={() => setShareOpen(false)}
        />
      )}

      {menu && (
        <>
          <div className="menu-layer" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }} />
          <div className="context-menu" style={menu.kind === 'file' && menu.alignRight ? { right: window.innerWidth - menu.x, top: menu.y } : { left: menu.x, top: menu.y }}>
            {menu.kind === 'file' ? (
              <FileMenu
                onExportPlan={() => { exportPlan(); setMenu(null); }}
                onBackupAll={() => { backupAll(); setMenu(null); }}
                onImport={() => { setMenu(null); fileInputRef.current?.click(); }}
              />
            ) : menu.kind === 'room' ? (
              <>
                <button onClick={() => { setOpeningDialogOpen(true); setMenu(null); }}>🚪 ドア／窓を追加</button>
                <hr />
                <button onClick={() => { commit((d) => ops.reorderRoom(d, floor, menu.id, 'front')); setMenu(null); }}>前面へ</button>
                <button onClick={() => { commit((d) => ops.reorderRoom(d, floor, menu.id, 'forward')); setMenu(null); }}>1つ前へ</button>
                <button onClick={() => { commit((d) => ops.reorderRoom(d, floor, menu.id, 'backward')); setMenu(null); }}>1つ後ろへ</button>
                <button onClick={() => { commit((d) => ops.reorderRoom(d, floor, menu.id, 'back')); setMenu(null); }}>背面へ</button>
                <hr />
                <button className="danger" onClick={() => { commit((d) => ops.deleteRoom(d, floor, menu.id)); if (selectedRoomId === menu.id) setSelectedRoomId(null); setMenu(null); }}>削除</button>
              </>
            ) : (
              <>
                <button onClick={() => { changeOpeningWidth(menu.id); setMenu(null); }}>幅を変更…</button>
                <button onClick={() => {
                  const cur = floorData.openings.find((o) => o.id === menu.id);
                  if (cur) commit((d) => ops.patchOpening(d, floor, menu.id, { kind: cur.kind === 'door' ? 'window' : 'door' }));
                  setMenu(null);
                }}>ドア⇄窓を切替</button>
                <hr />
                <button className="danger" onClick={() => { commit((d) => ops.removeOpening(d, floor, menu.id)); if (selectedOpeningId === menu.id) setSelectedOpeningId(null); setMenu(null); }}>削除</button>
              </>
            )}
          </div>
        </>
      )}

      {openingDialogOpen && (
        <OpeningDialog
          onCancel={() => setOpeningDialogOpen(false)}
          onConfirm={(kind, size) => {
            setPlacingOpening({ kind, size });
            setOpeningDialogOpen(false);
            setSelectedRoomId(null);
            setSelectedOpeningId(null);
          }}
        />
      )}
    </div>
  );
}
