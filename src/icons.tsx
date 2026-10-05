import { IconBase, type IconBaseProps } from 'react-icons';

/**
 * The autopilot's yoke, as the user drew it: a pilot's control wheel seen from the seat, two grips
 * joined by a U, the hub and the column below. Game-icons has no yoke (a car's steering wheel, a
 * ship's wheel); this one is drawn on the same 512 grid so it sits with them in the card.
 */
export function YokeIcon(props: IconBaseProps) {
  return (
    <IconBase attr={{ viewBox: '0 0 512 512' }} {...props}>
      {/* The wide, shallow U of the wheel. */}
      <path d="M58 196 Q70 306 168 312 H344 Q442 306 454 196" fill="none" stroke="currentColor" strokeWidth="60" strokeLinecap="round" />
      {/* The two grips at its ends. */}
      <rect x="14" y="104" width="88" height="168" rx="40" />
      <rect x="410" y="104" width="88" height="168" rx="40" />
      {/* The hub and the column into the panel. */}
      <circle cx="256" cy="314" r="70" />
      <rect x="220" y="360" width="72" height="128" rx="14" />
    </IconBase>
  );
}
