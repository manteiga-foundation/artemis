// The live cosmos's channel: the recorder's events, delivered to the console in small batches
// over the same path as the machine feed (a window event dispatched in the console page). When
// the console (re)loads, it first gets a reset and the whole session from the database, so a
// reload rebuilds the same cosmos; events are only sent once the console listens.
import type { Page } from 'playwright';
import type { Recorder } from './recorder';
import { SITE_EVENT, SITE_FEED_READY, type SiteEvent } from '../src/site-events';

export function startSiteFeed(page: Page, recorder: Recorder, intervalMs = 150): () => void {
  let buffer: SiteEvent[] = [];
  let needSnapshot = true;
  let sending = false;
  let stopped = false;
  const off = recorder.onEvent((e) => buffer.push(e));
  const onLoad = () => {
    needSnapshot = true;
  };
  page.on('load', onLoad);

  const flush = async () => {
    if (sending || stopped || (!needSnapshot && buffer.length === 0)) return;
    sending = true;
    // A snapshot covers everything written so far, so it replaces whatever was waiting.
    const snapshot = needSnapshot;
    const batch: SiteEvent[] = snapshot ? [{ type: 'reset' }, ...recorder.snapshot()] : buffer;
    buffer = [];
    needSnapshot = false;
    const delivered = await page
      .evaluate(
        `(() => { if (!window[${JSON.stringify(SITE_FEED_READY)}]) return false;` +
          ` window.dispatchEvent(new CustomEvent(${JSON.stringify(SITE_EVENT)}, { detail: ${JSON.stringify(batch)} })); return true; })()`
      )
      .catch(() => false);
    if (!delivered) {
      if (snapshot) needSnapshot = true;
      else buffer = [...batch, ...buffer];
    }
    sending = false;
  };

  const timer = setInterval(flush, intervalMs);
  return () => {
    stopped = true;
    clearInterval(timer);
    off();
    page.off('load', onLoad);
  };
}
