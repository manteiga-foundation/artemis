// The console remembers which website it is reviewing for the life of its window, so a reload
// (right-click Reload, Cmd+R) comes back engaged instead of on the entry screen.
import { normalizeTarget } from './target';

export const RESUME_KEY = 'artemis.resume';

export interface Resume {
  targetUrl: string;
}

type Storage = { getItem(key: string): string | null; setItem(key: string, value: string): void };

export function writeResume(storage: Storage, r: Resume): void {
  try {
    storage.setItem(RESUME_KEY, JSON.stringify(r));
  } catch {
    // Storage refused (privacy mode, quota): a reload simply starts at the entry screen.
  }
}

export function readResume(storage: Storage): Resume | null {
  try {
    const raw = storage.getItem(RESUME_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as { targetUrl?: unknown };
    const targetUrl = typeof value?.targetUrl === 'string' ? normalizeTarget(value.targetUrl) : null;
    return targetUrl ? { targetUrl } : null;
  } catch {
    return null;
  }
}
