import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Animated, Animator, Text } from '@arwes/react';
import { getState, useStore } from '../store';
import { isOwnedBrowser } from '../owned';
import { passesThrough, shellBridge, slotLayout } from '../shell';

// Browser view centre: the website under review fills the stage from under the header to the
// bottom edge, running behind the bottom panels. In the owned browser (the Electron shell,
// shell/main.ts) the site is a genuine native page placed behind the console exactly where this
// slot is; clicks over it go through to the site, clicks on the panels stay with the console. In an
// ordinary browser it falls back to a sandboxed iframe, and sites that refuse framing stay blank.
export function BrowserSurface() {
  const targetUrl = useStore((s) => s.targetUrl);
  const pageUrl = useStore((s) => s.pageUrl);
  const engaged = useStore((s) => s.engaged);
  const stageView = useStore((s) => s.stageView);
  const diving = useStore((s) => s.viewTransition !== null);
  const [loaded, setLoaded] = useState(false);
  const owned = isOwnedBrowser();
  const shell = shellBridge();
  const slotRef = useRef<HTMLDivElement>(null);

  useEffect(() => setLoaded(false), [targetUrl]);

  useLayoutEffect(() => {
    if (!shell) return;
    const slot = slotRef.current;
    let visible = false;
    const report = () => {
      const layout = slotLayout(getState(), slot ? slot.getBoundingClientRect() : null);
      visible = layout.visible;
      shell.layout(layout);
    };
    report();
    const resize = new ResizeObserver(report);
    if (slot) resize.observe(slot);
    window.addEventListener('resize', report);
    let through = false;
    const onMove = (e: MouseEvent) => {
      const next = passesThrough(visible, document.elementFromPoint(e.clientX, e.clientY));
      if (next !== through) {
        through = next;
        shell.passThrough(next);
      }
    };
    document.addEventListener('mousemove', onMove, true);
    return () => {
      resize.disconnect();
      window.removeEventListener('resize', report);
      document.removeEventListener('mousemove', onMove, true);
      shell.passThrough(false);
      shell.layout(slotLayout(getState(), null));
    };
  }, [shell, engaged, stageView, diving]);

  const live = shell ? pageUrl !== null : loaded;
  const state = !targetUrl ? 'DETACHED' : live ? 'LIVE' : 'CONNECTING';

  return (
    <Animator>
      <Animated className="browser-surface" animated={['fade']}>
        <div className="browser-bar">
          <span className="browser-scheme">LIVE PAGE</span>
          <span className="browser-url" title="Address of the page the browser is on">
            {pageUrl ?? targetUrl ?? '--'}
          </span>
          {targetUrl && !owned && (
            <span className="browser-hint" title="Run `bun run artemis` for the browser Artemis owns">
              external browser · sites that refuse framing stay blank
            </span>
          )}
          <span className={`browser-state${live ? ' is-live' : ''}`}>
            {owned ? 'OWNED' : 'EXTERNAL'} · {state}
          </span>
        </div>
        <div className="browser-slot" ref={slotRef}>
          {targetUrl ? (
            // The owned browser's site shows through the slot; nothing is rendered in it.
            shell ? null : (
              <iframe
                key={targetUrl}
                className="browser-frame"
                title="Website under review"
                src={targetUrl}
                // No allow-top-navigation: a frame-busting site cannot take over the console.
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
                referrerPolicy="no-referrer-when-downgrade"
                onLoad={() => setLoaded(true)}
              />
            )
          ) : (
            <Animator>
              <Text as="div" className="slot-title" manager="decipher" fixed>
                PAGE SLOT
              </Text>
            </Animator>
          )}
        </div>
      </Animated>
    </Animator>
  );
}
