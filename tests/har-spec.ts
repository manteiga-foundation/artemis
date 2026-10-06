// HAR 1.2 as the specification requires it (http://www.softwareishard.com/blog/har-12-spec/),
// checked field by field: what importers (browser developer tools, ZAP, Charles, Fiddler,
// Insomnia, Playwright) rely on. Returns the problems found; an empty list is a valid HAR.
type J = Record<string, unknown>;

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export function harProblems(har: unknown): string[] {
  const problems: string[] = [];
  const need = (o: J, key: string, type: 'string' | 'number' | 'object' | 'array' | 'boolean', at: string) => {
    const v = o[key];
    const ok = type === 'array' ? Array.isArray(v) : type === 'object' ? typeof v === 'object' && v !== null && !Array.isArray(v) : typeof v === type;
    if (!ok) problems.push(`${at}.${key}: expected ${type}, got ${JSON.stringify(v)?.slice(0, 60)}`);
    return ok;
  };
  const optional = (o: J, key: string, type: 'string' | 'number' | 'boolean', at: string) => {
    if (o[key] !== undefined && typeof o[key] !== type) problems.push(`${at}.${key}: expected ${type} when present`);
  };
  const date = (o: J, key: string, at: string) => {
    if (need(o, key, 'string', at) && !ISO.test(o[key] as string)) problems.push(`${at}.${key}: not ISO 8601: ${o[key]}`);
  };
  const pairs = (o: J, key: string, at: string, extra?: (p: J, at: string) => void) => {
    if (!need(o, key, 'array', at)) return;
    (o[key] as J[]).forEach((p, i) => {
      need(p, 'name', 'string', `${at}.${key}[${i}]`);
      need(p, 'value', 'string', `${at}.${key}[${i}]`);
      extra?.(p, `${at}.${key}[${i}]`);
    });
  };
  const cookie = (c: J, at: string) => {
    optional(c, 'path', 'string', at);
    optional(c, 'domain', 'string', at);
    if (c.expires !== undefined && c.expires !== null && !(typeof c.expires === 'string' && ISO.test(c.expires))) problems.push(`${at}.expires: not ISO 8601`);
    optional(c, 'httpOnly', 'boolean', at);
    optional(c, 'secure', 'boolean', at);
  };

  if (typeof har !== 'object' || har === null) return ['not an object'];
  const root = har as J;
  if (!need(root, 'log', 'object', 'har')) return problems;
  const log = root.log as J;
  if (log.version !== '1.2') problems.push(`log.version: expected "1.2", got ${JSON.stringify(log.version)}`);
  if (need(log, 'creator', 'object', 'log')) {
    need(log.creator as J, 'name', 'string', 'log.creator');
    need(log.creator as J, 'version', 'string', 'log.creator');
  }
  const pageIds = new Set<string>();
  if (log.pages !== undefined && need(log, 'pages', 'array', 'log')) {
    (log.pages as J[]).forEach((p, i) => {
      const at = `log.pages[${i}]`;
      date(p, 'startedDateTime', at);
      if (need(p, 'id', 'string', at)) {
        if (pageIds.has(p.id as string)) problems.push(`${at}.id: duplicate ${p.id}`);
        pageIds.add(p.id as string);
      }
      need(p, 'title', 'string', at);
      need(p, 'pageTimings', 'object', at);
    });
  }
  if (!need(log, 'entries', 'array', 'log')) return problems;
  (log.entries as J[]).forEach((e, i) => {
    const at = `log.entries[${i}]`;
    if (e.pageref !== undefined && !pageIds.has(e.pageref as string)) problems.push(`${at}.pageref: no page ${e.pageref}`);
    date(e, 'startedDateTime', at);
    need(e, 'time', 'number', at);
    need(e, 'cache', 'object', at);
    if (need(e, 'request', 'object', at)) {
      const r = e.request as J;
      const ra = `${at}.request`;
      need(r, 'method', 'string', ra);
      if (need(r, 'url', 'string', ra) && !/^[a-z][a-z0-9+.-]*:/i.test(r.url as string)) problems.push(`${ra}.url: not absolute`);
      need(r, 'httpVersion', 'string', ra);
      pairs(r, 'cookies', ra, cookie);
      pairs(r, 'headers', ra);
      pairs(r, 'queryString', ra);
      need(r, 'headersSize', 'number', ra);
      need(r, 'bodySize', 'number', ra);
      if (r.postData !== undefined && need(r, 'postData', 'object', ra)) {
        const p = r.postData as J;
        need(p, 'mimeType', 'string', `${ra}.postData`);
        optional(p, 'text', 'string', `${ra}.postData`);
        if (p.params !== undefined && need(p, 'params', 'array', `${ra}.postData`))
          (p.params as J[]).forEach((q, k) => need(q, 'name', 'string', `${ra}.postData.params[${k}]`));
      }
    }
    if (need(e, 'response', 'object', at)) {
      const r = e.response as J;
      const ra = `${at}.response`;
      need(r, 'status', 'number', ra);
      need(r, 'statusText', 'string', ra);
      need(r, 'httpVersion', 'string', ra);
      pairs(r, 'cookies', ra, cookie);
      pairs(r, 'headers', ra);
      need(r, 'redirectURL', 'string', ra);
      need(r, 'headersSize', 'number', ra);
      need(r, 'bodySize', 'number', ra);
      if (need(r, 'content', 'object', ra)) {
        const c = r.content as J;
        need(c, 'size', 'number', `${ra}.content`);
        need(c, 'mimeType', 'string', `${ra}.content`);
        optional(c, 'text', 'string', `${ra}.content`);
        if (c.encoding !== undefined && c.encoding !== 'base64') problems.push(`${ra}.content.encoding: only base64 is defined`);
      }
    }
    if (need(e, 'timings', 'object', at)) {
      const t = e.timings as J;
      for (const k of ['send', 'wait', 'receive']) if (need(t, k, 'number', `${at}.timings`) && (t[k] as number) < 0) problems.push(`${at}.timings.${k}: negative`);
      for (const k of ['blocked', 'dns', 'connect', 'ssl']) if (t[k] !== undefined && (typeof t[k] !== 'number' || ((t[k] as number) < 0 && t[k] !== -1))) problems.push(`${at}.timings.${k}: -1 or >= 0`);
      // `time` is the sum of the timings that apply (ssl is inside connect).
      const sum = ['blocked', 'dns', 'connect', 'send', 'wait', 'receive'].reduce((s, k) => s + (typeof t[k] === 'number' && (t[k] as number) > 0 ? (t[k] as number) : 0), 0);
      if (typeof e.time === 'number' && Math.abs(e.time - sum) > 1) problems.push(`${at}.time: ${e.time} is not the sum of its timings (${sum})`);
    }
    // Custom fields must start with an underscore.
    for (const k of Object.keys(e))
      if (!k.startsWith('_') && !['pageref', 'startedDateTime', 'time', 'request', 'response', 'cache', 'timings', 'serverIPAddress', 'connection', 'comment'].includes(k)) problems.push(`${at}.${k}: unknown field`);
  });
  return problems;
}
