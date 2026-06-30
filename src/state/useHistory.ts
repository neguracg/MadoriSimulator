import { useCallback, useRef, useState } from 'react';

interface HistoryState<T> {
  past: T[];
  present: T;
  future: T[];
}

const LIMIT = 200;

/**
 * Undo/redo wrapper around a single immutable value.
 * - `commit` pushes a new history entry (undoable).
 * - `set` replaces the present without touching history (live preview).
 * - `reset` loads a value and clears history (load / import).
 */
export function useHistory<T>(initial: T) {
  const [state, setState] = useState<HistoryState<T>>({ past: [], present: initial, future: [] });
  const presentRef = useRef(initial);
  presentRef.current = state.present;

  const commit = useCallback((next: T | ((cur: T) => T)) => {
    setState((s) => {
      const value = typeof next === 'function' ? (next as (c: T) => T)(s.present) : next;
      if (value === s.present) return s;
      return { past: [...s.past, s.present].slice(-LIMIT), present: value, future: [] };
    });
  }, []);

  const set = useCallback((next: T | ((cur: T) => T)) => {
    setState((s) => ({
      ...s,
      present: typeof next === 'function' ? (next as (c: T) => T)(s.present) : next,
    }));
  }, []);

  const undo = useCallback(() => {
    setState((s) =>
      s.past.length === 0
        ? s
        : {
            past: s.past.slice(0, -1),
            present: s.past[s.past.length - 1],
            future: [s.present, ...s.future],
          },
    );
  }, []);

  const redo = useCallback(() => {
    setState((s) =>
      s.future.length === 0
        ? s
        : { past: [...s.past, s.present], present: s.future[0], future: s.future.slice(1) },
    );
  }, []);

  const reset = useCallback((value: T) => {
    setState({ past: [], present: value, future: [] });
  }, []);

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
