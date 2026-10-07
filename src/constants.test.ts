import { describe, expect, it } from 'vitest';
import { DEFAULT_TYPES, roomColor } from './constants';

const room = (over: Record<string, unknown>) => ({ id: 'r', name: 'r', typeId: 'ldk', cells: ['0,0'], z: 1, ...over });

describe('roomColor（キャンバス・プロパティ欄・印刷が同じ色を使う）', () => {
  it('部屋ごとの色があればそれ。無ければ種別の色。種別が消えていれば灰色（6桁の16進）', () => {
    const ldk = DEFAULT_TYPES.find((t) => t.id === 'ldk')!;
    expect(roomColor(room({ colorOverride: '#112233' }), DEFAULT_TYPES)).toBe('#112233');
    expect(roomColor(room({}), DEFAULT_TYPES)).toBe(ldk.color);
    expect(roomColor(room({ typeId: 'gone' }), DEFAULT_TYPES)).toBe('#bbbbbb');
    expect(roomColor(room({ typeId: 'gone' }), DEFAULT_TYPES)).toMatch(/^#[0-9a-f]{6}$/); // <input type="color"> が受けられる形
  });
});
