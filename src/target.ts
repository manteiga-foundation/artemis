// The website under review: normalisation and display helpers.

const HOST_OK = /^(localhost|(\d{1,3}\.){3}\d{1,3}|[a-z0-9-]+(\.[a-z0-9-]+)+)$/i;

/**
 * Turn what a person types into a canonical http(s) URL, or null if it is not a web address.
 * Bare domains and paths get `https://`. Only http and https are accepted; the host must be a
 * dotted name, localhost or an IPv4 address.
 */
export function normalizeTarget(input: string): string | null {
  const raw = input.trim();
  if (!raw || /\s/.test(raw)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!HOST_OK.test(url.hostname)) return null;
  return url.href;
}

/** Host (with port when present) for compact display. */
export const hostOf = (url: string): string => new URL(url).host;
