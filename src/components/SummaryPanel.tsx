import { cellsToM2, m2ToJou, m2ToTsubo } from '../constants';
import type { FloorData } from '../types';
import { bbox } from '../utils/geometry';

interface Props {
  floors: Record<number, FloorData>;
  currentFloor: number;
  cellMm: number;
}

function occupiedCells(f: FloorData): number {
  const set = new Set<string>();
  for (const r of f.rooms) for (const c of r.cells) set.add(c);
  return set.size;
}

function AreaTriple({ cells, cellMm }: { cells: number; cellMm: number }) {
  const m2 = cellsToM2(cells, cellMm);
  return (
    <span className="triple">
      <b>{m2.toFixed(2)}</b>㎡ <span className="muted">/ {m2ToJou(m2).toFixed(1)}畳 / {m2ToTsubo(m2).toFixed(2)}坪</span>
    </span>
  );
}

export default function SummaryPanel({ floors, currentFloor, cellMm }: Props) {
  const c1 = occupiedCells(floors[1]);
  const c2 = occupiedCells(floors[2]);

  const cur = floors[currentFloor];
  const all = new Set<string>();
  for (const r of cur.rooms) for (const c of r.cells) all.add(c);
  const box = bbox(all);
  const footprint = box ? box.w * box.h : 0;
  const empty = footprint - all.size;

  return (
    <div className="summary">
      <h4>面積サマリー</h4>
      <div className="summary-grid">
        <div className="s-label">1階</div>
        <div className="s-val"><AreaTriple cells={c1} cellMm={cellMm} /></div>
        <div className="s-label">2階</div>
        <div className="s-val"><AreaTriple cells={c2} cellMm={cellMm} /></div>
        <div className="s-label strong">延床</div>
        <div className="s-val strong"><AreaTriple cells={c1 + c2} cellMm={cellMm} /></div>
      </div>
      <div className="summary-foot">
        <span>{currentFloor}階の外周内マス数: <b>{footprint}</b></span>
        <span>空きマス: <b>{empty}</b></span>
      </div>
    </div>
  );
}
