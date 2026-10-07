import { describe, expect, it } from 'vitest';
import { CELL_MM_RANGE, OPENING_MM_RANGE, WALL_MM_RANGE } from '../constants';
import { parseNumberInRange } from './NumberField';

describe('parseNumberInRange: 数値入力の検査（B8）', () => {
  it('範囲内の数字はその数を返す。両端を含む', () => {
    expect(parseNumberInRange('455', CELL_MM_RANGE.min, CELL_MM_RANGE.max)).toBe(455);
    expect(parseNumberInRange('100', CELL_MM_RANGE.min, CELL_MM_RANGE.max)).toBe(100);
    expect(parseNumberInRange('1000', CELL_MM_RANGE.min, CELL_MM_RANGE.max)).toBe(1000);
    expect(parseNumberInRange('50', WALL_MM_RANGE.min, WALL_MM_RANGE.max)).toBe(50);
    expect(parseNumberInRange('400', WALL_MM_RANGE.min, WALL_MM_RANGE.max)).toBe(400);
    expect(parseNumberInRange('4000', OPENING_MM_RANGE.min, OPENING_MM_RANGE.max)).toBe(4000);
  });

  it('範囲外は null（9 や 1001 や 0 が設定へ入らない）', () => {
    expect(parseNumberInRange('9', CELL_MM_RANGE.min, CELL_MM_RANGE.max)).toBeNull();
    expect(parseNumberInRange('99', CELL_MM_RANGE.min, CELL_MM_RANGE.max)).toBeNull();
    expect(parseNumberInRange('1001', CELL_MM_RANGE.min, CELL_MM_RANGE.max)).toBeNull();
    expect(parseNumberInRange('49', WALL_MM_RANGE.min, WALL_MM_RANGE.max)).toBeNull();
    expect(parseNumberInRange('401', WALL_MM_RANGE.min, WALL_MM_RANGE.max)).toBeNull();
    expect(parseNumberInRange('0', 1)).toBeNull();
    expect(parseNumberInRange('4001', OPENING_MM_RANGE.min, OPENING_MM_RANGE.max)).toBeNull();
    expect(parseNumberInRange('99999', OPENING_MM_RANGE.min, OPENING_MM_RANGE.max)).toBeNull();
  });

  it('空欄・空白だけ・途中の入力は null（入力途中の値が文書へ入らない）', () => {
    for (const s of ['', '   ', '-', '.', '1.', '.5']) expect(parseNumberInRange(s, 1, 100), JSON.stringify(s)).toBeNull();
  });

  it('全体一致で検査する（先頭だけ読める 1000あ・指数・16進・符号・桁区切りは数字として扱わない）', () => {
    for (const s of ['1000あ', 'あ1000', '1e3', '0x10', '-5', '+5', '1,000', '12 3', 'Infinity', 'NaN', '１２００あ']) {
      expect(parseNumberInRange(s, 1, 100000), JSON.stringify(s)).toBeNull();
    }
  });

  it('前後の空白は無視し、全角の数字・小数点は半角として読む', () => {
    expect(parseNumberInRange('  800 ', 100, 4000)).toBe(800);
    expect(parseNumberInRange('１２００', 100, 4000)).toBe(1200);
    expect(parseNumberInRange('１２００．５', 100, 4000)).toBe(1200.5);
  });

  it('小数は許す。上限を省くと上限なし', () => {
    expect(parseNumberInRange('120.5', 20)).toBe(120.5);
    expect(parseNumberInRange('99999999', 20)).toBe(99999999);
    expect(parseNumberInRange('19.9', 20)).toBeNull();
  });
});
