// Guard for one mechanism: a document operation must never leave a room cell outside the grid (such cells are not
// drawn and are not read back from storage). It failed three times in three places (move, paste, edge drag), each
// time because one more producer of cells forgot the rule. Every export of docOps is listed below: either how it is
// driven to the edge of the grid, or why it cannot produce room cells. An export that is not listed fails the
// test, so whoever adds an operation has to decide which it is.
import { describe, expect, it } from 'vitest';
import { GRID_H, GRID_W, defaultDoc } from '../constants';
import type { Doc, Room } from '../types';
import * as docOps from './docOps';

const room = (id: string, cells: string[], z = 1): Room => ({ id, name: id, typeId: 'living', cells, z });

/** Cells on and outside every edge of the grid, plus two valid corner cells. */
const OUTSIDE = ['64,3', '3,64', '-1,3', '3,-1', '63,63', '0,0', '70,70'];

function base(): Doc {
  const d = defaultDoc();
  d.floors[1] = {
    rooms: [room('A', ['62,62', '63,62', '62,63', '63,63']), room('B', ['0,0', '1,0'], 2)],
    openings: [],
    furniture: [],
  };
  return d;
}

type Call = (d: Doc) => Doc;

const EDGE_CALLS: Record<string, Call[] | string> = {
  createRoom: [(d) => docOps.createRoom(d, 1, 'New', 'living', OUTSIDE)],
  expandRoom: [(d) => docOps.expandRoom(d, 1, 'A', OUTSIDE)],
  shrinkRoom: [(d) => docOps.shrinkRoom(d, 1, 'A', ['62,62'])],
  setRoomShape: [(d) => docOps.setRoomShape(d, 1, 'A', OUTSIDE)],
  translateRoom: [(d) => docOps.translateRoom(d, 1, 'A', 99, 99), (d) => docOps.translateRoom(d, 1, 'B', -99, -99)],
  pasteRoom: [(d) => docOps.pasteRoom(d, 1, room('src', ['63,63', '62,63']), null, 'new', 5, 5)],
  resolveOverlaps: [(d) => docOps.resolveOverlaps(d, 1)],
  deleteRoom: 'only removes a room',
  patchRoom: 'its patch type (RoomPatch) cannot carry cells, layer or id',
  reorderRoom: 'changes the layer order only',
  linkedToRoomMove: 'a query: it returns ids, not a document',
  addOpening: 'openings are not room cells',
  patchOpening: 'openings are not room cells',
  removeOpening: 'openings are not room cells',
  addFurniture: 'furniture is placed freely in mm (outside the grid is allowed)',
  patchFurniture: 'furniture is placed freely in mm (outside the grid is allowed)',
  removeFurniture: 'furniture is placed freely in mm (outside the grid is allowed)',
  pasteFurniture: 'furniture is placed freely in mm; the paste is kept inside the grid and tested in docOps.test.ts',
  addRoomType: 'room types only',
  updateRoomType: 'room types only',
  updateSettings: 'settings only (cells are counted in cells, not mm)',
};

describe('docOps の公開操作は、部屋のマスをグリッドの外に残さない', () => {
  it('公開操作がすべて表に載っている（載っていない新しい操作・消えた操作があれば落ちる）', () => {
    expect(Object.keys(docOps).sort()).toEqual(Object.keys(EDGE_CALLS).sort());
  });

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
