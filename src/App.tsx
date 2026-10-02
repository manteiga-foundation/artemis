import { useEffect, type CSSProperties } from 'react';
import { Animator, AnimatorGeneralProvider, BleepsProvider } from '@arwes/react';
import { Background } from './components/Background';
import { Stage } from './components/Stage';
import { Header } from './components/Header';
import { MiniMap } from './components/MiniMap';
import { Console, stepLens } from './components/Console';
import { CommandCard, runCommand } from './components/CommandCard';
import { BootOverlay, TARGET_FIELD_ID } from './components/BootOverlay';
import { commandByKey } from './commands';
import { controller } from './graph/controller';
import { LENSES, getState, setState, useStore } from './store';
import { SfxBridge, bleepsSettings, useSfx } from './sfx';
import { paletteStyle } from './views';
import { FRAME_KEY_MESSAGE, isOwnedBrowser } from './owned';

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
      const cmd = commandByKey(s.view, k);
      if (cmd) {
        runCommand(cmd, play);
        return true;
      }
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
      if (k === 'Escape') {
        const r = controller.cancel();
        if (r) play(r.sfx ?? 'click');
        return true;
      }
      return false;
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
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

    window.addEventListener('keydown', onKey);
    window.addEventListener('message', onMessage);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('message', onMessage);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
    };
  }, [play]);

  return null;
}

export function App() {
  const engaged = useStore((s) => s.engaged);
  const view = useStore((s) => s.view);
  const stageView = useStore((s) => s.stageView);
  const diving = useStore((s) => s.viewTransition !== null);
  // While the stage still shows the outgoing view, the HUD folds away; it reassembles,
  // recoloured, once the stage has swapped.
  const hudActive = engaged && !(diving && stageView !== view);

  return (
    <AnimatorGeneralProvider duration={{ enter: 0.4, exit: 0.3, stagger: 0.06 }}>
      <BleepsProvider {...bleepsSettings}>
        <SfxBridge />
        <Hotkeys />
        <div className="app" data-view={view} data-shown={stageView} style={paletteStyle(stageView) as CSSProperties}>
          <Background />
          <Stage />
          <Animator active={hudActive} combine manager="stagger">
            <div className={`hud${hudActive ? ' is-on' : ''}`}>
              <Header />
              <div className="hud-bottom">
                <MiniMap />
                <Console />
                <CommandCard />
              </div>
            </div>
          </Animator>
          <BootOverlay />
        </div>
      </BleepsProvider>
    </AnimatorGeneralProvider>
  );
}
