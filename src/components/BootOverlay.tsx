import { useEffect, useRef, useState, type RefObject } from 'react';
import { Animated, Animator, FrameCorners, FrameOctagon, FrameUnderline, Text, useAnimator } from '@arwes/react';
import type { AnimatorNode } from '@arwes/react';
import { engageConsole } from '../session';
import { useStore } from '../store';
import { normalizeTarget } from '../target';
import { useSfx } from '../sfx';

export const TARGET_FIELD_ID = 'target-url';

/**
 * Focus a field once its Arwes animator has finished entering. Arwes keeps entering elements
 * visibility:hidden, and a focused element that turns hidden is blurred by the browser, so
 * focusing on mount (or on the first visible frame) does not stick.
 */
function FocusWhenEntered({ target }: { target: RefObject<HTMLElement> }) {
  const animator = useAnimator();
  useEffect(() => {
    if (!animator) {
      target.current?.focus();
      return;
    }
    const onNode = (node: AnimatorNode) => {
      if (node.state === 'entered') target.current?.focus();
    };
    onNode(animator.node);
    return animator.node.subscribe(onNode);
  }, [animator, target]);
  return null;
}

/** Engage with the given website; plays the engage sound on success (needs the user's gesture). */
export function useEngage() {
  const play = useSfx();
  return (input: string): boolean => {
    const ok = engageConsole(input);
    play(ok ? 'engage' : 'command-error');
    return ok;
  };
}

// Entry gate (pattern used by soulextract.com): a user gesture is required before the browser
// allows audio, so the console assembles and the intro bleep plays on ENGAGE. The gate also
// asks which website is under review; nothing starts without one.
export function BootOverlay() {
  const engaged = useStore((s) => s.engaged);
  const engage = useEngage();
  const [value, setValue] = useState('');
  const [rejected, setRejected] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const valid = normalizeTarget(value) !== null;

  const submit = (e: { preventDefault: () => void }) => {
    e.preventDefault();
    if (!engage(value)) setRejected(true);
  };

  return (
    <Animator active={!engaged} unmountOnExited combine manager="stagger" duration={{ exit: 0.5 }}>
      <Animated className="boot" animated={['fade']}>
        <form className="boot-box" onSubmit={submit} noValidate>
          <Animator>
            <FrameCorners className="frame" strokeWidth={1.5} cornerLength={22} />
          </Animator>
          <Animator>
            <Text as="h1" className="boot-title" manager="decipher" fixed>
              ARTEMIS
            </Text>
          </Animator>
          <Animator>
            <Text as="p" className="boot-sub">
              Web Application Intelligent Console
            </Text>
          </Animator>
          <Animator>
            <Animated className="boot-field" animated={['fade', ['y', 10, 0]]}>
              <FocusWhenEntered target={inputRef} />
              <FrameUnderline className="frame" strokeWidth={1} squareSize={8} />
              <label className="boot-label" htmlFor={TARGET_FIELD_ID}>
                Web App
              </label>
              <input
                id={TARGET_FIELD_ID}
                ref={inputRef}
                className="boot-input"
                type="text"
                inputMode="url"
                autoComplete="url"
                spellCheck={false}
                placeholder="example.com"
                value={value}
                aria-invalid={rejected && !valid}
                onChange={(e) => {
                  setValue(e.target.value);
                  setRejected(false);
                }}
                // A disabled submit button suppresses implicit submission; Enter must still answer.
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submit(e);
                }}
              />
            </Animated>
          </Animator>
          <Animator>
            <Animated animated={['fade', ['y', 10, 0]]}>
              <button type="submit" className="boot-btn" disabled={!valid}>
                <FrameOctagon className="frame" squareSize={10} strokeWidth={1} leftBottom={false} rightTop={false} />
                <span>Engage</span>
              </button>
            </Animated>
          </Animator>
          <Animator>
            <Text as="p" className={`boot-note${rejected && !valid ? ' is-warn' : ''}`}>
              {rejected && !valid
                ? 'Enter a web address such as example.com to begin.'
                : 'Press Enter to begin'}
            </Text>
          </Animator>
        </form>
      </Animated>
    </Animator>
  );
}
