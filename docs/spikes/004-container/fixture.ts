// Spike 004's website: a small shop with sections, products, an API call per page, a sign-in
// (for the interactive part of the spike) and a Sign out link the autopilot must never follow.
// Neutral words, as the test fixtures (AGENTS.md).

const nav = '<nav><a href="/">Home</a> <a href="/docs">Docs</a> <a href="/pricing">Pricing</a> <a href="/blog">Blog</a> <a href="/login">Sign in</a></nav>';
const api = '<script>fetch("/api/stats").then((r) => r.json()).then((s) => { document.getElementById("s").textContent = "visitors " + s.visitors; });</script><p id="s"></p>';
const page = (title: string, body: string) =>
  `<!doctype html><title>${title}</title><body style="font:16px sans-serif;margin:40px">${nav}${body}${api}</body>`;

const PAGES: Record<string, string> = {
  '/': page('Shop', `<h1>Shop</h1><p>${[1, 2, 3, 4, 5].map((n) => `<a href="/product/${n}">Product ${n}</a>`).join(' ')}</p><p><a href="/about">About</a> <a href="/logout">Sign out</a></p>`),
  '/docs': page('Docs', '<h1>Docs</h1><a href="/docs/start">Getting started</a> <a href="/docs/api">API</a>'),
  '/docs/start': page('Getting started', '<h1>Getting started</h1>'),
  '/docs/api': page('API', '<h1>API</h1>'),
  '/pricing': page('Pricing', '<h1>Pricing</h1><a href="/pricing?plan=team">Team</a> <a href="/pricing?plan=solo">Solo</a>'),
  '/blog': page('Blog', `<h1>Blog</h1>${[1, 2, 3].map((n) => `<a href="/blog/post-${n}">Post ${n}</a>`).join(' ')}`),
  '/about': page('About', '<h1>About</h1>'),
  '/login': page(
    'Sign in',
    '<h1>Sign in</h1><form method="post" action="/login"><label>User <input name="user" autocomplete="username"></label> <label>Password <input name="password" type="password" autocomplete="current-password"></label> <button>Sign in</button></form>'
  ),
  '/account': page('Account', '<h1>Account</h1><p id="who"></p><script>document.getElementById("who").textContent = "signed in as " + decodeURIComponent((document.cookie.match(/session=([^;]*)/) || [])[1] || "nobody");</script>')
};

export function startFixture(port: number) {
  let visitors = 0;
  const server = Bun.serve({
    hostname: '0.0.0.0',
    port,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;
      if (path === '/api/stats') return Response.json({ visitors: ++visitors });
      if (path === '/login' && req.method === 'POST') {
        const form = await req.formData();
        const user = String(form.get('user') ?? '');
        const ok = user && form.get('password') === 'spike-004';
        return ok
          ? new Response(null, { status: 303, headers: { location: '/account', 'set-cookie': `session=${encodeURIComponent(user)}; Path=/; HttpOnly` } })
          : new Response(page('Sign in', '<h1>Sign in</h1><p>Wrong user or password.</p><a href="/login">Try again</a>'), { status: 401, headers: { 'content-type': 'text/html' } });
      }
      if (path === '/account' && !/session=/.test(req.headers.get('cookie') ?? '')) return new Response(null, { status: 303, headers: { location: '/login' } });
      if (path === '/logout') return new Response(page('Signed out', '<h1>Signed out</h1>'), { headers: { 'content-type': 'text/html', 'set-cookie': 'session=; Path=/; Max-Age=0' } });
      const body = PAGES[path] ?? (/^\/(product\/\d+|blog\/post-\d+)$/.test(path) ? page(path, `<h1>${path.slice(1)}</h1>`) : null);
      if (body === null) return new Response('not found', { status: 404 });
      return new Response(body, { headers: { 'content-type': 'text/html' } });
    }
  });
  return { url: `http://127.0.0.1:${server.port}`, port: server.port!, stop: () => server.stop(true) };
}
