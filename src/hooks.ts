import { useEffect, useState, type RefObject } from 'react';
import { createEffectIlluminator } from '@arwes/react';
import { useStore } from './store';
import { PALETTES, rgbaCss } from './views';

/** Arwes illuminator effect: a soft radial glow in the shown view's hue that follows the pointer. */
export function useIlluminator(ref: RefObject<HTMLElement>, size = 260) {
  const view = useStore((s) => s.stageView);
  const color = rgbaCss(PALETTES[view].azure, 0.11);
  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    const fx = createEffectIlluminator({ container, color, size });
    return () => fx.cancel();
  }, [ref, color, size]);
}

export function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(t);
  }, []);
  return now;
}

/** Fires when a command hotkey is pressed so its button can flash. */
export const CMD_PRESS_EVENT = 'scope:cmd-press';

export function useCommandFlash(key: string) {
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    let t = 0;
    const onPress = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== key) return;
      setFlash(true);
      window.clearTimeout(t);
      t = window.setTimeout(() => setFlash(false), 160);
    };
    window.addEventListener(CMD_PRESS_EVENT, onPress);
    return () => {
      window.removeEventListener(CMD_PRESS_EVENT, onPress);
      window.clearTimeout(t);
    };
  }, [key]);
  return flash;
}
