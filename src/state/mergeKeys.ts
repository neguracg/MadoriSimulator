// @owns 連続入力（文字入力・色選択・数値入力）のうち、Undo の1段にまとめる項目とそのキー
//
// useHistory.commit(fn, mergeKey) joins consecutive commits that carry the same key. Which edits are "one continuing
// input" is decided here, in one place, not at every call site.

export type PatchTarget = 'room' | 'furniture' | 'type' | 'settings';

/** Fields that change many times in a row while one person is still editing (typing, dragging a colour, typing a number). */
const CONTINUOUS: Record<PatchTarget, readonly string[]> = {
  room: ['name', 'colorOverride'],
  furniture: ['name', 'color', 'w', 'h'],
  type: ['name', 'color'],
  settings: ['wallMm', 'cellMm'],
};

/**
 * The merge key for a patch to one thing (`id`: the room, furniture or type; any fixed word for the settings),
 * or undefined when it is a one-off edit that must be its own undo step (a type picked from a list, several fields at once).
 */
export function mergeKeyFor(target: PatchTarget, id: string, patch: object): string | undefined {
  const fields = Object.keys(patch);
  if (fields.length !== 1 || !CONTINUOUS[target].includes(fields[0])) return undefined;
  return `${target}-${fields[0]}:${id}`;
}
