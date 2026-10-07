// @owns 複数間取り(プロジェクト)の localStorage 永続化とファイル入出力（保存キー・退避・取り込みの正本）
import { defaultDoc, uid } from '../constants';
import type { Doc } from '../types';
import { acceptDoc } from './migrate';

export const PROJECT_KEY = 'madori-simulator-project-v1';
/** Single-document key from before plans existed. Read for migration only, never written. */
export const OLD_DOC_KEY = 'madori-simulator-doc-v1';
/** Raw project string as it was at the previous start; copied BEFORE anything is parsed or repaired. */
export const BACKUP_PREV_KEY = `${PROJECT_KEY}.backup-prev`;
/** Raw data that could not be loaded is parked under <prefix><ISO time> before falling back to a default. */
export const CORRUPT_KEY_PREFIX = `${PROJECT_KEY}.corrupt-`;
const MAX_CORRUPT_COPIES = 3;

export interface Plan {
  id: string;
  name: string;
  doc: Doc;
}
export interface Project {
  version: number;
  activePlanId: string;
  plans: Plan[];
}

/** The part of Storage used here (tests pass an in-memory fake). */
export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null; // touching localStorage itself can throw when site data is blocked
  }
}

export function makePlan(name: string, doc?: Doc): Plan {
  return { id: uid(), name, doc: doc ?? defaultDoc() };
}

/** A copy of a plan under a new id and a new name. The document is a deep copy (JSON round trip): nothing is shared with the original. */
export function copyPlan(src: Plan, doc: Doc = src.doc): Plan {
  return makePlan(`${src.name} のコピー`, JSON.parse(JSON.stringify(doc)) as Doc);
}

/**
 * The plan list after plans are added. Every way of getting a new plan ends here (new tab, copy, shared link, imported
 * file, plans another tab saved). `parked` is the document of the plan being left: it is stored into its tab first.
 * A plan whose id is already in the list is not added twice. Returns `plans` itself when nothing changes.
 */
export function addPlans(plans: Plan[], added: Plan[], parked?: { id: string; doc: Doc }): Plan[] {
  const have = new Set(plans.map((p) => p.id));
  const fresh = added.filter((p) => !have.has(p.id));
  const base = parked ? plans.map((p) => (p.id === parked.id ? { ...p, doc: parked.doc } : p)) : plans;
  return fresh.length === 0 && !parked ? plans : base.concat(fresh);
}

/** The project as it is stored: the plan on screen carries the live document (the history's present). */
export function buildProject(plans: Plan[], activePlanId: string, doc: Doc): Project {
  return { version: 1, activePlanId, plans: plans.map((p) => (p.id === activePlanId ? { ...p, doc } : p)) };
}

function freshProject(): Project {
  const plan = makePlan('間取り 1');
  return { version: 1, activePlanId: plan.id, plans: [plan] };
}

function readKey(storage: StorageLike, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

/** Best effort: a failed backup must not stop the app from starting. */
function backupPrev(storage: StorageLike, raw: string): void {
  try {
    if (storage.getItem(BACKUP_PREV_KEY) !== raw) storage.setItem(BACKUP_PREV_KEY, raw);
  } catch (e) {
    console.warn('backup-prev を書けませんでした', e);
  }
}

/** Keep the unreadable raw data (newest MAX_CORRUPT_COPIES copies, no duplicates of the same content). */
function quarantine(storage: StorageLike, raw: string): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && k.startsWith(CORRUPT_KEY_PREFIX)) keys.push(k);
    }
    keys.sort(); // ISO time sorts chronologically
    if (keys.some((k) => storage.getItem(k) === raw)) return;
    storage.setItem(`${CORRUPT_KEY_PREFIX}${new Date().toISOString()}`, raw);
    for (const k of keys.slice(0, Math.max(0, keys.length + 1 - MAX_CORRUPT_COPIES))) storage.removeItem(k);
    console.warn('保存データを読めなかったため、元の内容を退避しました（キー: ' + CORRUPT_KEY_PREFIX + '…）');
  } catch (e) {
    console.warn('壊れた保存データを退避できませんでした', e);
  }
}

