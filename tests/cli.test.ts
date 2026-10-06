import { describe, expect, test } from 'bun:test';
import { autopilotNotices, certificateNotice, parseArtemisArgs, settleSpeeds, USAGE } from '../server/cli';
import { colorMode, notice, plain, welcome, type ColorMode } from '../server/terminal';

// `bun run artemis [website] [--autopilot slow|regular|max]`: what the launcher accepts, and how
// it looks in the terminal (a large welcome, then one notification per event).

describe('the launcher’s arguments', () => {
  test('a website alone, as typed: bare domains get https, like the console’s field', () => {
    expect(parseArtemisArgs(['example.com'])).toEqual({ website: 'https://example.com/', autopilot: 0, help: false });
    expect(parseArtemisArgs([])).toEqual({ website: null, autopilot: 0, help: false });
  });

  test('the autopilot and its three levels, by name or number, before or after the website', () => {
    for (const [args, level] of [
      [['example.com', '--autopilot', 'slow'], 1],
      [['--autopilot=regular', 'example.com'], 2],
      [['-a', 'max', 'example.com'], 3],
      [['example.com', '--autopilot', '3'], 3],
      [['example.com', '--autopilot', 'MAX'], 3]
    ] as const)
      expect(parseArtemisArgs([...args])).toEqual({ website: 'https://example.com/', autopilot: level, help: false });
  });

  test('refuses what it cannot fly, saying why', () => {
    expect(parseArtemisArgs(['--autopilot', 'max'])).toEqual({ error: 'the autopilot needs a website to fly: bun run artemis <website> --autopilot max' });
    expect(parseArtemisArgs(['example.com', '--autopilot', 'warp'])).toEqual({ error: 'unknown autopilot level "warp": use slow, regular or max (or 1, 2, 3)' });
    expect(parseArtemisArgs(['example.com', '--autopilot'])).toEqual({ error: 'unknown autopilot level "": use slow, regular or max (or 1, 2, 3)' });
    expect(parseArtemisArgs(['not a site'])).toEqual({ error: 'not a web address: "not a site"' });
    expect(parseArtemisArgs(['example.com', '--fast'])).toEqual({ error: 'unknown option --fast' });
    expect(parseArtemisArgs(['a.com', 'b.com'])).toEqual({ error: 'one website at a time: a.com, b.com' });
  });

  test('--help shows the usage', () => {
    expect(parseArtemisArgs(['--help'])).toMatchObject({ help: true });
    expect(parseArtemisArgs(['-h'])).toMatchObject({ help: true });
    expect(USAGE).toContain('--autopilot slow|regular|max');
  });

  test('the real command refuses before starting anything (exit 2, the reason and the usage); --help exits 0', () => {
    const run = (...args: string[]) => Bun.spawnSync(['bun', 'run', 'scripts/artemis.ts', ...args], { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, ARTEMIS_PORT: '1' } });
    const refused = run('--autopilot', 'max');
    expect(refused.exitCode).toBe(2);
    expect(refused.stderr.toString()).toContain('Artemis: the autopilot needs a website to fly');
    expect(refused.stderr.toString()).toContain('Usage: bun run artemis');
    const help = run('--help');
    expect(help.exitCode).toBe(0);
    expect(help.stdout.toString()).toContain('-a, --autopilot <level>');
  });
});

