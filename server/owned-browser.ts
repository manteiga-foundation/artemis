// The browser Artemis owns.
//
// Artemis is the top-level page inside a Chromium that Playwright launches; the website under
// review loads in a frame in the centre of the Browser view. Because Playwright owns the browser
// it can rewrite the responses that would otherwise refuse framing (X-Frame-Options, CSP
// frame-ancestors) and make the site's cookies usable inside a cross-site frame (SameSite=None).
// Only documents loaded into sub-frames are touched; Artemis's own requests pass through.
import { chromium, type BrowserContext, type Page, type Request, type Route } from 'playwright';

export const OWNED_FLAG = 'owned';

export interface OwnBrowserOptions {
  /** Where Artemis is served, e.g. http://127.0.0.1:5173 */
  appUrl: string;
  /** Persistent profile directory (cookies, logins survive restarts). */
  userDataDir: string;
  headless?: boolean;
  width?: number;
  height?: number;
}

export interface OwnedBrowser {
  context: BrowserContext;
  page: Page;
  close(): Promise<void>;
}

/** Remove every `frame-ancestors` directive from a Content-Security-Policy header value. */
export function stripFrameAncestors(csp: string): string {
  return csp
    .split(',')
    .map((policy) =>
      policy
        .split(';')
        .map((d) => d.trim())
        .filter((d) => d && !/^frame-ancestors\b/i.test(d))
        .join('; ')
    )
    .filter(Boolean)
    .join(', ');
}

/** Rewrite a Set-Cookie value so the cookie is sent inside a cross-site frame. */
export function crossSiteCookie(cookie: string): string {
  let out = cookie.replace(/;\s*SameSite=[^;]*/gi, '').trimEnd();
  out += '; SameSite=None';
  if (!/;\s*Secure(\s*;|\s*$)/i.test(out)) out += '; Secure';
  return out;
}

/** Playwright route handler: let sub-frame documents be framed and keep their cookies. */
export async function unframe(route: Route, request: Request): Promise<void> {
  let inSubFrame = false;
  try {
    inSubFrame = request.resourceType() === 'document' && request.frame().parentFrame() !== null;
  } catch {
    inSubFrame = false;
  }
  if (!inSubFrame) return route.continue();

  // Redirects: Chromium does not send the request that follows a redirect back through this
  // handler, so the final page would arrive unrewritten and be blocked. Instead answer the hop
  // with a page that performs the redirect itself (keeping any cookies the redirect set); the
  // follow-up is then a fresh navigation this handler sees.
  const response = await route.fetch({ maxRedirects: 0 });
  const headers = response.headers();
  if (headers['set-cookie']) {
    headers['set-cookie'] = headers['set-cookie'].split('\n').map(crossSiteCookie).join('\n');
  }
  if (response.status() >= 300 && response.status() < 400 && headers['location']) {
    const target = new URL(headers['location'], request.url()).href;
    const hop: Record<string, string> = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' };
    if (headers['set-cookie']) hop['set-cookie'] = headers['set-cookie'];
    const safe = target.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
    const body = `<!doctype html><meta charset="utf-8"><script>location.replace(${JSON.stringify(target)})</script><noscript><meta http-equiv="refresh" content="0; url=${safe}"></noscript>`;
    return route.fulfill({ status: 200, headers: hop, body });
  }
  delete headers['x-frame-options'];
  for (const name of ['content-security-policy', 'content-security-policy-report-only']) {
    if (headers[name] !== undefined) {
      const stripped = stripFrameAncestors(headers[name]);
      if (stripped) headers[name] = stripped;
      else delete headers[name];
    }
  }
  await route.fulfill({ response, headers });
}

export const withOwnedFlag = (appUrl: string): string => {
  const u = new URL(appUrl);
  u.searchParams.set(OWNED_FLAG, '1');
  return u.href;
};

/**
 * Runs in every frame of the owned browser; does nothing in the top-level console.
 *
 * Navigation: a site that notices it is framed often aims its links at the top window
 * (`target="_top"`, `<base target>`, `window.open(url, '_top')`), which the sandbox blocks because
 * it would replace the console. Those, and `target="_blank"` links that would open a window
 * outside the console, are retargeted at the frame itself. Plain `window.open` popups are left alone.
 *
 * Hotkeys: plain key presses (not while typing in a field) are forwarded to the console, so V and
 * the other commands keep working after clicking into the page. The page still receives the key.
 */
export const FRAME_AGENT = `(() => {
  if (window.top === window) return;
  const ESCAPING = new Set(['_top', '_parent', '_blank']);
  const effectiveTarget = (el) => el.getAttribute('target') || document.querySelector('base[target]')?.getAttribute('target') || '';
  const retarget = (e) => {
    const el = e.target && e.target.closest ? e.target.closest('a[href], area[href], form') : null;
    if (el && ESCAPING.has(effectiveTarget(el))) el.setAttribute('target', '_self');
  };
  window.addEventListener('click', retarget, true);
  window.addEventListener('auxclick', retarget, true);
  window.addEventListener('submit', retarget, true);
  const open = window.open;
  window.open = function (url, target, features) {
    if (target === '_top' || target === '_parent') { if (url) location.assign(String(url)); return null; }
    return open.call(window, url, target, features);
  };
  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (e.key.length !== 1 && e.key !== 'Escape' && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    try { window.top.postMessage({ type: 'artemis:key', key: e.key }, '*'); } catch {}
  }, true);
})();`;

/** Launch the owned Chromium with Artemis as its only page. */
export async function ownBrowser(o: OwnBrowserOptions): Promise<OwnedBrowser> {
  const url = withOwnedFlag(o.appUrl);
  const headless = o.headless ?? false;
  const width = o.width ?? 1440;
  const height = o.height ?? 900;
  const context = await chromium.launchPersistentContext(o.userDataDir, {
    headless,
    viewport: headless ? { width, height } : null,
    args: headless ? [] : [`--app=${url}`, `--window-size=${width},${height}`],
    ignoreDefaultArgs: ['--enable-automation']
  });
  await context.route('**/*', unframe);
  await context.addInitScript(FRAME_AGENT);

  let page: Page;
  if (headless) {
    page = context.pages()[0] ?? (await context.newPage());
    await page.goto(url);
  } else {
    page = context.pages()[0] ?? (await context.waitForEvent('page'));
    if (page.url() === 'about:blank') await page.goto(url);
  }
  return { context, page, close: () => context.close() };
}
