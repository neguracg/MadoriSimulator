// @owns Undo/Redo の履歴（積み方・連続入力のまとめ・上限）
import { useCallback, useRef, useState } from 'react';

/** How long after a keyed commit the next commit with the same key still joins it (measured from the previous commit). */
export const MERGE_WINDOW_MS = 1500;
const LIMIT = 200;

/** The previous commit that carried a merge key. */
export interface MergeMark {
  key: string;
  at: number;
}

export interface HistoryState<T> {
  past: T[];
  present: T;
  future: T[];
  mark: MergeMark | null;
}

export const initialHistory = <T>(value: T): HistoryState<T> => ({ past: [], present: value, future: [], mark: null });

/**
 * One commit. With a merge key equal to the previous commit's, and within MERGE_WINDOW_MS of it, the present is
 * replaced instead of pushing a new entry: a run of keystrokes or a colour drag is ONE undo step.
 * A commit without a key, with another key, or after a pause starts a new entry. A commit that changes nothing
 * leaves everything as it was. Pure: `now` comes from the caller (a state updater may run later, or twice).
 */
export function commitState<T>(s: HistoryState<T>, value: T, mergeKey: string | undefined, now: number): HistoryState<T> {
  if (value === s.present) return s;
  const mark = mergeKey === undefined ? null : { key: mergeKey, at: now };
  const joins = mark !== null && s.mark !== null && s.mark.key === mark.key && now - s.mark.at <= MERGE_WINDOW_MS;
  return joins
    ? { past: s.past, present: value, future: [], mark }
    : { past: [...s.past, s.present].slice(-LIMIT), present: value, future: [], mark };
}

/** Undo / redo end any run of merged commits: what is typed afterwards is a new entry. */
export function undoState<T>(s: HistoryState<T>): HistoryState<T> {
  if (s.past.length === 0) return s;
  return { past: s.past.slice(0, -1), present: s.past[s.past.length - 1], future: [s.present, ...s.future], mark: null };
}

export function redoState<T>(s: HistoryState<T>): HistoryState<T> {
  if (s.future.length === 0) return s;
  return { past: [...s.past, s.present], present: s.future[0], future: s.future.slice(1), mark: null };
}

/**
 * Undo/redo wrapper around a single immutable value.
 * - `commit` pushes a new history entry (undoable). With a `mergeKey` it joins the previous commit of the same key
 *   when it follows within MERGE_WINDOW_MS (continuous input: typing, a colour drag).
 * - `set` replaces the present without touching history (live preview).
 * - `reset` loads a value and clears history (load / import).
 */
export function useHistory<T>(initial: T) {
  const [state, setState] = useState<HistoryState<T>>(() => initialHistory(initial));
  const presentRef = useRef(initial);
  presentRef.current = state.present;

  const commit = useCallback((next: T | ((cur: T) => T), mergeKey?: string) => {
    const now = Date.now(); // taken here, not inside the updater: an updater may run later or twice
    setState((s) => commitState(s, typeof next === 'function' ? (next as (c: T) => T)(s.present) : next, mergeKey, now));
  }, []);

  const set = useCallback((next: T | ((cur: T) => T)) => {
    setState((s) => ({
      ...s,
      present: typeof next === 'function' ? (next as (c: T) => T)(s.present) : next,
      mark: null,
    }));
  }, []);

  const undo = useCallback(() => setState(undoState), []);
  const redo = useCallback(() => setState(redoState), []);
  const reset = useCallback((value: T) => setState(initialHistory(value)), []);

  return {
    present: state.present,
    presentRef,
    commit,
    set,
    undo,
    redo,
    reset,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
  };
}
