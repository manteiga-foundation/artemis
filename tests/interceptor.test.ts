import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { getState, setState } from '../src/store';
import { installFakeWindow, restoreWindow } from './harness';
import {
  emptyTraffic,
  formatBytes,
  formatMs,
  hostOfEntry,
  isActionable,
  matches,
  pathOfEntry,
  seedTraffic,
  summary,
  trafficFromSiteEvents
} from '../src/interceptor';
import { armTraffic, dropEntry, editEntry, forwardEntry, pauseTraffic, resetTraffic } from '../src/interceptor-session';
import { STRIP, stripLenses } from '../src/commands';
import { LENSES } from '../src/store';

const initialState = getState();

beforeEach(() => {
  installFakeWindow();
  setState({ ...initialState, engaged: true });
});

afterEach(() => {
  setState(initialState);
  restoreWindow();
});

describe('the emulated session the panel opens on', () => {
  test('it is a real-shaped capture: http and websocket, answered, failed, dropped and held', () => {
    const t = seedTraffic();
    expect(t.entries.length).toBeGreaterThan(12);
    expect(t.armed).toBe(false);
    expect(t.paused).toBe(false);
    expect(t.source).toBe('sample');
    const protos = new Set(t.entries.map((e) => e.protocol));
    expect(protos.has('http')).toBe(true);
    expect(protos.has('ws')).toBe(true);
    const states = new Set(t.entries.map((e) => e.state));
    expect(states.has('held')).toBe(true);
    expect(states.has('complete')).toBe(true);
    expect(states.has('dropped')).toBe(true);
    expect(states.has('failed')).toBe(true);
    // A status, a size and a time for everything that was answered.
    for (const e of t.entries.filter((x) => x.state === 'complete')) {
      expect(typeof e.status).toBe('number');
      expect(typeof e.responseBytes).toBe('number');
      expect(typeof e.durationMs).toBe('number');
    }
    // A client error and a server error are both there to be read.
    expect(t.entries.some((e) => e.status === 404)).toBe(true);
    expect(t.entries.some((e) => e.status === 503)).toBe(true);
    // Full headers and bodies, not just a line per request.
    const api = t.entries.find((e) => e.requestBody?.startsWith('{'))!;
    expect(api.requestHeaders.length).toBeGreaterThan(1);
    expect(api.responseHeaders.length).toBeGreaterThan(1);
    expect(api.responseBody).not.toBeNull();
  });

  test('only the sample can be acted on: the operator\'s held requests, never observed history', () => {
    const t = seedTraffic();
    for (const e of t.entries.filter((x) => x.state === 'held')) expect(isActionable(e)).toBe(true);
    for (const e of t.entries.filter((x) => x.observed)) expect(isActionable(e)).toBe(false);
    const recorded = trafficFromSiteEvents(emptyTraffic(), [
      { type: 'request', id: 1, visitId: null, method: 'GET', url: 'https://intranet.example/api/x', resourceType: 'fetch', mainDocument: false }
    ]);
    expect(recorded.entries[0].state).toBe('inflight');
    expect(isActionable(recorded.entries[0])).toBe(false);
  });

  test('ids are unique and in the order they happened; the sample is deterministic', () => {
    const a = seedTraffic();
    const b = seedTraffic();
    expect(a.entries.map((e) => e.id)).toEqual(b.entries.map((e) => e.id));
    expect(new Set(a.entries.map((e) => e.id)).size).toBe(a.entries.length);
    const times = a.entries.map((e) => e.t);
    expect([...times].sort((x, y) => x - y)).toEqual(times);
  });
});

describe('arming the proxy', () => {
  test('arm says so on the console and disarm releases what it was holding', () => {
    const t = seedTraffic();
    const armed = armTraffic(t, true);
    expect(armed.armed).toBe(true);
    expect(getState().status).toContain('armed');
    const released = armTraffic(armed, false);
    expect(released.armed).toBe(false);
    expect(released.entries.some((e) => e.state === 'held')).toBe(false);
    expect(getState().status).toContain('disarmed');
  });

  test('holding needs the proxy armed: pausing while disarmed says so and holds nothing', () => {
    const t = seedTraffic();
    const p = pauseTraffic(t, true);
    expect(p.paused).toBe(false);
    expect(getState().statusTone).toBe('warn');
    const armed = armTraffic(t, true);
    expect(pauseTraffic(armed, true).paused).toBe(true);
    expect(getState().status).toContain('Hold');
  });

  test('a reset returns the panel to the sample', () => {
    const recorded = trafficFromSiteEvents(seedTraffic(), [
      { type: 'request', id: 90, visitId: 1, method: 'GET', url: 'https://intranet.example/', resourceType: 'document', mainDocument: true }
    ]);
    expect(recorded.source).toBe('recorded');
    const back = resetTraffic();
    expect(back.source).toBe('sample');
    expect(back.entries.length).toBe(seedTraffic().entries.length);
  });
});

