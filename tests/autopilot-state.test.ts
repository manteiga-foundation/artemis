import { describe, expect, test } from 'bun:test';
import { actorAt, createAutopilot, onSiteInput, setActing, setSpeed } from '../shell/autopilot-state';

// The shell's side of the autopilot: the speed the console set, and when the autopilot itself is
// acting in the site. Its clicks are recorded as the autopilot's; the operator's click, wheel or
// typing in the site while it flies disengages it, like a real autopilot.

describe("the shell's autopilot state", () => {
  test('the speed is 0 to 3; anything else is off', () => {
    const s = createAutopilot();
    expect(s.speed).toBe(0);
    setSpeed(s, 2);
    expect(s.speed).toBe(2);
    setSpeed(s, 7);
    expect(s.speed).toBe(0);
    setSpeed(s, Number.NaN);
    expect(s.speed).toBe(0);
  });

  test("an action during the autopilot's own click (and just after it) is the autopilot's; others are the operator's", () => {
    const s = createAutopilot();
    setSpeed(s, 3);
    setActing(s, true, 1000);
    expect(actorAt(s, 1100)).toBe('autopilot');
    setActing(s, false, 1300);
    // The page reports the click a moment after Playwright's click returns.
    expect(actorAt(s, 1500)).toBe('autopilot');
    expect(actorAt(s, 5000)).toBe('user');
    expect(actorAt(s, 900)).toBe('user');
  });

  test("the operator's input while it flies disengages it once; its own input, or input while off, does not", () => {
    const s = createAutopilot();
    expect(onSiteInput(s, 100)).toBe(false); // off: nothing to disengage
    setSpeed(s, 1);
    setActing(s, true, 1000);
    expect(onSiteInput(s, 1010)).toBe(false); // its own click
    setActing(s, false, 1200);
    expect(onSiteInput(s, 1400)).toBe(false); // still its own, reported late
    expect(onSiteInput(s, 4000)).toBe(true); // the operator
    expect(s.speed).toBe(0);
    expect(onSiteInput(s, 4100)).toBe(false); // already off
  });

  test('old acting windows are forgotten', () => {
    const s = createAutopilot();
    for (let i = 0; i < 500; i++) {
      setActing(s, true, i * 10_000);
      setActing(s, false, i * 10_000 + 100);
    }
    expect(s.windows.length).toBeLessThanOrEqual(50);
  });
});
