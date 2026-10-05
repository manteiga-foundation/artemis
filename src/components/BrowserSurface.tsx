import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Animated, Animator, Text } from '@arwes/react';
import { FaArrowLeft, FaArrowRight, FaRotateRight } from 'react-icons/fa6';
import { getState, setState, useStore } from '../store';
import { isOwnedBrowser } from '../owned';
import { passesThrough, shellBridge, slotLayout } from '../shell';
import { normalizeTarget } from '../target';

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
  const settingsOpen = useStore((s) => s.settingsOpen);
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
  }, [shell, engaged, stageView, diving, settingsOpen]);

  const live = shell ? pageUrl !== null : loaded;
  const state = !targetUrl ? 'DETACHED' : live ? 'LIVE' : 'CONNECTING';
  // In an ordinary browser the frame shows what the address strip last went to.
  const frameUrl = pageUrl ?? targetUrl;
  const [reloads, setReloads] = useState(0);
  const canGoBack = useStore((s) => s.canGoBack);
  const canGoForward = useStore((s) => s.canGoForward);
  const go = (url: string) => (shell ? shell.navigate(url) : setState({ pageUrl: url }));
  const reload = () => (shell ? shell.reload() : setReloads((n) => n + 1));
  const historyHint = shell ? undefined : 'Back and Forward need the browser Artemis owns (bun run artemis)';

  return (
    <Animator>
      <Animated className="browser-surface" animated={['fade']}>
        <div className="browser-bar">
          <span className="browser-scheme">LIVE PAGE</span>
          <span className="browser-nav">
            <button type="button" aria-label="Back" title={historyHint ?? 'Back'} disabled={!shell || !canGoBack} onClick={() => shell?.back()}>
              <FaArrowLeft aria-hidden />
            </button>
            <button type="button" aria-label="Forward" title={historyHint ?? 'Forward'} disabled={!shell || !canGoForward} onClick={() => shell?.forward()}>
              <FaArrowRight aria-hidden />
            </button>
            <button type="button" aria-label="Reload" title="Reload" disabled={!targetUrl} onClick={reload}>
              <FaRotateRight aria-hidden />
            </button>
          </span>
          <AddressField address={pageUrl ?? targetUrl} onGo={go} />
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
                key={`${frameUrl}#${reloads}`}
                className="browser-frame"
                title="Website under review"
                src={frameUrl ?? undefined}
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

/**
 * The address of the page shown, editable like a browser's: rewrite it (its GET parameters too)
 * and press Enter to go there; Escape puts back the address of the page shown. While it is being
 * edited, the site's own navigation does not overwrite what is typed.
 */
function AddressField({ address, onGo }: { address: string | null; onGo: (url: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = address ?? '';
  return (
    <input
      className="browser-url"
      aria-label="Address"
      title="Address of the page the browser is on: edit it and press Enter to go there"
      spellCheck={false}
      autoComplete="off"
      disabled={!address}
      value={draft ?? shown}
      placeholder="--"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => setDraft(null)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          setDraft(null);
          e.currentTarget.blur();
        } else if (e.key === 'Enter') {
          const url = normalizeTarget(draft ?? shown);
          if (!url) {
            setState((s) => ({ status: `Not a web address: ${draft ?? shown}`, statusTone: 'warn', statusId: s.statusId + 1 }));
            return;
          }
          setDraft(null);
          onGo(url);
          e.currentTarget.blur();
        }
      }}
    />
  );
}
