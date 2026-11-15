import { describe, expect, test } from 'bun:test';
import { linuxSandbox, missingLibraries, sandboxNotice, shellLaunchArgs, type SandboxFacts } from '../server/platform';

// What the owned browser needs from each desktop system, decided in one place (server/platform.ts)
// and measured in docs/spikes/005-linux-desktop.md.
describe('the shell on each desktop system', () => {
  test('on Linux it runs as an X11 client (Xwayland under Wayland): a Wayland app cannot place the console over the site', () => {
    expect(shellLaunchArgs('linux')).toContain('--ozone-platform=x11');
  });

  test('macOS and Windows keep Electron as it is', () => {
    expect(shellLaunchArgs('darwin')).toEqual([]);
    expect(shellLaunchArgs('win32')).toEqual([]);
  });
});

// Chromium's sandbox on Linux: user namespaces where the system allows them, else the setuid
// helper. Measured on Ubuntu 24.04 (AppArmor restricts user namespaces): with neither, Electron
// aborts at launch; Playwright then passes --no-sandbox, so the site would run unsandboxed.
describe("Chromium's sandbox on Linux", () => {
  const facts = (f: Partial<SandboxFacts>): SandboxFacts => ({ helper: { uid: 1000, mode: 0o100755 }, restrictUserns: null, usernsClone: null, maxUserNamespaces: '63000', profile: false, ...f });

  test('user namespaces where nothing restricts them (Debian, Fedora, Arch, Ubuntu before 23.10)', () => {
    expect(linuxSandbox(facts({}))).toBe('userns');
    expect(linuxSandbox(facts({ restrictUserns: '0', usernsClone: '1' }))).toBe('userns');
  });

  test("Ubuntu 23.10 and later: only with Artemis's AppArmor profile", () => {
    expect(linuxSandbox(facts({ restrictUserns: '1' }))).toBe('off');
    expect(linuxSandbox(facts({ restrictUserns: '1', profile: true }))).toBe('userns');
  });

  test('user namespaces switched off: only the setuid helper (root-owned, mode 4755)', () => {
    expect(linuxSandbox(facts({ usernsClone: '0' }))).toBe('off');
    expect(linuxSandbox(facts({ maxUserNamespaces: '0' }))).toBe('off');
    expect(linuxSandbox(facts({ usernsClone: '0', helper: { uid: 0, mode: 0o104755 } }))).toBe('suid');
    expect(linuxSandbox(facts({ restrictUserns: '1', helper: { uid: 0, mode: 0o100755 } }))).toBe('off');
  });

  test('without it the terminal says so, with the one command that turns it on', () => {
    const n = sandboxNotice('/home/ana/.artemis/app');
    expect(n.kind).toBe('warn');
    expect(n.text).toContain('sandbox');
    expect(n.text).toContain('sudo sh /home/ana/.artemis/app/scripts/linux-sandbox.sh');
  });
});

describe("Electron's system libraries on Linux", () => {
  test('the ones ldd cannot find are named before launching, instead of a crash from Playwright', () => {
    const ldd = `\tlinux-vdso.so.1 (0x0000ffff9a1f0000)
\tlibffmpeg.so => /opt/artemis/node_modules/electron/dist/libffmpeg.so (0x0000ffff97000000)
\tlibnss3.so => not found
\tlibgtk-3.so.0 => /lib/aarch64-linux-gnu/libgtk-3.so.0 (0x0000ffff96800000)
\tlibasound.so.2 => not found
`;
    expect(missingLibraries(ldd)).toEqual(['libnss3.so', 'libasound.so.2']);
    expect(missingLibraries('')).toEqual([]);
  });
});
