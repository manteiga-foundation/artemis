import { useEffect, useState } from 'react';
import { Animated, Animator, Text } from '@arwes/react';
import { useStore } from '../store';
import { isOwnedBrowser } from '../owned';

// Browser view centre: the website under review, loaded in a sandboxed frame that fills the stage
// from under the header to the bottom edge, running behind the bottom panels. Inside the browser
// Artemis owns, any site can be framed and keeps its session (server/owned-browser.ts). In an
// external browser, sites that refuse framing stay blank, and the address strip says so.
export function BrowserSurface() {
  const targetUrl = useStore((s) => s.targetUrl);
  const [loaded, setLoaded] = useState(false);
  const owned = isOwnedBrowser();

  useEffect(() => setLoaded(false), [targetUrl]);

  const state = !targetUrl ? 'DETACHED' : loaded ? 'LIVE' : 'CONNECTING';

  return (
    <Animator>
      <Animated className="browser-surface" animated={['fade']}>
        <div className="browser-bar">
          <span className="browser-scheme">LIVE PAGE</span>
          <span className="browser-url" title="Address of the page the browser is on">
            {targetUrl ?? '--'}
          </span>
          {targetUrl && !owned && (
            <span className="browser-hint" title="Run `bun run artemis` for the browser Artemis owns">
              external browser · sites that refuse framing stay blank
            </span>
          )}
          <span className={`browser-state${loaded ? ' is-live' : ''}`}>
            {owned ? 'OWNED' : 'EXTERNAL'} · {state}
          </span>
        </div>
        <div className="browser-slot">
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
