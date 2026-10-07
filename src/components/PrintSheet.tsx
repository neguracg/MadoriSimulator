// @owns 印刷用のレイアウト（階ごとに1ページ: 見出し・読み取り専用の全体図・部屋の一覧・面積）。画面では出さず、印刷の時だけ見える
import { memo, type ComponentProps } from 'react';
import { FLOORS, cellsToM2, m2ToJou, m2ToTsubo, roomColor } from '../constants';
import type { Doc } from '../types';
import { occupiedCellCount } from '../utils/geometry';
import { contentBox, fitZoom, padBox } from '../utils/viewFit';
import Canvas from './Canvas';

/** What one page lays the drawing out for, in px: about A4 portrait inside 12 mm margins, the drawing at most 150 mm high. */
const DRAW_W_PX = 700;
const DRAW_H_PX = 560;
/** Below this zoom the canvas hides its labels (a cell under 12 px): the printout of a big house keeps them. */
const PRINT_ZOOM_MIN = 0.6;

const NOOP = () => {};
type CanvasProps = ComponentProps<typeof Canvas>;
/** The canvas asks for all of its interaction props; a printout takes none of them. */
const INERT: Omit<CanvasProps, 'floorData' | 'roomTypes' | 'cellMm' | 'wallMm' | 'zoom' | 'openings' | 'furniture' | 'fit'> = {
  mode: 'edit',
  cellAction: 'none',
  selectedRoomId: null,
  pendingCells: [],
  ghostWallCells: [],
  placingOpening: null,
  selectedOpeningId: null,
  selectedFurnitureId: null,
  furnitureArmed: false,
  onSelectRoom: NOOP,
  onPendingChange: NOOP,
  onExpand: NOOP,
  onShrink: NOOP,
  onTranslate: NOOP,
  onSetShape: NOOP,
  onContextRoom: NOOP,
  onAddOpening: NOOP,
  onPatchOpening: NOOP,
  onSelectOpening: NOOP,
  onContextOpening: NOOP,
  onCreateFurniture: NOOP,
  onSelectFurniture: NOOP,
  onPatchFurniture: NOOP,
};

/** m2, tatami and tsubo of a number of cells, as the texts shown (the same units as the area summary of the screen). */
function area(cells: number, cellMm: number) {
  const m2 = cellsToM2(cells, cellMm);
  return { m2: m2.toFixed(2), jou: m2ToJou(m2).toFixed(1), tsubo: m2ToTsubo(m2).toFixed(2) };
}

/** A room name on one line (the canvas breaks lines at the newlines of a name). */
const oneLine = (name: string) => name.replace(/\s*\n\s*/g, ' ').trim() || '部屋';

function FloorPage({ planName, floor, doc }: { planName: string; floor: number; doc: Doc }) {
  const data = doc.floors[floor];
  const { cellMm, wallMm } = doc.settings;
  const box = contentBox(data, cellMm)!; // a page is made only for a floor that has rooms
  const zoom = Math.max(PRINT_ZOOM_MIN, fitZoom(box, DRAW_W_PX, DRAW_H_PX));
  const floorTotal = area(occupiedCellCount(data), cellMm);
  const houseTotal = area(FLOORS.reduce((n, f) => n + occupiedCellCount(doc.floors[f]), 0), cellMm);
  return (
    <section className="print-page">
      <h1>
        {planName} ― {floor}階
      </h1>
      <p className="print-note">
        1マス = {cellMm}mm ／ 壁厚 {wallMm}mm
      </p>
      <Canvas
        {...INERT}
        floorData={data}
        roomTypes={doc.roomTypes}
        cellMm={cellMm}
        wallMm={wallMm}
        zoom={zoom}
        openings={data.openings}
        furniture={data.furniture}
        fit={padBox(box)}
      />
      <table className="print-rooms">
        <thead>
          <tr>
            <th>部屋</th>
            <th>種別</th>
            <th className="num">㎡</th>
            <th className="num">畳</th>
          </tr>
        </thead>
        <tbody>
          {data.rooms.map((r) => {
            const a = area(r.cells.length, cellMm);
            return (
              <tr key={r.id}>
                <td>
                  <span className="print-chip" style={{ background: roomColor(r, doc.roomTypes) }} />
                  {oneLine(r.name)}
                </td>
                <td>{doc.roomTypes.find((t) => t.id === r.typeId)?.name ?? '—'}</td>
                <td className="num">{a.m2}</td>
                <td className="num">{a.jou}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="print-total">
        {floor}階 合計 <b>{floorTotal.m2}㎡</b>（{floorTotal.jou}畳 / {floorTotal.tsubo}坪）　延床面積（全階）<b>{houseTotal.m2}㎡</b>（{houseTotal.jou}畳 / {houseTotal.tsubo}坪）
      </p>
    </section>
  );
}

interface Props {
  planName: string;
  doc: Doc; // as it is to be printed (overlaps of move mode already settled)
}

/** The printout of a plan: one page for each floor that has rooms. Always in the page, but shown only by the print media query. */
function PrintSheet({ planName, doc }: Props) {
  const floors = FLOORS.filter((f) => doc.floors[f].rooms.length > 0);
  return (
    <div className="print-sheet">
      {floors.length === 0 ? (
        <section className="print-page">
          <h1>{planName}</h1>
          <p>部屋がまだありません。</p>
        </section>
      ) : (
        floors.map((f) => <FloorPage key={f} planName={planName} floor={f} doc={doc} />)
      )}
    </div>
  );
}

export default memo(PrintSheet);
