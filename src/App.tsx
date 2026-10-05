import { useEffect, type CSSProperties } from 'react';
import { Animator, AnimatorGeneralProvider, BleepsProvider } from '@arwes/react';
import { Background } from './components/Background';
import { Stage } from './components/Stage';
import { Header } from './components/Header';
import { MiniMap } from './components/MiniMap';
import { Console, stepLens } from './components/Console';
import { CommandCard, runCommand } from './components/CommandCard';
import { BootOverlay, TARGET_FIELD_ID } from './components/BootOverlay';
import { AutopilotGlow } from './components/AutopilotGlow';
import { pageLoadSignal } from './page-load';
import { commandByKey } from './commands';
import { controller } from './graph/controller';
import { LENSES, getState, setState, useStore } from './store';
import { SfxBridge, bleepsSettings, useSfx } from './sfx';
import { paletteStyle } from './views';
import { FRAME_KEY_MESSAGE, isOwnedBrowser } from './owned';
import { shellBridge } from './shell';
import { SITE_EVENT, SITE_FEED_READY, type SiteEvent } from './site-events';
import { usePerfSampler } from './metrics';
import { closeSettings, toggleSettings } from './settings-session';
import { autopilotFromShell } from './autopilot';

function Hotkeys() {
  const play = useSfx();

  useEffect(() => {
    /** Route one key to the console. Returns true when the key was consumed. */
    const dispatch = (key: string): boolean => {
      const s = getState();
      if (!s.engaged) {
        // Nothing starts without a website: keys on the entry screen go to the field.
        if (key === 'Enter' || key.length === 1) document.getElementById(TARGET_FIELD_ID)?.focus();
        return false;
      }
      const k = key.length === 1 ? key.toUpperCase() : key;
      // The configuration view: "," opens and closes it, Escape closes it; while it is open the
      // card holds the settings commands and the lenses rest (the graph is behind it).
      if (k === ',') {
        toggleSettings();
        play('click');
        return true;
      }
      if (k === 'Escape' && s.settingsOpen) {
        closeSettings();
        play('click');
        return true;
      }
      const cmd = commandByKey(s.view, k, s.recorded, s.settingsOpen);
      if (cmd) {
        runCommand(cmd, play);
        return true;
      }
      if (s.settingsOpen && (k === 'ArrowLeft' || k === 'ArrowRight' || /^[1-9]$/.test(k))) return false;
      if (k === 'ArrowLeft' || k === 'ArrowRight') {
        controller.setLens(stepLens(k === 'ArrowLeft' ? -1 : 1));
        play('click');
        return true;
      }
      if (/^[1-9]$/.test(k) && Number(k) <= LENSES.length) {
        const v = LENSES[Number(k) - 1].id;
        if (v !== s.lens) {
          controller.setLens(v);
          play('click');
        }
        return true;
      }
      if (k === 'M') {
        setState({ muted: !s.muted });
        return true;
      }
      if (k === 'C') {
        setState({ panelsHidden: !s.panelsHidden });
        play(s.panelsHidden ? 'panels-open' : 'panels-close');
        return true;
      }
      if (k === 'Escape') {
        const r = controller.cancel();
        if (r) play(r.sfx ?? 'command-ok');
        return true;
      }
      return false;
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      // Text fields keep their keys; a checkbox or a button does not (hotkeys still work there).
      const t = e.target as HTMLElement | null;
      const textEntry = t && ((t.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit', 'range'].includes((t as HTMLInputElement).type)) || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if (textEntry) return;
      if (dispatch(e.key)) e.preventDefault();
    };

    // Keys pressed inside the framed website. In the owned browser an init script in every frame
    // forwards them (server/owned-browser.ts); an external browser cannot reach a cross-origin frame.
    const onMessage = (e: MessageEvent) => {
      const d = e.data as { type?: unknown; key?: unknown } | null;
      if (!isOwnedBrowser() || !d || d.type !== FRAME_KEY_MESSAGE || typeof d.key !== 'string') return;
      dispatch(d.key);
    };

    // Focus leaving the document means the keyboard is in the page; tell the operator.
    const onBlur = () => window.setTimeout(() => setState({ keyboardInPage: document.activeElement?.tagName === 'IFRAME' }), 0);
    const onFocus = () => setState({ keyboardInPage: false });

    // Keys pressed in the owned browser's native site view, forwarded by the shell.
    const offShellKeys = shellBridge()?.onKey((key) => dispatch(key));

    window.addEventListener('keydown', onKey);
    window.addEventListener('message', onMessage);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    return () => {
      offShellKeys?.();
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('message', onMessage);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
    };
  }, [play]);

  return null;
}

/** The owned browser reports where the website is as it navigates (and again after a reload). */
function SiteAddress() {
  useEffect(() => shellBridge()?.onSiteNav((nav) => setState({ pageUrl: nav.url, canGoBack: !!nav.canGoBack, canGoForward: !!nav.canGoForward })), []);
  useEffect(() => shellBridge()?.onSiteLoad(pageLoadSignal), []);
  return null;
}

/** The autopilot's flight, reported by the owned browser (progress, the end, disengaging). */
function AutopilotFeed() {
  useEffect(() => shellBridge()?.onAutopilot(autopilotFromShell), []);
  return null;
}

/** The owned browser's recording, delivered live by the recorder's feed (server/site-feed.ts). */
function SiteFeed() {
  useEffect(() => {
    const on = (e: Event) => controller.applySiteEvents((e as CustomEvent<SiteEvent[]>).detail);
    const w = window as unknown as Record<string, boolean>;
    window.addEventListener(SITE_EVENT, on);
    w[SITE_FEED_READY] = true;
    return () => {
      window.removeEventListener(SITE_EVENT, on);
      w[SITE_FEED_READY] = false;
    };
  }, []);
  return null;
}

export function App() {
  const engaged = useStore((s) => s.engaged);
  const view = useStore((s) => s.view);
  const stageView = useStore((s) => s.stageView);
  const diving = useStore((s) => s.viewTransition !== null);
  const panelsHidden = useStore((s) => s.panelsHidden);
  usePerfSampler(engaged);
  // While the stage still shows the outgoing view, the HUD folds away; it reassembles,
  // recoloured, once the stage has swapped.
  const hudActive = engaged && !(diving && stageView !== view);

  return (
    <AnimatorGeneralProvider duration={{ enter: 0.4, exit: 0.3, stagger: 0.06 }}>
      <BleepsProvider {...bleepsSettings}>
        <SfxBridge />
        <Hotkeys />
        <SiteFeed />
        <SiteAddress />
        <AutopilotFeed />
        <div className="app" data-view={view} data-shown={stageView} style={paletteStyle(stageView) as CSSProperties}>
          <Background />
          <Stage />
          <Animator active={hudActive} combine manager="stagger">
            <div className={`hud${hudActive ? ' is-on' : ''}`}>
              <Header />
              {/* The bottom panels have their own root so C can fold them while the header stays. */}
              <Animator root active={hudActive && !panelsHidden} combine manager="stagger">
                <div className="hud-bottom" data-hidden={panelsHidden || undefined}>
                  <MiniMap />
                  <Console />
                  <CommandCard />
                </div>
              </Animator>
            </div>
          </Animator>
          <BootOverlay />
          <AutopilotGlow />
        </div>
      </BleepsProvider>
    </AnimatorGeneralProvider>
  );
}
