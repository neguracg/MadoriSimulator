// Guards for two mechanisms of the document operations. Each failed more than once, in a different place every time,
// because one more operation forgot the rule:
//  1. a room cell outside the grid (such cells are not drawn and are not read back from storage): move, paste and
//     edge drag each produced them (BUGLOG: grid range);
//  2. an opening left hanging in empty space: it is stored as the edge of a cell and belongs to no room by id, so an
//     operation that changes the shape or the existence of a room has to take it along or drop it (openingOps).
// Every export of docOps is listed below: either how it is driven to the edge of the grid / onto a room that changes,
// or why it can do neither. An export that is not listed fails the test, so whoever adds an operation has to decide.
import { describe, expect, it } from 'vitest';
import { GRID_H, GRID_W, defaultDoc } from '../constants';
import type { Doc, Room } from '../types';
import * as docOps from './docOps';
import { hostOf } from './openingOps';

const room = (id: string, cells: string[], z = 1): Room => ({ id, name: id, typeId: 'living', cells, z });

/** Cells on and outside every edge of the grid, plus two valid corner cells. */
const OUTSIDE = ['64,3', '3,64', '-1,3', '3,-1', '63,63', '0,0', '70,70'];

/** Rooms in two corners and in the middle; every opening is on a wall of one of them. */
function base(): Doc {
  const d = defaultDoc();
  d.floors[1] = {
    rooms: [
      room('A', ['62,62', '63,62', '62,63', '63,63']),
      room('B', ['0,0', '1,0'], 2),
      room('M', ['20,20', '21,20', '22,20', '20,21', '21,21', '22,21'], 3),
    ],
    openings: [
      { id: 'a-top', kind: 'door', cx: 62, cy: 62, side: 'N', size: 800 },
      { id: 'a-right', kind: 'window', cx: 63, cy: 63, side: 'E', size: 900 },
      { id: 'b-left', kind: 'door', cx: 0, cy: 0, side: 'W', size: 800 },
      { id: 'm-top', kind: 'door', cx: 21, cy: 20, side: 'N', size: 800 },
      { id: 'm-right', kind: 'window', cx: 22, cy: 21, side: 'E', size: 900 },
    ],
    furniture: [],
  };
  return d;
}

type Call = (d: Doc) => Doc;

const EDGE_CALLS: Record<string, Call[] | string> = {
  createRoom: [(d) => docOps.createRoom(d, 1, 'New', 'living', OUTSIDE), (d) => docOps.createRoom(d, 1, 'New', 'living', ['20,20', '21,20'])],
  deleteRoom: [(d) => docOps.deleteRoom(d, 1, 'A'), (d) => docOps.deleteRoom(d, 1, 'M')],
  expandRoom: [(d) => docOps.expandRoom(d, 1, 'A', OUTSIDE), (d) => docOps.expandRoom(d, 1, 'M', ['20,19', '21,19', '22,19'])],
  shrinkRoom: [(d) => docOps.shrinkRoom(d, 1, 'A', ['62,62']), (d) => docOps.shrinkRoom(d, 1, 'M', ['20,20', '21,20', '22,20']), (d) => docOps.shrinkRoom(d, 1, 'M', ['20,20', '21,20', '22,20', '20,21', '21,21', '22,21'])],
  setRoomShape: [(d) => docOps.setRoomShape(d, 1, 'A', OUTSIDE), (d) => docOps.setRoomShape(d, 1, 'M', ['25,25', '26,25'])],
  translateRoom: [(d) => docOps.translateRoom(d, 1, 'A', 99, 99), (d) => docOps.translateRoom(d, 1, 'B', -99, -99), (d) => docOps.translateRoom(d, 1, 'M', 5, -7)],
  pasteRoom: [(d) => docOps.pasteRoom(d, 1, room('src', ['63,63', '62,63']), null, 'new', 5, 5)],
  resolveOverlaps: [(d) => docOps.resolveOverlaps(d, 1), (d) => docOps.resolveOverlaps(docOps.translateRoom(d, 1, 'B', 20, 20), 1)],
  resolveAllOverlaps: [(d) => docOps.resolveAllOverlaps(docOps.translateRoom(d, 1, 'B', 20, 20)), (d) => docOps.resolveAllOverlaps(d)],
  patchRoom: 'its patch type (RoomPatch) cannot carry cells, layer or id',
  reorderRoom: 'changes the layer order only (overlaps exist only in move mode, and are settled by resolveOverlaps)',
  linkedToRoomMove: 'a query: it returns ids, not a document',
  addOpening: 'the canvas only offers wall edges (nearestWall); the caller owns that precondition',
  patchOpening: 'the canvas only offers wall edges (nearestWall); the caller owns that precondition',
  removeOpening: 'only removes an opening',
  addFurniture: 'furniture is placed freely in mm (outside the grid is allowed)',
  patchFurniture: 'furniture is placed freely in mm (outside the grid is allowed)',
  removeFurniture: 'furniture is placed freely in mm (outside the grid is allowed)',
  pasteFurniture: 'furniture is placed freely in mm; the paste is kept inside the grid and tested in docOps.test.ts',
  addRoomType: 'room types only',
  updateRoomType: 'room types only',
  updateSettings: 'settings only (cells are counted in cells, not mm)',
};

describe('docOps の公開操作の表', () => {
  it('公開操作がすべて表に載っている（載っていない新しい操作・消えた操作があれば落ちる）', () => {
    expect(Object.keys(docOps).sort()).toEqual(Object.keys(EDGE_CALLS).sort());
  });

  it('試験用の文書では、最初はどのドア/窓も部屋の壁に付いている', () => {
    const f = base().floors[1];
    for (const o of f.openings) expect(hostOf(f, o), o.id).not.toBeNull();
  });
});

describe('docOps の公開操作は、部屋のマスをグリッドの外に残さない', () => {
  for (const [name, calls] of Object.entries(EDGE_CALLS)) {
    if (typeof calls === 'string') continue;
    it(`${name}: グリッドの端・外のマスを渡しても、結果の全マスがグリッド内`, () => {
      for (const call of calls) {
        const out = call(base());
        for (const floor of Object.values(out.floors)) {
          for (const r of floor.rooms) {
            for (const c of r.cells) {
              const [x, y] = c.split(',').map(Number);
              expect(x >= 0 && y >= 0 && x < GRID_W && y < GRID_H, `${name}: ${r.id} has cell ${c}`).toBe(true);
            }
          }
        }
      }
    });
  }
});

describe('docOps の公開操作は、ドア/窓を宙に浮かせない', () => {
  for (const [name, calls] of Object.entries(EDGE_CALLS)) {
    if (typeof calls === 'string') continue;
    it(`${name}: 部屋の形・存在を変えた後も、どのドア/窓も部屋の壁に付いている`, () => {
      for (const call of calls) {
        const f = call(base()).floors[1];
        for (const o of f.openings) expect(hostOf(f, o), `${name}: ${o.id} at ${o.cx},${o.cy},${o.side}`).not.toBeNull();
      }
    });
  }
});
