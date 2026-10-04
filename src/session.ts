import { controller } from './graph/controller';
import { setState } from './store';
import { hostOf, normalizeTarget } from './target';
import { writeResume } from './resume';
import { shellBridge } from './shell';

/**
 * Start the console on a website. Returns false (and leaves the console on the entry screen)
 * when the input is not a web address. Sound is the caller's business: it needs the gesture.
 * `resume` re-engages after a console reload: the owned browser's site is already where the
 * reviewer left it, so it is not sent back to the start.
 */
export function engageConsole(input: string, opts: { resume?: boolean } = {}): boolean {
  const targetUrl = normalizeTarget(input);
  if (!targetUrl) {
    setState((s) => ({
      status: 'Enter a web address such as example.com to begin.',
      statusTone: 'warn',
      statusId: s.statusId + 1
    }));
    return false;
  }
  // The entry screen sits over the cosmos; the console itself opens in the browser view, directly.
  setState((s) => ({
    engaged: true,
    targetUrl,
    pageUrl: opts.resume ? s.pageUrl : null,
    view: 'browser',
    stageView: 'browser',
    viewTransition: null,
    status: `Console ${opts.resume ? 'resumed' : 'online'}. Reviewing ${hostOf(targetUrl)}.`,
    statusTone: 'ok',
    statusId: s.statusId + 1
  }));
  if (typeof sessionStorage !== 'undefined') writeResume(sessionStorage, { targetUrl });
  if (!opts.resume) shellBridge()?.navigate(targetUrl);
  controller.applyLens();
  controller.fitAll(900, 0.16, false);
  window.setTimeout(() => controller.syncMini(true), 400);
  return true;
}
