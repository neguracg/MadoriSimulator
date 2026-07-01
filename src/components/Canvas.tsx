import { useEffect, useMemo, useRef, useState } from 'react';
import { BASE_CELL_PX, DOOR_COLOR, GRID_H, GRID_W, WINDOW_COLOR, cellsToM2, m2ToJou } from '../constants';
import { cellKey, parseCell, type CellAction, type CellKey, type FloorData, type Mode, type Opening, type RoomType, type Side } from '../types';
import { applyRunDrag, bbox, boundaryRuns, boundarySegments, edgeSegment, unionBoundary, type Run } from '../utils/geometry';

interface Props {
  floorData: FloorData;
  roomTypes: RoomType[];
  cellMm: number;
  wallMm: number;
  mode: Mode;
  cellAction: CellAction;
  zoom: number;
  selectedRoomId: string | null;
  pendingCells: CellKey[];
  ghostWallCells: CellKey[]; // outer-wall cells of the OTHER floor
  openings: Opening[];
  placingOpening: { kind: 'door' | 'window'; size: number } | null;
  selectedOpeningId: string | null;
  onSelectRoom: (id: string | null) => void;
  onPendingChange: (cells: CellKey[]) => void;
  onExpand: (cells: CellKey[]) => void;
  onShrink: (cells: CellKey[]) => void;
  onTranslate: (roomId: string, dx: number, dy: number) => void;
  onSetShape: (roomId: string, cells: CellKey[]) => void;
  onContextRoom: (roomId: string, x: number, y: number) => void;
  onAddOpening: (kind: 'door' | 'window', cx: number, cy: number, side: Side, size: number) => void;
  onPatchOpening: (id: string, patch: { cx: number; cy: number; side: Side }) => void;
  onSelectOpening: (id: string | null) => void;
  onContextOpening: (id: string, x: number, y: number) => void;
}

type Pt = { x: number; y: number };

