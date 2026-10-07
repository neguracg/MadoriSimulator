import LZString from 'lz-string';
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

/** Full shareable URL with the plan embedded in the hash. */
export function buildShareUrl(name: string, doc: Doc): string {
  return `${location.origin}${location.pathname}#p=${encodePlan(name, doc)}`;
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