describe('an intercepted request', () => {
  const held = () => {
    const t = seedTraffic();
    return { t, e: t.entries.find((x) => x.state === 'held')! };
  };

  test('can be edited before it goes: method, address, headers and body, marked as edited', () => {
    const { t, e } = held();
    const next = editEntry(t, e.id, {
      method: 'POST',
      url: 'https://intranet.example/api/orders?page=2',
      requestBody: '{"page":2}',
      requestHeaders: [{ name: 'content-type', value: 'application/json' }]
    });
    const got = next!.entries.find((x) => x.id === e.id)!;
    expect(got.method).toBe('POST');
    expect(got.url).toBe('https://intranet.example/api/orders?page=2');
    expect(got.requestBody).toBe('{"page":2}');
    expect(got.requestHeaders).toEqual([{ name: 'content-type', value: 'application/json' }]);
    expect(got.edited).toBe(true);
    expect(got.state).toBe('held');
    expect(getState().status).toContain('edited');
  });

  test('is forwarded as edited, or dropped, and says which on the console', () => {
    const { t, e } = held();
    const edited = editEntry(t, e.id, { requestBody: '{"page":9}' })!;
    const sent = forwardEntry(edited, e.id)!;
    const got = sent.entries.find((x) => x.id === e.id)!;
    expect(got.state).toBe('forwarded');
    expect(got.requestBody).toBe('{"page":9}');
    expect(getState().status).toContain('Forwarded');

    const dropped = dropEntry(t, e.id)!;
    expect(dropped.entries.find((x) => x.id === e.id)!.state).toBe('dropped');
    expect(getState().status).toContain('Dropped');
  });

  test('only a held request can be edited, forwarded or dropped', () => {
    const t = seedTraffic();
    const done = t.entries.find((e) => e.state === 'complete')!;
    expect(forwardEntry(t, done.id)).toBeNull();
    expect(dropEntry(t, done.id)).toBeNull();
    expect(editEntry(t, done.id, { method: 'POST' })).toBeNull();
    expect(getState().statusTone).toBe('warn');
  });
});

describe('the list is read the way an auditor reads it', () => {
  test('an entry names its host and its path without the host', () => {
    const t = seedTraffic();
    const api = t.entries.find((e) => e.url.includes('/api/orders?'))!;
    expect(hostOfEntry(api)).toBe('intranet.example');
    expect(pathOfEntry(api)).toBe('/api/orders?page=1&size=25');
  });

  test('a filter matches the method, the host, the path, the status and the kind', () => {
    const t = seedTraffic();
    const api = t.entries.find((e) => e.url.includes('/api/orders?'))!;
    expect(matches(api, '')).toBe(true);
    expect(matches(api, 'get')).toBe(true);
    expect(matches(api, 'intranet.example')).toBe(true);
    expect(matches(api, '/api/')).toBe(true);
    expect(matches(api, '200')).toBe(true);
    expect(matches(api, 'fetch')).toBe(true);
    expect(matches(api, 'nothing-says-this-zz')).toBe(false);
  });

  test('the summary counts what was seen and the bytes it moved', () => {
    const t = seedTraffic();
    const s = summary(t.entries);
    expect(s.total).toBe(t.entries.length);
    expect(s.held).toBe(t.entries.filter((e) => e.state === 'held').length);
    expect(s.errors).toBe(t.entries.filter((e) => (e.status !== null && e.status >= 400) || e.state === 'failed').length);
    expect(s.sockets).toBe(t.entries.filter((e) => e.protocol === 'ws').length);
    expect(s.responseBytes).toBe(t.entries.reduce((n, e) => n + (e.responseBytes ?? 0), 0));
    // The failed PUT has no status to count, and the 101 socket is not one; both are in the sample
    // and both would be missed by a status-only count.
    expect(t.entries.some((e) => e.state === 'failed' && e.status === null)).toBe(true);
    expect(s.errors).toBe(3);
  });

  test('sizes and times read the way a person reads them', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1024)).toBe('1.0 kB');
    expect(formatBytes(1536)).toBe('1.5 kB');
    expect(formatBytes(1024 * 1024 * 3)).toBe('3.0 MB');
    expect(formatBytes(null)).toBe('--');
    expect(formatMs(12)).toBe('12 ms');
    expect(formatMs(1400)).toBe('1.4 s');
    expect(formatMs(null)).toBe('--');
  });
});

