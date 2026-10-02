import { useEffect, type CSSProperties } from 'react';
import { Animator, AnimatorGeneralProvider, BleepsProvider } from '@arwes/react';
import { Background } from './components/Background';
import { Stage } from './components/Stage';
import { Header } from './components/Header';
import { MiniMap } from './components/MiniMap';
import { Console, stepLens } from './components/Console';
import { CommandCard, runCommand } from './components/CommandCard';
import { BootOverlay, useEngage } from './components/BootOverlay';
import { commandByKey } from './commands';
import { controller } from './graph/controller';
import { LENSES, getState, setState, useStore } from './store';
import { SfxBridge, bleepsSettings, useSfx } from './sfx';
import { paletteStyle } from './views';

function Hotkeys() {
  const play = useSfx();
  const engage = useEngage();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;

      const s = getState();
      if (!s.engaged) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          engage();
        }
        return;
      }

      const k = e.key.length === 1 ? e.key.toUpperCase() : e.key;
      const cmd = commandByKey(s.view, k);
      if (cmd) {
        e.preventDefault();
        runCommand(cmd, play);
        return;
      }
      if (k === 'ArrowLeft' || k === 'ArrowRight') {
        e.preventDefault();
        controller.setLens(stepLens(k === 'ArrowLeft' ? -1 : 1));
        play('click');
        return;
      }
      if (/^[1-9]$/.test(k) && Number(k) <= LENSES.length) {
        const v = LENSES[Number(k) - 1].id;
        if (v !== s.lens) {
          controller.setLens(v);
          play('click');
        }
        return;
      }
      if (k === 'M') {
        setState({ muted: !s.muted });
        return;
      }
      if (k === 'Escape') {
        const r = controller.cancel();
        if (r) play(r.sfx ?? 'click');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [play, engage]);

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
