// Spike 004: the console's shell bridge (src/shell.ts ShellBridge) over a WebSocket instead of
// Electron's IPC. Served into the console's index.html as a classic script before the app module,
// so `window.artemisShell` exists when the console loads and the console runs its shell code path
// unchanged (D flies the autopilot, the Cosmos is the live recording, the address strip follows).
// Layout and click pass-through have no meaning without a native page behind the console: no-ops.

type Listener = (x: unknown) => void;

(() => {
  const listeners = new Map<string, Set<Listener>>();
  const on = (channel: string) => (fn: Listener) => {
    let set = listeners.get(channel);
    if (!set) listeners.set(channel, (set = new Set()));
    set.add(fn);
    // The shell replays the current address and status when the console connects: a late
    // subscriber gets the last value too.
    const last = lastValue.get(channel);
    if (last !== undefined) fn(last);
    return () => void set!.delete(fn);
  };
  const lastValue = new Map<string, unknown>();
  const emit = (channel: string, value: unknown) => {
    if (channel === 'site-nav') lastValue.set(channel, value);
    listeners.get(channel)?.forEach((fn) => fn(value));
  };

  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/feed`;
  let ws: WebSocket | null = null;
  const queue: string[] = [];
  const send = (msg: Record<string, unknown>) => {
    const text = JSON.stringify(msg);
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(text);
    else queue.push(text);
  };
  const stats = { batches: 0, events: 0, resets: 0, latencyMs: [] as number[] };
  (window as unknown as { __artemisFeedStats: typeof stats }).__artemisFeedStats = stats;

  // Like server/site-feed.ts: nothing is dispatched until the console listens (SITE_FEED_READY).
  const pending: unknown[][] = [];
  const deliver = () => {
    if (!(window as unknown as Record<string, boolean>).__artemisSiteFeed) return;
    while (pending.length) window.dispatchEvent(new CustomEvent('artemis:site', { detail: pending.shift() }));
  };
  setInterval(deliver, 50);

  const connect = () => {
    ws = new WebSocket(url);
    ws.onopen = () => {
      // The console reloaded: everything recorded so far, then live events.
      send({ type: 'hello' });
      while (queue.length) ws!.send(queue.shift()!);
    };
    ws.onmessage = (m) => {
      const msg = JSON.parse(String(m.data)) as { type: string; [k: string]: unknown };
      if (msg.type === 'site') {
        const batch = msg.events as unknown[];
        stats.batches++;
        stats.events += batch.length;
        if ((batch[0] as { type?: string } | undefined)?.type === 'reset') stats.resets++;
        if (typeof msg.sentAt === 'number') stats.latencyMs.push(Date.now() - msg.sentAt);
        pending.push(batch);
        deliver();
      } else emit(msg.type, msg.value);
    };
    ws.onclose = () => setTimeout(connect, 500);
  };
  connect();

  (window as unknown as { artemisShell: unknown }).artemisShell = {
    layout: () => {},
    passThrough: () => {},
    navigate: (url: string) => send({ type: 'navigate', url }),
    back: () => send({ type: 'back' }),
    forward: () => send({ type: 'forward' }),
    reload: () => send({ type: 'reload' }),
    autopilot: (speed: number) => send({ type: 'autopilot', speed }),
    onSiteNav: on('site-nav'),
    onKey: on('site-key'),
    onSitePointer: on('site-pointer'),
    onSiteLoad: on('site-load'),
    onAutopilot: on('autopilot-status')
  };
})();
