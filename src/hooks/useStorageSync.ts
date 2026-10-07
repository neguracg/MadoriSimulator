// @owns 別のタブとの間取りの統合（保存データが別のタブで書き換わった時に、このタブが持っていない間取りだけを受け取る）
import { useEffect, useRef } from 'react';
import { PROJECT_KEY, foreignPlans, type Plan } from '../state/projectStore';

/**
 * When another tab saves the project (a `storage` event), the plans this tab has never had go to `onForeign`.
 * Additions only: a plan both tabs have is left as this tab has it, and a plan the other tab deleted stays here.
 * `isKnown` says which plan ids this tab has had, including the ones it deleted itself (a plan deleted here must not
 * come back from the other tab's copy of it).
 */
export function useStorageSync(isKnown: (id: string) => boolean, onForeign: (plans: Plan[]) => void): void {
  const latest = useRef({ isKnown, onForeign });
  latest.current = { isKnown, onForeign };

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== PROJECT_KEY) return; // another key, or localStorage.clear() (key is null)
      const fresh = foreignPlans(e.newValue, latest.current.isKnown);
      if (fresh.length > 0) latest.current.onForeign(fresh);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
}
