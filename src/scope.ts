// The review scope: the host the operator gave on the entry screen, and its subdomains. Shared by
// the recorder (server) and the console, so both draw the same line.

/** The host that defines the review scope: the target's, without a leading www. */
export const scopeHostOf = (target: string): string => new URL(target).hostname.toLowerCase().replace(/^www\./, '');

/** Inside the review scope: the scope host itself or any of its subdomains. */
export const inScope = (host: string, scopeHost: string): boolean => {
  const h = host.toLowerCase();
  return h === scopeHost || h.endsWith(`.${scopeHost}`);
};

/** Parameters that track a visit (campaigns, ad clicks) and never change what the page is. */
const TRACKING = /^(utm_.*|fbclid|gclid|gbraid|wbraid|dclid|msclkid|mc_cid|mc_eid|_ga|_gl|yclid|igshid|_hsenc|_hsmi|mkt_tok|ttclid|twclid|li_fat_id)$/i;

/** The query parameters that make the page what it is, in the site's order: tracking aside. */
export const pageQuery = (u: URL): [string, string][] => [...u.searchParams].filter(([k]) => !TRACKING.test(k));

/**
 * How a page is told apart (the cosmos and the autopilot agree): its address with the query, the
 * parameters in name order and tracking aside, never the fragment. One-address applications
 * (App.aspx?comp=...) are many pages. `withQuery` false: the path alone, for pages outside the
 * scope, whose queries are handshakes (a sign-in provider's state and nonce).
 */
export const pageKeyOf = (u: URL, withQuery = true): string => {
  const q = withQuery ? new URLSearchParams(pageQuery(u).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))).toString() : '';
  return `${u.origin}${u.pathname}${q ? `?${q}` : ''}`;
};

/** A page's name on the cosmos: its path, and its first parameter when the query tells it apart. */
export const pageLabelOf = (u: URL): string => {
  const q = pageQuery(u);
  if (!q.length) return u.pathname;
  return `${u.pathname}?${new URLSearchParams([q[0]]).toString()}${q.length > 1 ? '&…' : ''}`;
};