describe('the recording feeds the same panel', () => {
  test('a request and its response become one entry, in flight, then answered', () => {
    const first = trafficFromSiteEvents(emptyTraffic(), [
      { type: 'request', id: 41, visitId: 3, method: 'GET', url: 'https://intranet.example/api/orders', resourceType: 'fetch', mainDocument: false }
    ]);
    expect(first.source).toBe('recorded');
    const open = first.entries.find((e) => e.id === 41)!;
    expect(open.state).toBe('inflight');
    expect(open.observed).toBe(true);
    expect(open.status).toBeNull();
    const done = trafficFromSiteEvents(first, [{ type: 'response', id: 41, status: 200 }]);
    const e = done.entries.find((x) => x.id === 41)!;
    expect(e.state).toBe('complete');
    expect(e.status).toBe(200);
  });

  test('a failure is marked failed; a socket is a socket; a repeated event changes nothing', () => {
    const t = trafficFromSiteEvents(emptyTraffic(), [
      { type: 'request', id: 7, visitId: null, method: 'GET', url: 'wss://intranet.example/live', resourceType: 'websocket', mainDocument: false },
      { type: 'request', id: 8, visitId: null, method: 'GET', url: 'https://intranet.example/missing.js', resourceType: 'script', mainDocument: false },
      { type: 'response', id: 7, status: 101 },
      { type: 'response', id: 8, status: null, failed: true }
    ]);
    const socket = t.entries.find((e) => e.id === 7)!;
    expect(socket.protocol).toBe('ws');
    expect(socket.status).toBe(101);
    expect(t.entries.find((e) => e.id === 8)!.state).toBe('failed');
    const again = trafficFromSiteEvents(t, [
      { type: 'request', id: 7, visitId: null, method: 'GET', url: 'wss://intranet.example/live', resourceType: 'websocket', mainDocument: false }
    ]);
    expect(again.entries.filter((e) => e.id === 7).length).toBe(1);
  });

  test('the recording replaces the sample once, then grows', () => {
    const seeded = seedTraffic();
    const t = trafficFromSiteEvents(seeded, [
      { type: 'request', id: 90, visitId: 1, method: 'GET', url: 'https://intranet.example/', resourceType: 'document', mainDocument: true }
    ]);
    expect(t.entries.map((e) => e.id)).toEqual([90]);
    const grown = trafficFromSiteEvents(t, [
      { type: 'request', id: 91, visitId: 1, method: 'GET', url: 'https://intranet.example/a.js', resourceType: 'script', mainDocument: false }
    ]);
    expect(grown.entries.map((e) => e.id)).toEqual([90, 91]);
  });

  test('an event that is not about traffic (a visit, a session) leaves the sample alone', () => {
    const t = seedTraffic();
    const same = trafficFromSiteEvents(t, [
      { type: 'session', target: 'https://intranet.example/', scopeHost: 'intranet.example' },
      { type: 'visit', id: 1, t: 1, url: 'https://intranet.example/', kind: 'document', committed: true },
      { type: 'reset' }
    ]);
    expect(same).toBe(t);
  });
});

describe('the strip: the four lenses, keys 1-4; the Interceptor lives on the card (I)', () => {
  test('the strip is the four named lenses, numbered from 1', () => {
    expect(STRIP.map((s) => s.key)).toEqual(['1', '2', '3', '4']);
    expect(STRIP.map((s) => s.label)).toEqual(['Clusters', 'Hubs', 'Routes', 'Anomalies']);
    expect(STRIP.every((s) => s.lens !== null)).toBe(true);
  });

  test('Overview is no longer a named lens: it is the neutral state the panel closes back to', () => {
    expect(stripLenses().map((l) => l.id)).toEqual(['clusters', 'hubs', 'routes', 'anomalies']);
    // The neutral state stays in the store (a fresh console reads the graph plainly) but it is not
    // one of the tabs.
    expect(getState().lens).toBe('overview');
    expect(stripLenses().some((l) => l.id === 'overview')).toBe(false);
    expect(LENSES.some((l) => l.id === 'overview')).toBe(false);
  });
});
