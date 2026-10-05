// The review scope: the host the operator gave on the entry screen, and its subdomains. Shared by
// the recorder (server) and the console, so both draw the same line.

/** The host that defines the review scope: the target's, without a leading www. */
export const scopeHostOf = (target: string): string => new URL(target).hostname.toLowerCase().replace(/^www\./, '');

/** Inside the review scope: the scope host itself or any of its subdomains. */
export const inScope = (host: string, scopeHost: string): boolean => {
  const h = host.toLowerCase();
  return h === scopeHost || h.endsWith(`.${scopeHost}`);
};

/** How a page is told apart: its address without query or fragment (the cosmos and the autopilot agree). */
export const pageKeyOf = (u: URL): string => `${u.origin}${u.pathname}`;
