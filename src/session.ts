import { controller } from './graph/controller';
import { setState } from './store';
import { hostOf, normalizeTarget } from './target';

/**
 * Start the console on a website. Returns false (and leaves the console on the entry screen)
 * when the input is not a web address. Sound is the caller's business: it needs the gesture.
 */
export function engageConsole(input: string): boolean {
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
    view: 'browser',
    stageView: 'browser',
    viewTransition: null,
    status: `Console online. Reviewing ${hostOf(targetUrl)}.`,
    statusTone: 'ok',
    statusId: s.statusId + 1
  }));
  controller.applyLens();
  controller.main?.fitView(900, 0.16, false);
  window.setTimeout(() => controller.syncMini(true), 400);
  return true;
}
