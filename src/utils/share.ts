// @owns 間取りの共有リンク（URL の組み立てと、URL からの読み取り）
import LZString from 'lz-string';
import { PUBLIC_APP_URL } from '../constants';
import type { Doc } from '../types';
import { acceptDoc } from '../state/migrate';

interface SharePayload {
  n: string; // plan name
  d: Doc; // document
}

/** Encode a plan into a URL-safe, compressed string. */
export function encodePlan(name: string, doc: Doc): string {
  return LZString.compressToEncodedURIComponent(JSON.stringify({ n: name, d: doc } satisfies SharePayload));
}

export function decodePlan(s: string): { name: string; doc: Doc } | null {
  try {
    const raw = LZString.decompressFromEncodedURIComponent(s);
    if (!raw) return null;
    const o = JSON.parse(raw) as { n?: unknown; d?: unknown } | null;
    const doc = acceptDoc(o?.d); // old / partial / unsettled documents are repaired here, like at every other entrance
    const name = o?.n;
    if (doc) return { name: typeof name === 'string' && name ? name : '受信した間取り', doc };
  } catch {
    /* ignore */
  }
  return null;
}

/** The part of `location` the share address depends on (tests pass a plain object). */
export type PageLocation = Pick<Location, 'protocol' | 'hostname' | 'origin' | 'pathname'>;

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** True when the page is served from this very machine (localhost, loopback, a file): a link to it opens nothing on another device. */
export function isLocalPage(loc: PageLocation = location): boolean {
  return loc.protocol === 'file:' || LOCAL_HOSTNAMES.has(loc.hostname);
}

/** The address a share link is built on: the published app when this page is a local one, otherwise this page itself. */
export function shareBase(loc: PageLocation = location): string {
  return isLocalPage(loc) ? PUBLIC_APP_URL : `${loc.origin}${loc.pathname}`;
}

/** Full shareable URL with the plan embedded in the hash. */
export function buildShareUrl(name: string, doc: Doc, loc: PageLocation = location): string {
  return `${shareBase(loc)}#p=${encodePlan(name, doc)}`;
}

/** If the current URL carries a shared plan, decode it. */
export function readSharedFromHash(): { name: string; doc: Doc } | null {
  const h = location.hash;
  if (!h.startsWith('#p=')) return null;
  return decodePlan(h.slice(3));
}

export function clearShareHash(): void {
  history.replaceState(null, '', location.pathname + location.search);
}
