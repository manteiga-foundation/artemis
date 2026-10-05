// The console's side of the Electron shell (shell/main.ts). In the shell the website is a native,
// genuine browser page behind the console's transparent window: the console tells the shell where
// the slot is, whether a click at the pointer is the site's, and where to go on Engage; the shell
// tells the console where the site is and forwards hotkeys typed in it. In an ordinary browser
// there is no bridge and the Browser view falls back to an iframe.
import type { ViewId } from './views';
import type { AutopilotStatus } from './autopilot';

/** Where the native site view sits, in the console's CSS pixels; hidden when `visible` is false. */
export interface SlotLayout {
  visible: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SiteNav {
  url: string;
  title?: string;
  canGoBack?: boolean;
  canGoForward?: boolean;
}

/** Exposed on `window.artemisShell` by shell/console-preload.ts. */
export interface ShellBridge {
  layout(l: SlotLayout): void;
  navigate(url: string): void;
  /** The site's own history, as a browser's buttons. */
  back(): void;
  forward(): void;
  reload(): void;
  passThrough(through: boolean): void;
  /** Returns an unsubscribe function. The shell replays the current address when the console loads. */
  onSiteNav(fn: (nav: SiteNav) => void): () => void;
  onKey(fn: (key: string) => void): () => void;
  /** Where the pointer is over the site (site coordinates), or that it left the site view; sent while clicks pass through. */
  onSitePointer(fn: (p: { x?: number; y?: number; left?: boolean }) => void): () => void;
  /** The autopilot's speed (0 off, 1 slow, 2 regular, 3 max), set from the console. */
  autopilot(speed: number): void;
  /** Reports from the flight (src/autopilot.ts AutopilotStatus). */
  onAutopilot(fn: (status: AutopilotStatus) => void): () => void;
}

export const shellBridge = (): ShellBridge | null =>
  (typeof window !== 'undefined' && (window as unknown as { artemisShell?: ShellBridge }).artemisShell) || null;

export const inShell = (): boolean => shellBridge() !== null;

/** Everything of the console that keeps its clicks; elsewhere, over the site, clicks go through. */
export const PANEL_SELECTOR = '.hud-header, .browser-bar, .hud-bottom > *, .boot, [role="dialog"]';

const HIDDEN: SlotLayout = { visible: false, x: 0, y: 0, w: 0, h: 0 };

/**
 * The native view is shown only while the console is engaged, showing the Browser view, and not
 * diving (a native view cannot travel with the stage's animation).
 */
export function slotLayout(
  s: { engaged: boolean; stageView: ViewId; viewTransition: unknown; settingsOpen?: boolean },
  rect: { x: number; y: number; width: number; height: number } | null
): SlotLayout {
  // The configuration view covers the stage: the site steps aside until it closes.
  if (!rect || !s.engaged || s.stageView !== 'browser' || s.viewTransition || s.settingsOpen || rect.width <= 0 || rect.height <= 0) return HIDDEN;
  return { visible: true, x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) };
}

/** Whether a click at the element under the pointer belongs to the site behind the console. */
export function passesThrough(siteVisible: boolean, target: { closest(selector: string): unknown } | null): boolean {
  return siteVisible && !(target && target.closest(PANEL_SELECTOR));
}
