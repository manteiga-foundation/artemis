import type { IconType } from 'react-icons';
import {
  GiBowArrow,
  GiStopSign,
  GiCheckedShield,
  GiRadarSweep,
  GiCrosshair,
  GiLinkedRings,
  GiExplosionRays,
  GiCycle,
  GiBroom
} from 'react-icons/gi';
import { controller, type CommandResult } from './graph/controller';
import type { UIState } from './store';

export interface CommandDef {
  key: string; // hotkey (single uppercase letter)
  name: string;
  hint: string;
  Icon: IconType;
  run: () => CommandResult;
  /** Returns true when the command is a toggle currently in its "on" state. */
  isActive?: (s: UIState) => boolean;
}

// 3x3 command card, RTS-style. Row-major order. A, S (top row) and V (middle row)
// keep the positions drawn in the paper sketch.
export const COMMANDS: CommandDef[] = [
  {
    key: 'A',
    name: 'Target',
    hint: 'Arm targeting, then select a node to lock on and zoom.',
    Icon: GiBowArrow,
    run: () => controller.target(),
    isActive: (s) => s.targetMode
  },
  {
    key: 'S',
    name: 'Stop',
    hint: 'Halt or resume the force simulation.',
    Icon: GiStopSign,
    run: () => controller.stop(),
    isActive: (s) => s.paused
  },
  {
    key: 'H',
    name: 'Hold',
    hint: 'Pin the selected node in place (toggle).',
    Icon: GiCheckedShield,
    run: () => controller.hold(),
    isActive: (s) => s.selected !== null && s.pinned.includes(s.selected)
  },
  {
    key: 'V',
    name: 'Vision',
    hint: 'Fit the entire network into view.',
    Icon: GiRadarSweep,
    run: () => controller.vision()
  },
  {
    key: 'F',
    name: 'Focus',
    hint: 'Zoom to the selection, or cycle through sectors.',
    Icon: GiCrosshair,
    run: () => controller.focus()
  },
  {
    key: 'L',
    name: 'Links',
    hint: 'Show or hide link rendering.',
    Icon: GiLinkedRings,
    run: () => controller.links(),
    isActive: (s) => !s.linksOn
  },
  {
    key: 'D',
    name: 'Disperse',
    hint: 'Repulsion pulse; the layout scatters and re-settles.',
    Icon: GiExplosionRays,
    run: () => controller.disperse()
  },
  {
    key: 'R',
    name: 'Regenerate',
    hint: 'Generate a new network topology.',
    Icon: GiCycle,
    run: () => controller.regenerate()
  },
  {
    key: 'X',
    name: 'Clear',
    hint: 'Clear selection, holds and targeting.',
    Icon: GiBroom,
    run: () => controller.clear()
  }
];

export const COMMAND_BY_KEY = new Map(COMMANDS.map((c) => [c.key, c]));
