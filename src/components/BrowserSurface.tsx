import { useRef } from 'react';
import { Animated, Animator, FrameCorners, FrameLines, Text } from '@arwes/react';
import { controller } from '../graph/controller';
import { useStore } from '../store';
import { useIlluminator } from '../hooks';

// Browser view centre: where the live page will sit. Until the Playwright-owned browser is
// attached this is a deliberate placeholder so the frame, address line and surrounding HUD can
// be designed and tested independently of the page itself.
export function BrowserSurface() {
  const ref = useRef<HTMLDivElement>(null);
  const currentPage = useStore((s) => s.currentPage);
  const selected = useStore((s) => s.selected);
  const meta = controller.data.meta[selected ?? currentPage];
  useIlluminator(ref);

  return (
    <Animator combine manager="stagger" duration={{ stagger: 0.05 }}>
      <Animated elementRef={ref} className="browser-surface panel" animated={['fade']}>
        <Animator>
          <FrameCorners className="frame" strokeWidth={1.5} cornerLength={28} />
        </Animator>
        <div className="browser-bar">
          <span className="browser-scheme">LIVE PAGE</span>
          <span className="browser-url" title="Address of the page the browser is on">
            artemis://{meta.id.toLowerCase()}
          </span>
          <span className="browser-state">DETACHED</span>
        </div>
        <div className="browser-slot">
          <Animator>
            <FrameLines className="frame slot-frame" largeLineWidth={1} smallLineWidth={1} smallLineLength={18} />
          </Animator>
          <Animator>
            <Text as="div" className="slot-title" manager="decipher" fixed>
              PAGE SLOT
            </Text>
          </Animator>
          <p className="slot-note">The live page renders here at native speed inside a browser Artemis owns.</p>
          <p className="slot-note slot-dim">Interface placeholder. The page attaches when the runtime is connected.</p>
        </div>
      </Animated>
    </Animator>
  );
}
