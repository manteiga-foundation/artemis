// What the owned browser needs from each desktop system (measured in
// docs/spikes/005-linux-desktop.md). The decisions are pure, so the unit tests read them without
// Electron; `readSandboxFacts` is the one place that looks at the machine.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Electron switches the shell is launched with on this system, beyond Artemis's own. */
export function shellLaunchArgs(platform: NodeJS.Platform): string[] {
  // Electron runs as a native Wayland app in a Wayland session (Ubuntu's default), and a Wayland
  // app cannot place one of its windows: the console landed wherever the compositor put it, not
  // over the site. Through Xwayland it is an X11 client and sits exactly over the content.
  if (platform === 'linux') return ['--ozone-platform=x11'];
  return [];
}

/**
 * Chromium's sandbox on Linux: 'userns' (user namespaces, its first choice), 'suid' (the setuid
 * helper, chrome-sandbox), or 'off' (neither is available: launched with --no-sandbox).
 */
export type LinuxSandbox = 'userns' | 'suid' | 'off';

/** What decides it, read from the machine by `readSandboxFacts`. */
export interface SandboxFacts {
  /** chrome-sandbox's owner and mode, or null when it is missing. */
  helper: { uid: number; mode: number } | null;
  /** /proc/sys/kernel/apparmor_restrict_unprivileged_userns (Ubuntu 23.10+: '1'). */
  restrictUserns: string | null;
  /** /proc/sys/kernel/unprivileged_userns_clone (Debian's switch). */
  usernsClone: string | null;
  /** /proc/sys/user/max_user_namespaces ('0': none allowed). */
  maxUserNamespaces: string | null;
  /** Artemis's AppArmor profile (scripts/linux-sandbox.sh) allows this Electron user namespaces. */
  profile: boolean;
}

export function linuxSandbox(f: SandboxFacts): LinuxSandbox {
  const userns = f.usernsClone !== '0' && f.maxUserNamespaces !== '0' && (f.restrictUserns !== '1' || f.profile);
  if (userns) return 'userns';
  if (f.helper && f.helper.uid === 0 && (f.helper.mode & 0o4000) !== 0) return 'suid';
  return 'off';
}

/** The AppArmor profile scripts/linux-sandbox.sh writes (Ubuntu 23.10 and later). */
export const APPARMOR_PROFILE = '/etc/apparmor.d/artemis-electron';

/** The facts for the Electron binary at `electronPath` (its folder holds chrome-sandbox). */
export function readSandboxFacts(electronPath: string): SandboxFacts {
  const read = (file: string) => {
    try {
      return readFileSync(file, 'utf8').trim();
    } catch {
      return null;
    }
  };
  let helper: SandboxFacts['helper'] = null;
  try {
    const s = statSync(join(electronPath, '..', 'chrome-sandbox'));
    helper = { uid: s.uid, mode: s.mode };
  } catch {
    // no helper
  }
  return {
    helper,
    restrictUserns: read('/proc/sys/kernel/apparmor_restrict_unprivileged_userns'),
    usernsClone: read('/proc/sys/kernel/unprivileged_userns_clone'),
    maxUserNamespaces: read('/proc/sys/user/max_user_namespaces'),
    profile: existsSync(APPARMOR_PROFILE) && (read(APPARMOR_PROFILE) ?? '').includes(electronPath)
  };
}

/** From `ldd <electron>`: the shared libraries the system does not have (Electron cannot start). */
export function missingLibraries(lddOutput: string): string[] {
  return [...lddOutput.matchAll(/^\s*(\S+)\s+=>\s+not found/gm)].map((m) => m[1]);
}

/** Said in the terminal at each launch while the sandbox is off. */
export function sandboxNotice(appRoot: string): { kind: 'warn'; text: string } {
  return {
    kind: 'warn',
    text: `Chromium's sandbox is off: this system does not let Electron use it, so the site's pages run without it. Turn it on once with: sudo sh ${join(appRoot, 'scripts/linux-sandbox.sh')}`
  };
}
