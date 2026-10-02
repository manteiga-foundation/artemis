import { Animated, Animator, FrameCorners, FrameOctagon, Text } from '@arwes/react';
import { controller } from '../graph/controller';
import { setState, useStore } from '../store';
import { useSfx } from '../sfx';

export function useEngage() {
  const play = useSfx();
  return () => {
    setState((s) => ({
      engaged: true,
      status: 'Console online. Network telemetry streaming.',
      statusTone: 'ok',
      statusId: s.statusId + 1
    }));
    play('intro');
    controller.main?.fitView(900, 0.16, false);
    window.setTimeout(() => controller.syncMini(true), 400);
  };
}

// Entry gate (pattern used by soulextract.com): a user gesture is required before the
// browser allows audio, so the console assembles and the intro bleep plays on ENGAGE.
export function BootOverlay() {
  const engaged = useStore((s) => s.engaged);
  const engage = useEngage();

  return (
    <Animator active={!engaged} unmountOnExited combine manager="stagger" duration={{ exit: 0.5 }}>
      <Animated className="boot" animated={['fade']}>
        <div className="boot-box">
          <Animator>
            <FrameCorners className="frame" strokeWidth={1.5} cornerLength={22} />
          </Animator>
          <Animator>
            <Text as="h1" className="boot-title" manager="decipher" fixed>
              SCOPE
            </Text>
          </Animator>
          <Animator>
            <Text as="p" className="boot-sub">
              Network operations console. Draft interface.
            </Text>
          </Animator>
          <Animator>
            <Animated animated={['fade', ['y', 10, 0]]}>
              <button type="button" className="boot-btn" onClick={engage} autoFocus>
                <FrameOctagon className="frame" squareSize={10} strokeWidth={1} leftBottom={false} rightTop={false} />
                <span>Engage</span>
              </button>
            </Animated>
          </Animator>
          <Animator>
            <Text as="p" className="boot-note">
              Audio starts after engagement. Press Enter to begin.
            </Text>
          </Animator>
        </div>
      </Animated>
    </Animator>
  );
}