function rectCells(a: Pt, b: Pt): CellKey[] {
  const x0 = Math.max(0, Math.min(a.x, b.x));
  const x1 = Math.min(GRID_W - 1, Math.max(a.x, b.x));
  const y0 = Math.max(0, Math.min(a.y, b.y));
  const y1 = Math.min(GRID_H - 1, Math.max(a.y, b.y));
  const out: CellKey[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push(cellKey(x, y));
  return out;
}

/** Wrap text to fit availablePx, honouring manual line breaks. Full-width chars ≈ fs, half-width ≈ fs*0.55. */
function wrapText(text: string, availablePx: number, fs: number): string[] {
  const lines: string[] = [];
  for (const raw of text.split('\n')) {
    if (raw === '') { lines.push(''); continue; }
    let cur = '';
    let curW = 0;
    for (const ch of raw) {
      const w = ch.charCodeAt(0) > 0xff ? fs : fs * 0.55;
      if (curW + w > availablePx && cur !== '') {
        lines.push(cur);
        cur = ch;
        curW = w;
      } else {
        cur += ch;
        curW += w;
      }
    }
    if (cur) lines.push(cur);
  }
  return lines.length ? lines : [''];
}

export default function Canvas(props: Props) {
  const { floorData, roomTypes, cellMm, wallMm, mode, cellAction, zoom, selectedRoomId, pendingCells, ghostWallCells, openings, placingOpening, selectedOpeningId } = props;
  const cell = BASE_CELL_PX * zoom;
  const pxPerMm = cell / cellMm;
  const wallPx = Math.max(2, wallMm * pxPerMm);
  const svgRef = useRef<SVGSVGElement>(null);

  const typeColor = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of roomTypes) m.set(t.id, t.color);
    return m;
  }, [roomTypes]);

  const cellOwner = useMemo(() => {
    const m = new Map<CellKey, string>();
    for (const r of [...floorData.rooms].sort((a, b) => a.z - b.z)) {
      for (const c of r.cells) m.set(c, r.id); // higher z overwrites
    }
    return m;
  }, [floorData.rooms]);

  const selectedRoom = floorData.rooms.find((r) => r.id === selectedRoomId) ?? null;

  // wall edges (for snapping doors/windows) — one entry per physical wall segment
  type WallEdge = { cx: number; cy: number; side: Side; mx: number; my: number };
  const wallEdges = useMemo<WallEdge[]>(() => {
    const seen = new Set<string>();
    const list: WallEdge[] = [];
    for (const r of floorData.rooms) {
      const set = new Set(r.cells);
      for (const c of r.cells) {
        const [x, y] = parseCell(c);
        const cand: [Side, number, number, string, number, number][] = [
          ['N', x, y - 1, `h,${x},${y}`, x + 0.5, y],
          ['S', x, y + 1, `h,${x},${y + 1}`, x + 0.5, y + 1],
          ['W', x - 1, y, `v,${x},${y}`, x, y + 0.5],
          ['E', x + 1, y, `v,${x + 1},${y}`, x + 1, y + 0.5],
        ];
        for (const [side, nx, ny, skey, mx, my] of cand) {
          if (!set.has(cellKey(nx, ny)) && !seen.has(skey)) {
            seen.add(skey);
            list.push({ cx: x, cy: y, side, mx, my });
          }
        }
      }
    }
    return list;
  }, [floorData.rooms]);

  // find nearest wall segment for door/window snapping
  const nearestWall = (px: number, py: number): WallEdge | null => {
    let best: WallEdge | null = null;
    let bd = Infinity;
    for (const w of wallEdges) {
      const d = (w.mx - px) ** 2 + (w.my - py) ** 2;
      if (d < bd) { bd = d; best = w; }
    }
    return best;
  };

  // ---- drag state ----
  const [rubber, setRubber] = useState<{ start: Pt; cur: Pt; purpose: 'create' | 'expand' | 'shrink' } | null>(null);
  const [moveDrag, setMoveDrag] = useState<{ roomId: string; start: Pt; cur: Pt } | null>(null);
  const [handleDrag, setHandleDrag] = useState<
    ({ kind: 'edge'; run: Run } | { kind: 'corner'; ax: number; ay: number }) | null
  >(null);
  const [handlePreview, setHandlePreview] = useState<CellKey[] | null>(null);
  const [placeGhost, setPlaceGhost] = useState<{ cx: number; cy: number; side: Side } | null>(null);
  const [openingDrag, setOpeningDrag] = useState<{ id: string } | null>(null);
  const [openingDragPos, setOpeningDragPos] = useState<{ cx: number; cy: number; side: Side } | null>(null);
  const dragBaseCells = useRef<CellKey[]>([]);
  const movedRef = useRef(false);

  const ptFromEvent = (e: { clientX: number; clientY: number }) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const px = (e.clientX - rect.left) / cell;
    const py = (e.clientY - rect.top) / cell;
    return { cx: Math.floor(px), cy: Math.floor(py), px, py };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || handleDrag) return;
    // placing a door/window: click confirms position on the nearest wall
    if (placingOpening) {
      const { px, py } = ptFromEvent(e);
      const w = nearestWall(px, py);
      if (w) props.onAddOpening(placingOpening.kind, w.cx, w.cy, w.side, placingOpening.size);
      return;
    }
    const { cx, cy } = ptFromEvent(e);
    if (cx < 0 || cy < 0 || cx >= GRID_W || cy >= GRID_H) return;
    movedRef.current = false;
    const owner = cellOwner.get(cellKey(cx, cy));
    (e.target as Element).setPointerCapture?.(e.pointerId);
    props.onSelectOpening(null);

    if (mode === 'move') {
      if (owner) {
        props.onSelectRoom(owner);
        setMoveDrag({ roomId: owner, start: { x: cx, y: cy }, cur: { x: cx, y: cy } });
      }
      return;
    }
    // edit mode
    if (cellAction === 'expand') {
      setRubber({ start: { x: cx, y: cy }, cur: { x: cx, y: cy }, purpose: 'expand' });
    } else if (cellAction === 'shrink') {
      setRubber({ start: { x: cx, y: cy }, cur: { x: cx, y: cy }, purpose: 'shrink' });
    } else if (owner) {
      props.onSelectRoom(owner);
    } else {
      props.onSelectRoom(null);
      setRubber({ start: { x: cx, y: cy }, cur: { x: cx, y: cy }, purpose: 'create' });
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (placingOpening) {
      const { px, py } = ptFromEvent(e);
      setPlaceGhost(nearestWall(px, py));
      return;
    }
    if (!rubber && !moveDrag) return;
    const { cx, cy } = ptFromEvent(e);
    movedRef.current = true;
    if (rubber) setRubber((r) => (r ? { ...r, cur: { x: cx, y: cy } } : r));
    if (moveDrag) setMoveDrag((m) => (m ? { ...m, cur: { x: cx, y: cy } } : m));
  };

  const onPointerUp = () => {
    if (rubber) {
      const cells = rectCells(rubber.start, rubber.cur);
      if (rubber.purpose === 'create') props.onPendingChange(cells);
      else if (rubber.purpose === 'expand' && selectedRoomId) props.onExpand(cells);
      else if (rubber.purpose === 'shrink' && selectedRoomId) props.onShrink(cells);
      setRubber(null);
    } else if (moveDrag) {
      const dx = moveDrag.cur.x - moveDrag.start.x;
      const dy = moveDrag.cur.y - moveDrag.start.y;
      if (dx !== 0 || dy !== 0) props.onTranslate(moveDrag.roomId, dx, dy);
      setMoveDrag(null);
    }
  };

  // ---- handle (edge / corner) drag, via window listeners ----
  useEffect(() => {
    if (!handleDrag || !selectedRoom) return;
    const base = dragBaseCells.current;

    const onMove = (e: PointerEvent) => {
      const { px, py, cx, cy } = ptFromEvent(e);
      if (handleDrag.kind === 'edge') {
        const run = handleDrag.run;
        let movedOutward: number;
        if (run.orient === 'H') {
          const refLine = run.line;
          const delta = py - refLine; // + = downward
          movedOutward = run.dir === 'N' ? -delta : delta;
        } else {
          const refLine = run.line;
          const delta = px - refLine; // + = rightward
          movedOutward = run.dir === 'W' ? -delta : delta;
        }
        const k = Math.round(movedOutward);
        const next = applyRunDrag(base, run, k);
        setHandlePreview(next.length > 0 ? next : base);
      } else {
        const tx = Math.min(GRID_W - 1, Math.max(0, cx));
        const ty = Math.min(GRID_H - 1, Math.max(0, cy));
        const a: Pt = { x: handleDrag.ax, y: handleDrag.ay };
        const b: Pt = { x: tx, y: ty };
        setHandlePreview(rectCells(a, b));
      }
    };
    const onUp = () => {
      setHandlePreview((prev) => {
        if (prev && prev.length > 0 && selectedRoom) props.onSetShape(selectedRoom.id, prev);
        return null;
      });
      setHandleDrag(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleDrag, cell]);

  // ---- door/window drag, via window listeners ----
  useEffect(() => {
    if (!openingDrag) return;
    const onMove = (e: PointerEvent) => {
      const { px, py } = ptFromEvent(e);
      const w = nearestWall(px, py);
      if (w) setOpeningDragPos({ cx: w.cx, cy: w.cy, side: w.side });
    };
    const onUp = () => {
      setOpeningDragPos((pos) => {
        if (pos && openingDrag) props.onPatchOpening(openingDrag.id, pos);
        return null;
      });
      setOpeningDrag(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openingDrag, cell, wallEdges]);

  // ---- render ----
  const W = GRID_W * cell;
  const H = GRID_H * cell;

  const gridLines = [];
  for (let i = 0; i <= GRID_W; i++) {
    gridLines.push(
      <line key={`v${i}`} x1={i * cell} y1={0} x2={i * cell} y2={H} className={i % 2 === 0 ? 'grid-major' : 'grid-minor'} />,
    );
  }
  for (let j = 0; j <= GRID_H; j++) {
    gridLines.push(
      <line key={`h${j}`} x1={0} y1={j * cell} x2={W} y2={j * cell} className={j % 2 === 0 ? 'grid-major' : 'grid-minor'} />,
    );
  }

  const moveOffset = moveDrag ? { dx: moveDrag.cur.x - moveDrag.start.x, dy: moveDrag.cur.y - moveDrag.start.y } : null;

  // displayed cells per room (apply move offset / handle preview)
  const displayCells = (roomId: string, cells: CellKey[]): { cells: CellKey[]; dx: number; dy: number } => {
    if (handlePreview && roomId === selectedRoomId) return { cells: handlePreview, dx: 0, dy: 0 };
    if (moveOffset && moveDrag?.roomId === roomId) return { cells, dx: moveOffset.dx, dy: moveOffset.dy };
    return { cells, dx: 0, dy: 0 };
  };

  // union outline using displayed cells
  const unionRooms = floorData.rooms.map((r) => {
    const d = displayCells(r.id, r.cells);
    return { ...r, cells: d.cells.map((c) => { const [x, y] = parseCell(c); return cellKey(x + d.dx, y + d.dy); }) };
  });

  const showHandles = mode === 'edit' && cellAction === 'none' && !!selectedRoom && !moveDrag && !rubber;
  const runs = showHandles ? boundaryRuns(selectedRoom!.cells) : [];
  const box = showHandles ? bbox(selectedRoom!.cells) : null;
  const isRect = showHandles && box && selectedRoom!.cells.length === box.w * box.h;

  return (
    <div className="canvas-scroll">
      <svg
        ref={svgRef}
        width={W}
        height={H}
        className={`canvas mode-${mode} act-${cellAction}${placingOpening ? ' placing' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onContextMenu={(e) => {
          const { cx, cy } = ptFromEvent(e);
          const owner = cellOwner.get(cellKey(cx, cy));
          if (owner) {
            e.preventDefault();
            props.onContextRoom(owner, e.clientX, e.clientY);
          }
        }}
      >
        <rect x={0} y={0} width={W} height={H} className="canvas-bg" />
        <g>{gridLines}</g>

        {/* other floor's outer wall (ghost) */}
        {ghostWallCells.length > 0 &&
          boundarySegments(ghostWallCells).map((s, i) => (
            <line
              key={`g${i}`}
              x1={s[0] * cell}
              y1={s[1] * cell}
              x2={s[2] * cell}
              y2={s[3] * cell}
              stroke="#e67e22"
              strokeWidth={2}
              strokeDasharray="5 4"
              opacity={0.7}
            />
          ))}

        {/* room fills + walls */}
        {[...floorData.rooms]
          .sort((a, b) => a.z - b.z)
          .map((r) => {
            const color = r.colorOverride ?? typeColor.get(r.typeId) ?? '#bbb';
            const d = displayCells(r.id, r.cells);
            const moving = moveOffset && moveDrag?.roomId === r.id;
            const segs = boundarySegments(d.cells);
            let sx = 0, sy = 0;
            for (const c of d.cells) {
              const [x, y] = parseCell(c);
              sx += x + 0.5;
              sy += y + 0.5;
            }
            const n = d.cells.length || 1;
            const m2 = cellsToM2(d.cells.length, cellMm);
            // Use the exact centroid when it lies on an owned cell (true center
            // for rectangles); otherwise snap to the owned cell nearest it so the
            // label never floats over the notch / a neighbouring room.
            const ccx = sx / n, ccy = sy / n;
            const owned = new Set(d.cells);
            let ax = ccx, ay = ccy;
            if (!owned.has(cellKey(Math.floor(ccx), Math.floor(ccy)))) {
              let bestD = Infinity;
              for (const c of d.cells) {
                const [x, y] = parseCell(c);
                const px = x + 0.5, py = y + 0.5;
                const dd = (px - ccx) ** 2 + (py - ccy) ** 2;
                if (dd < bestD) { bestD = dd; ax = px; ay = py; }
              }
            }
            const cx = (ax + d.dx) * cell;
            const cy = (ay + d.dy) * cell;
            const lbox = bbox(d.cells);
            const labelFs = Math.min(13, Math.max(8, cell * 0.62));
            const availPx = (lbox ? lbox.w : 1) * cell * 0.9;
            const nameLines = wrapText(r.name || '部屋', availPx, labelFs);
            const areaLine = `${m2.toFixed(1)}㎡ / ${m2ToJou(m2).toFixed(1)}畳`;
            const labelLines = [...nameLines, areaLine];
            const lineEm = 1.2;
            const startEm = -((labelLines.length - 1) / 2) * lineEm;
            return (
              <g key={r.id} opacity={moving ? 0.7 : 1}>
                {d.cells.map((c) => {
                  const [x, y] = parseCell(c);
                  return (
                    <rect
                      key={c}
                      x={(x + d.dx) * cell}
                      y={(y + d.dy) * cell}
                      width={cell}
                      height={cell}
                      fill={color}
                      fillOpacity={r.id === selectedRoomId ? 0.72 : 0.5}
                    />
                  );
                })}
                {segs.map((s, i) => (
                  <line
                    key={i}
                    x1={(s[0] + d.dx) * cell}
                    y1={(s[1] + d.dy) * cell}
                    x2={(s[2] + d.dx) * cell}
                    y2={(s[3] + d.dy) * cell}
                    stroke="#5a5a5a"
                    strokeWidth={wallPx * 0.6}
                    strokeLinecap="square"
                  />
                ))}
                {cell >= 12 && d.cells.length > 0 && (
                  <text
                    x={cx}
                    y={cy}
                    className="room-label"
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={labelFs}
                  >
                    {labelLines.map((ln, i) => (
                      <tspan
                        key={i}
                        x={cx}
                        dy={`${i === 0 ? startEm : lineEm}em`}
                        className={i === labelLines.length - 1 ? 'room-sub' : undefined}
                      >
                        {ln}
                      </tspan>
                    ))}
                  </text>
                )}
              </g>
            );
          })}

        {/* outer wall */}
        {unionBoundary(unionRooms).map((s, i) => (
          <line
            key={`o${i}`}
            x1={s[0] * cell}
            y1={s[1] * cell}
            x2={s[2] * cell}
            y2={s[3] * cell}
            stroke="#2c3e50"
            strokeWidth={wallPx}
            strokeLinecap="square"
          />
        ))}

        {/* edge lengths (meters): outer wall always; selected room when picked */}
        {cell >= 12 &&
          (() => {
            const lenEls = (cellsSet: Set<CellKey>, kind: 'outer' | 'room', prefix: string) => {
              const base = kind === 'outer' ? 13 : 11;
              const m = kind === 'outer' ? 1 : -1; // outer = outside, room = inside
              const cls = kind === 'outer' ? 'edge-len' : 'edge-len edge-len-room';
              return boundaryRuns(cellsSet).map((run, i) => {
                const lenM = ((run.to - run.from) * cellMm) / 1000;
                const label = `${lenM.toFixed(2)}m`;
                if (run.orient === 'H') {
                  const x = ((run.from + run.to) / 2) * cell;
                  const y = run.line * cell + (run.dir === 'N' ? -1 : 1) * base * m;
                  return (
                    <text key={`${prefix}${i}`} x={x} y={y} className={cls} textAnchor="middle" dominantBaseline="middle">
                      {label}
                    </text>
                  );
                }
                const y = ((run.from + run.to) / 2) * cell;
                const x = run.line * cell + (run.dir === 'W' ? -1 : 1) * base * m;
                return (
                  <text key={`${prefix}${i}`} x={x} y={y} className={cls} textAnchor="middle" dominantBaseline="middle" transform={`rotate(-90 ${x} ${y})`}>
                    {label}
                  </text>
                );
              });
            };
            const u = new Set<CellKey>();
            for (const r of unionRooms) for (const c of r.cells) u.add(c);
            const roomEls = (() => {
              if (!selectedRoom) return null;
              const ds = displayCells(selectedRoom.id, selectedRoom.cells);
              const rs = new Set<CellKey>(
                ds.cells.map((c) => { const [x, y] = parseCell(c); return cellKey(x + ds.dx, y + ds.dy); }),
              );
              return lenEls(rs, 'room', 'rlen');
            })();
            return (
              <>
                {lenEls(u, 'outer', 'len')}
                {roomEls}
              </>
            );
          })()}

        {/* selected room dashed highlight */}
        {selectedRoom &&
          boundarySegments(displayCells(selectedRoom.id, selectedRoom.cells).cells).map((s, i) => (
            <line
              key={`sel${i}`}
              x1={s[0] * cell}
              y1={s[1] * cell}
              x2={s[2] * cell}
              y2={s[3] * cell}
              stroke="#e74c3c"
              strokeWidth={2}
              strokeDasharray="6 4"
            />
          ))}

        {/* pending selection */}
        {pendingCells.map((c) => {
          const [x, y] = parseCell(c);
          return <rect key={`p${c}`} x={x * cell} y={y * cell} width={cell} height={cell} className="pending-cell" />;
        })}

        {/* rubber band */}
        {rubber &&
          rectCells(rubber.start, rubber.cur).map((c) => {
            const [x, y] = parseCell(c);
            return (
              <rect key={`rb${c}`} x={x * cell} y={y * cell} width={cell} height={cell} className={`rubber rubber-${rubber.purpose}`} />
            );
          })}

        {/* doors / windows */}
        {openings.map((o) => {
          const live = openingDrag?.id === o.id && openingDragPos ? { ...o, ...openingDragPos } : o;
          const seg = edgeSegment(live.cx, live.cy, live.side);
          const horiz = live.side === 'N' || live.side === 'S';
          const mx = ((seg[0] + seg[2]) / 2) * cell;
          const my = ((seg[1] + seg[3]) / 2) * cell;
          const lenPx = Math.min(cell * 3.2, Math.max(cell * 0.5, o.size * pxPerMm));
          const color = o.kind === 'door' ? DOOR_COLOR : WINDOW_COLOR;
          const barW = o.kind === 'door' ? Math.max(6, wallPx * 1.3) : Math.max(4, wallPx * 0.8);
          const x1 = horiz ? mx - lenPx / 2 : mx;
          const y1 = horiz ? my : my - lenPx / 2;
          const x2 = horiz ? mx + lenPx / 2 : mx;
          const y2 = horiz ? my : my + lenPx / 2;
          const sel = o.id === selectedOpeningId;
          return (
            <g key={o.id} className="opening" style={{ cursor: 'grab' }}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#fff" strokeWidth={wallPx + 3} strokeLinecap="butt" />
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={barW} strokeLinecap="round" />
              {o.kind === 'window' && (
                <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#fff" strokeWidth={Math.max(1, barW * 0.34)} strokeLinecap="butt" />
              )}
              {sel && (
                <rect
                  x={Math.min(x1, x2) - 5}
                  y={Math.min(y1, y2) - 5}
                  width={Math.abs(x2 - x1) + 10}
                  height={Math.abs(y2 - y1) + 10}
                  fill="none"
                  stroke="#111"
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                  rx={3}
                />
              )}
              {/* wide invisible hit area */}
              <line
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke="transparent"
                strokeWidth={16}
                strokeLinecap="round"
                onPointerDown={(e) => {
                  if (placingOpening) return;
                  e.stopPropagation();
                  props.onSelectOpening(o.id);
                  setOpeningDragPos(null);
                  setOpeningDrag({ id: o.id });
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  props.onSelectOpening(o.id);
                  props.onContextOpening(o.id, e.clientX, e.clientY);
                }}
              />
            </g>
          );
        })}

        {/* placement ghost */}
        {placingOpening && placeGhost && (() => {
          const seg = edgeSegment(placeGhost.cx, placeGhost.cy, placeGhost.side);
          const horiz = placeGhost.side === 'N' || placeGhost.side === 'S';
          const mx = ((seg[0] + seg[2]) / 2) * cell;
          const my = ((seg[1] + seg[3]) / 2) * cell;
          const lenPx = Math.min(cell * 3.2, Math.max(cell * 0.5, placingOpening.size * pxPerMm));
          const color = placingOpening.kind === 'door' ? DOOR_COLOR : WINDOW_COLOR;
          const x1 = horiz ? mx - lenPx / 2 : mx;
          const y1 = horiz ? my : my - lenPx / 2;
          const x2 = horiz ? mx + lenPx / 2 : mx;
          const y2 = horiz ? my : my + lenPx / 2;
          return (
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={Math.max(6, wallPx * 1.3)} strokeLinecap="round" opacity={0.5} />
          );
        })()}

        {/* edge handles */}
        {showHandles &&
          runs.map((run, i) => {
            const hx = run.orient === 'H' ? ((run.from + run.to) / 2) * cell : run.line * cell;
            const hy = run.orient === 'H' ? run.line * cell : ((run.from + run.to) / 2) * cell;
            return (
              <rect
                key={`eh${i}`}
                x={hx - 6}
                y={hy - 6}
                width={12}
                height={12}
                rx={3}
                className="edge-handle"
                style={{ cursor: run.orient === 'H' ? 'ns-resize' : 'ew-resize' }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  dragBaseCells.current = selectedRoom!.cells;
                  setHandleDrag({ kind: 'edge', run });
                }}
              />
            );
          })}

        {/* corner handles (rectangles only) */}
        {showHandles && isRect && box &&
          [
            { hx: box.minX, hy: box.minY, ax: box.maxX, ay: box.maxY, cur: 'nwse-resize' },
            { hx: box.maxX + 1, hy: box.minY, ax: box.minX, ay: box.maxY, cur: 'nesw-resize' },
            { hx: box.minX, hy: box.maxY + 1, ax: box.maxX, ay: box.minY, cur: 'nesw-resize' },
            { hx: box.maxX + 1, hy: box.maxY + 1, ax: box.minX, ay: box.minY, cur: 'nwse-resize' },
          ].map((c, i) => (
            <circle
              key={`ch${i}`}
              cx={c.hx * cell}
              cy={c.hy * cell}
              r={7}
              className="corner-handle"
              style={{ cursor: c.cur }}
              onPointerDown={(e) => {
                e.stopPropagation();
                dragBaseCells.current = selectedRoom!.cells;
                setHandleDrag({ kind: 'corner', ax: c.ax, ay: c.ay });
              }}
            />
          ))}
      </svg>
    </div>
  );
}
