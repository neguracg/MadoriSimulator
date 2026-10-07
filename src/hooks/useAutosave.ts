// @owns 自動保存をいつ書くか（変更のたびに書く／別のタブから取り込んだだけの変化では書かない）と、保存失敗の状態
import { useEffect, useRef, useState } from 'react';
import { buildProject, saveProject, type Plan } from '../state/projectStore';
import type { Doc } from '../types';

/**
 * Saves the whole project whenever the plans, the selected plan or its document change. `saveError` is true while the
 * browser refuses the write.
 *
 * `skipNextSave()` is called right before plans that ANOTHER tab saved are added to this tab. Those plans are already in
 * storage; writing the project back would put this tab's older copies of the plans it already had over the other tab's
 * newer ones, so a tab that is only watching would destroy what the working tab saved. The skip is for that one change
 * only: when the document or the selected plan changed in the same render, it is saved as usual.
 */
export function useAutosave(plans: Plan[], activePlanId: string, doc: Doc): { saveError: boolean; skipNextSave: () => void } {
  const [saveError, setSaveError] = useState(false);
  const skip = useRef(false);
  const last = useRef({ doc, activePlanId });

  useEffect(() => {
    const changedHere = last.current.doc !== doc || last.current.activePlanId !== activePlanId;
    last.current = { doc, activePlanId };
    const skipped = skip.current && !changedHere;
    skip.current = false;
    if (skipped) return;
    setSaveError(!saveProject(buildProject(plans, activePlanId, doc)));
  }, [plans, activePlanId, doc]);

  return { saveError, skipNextSave: () => (skip.current = true) };
}
