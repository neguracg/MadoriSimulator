// @owns ドラッグ中の一時値（描画用の state と、pointerup で確定に使う ref を常に同じ値に保つ）
import { useCallback, useRef, useState, type MutableRefObject } from 'react';

/**
 * A value that changes while a pointer drag is in progress.
 * - `value` (state) drives the preview drawing.
 * - `ref` always holds the latest value synchronously, so the pointerup handler reads it and commits to the
 *   parent right there. Never commit from inside a state updater function: React may run an updater later
 *   (after the handler already reset its refs, so the commit is dropped) or twice (StrictMode, so it is
 *   committed twice and the parent is updated while another component renders).
 * `set(null)` ends the drag (clears both).
 */
export function useLiveValue<T>(): [T | null, MutableRefObject<T | null>, (next: T | null) => void] {
  const [value, setValue] = useState<T | null>(null);
  const ref = useRef<T | null>(null);
  const set = useCallback((next: T | null) => {
    ref.current = next;
    setValue(next);
  }, []);
  return [value, ref, set];
}
