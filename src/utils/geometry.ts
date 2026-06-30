import { cellKey, parseCell, type CellKey, type Room, type Side } from '../types';

export type Segment = [number, number, number, number]; // x1,y1,x2,y2 in cell units

/**
 * Boundary edges of a cell set: an edge is on the boundary when the neighbouring
 * cell across it is not part of the set. Returns segments in grid-cell units.
 */
export function boundarySegments(cells: Iterable<CellKey>): Segment[] {
  const set = cells instanceof Set ? cells : new Set(cells);
  const segs: Segment[] = [];
  for (const k of set) {
    const [x, y] = parseCell(k);
    if (!set.has(cellKey(x, y - 1))) segs.push([x, y, x + 1, y]); // top
    if (!set.has(cellKey(x, y + 1))) segs.push([x, y + 1, x + 1, y + 1]); // bottom
    if (!set.has(cellKey(x - 1, y))) segs.push([x, y, x, y + 1]); // left
    if (!set.has(cellKey(x + 1, y))) segs.push([x + 1, y, x + 1, y + 1]); // right
  }
  return segs;
}

/** Union outline of all rooms (the house outer wall). */
export function unionBoundary(rooms: Room[]): Segment[] {
  const all = new Set<CellKey>();
  for (const r of rooms) for (const c of r.cells) all.add(c);
  return boundarySegments(all);
}

/** Bounding box of a set of cells. Returns null when empty. */
export function bbox(cells: Iterable<CellKey>) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let count = 0;
  for (const k of cells) {
    const [x, y] = parseCell(k);
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    count++;
  }
  if (count === 0) return null;
  return { minX, minY, maxX, maxY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** Split a cell set into 4-connected components. */
export function connectedComponents(cells: CellKey[]): CellKey[][] {
  const set = new Set(cells);
  const seen = new Set<CellKey>();
  const groups: CellKey[][] = [];
  for (const start of cells) {
    if (seen.has(start)) continue;
    const stack = [start];
    const group: CellKey[] = [];
    seen.add(start);
    while (stack.length) {
      const k = stack.pop()!;
      group.push(k);
      const [x, y] = parseCell(k);
      for (const n of [cellKey(x + 1, y), cellKey(x - 1, y), cellKey(x, y + 1), cellKey(x, y - 1)]) {
        if (set.has(n) && !seen.has(n)) {
          seen.add(n);
          stack.push(n);
        }
      }
    }
    groups.push(group);
  }
  return groups;
}

/** A maximal straight run of boundary edges, used for edge-drag handles. */
export interface Run {
  orient: 'H' | 'V';
  dir: Side; // outward facing direction
  line: number; // gridline (row for H, col for V)
  from: number; // start along the run (col for H, row for V)
  to: number; // end (exclusive)
}

function groupRuns(orient: 'H' | 'V', dir: Side, edges: [number, number][]): Run[] {
  // edges: [line, pos]
  const byLine = new Map<number, number[]>();
  for (const [line, pos] of edges) {
    if (!byLine.has(line)) byLine.set(line, []);
    byLine.get(line)!.push(pos);
  }
  const runs: Run[] = [];
  for (const [line, positions] of byLine) {
    positions.sort((a, b) => a - b);
    let start = positions[0];
    let prev = positions[0];
    for (let i = 1; i <= positions.length; i++) {
      if (i < positions.length && positions[i] === prev + 1) {
        prev = positions[i];
      } else {
        runs.push({ orient, dir, line, from: start, to: prev + 1 });
        if (i < positions.length) {
          start = positions[i];
          prev = positions[i];
        }
      }
    }
  }
  return runs;
}

/** All maximal straight boundary runs of a cell set. */
export function boundaryRuns(cells: Iterable<CellKey>): Run[] {
  const set = cells instanceof Set ? cells : new Set(cells);
  const N: [number, number][] = [];
  const S: [number, number][] = [];
  const W: [number, number][] = [];
  const E: [number, number][] = [];
  for (const k of set) {
    const [x, y] = parseCell(k);
    if (!set.has(cellKey(x, y - 1))) N.push([y, x]); // H edge, gridline row y, col x
    if (!set.has(cellKey(x, y + 1))) S.push([y + 1, x]); // gridline row y+1
    if (!set.has(cellKey(x - 1, y))) W.push([x, y]); // V edge, gridline col x, row y
    if (!set.has(cellKey(x + 1, y))) E.push([x + 1, y]); // gridline col x+1
  }
  return [
    ...groupRuns('H', 'N', N),
    ...groupRuns('H', 'S', S),
    ...groupRuns('V', 'W', W),
    ...groupRuns('V', 'E', E),
  ];
}

/**
 * Apply a perpendicular drag of `k` cells to a run (k>0 = extend outward,
 * k<0 = retract inward). Returns a new cell-key array.
 */
export function applyRunDrag(cells: Iterable<CellKey>, run: Run, k: number): CellKey[] {
  const set = new Set(cells);
  const n = Math.abs(k);
  if (n === 0) return [...set];
  const outward = k > 0;
  const span: number[] = [];
  for (let i = run.from; i < run.to; i++) span.push(i);

  const add = (x: number, y: number) => set.add(cellKey(x, y));
  const del = (x: number, y: number) => set.delete(cellKey(x, y));

  for (const p of span) {
    for (let s = 1; s <= n; s++) {
      if (run.orient === 'H') {
        const col = p;
        if (run.dir === 'N') {
          if (outward) add(col, run.line - s);
          else del(col, run.line + (s - 1));
        } else {
          // S: inside cell row = line-1, outside = line..
          if (outward) add(col, run.line + (s - 1));
          else del(col, run.line - s);
        }
      } else {
        const row = p;
        if (run.dir === 'W') {
          if (outward) add(run.line - s, row);
          else del(run.line + (s - 1), row);
        } else {
          // E: inside col = line-1, outside = line..
          if (outward) add(run.line + (s - 1), row);
          else del(run.line - s, row);
        }
      }
    }
  }
  return [...set];
}

/** Which side of a cell a point (in cell units) is closest to. */
export function nearestSide(localX: number, localY: number): Side {
  const distTop = localY;
  const distBottom = 1 - localY;
  const distLeft = localX;
  const distRight = 1 - localX;
  const min = Math.min(distTop, distBottom, distLeft, distRight);
  if (min === distTop) return 'N';
  if (min === distBottom) return 'S';
  if (min === distLeft) return 'W';
  return 'E';
}

/** Pixel segment for an opening marker drawn on the given cell edge. */
export function edgeSegment(cx: number, cy: number, side: Side): Segment {
  switch (side) {
    case 'N': return [cx, cy, cx + 1, cy];
    case 'S': return [cx, cy + 1, cx + 1, cy + 1];
    case 'W': return [cx, cy, cx, cy + 1];
    case 'E': return [cx + 1, cy, cx + 1, cy + 1];
  }
}
