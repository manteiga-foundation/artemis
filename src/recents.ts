// The web apps engaged before: the entry screen lists the last few under the field so a reviewer
// returning to a site is one click from it. Pure: storage in, list out; the component only renders.

export interface Recent {
  /** The canonical address engaged (what `normalizeTarget` returned). */
  url: string;
  /** When it was engaged, epoch milliseconds. */
  at: number;
}

export const RECENTS_KEY = 'artemis.recents';
export const RECENTS_MAX = 5;

/** Read the list, newest first; anything malformed is dropped. */
export function loadRecents(storage: Storage | undefined | null): Recent[] {
  if (!storage) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(storage.getItem(RECENTS_KEY) ?? 'null');
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const out: Recent[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const { url, at } = item as Record<string, unknown>;
    if (typeof url !== 'string' || typeof at !== 'number' || !Number.isFinite(at)) continue;
    if (!/^https?:\/\//.test(url)) continue;
    out.push({ url, at });
  }
  return out.sort((a, b) => b.at - a.at).slice(0, RECENTS_MAX);
}

/** Put `url` at the front with time `now`; one entry per address; the last `RECENTS_MAX` kept. */
export function rememberRecent(storage: Storage | undefined | null, url: string, now: number): Recent[] {
  if (!storage) return [];
  const list = [{ url, at: now }, ...loadRecents(storage).filter((r) => r.url !== url)].slice(0, RECENTS_MAX);
  storage.setItem(RECENTS_KEY, JSON.stringify(list));
  return list;
}

/** How long ago, the way a person says it. */
export function ageLabel(at: number, now: number): string {
  const s = Math.max(0, now - at) / 1000;
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  if (d < 2) return 'yesterday';
  return `${d} days ago`;
}

/** The address without its scheme and trailing slash, for a compact label. */
export function recentLabel(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}