/** Plans of a Project-shaped array. Plans without a usable doc are dropped (counted). */
function readPlans(list: unknown[], keepIds: boolean, fallbackName: (i: number) => string) {
  const plans: Plan[] = [];
  const used = new Set<string>();
  let dropped = 0;
  list.forEach((p, i) => {
    const doc = isObj(p) ? acceptDoc(p.doc) : null;
    if (!isObj(p) || !doc) {
      dropped++;
      return;
    }
    let id = keepIds && typeof p.id === 'string' && p.id ? p.id : uid();
    if (used.has(id)) id = uid();
    used.add(id);
    plans.push({ id, name: typeof p.name === 'string' && p.name.trim() ? p.name : fallbackName(i), doc });
  });
  return { plans, dropped };
}

function parseProject(raw: string): { project: Project | null; damaged: boolean } {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { project: null, damaged: true };
  }
  if (!isObj(data) || !Array.isArray(data.plans)) return { project: null, damaged: true };
  const { plans, dropped } = readPlans(data.plans, true, (i) => `間取り ${i + 1}`);
  if (plans.length === 0) return { project: null, damaged: data.plans.length > 0 };
  const active = plans.some((p) => p.id === data.activePlanId) ? (data.activePlanId as string) : plans[0].id;
  return { project: { version: 1, activePlanId: active, plans }, damaged: dropped > 0 };
}

/**
 * The plans in a stored project (the text another tab saved) that this tab has never had, i.e. what a `storage`
 * event brings. They are read like any stored project (acceptDoc) and keep their ids: that is how "never had" is told.
 * Nothing here removes or replaces anything.
 */
export function foreignPlans(raw: string | null, isKnown: (id: string) => boolean): Plan[] {
  if (raw === null) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!isObj(data) || !Array.isArray(data.plans)) return [];
  // Picked by id BEFORE the documents are read: the other tab saves on every edit, and the plans this tab already has
  // (nearly all of them) must not be checked again each time. A plan without an id cannot be told from one seen before: left out.
  const unknown = data.plans.filter((p) => isObj(p) && typeof p.id === 'string' && p.id !== '' && !isKnown(p.id));
  return readPlans(unknown, true, (i) => `間取り ${i + 1}`).plans;
}

function parseDoc(text: string): Doc | null {
  try {
    return acceptDoc(JSON.parse(text));
  } catch {
    return null;
  }
}

/**
 * Load the saved project. The raw string is copied to BACKUP_PREV_KEY before it is parsed; anything that
 * cannot be loaded as is (broken JSON, plans without a document) is parked under CORRUPT_KEY_PREFIX.
 * Every document goes through acceptDoc (repaired, and settled: no overlapping rooms). Falls back to the legacy
 * single-document key, then a new project.
 */
export function loadProject(storage: StorageLike | null = defaultStorage()): Project {
  if (!storage) return freshProject();
  const raw = readKey(storage, PROJECT_KEY);
  if (raw !== null) {
    backupPrev(storage, raw);
    const { project, damaged } = parseProject(raw);
    if (damaged) quarantine(storage, raw);
    if (project) return project;
  }
  const old = readKey(storage, OLD_DOC_KEY);
  const doc = old === null ? null : parseDoc(old);
  if (doc) {
    const plan = makePlan('間取り 1', doc);
    return { version: 1, activePlanId: plan.id, plans: [plan] };
  }
  return freshProject();
}

/** false when the browser refused the write (quota, blocked storage): the caller must tell the user. */
export function saveProject(p: Project, storage: StorageLike | null = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(PROJECT_KEY, JSON.stringify(p));
    return true;
  } catch {
    return false;
  }
}

/** Plans in an imported file: a Project file gives all its plans, a Doc file gives one. New ids; [] when unusable. */
export function parseImportFile(text: string, fileName: string): Plan[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  const dot = fileName.lastIndexOf('.');
  const base = (dot >= 0 ? fileName.slice(0, dot) : fileName).trim() || '読み込んだ間取り';
  if (isObj(data) && Array.isArray(data.plans)) {
    return readPlans(data.plans, false, (i) => `${base} ${i + 1}`).plans;
  }
  const doc = acceptDoc(data);
  return doc ? [makePlan(base, doc)] : [];
}

/** JSON text of a whole project (all plans), the format parseImportFile reads back. */
export function exportProject(p: Project): string {
  return JSON.stringify(p, null, 2);
}

/** File name of a whole-project backup, with the local date: madori-backup-2026-10-07.json */
export function backupFileName(now: Date = new Date()): string {
  const two = (n: number) => String(n).padStart(2, '0');
  return `madori-backup-${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}.json`;
}

/** Hand `text` to the browser as a downloaded file. */
export function downloadText(fileName: string, text: string, mime = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a); // some browsers ignore click() on a link that is not in the page
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000); // not at once: the download may not have started reading it
}
