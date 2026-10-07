// @owns 複数間取り(プロジェクト)の localStorage 永続化とファイル入出力（保存キー・退避・取り込みの正本）
import { defaultDoc, uid } from '../constants';
import type { Doc } from '../types';
import { normalizeDoc } from './migrate';

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
    const doc = isObj(p) ? normalizeDoc(p.doc) : null;
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

function parseDoc(text: string): Doc | null {
  try {
    return normalizeDoc(JSON.parse(text));
  } catch {
    return null;
  }
}

/**
 * Load the saved project. The raw string is copied to BACKUP_PREV_KEY before it is parsed; anything that
 * cannot be loaded as is (broken JSON, plans without a document) is parked under CORRUPT_KEY_PREFIX.
 * Every document goes through normalizeDoc. Falls back to the legacy single-document key, then a new project.
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
  const doc = normalizeDoc(data);
  return doc ? [makePlan(base, doc)] : [];
}

/** JSON text of a whole project (all plans), the format parseImportFile reads back. */
export function exportProject(p: Project): string {
  return JSON.stringify(p, null, 2);
}
