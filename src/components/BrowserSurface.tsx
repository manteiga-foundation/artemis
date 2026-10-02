import { useEffect, useRef, useState } from 'react';
import { Animated, Animator, FrameCorners, FrameLines, Text } from '@arwes/react';
import { useStore } from '../store';
import { useIlluminator } from '../hooks';
import { isOwnedBrowser } from '../owned';

// Browser view centre: the website under review, loaded in a sandboxed frame. Inside the browser
// Artemis owns, any site can be framed and keeps its session (server/owned-browser.ts). In an
// external browser, sites that refuse framing stay blank, and the state line says so.
export function BrowserSurface() {
  const ref = useRef<HTMLDivElement>(null);
  const targetUrl = useStore((s) => s.targetUrl);
  const [loaded, setLoaded] = useState(false);
  const owned = isOwnedBrowser();
  useIlluminator(ref);

  useEffect(() => setLoaded(false), [targetUrl]);

  const state = !targetUrl ? 'DETACHED' : loaded ? 'LIVE' : 'CONNECTING';

  return (
    <Animator combine manager="stagger" duration={{ stagger: 0.05 }}>
      <Animated elementRef={ref} className="browser-surface panel" animated={['fade']}>
        <Animator>
          <FrameCorners className="frame" strokeWidth={1.5} cornerLength={28} />
        </Animator>
        <div className="browser-bar">
          <span className="browser-scheme">LIVE PAGE</span>
          <span className="browser-url" title="Address of the page the browser is on">
            {targetUrl ?? '--'}
          </span>
          <span className={`browser-state${loaded ? ' is-live' : ''}`}>
            {owned ? 'OWNED' : 'EXTERNAL'} · {state}
          </span>
        </div>
        <div className="browser-slot">
          <Animator>
            <FrameLines className="frame slot-frame" largeLineWidth={1} smallLineWidth={1} smallLineLength={18} />
          </Animator>
          {targetUrl ? (
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
          ) : (
            <>
              <Animator>
                <Text as="div" className="slot-title" manager="decipher" fixed>
                  PAGE SLOT
                </Text>
              </Animator>
              <p className="slot-note">The website under review renders here.</p>
            </>
          )}
        </div>
        {targetUrl && !owned && (
          <p className="slot-footnote">
            External browser: sites that refuse framing stay blank here. Run <code>bun run artemis</code> for the
            owned browser.
          </p>
        )}
      </Animated>
    </Animator>
  );
}