describe('the autopilot’s notifications', () => {
  test('a certificate the site’s pages accepted is a warning naming the origin, the reason, the issuer and the expiry: the site’s own finding', () => {
    expect(
      certificateNotice({ t: 0, origin: 'https://intranet.example', url: 'https://intranet.example/login', error: 'net::ERR_CERT_DATE_INVALID', issuer: 'Example CA', subject: 'intranet.example', validExpiry: '2024-03-01T00:00:00.000Z' })
    ).toEqual({ kind: 'warn', text: 'Untrusted certificate accepted for https://intranet.example: net::ERR_CERT_DATE_INVALID (issuer Example CA, expires 2024-03-01); the site’s own finding' });
  });
  test('engaged, a new speed, off; progress every ten pages; covered or stopped; what it did for the site', () => {
    const say = autopilotNotices();
    expect(say({ event: 'speed', speed: 3, previous: 0 })).toEqual({ kind: 'autopilot', text: 'Engaged at max · the next page as soon as one has loaded' });
    expect(say({ event: 'progress', speed: 3, visited: 1, pending: 5, etaMs: 9000 })).toBeNull();
    expect(say({ event: 'progress', speed: 3, visited: 10, pending: 32, etaMs: 130_000 })).toEqual({ kind: 'autopilot', text: '10 pages visited, 32 to go, about 2 min left' });
    expect(say({ event: 'progress', speed: 3, visited: 14, pending: 30, etaMs: 100_000 })).toBeNull();
    expect(say({ event: 'progress', speed: 3, visited: 20, pending: 2, etaMs: 20_000 })).toEqual({ kind: 'autopilot', text: '20 pages visited, 2 to go, under a minute left' });
    expect(say({ event: 'speed', speed: 1, previous: 3 })).toEqual({ kind: 'autopilot', text: 'Speed: slow · about 10 s a page, scrolling down it' });
    expect(say({ event: 'note', speed: 1, text: 'answered "Leave this page?" with Leave' })).toEqual({ kind: 'site', text: 'Autopilot answered "Leave this page?" with Leave' });
    expect(say({ event: 'speed', speed: 0, previous: 1 })).toEqual({ kind: 'autopilot', text: 'Off: D in the console, or a hand on the site took the controls' });
    expect(say({ event: 'done', speed: 0, visited: 4, pending: 0, etaMs: 0 })).toEqual({ kind: 'autopilot', text: 'The site is covered: 4 pages visited, nothing left to open' });
    expect(say({ event: 'stuck', speed: 0, reason: 'too many links in a row went nowhere' })).toEqual({ kind: 'warn', text: 'Autopilot stopped: too many links in a row went nowhere' });
    // A new flight counts its progress from the start again.
    say({ event: 'speed', speed: 2, previous: 0 });
    expect(say({ event: 'progress', speed: 2, visited: 10, pending: 1, etaMs: 4000 })).toEqual({ kind: 'autopilot', text: '10 pages visited, 1 to go, under a minute left' });
  });

  test('quick presses are one change: the speed it settles on, said once; going round to where it was says nothing', async () => {
    const seen: unknown[] = [];
    const feed = settleSpeeds((e) => seen.push(e), 30);
    feed({ event: 'speed', speed: 1, previous: 0 });
    feed({ event: 'speed', speed: 2, previous: 1 });
    feed({ event: 'speed', speed: 3, previous: 2 });
    expect(seen).toEqual([]);
    await Bun.sleep(60);
    expect(seen).toEqual([{ event: 'speed', speed: 3, previous: 0 }]);
    // Anything else the flight says goes out at once, after a change still settling.
    feed({ event: 'speed', speed: 0, previous: 3 });
    feed({ event: 'done', speed: 0, visited: 3 });
    expect(seen.slice(1)).toEqual([
      { event: 'speed', speed: 0, previous: 3 },
      { event: 'done', speed: 0, visited: 3 }
    ]);
    feed({ event: 'speed', speed: 1, previous: 0 });
    feed({ event: 'speed', speed: 0, previous: 1 });
    await Bun.sleep(60);
    expect(seen).toHaveLength(3);
  });

  test('the launcher’s own presses wait for the level it asked for, however slow the machine: the speeds on the way are never said', async () => {
    const seen: unknown[] = [];
    const feed = settleSpeeds((e) => seen.push(e), 30);
    feed.expect(3);
    feed({ event: 'speed', speed: 1, previous: 0 });
    await Bun.sleep(60);
    feed({ event: 'speed', speed: 2, previous: 1 });
    await Bun.sleep(60);
    // Whatever else the flight says meanwhile still goes out, without the speed on the way.
    feed({ event: 'note', speed: 2, text: 'answered a dialog' });
    expect(seen).toEqual([{ event: 'note', speed: 2, text: 'answered a dialog' }]);
    feed({ event: 'speed', speed: 3, previous: 2 });
    await Bun.sleep(60);
    expect(seen.slice(1)).toEqual([{ event: 'speed', speed: 3, previous: 0 }]);
    // Arrived: later changes are said as usual.
    feed({ event: 'speed', speed: 0, previous: 3 });
    await Bun.sleep(60);
    expect(seen).toHaveLength(3);
  });

  test('if the level never comes, the speed it reached is said after a while, not held forever', async () => {
    const seen: unknown[] = [];
    const feed = settleSpeeds((e) => seen.push(e), 30);
    feed.expect(3, 100);
    feed({ event: 'speed', speed: 1, previous: 0 });
    await Bun.sleep(60);
    expect(seen).toEqual([]);
    await Bun.sleep(100);
    expect(seen).toEqual([{ event: 'speed', speed: 1, previous: 0 }]);
  });

  test('when the launcher gives up pressing, the speed it reached is said at once', async () => {
    const seen: unknown[] = [];
    const feed = settleSpeeds((e) => seen.push(e), 30);
    feed.expect(3);
    feed({ event: 'speed', speed: 2, previous: 0 });
    feed.release();
    await Bun.sleep(60);
    expect(seen).toEqual([{ event: 'speed', speed: 2, previous: 0 }]);
  });
});

const NOW = new Date(2026, 9, 6, 13, 42, 7);
const info = { version: '0.1.0', consoleUrl: 'http://127.0.0.1:5173', website: 'https://example.com/', autopilot: 3 as const, profile: '/p/shell-profile', sessions: '/p/sessions' };

describe('the terminal', () => {
  test('a large ARTEMIS welcome, then what this run is: console, website, autopilot, profile, sessions', () => {
    const lines = welcome(info, { mode: 'none', columns: 100 }).split('\n');
    const banner = lines.filter((l) => /[█╚]/.test(l));
    expect(banner).toHaveLength(6);
    // The letters, read off the first row of the block font: A R T E M I S.
    expect(banner[0].trim().startsWith('█████╗ ██████╗ ████████╗███████╗███╗   ███╗██╗███████╗')).toBe(true);
    const text = lines.join('\n');
    expect(text).toContain('WEB APPLICATION INTELLIGENT CONSOLE');
    expect(text).toContain('v0.1.0');
    expect(text).toMatch(/Console\s+http:\/\/127\.0\.0\.1:5173/);
    expect(text).toMatch(/Website\s+https:\/\/example\.com\//);
    expect(text).toMatch(/Autopilot\s+max · the next page as soon as one has loaded/);
    expect(text).toMatch(/Profile\s+\/p\/shell-profile/);
    expect(text).toMatch(/Sessions\s+\/p\/sessions/);
    expect(text).toContain('Ctrl+C saves and closes');
  });

  test('without a website or autopilot it says what to do; on a narrow terminal the title fits on one line', () => {
    const text = welcome({ ...info, website: null, autopilot: 0 }, { mode: 'none', columns: 100 });
    expect(text).toMatch(/Website\s+none yet: type one in the console/);
    expect(text).toMatch(/Autopilot\s+off · D in the console, or --autopilot slow\|regular\|max/);
    const narrow = welcome(info, { mode: 'none', columns: 50 });
    expect(narrow).not.toContain('█');
    expect(narrow).toContain('A R T E M I S');
    // The title and the rules fit; a long path is never cut (the terminal wraps it, copyable).
    for (const l of narrow.split('\n').filter((l) => !/^\s{2}(Console|Website|Autopilot|Profile|Sessions)\s/.test(l))) expect(l.length).toBeLessThanOrEqual(50);
  });

  test('colour only for a terminal that can show it: NO_COLOR and pipes get plain text', () => {
    expect(colorMode({}, false)).toBe('none');
    expect(colorMode({ NO_COLOR: '1', COLORTERM: 'truecolor' }, true)).toBe('none');
    expect(colorMode({ COLORTERM: 'truecolor' }, true)).toBe('truecolor');
    expect(colorMode({ TERM: 'xterm-256color' }, true)).toBe('256');
    expect(colorMode({ FORCE_COLOR: '3' }, false)).toBe('truecolor');
  });

  test('notifications: time, kind and message on one line; plain when colour is off', () => {
    expect(notice('session', 'Database /s/x.sqlite', { mode: 'none', now: NOW })).toBe('  13:42:07  ◆ SESSION    Database /s/x.sqlite');
    expect(notice('autopilot', 'Engaged at max', { mode: 'none', now: NOW })).toBe('  13:42:07  ◆ AUTOPILOT  Engaged at max');
  });

  test('in colour the same text, painted: truecolor where the terminal says so, 256 colours otherwise', () => {
    for (const mode of ['truecolor', '256'] as ColorMode[]) {
      const w = welcome(info, { mode, columns: 100 });
      expect(w).toContain('\x1b[');
      expect(plain(w)).toBe(welcome(info, { mode: 'none', columns: 100 }));
      const n = notice('saved', 'Session saved', { mode, now: NOW });
      expect(plain(n)).toBe(notice('saved', 'Session saved', { mode: 'none', now: NOW }));
    }
    expect(welcome(info, { mode: 'truecolor', columns: 100 })).toContain('\x1b[38;2;');
    expect(welcome(info, { mode: '256', columns: 100 })).not.toContain('\x1b[38;2;');
  });
});
