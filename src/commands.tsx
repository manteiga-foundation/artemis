import type { IconType } from 'react-icons';
import {
  GiBowArrow,
  GiStopSign,
  GiCheckedShield,
  GiCrosshair,
  GiLinkedRings,
  GiExplosionRays,
  GiCycle,
  GiBroom,
  GiStairs,
  GiNotebook,
  GiPhotoCamera,
  GiLightBulb,
  GiPathDistance,
  GiFamilyTree,
  GiRadarSweep
} from 'react-icons/gi';
import { FaLayerGroup } from 'react-icons/fa6';
import { controller, type CommandResult } from './graph/controller';
import type { UIState } from './store';
import { VIEW_BY_ID, nextView, viewDepth, type ViewId } from './views';

export interface CommandDef {
  key: string; // hotkey (single uppercase letter)
  name: string;
  hint: string;
  Icon: IconType;
  run: () => CommandResult;
  /** Returns true when the command is a toggle currently in its "on" state. */
  isActive?: (s: UIState) => boolean;
}

// 3x3 command card, RTS-style, row-major. In every view A and S hold the top row and V the
// middle row, the positions drawn in the paper sketch. The remaining six slots adapt to the view.

const viewCommand = (from: ViewId): CommandDef => {
  const to = VIEW_BY_ID.get(nextView(from))!;
  const verb = viewDepth(to.id) > viewDepth(from) ? 'Pull back to' : 'Return to';
  return {
    key: 'V',
    name: 'View',
    hint: `${verb} the ${to.label} view: ${to.tagline.toLowerCase()}.`,
    Icon: FaLayerGroup,
    run: () => controller.cycleView()
  };
};

const target: CommandDef = {
  key: 'A',
  name: 'Target',
  hint: 'Arm targeting, then select a node to lock on and zoom.',
  Icon: GiBowArrow,
  run: () => controller.target(),
  isActive: (s) => s.targetMode
};

const stop: CommandDef = {
  key: 'S',
  name: 'Stop',
  hint: 'Halt or resume the force simulation.',
  Icon: GiStopSign,
  run: () => controller.stop(),
  isActive: (s) => s.paused
};

const hold: CommandDef = {
  key: 'H',
  name: 'Hold',
  hint: 'Pin the selected node in place (toggle).',
  Icon: GiCheckedShield,
  run: () => controller.hold(),
  isActive: (s) => s.selected !== null && s.pinned.includes(s.selected)
};

const focus: CommandDef = {
  key: 'F',
  name: 'Focus',
  hint: 'Zoom to the selection; with nothing selected, tour the sectors, then fit the whole network.',
  Icon: GiCrosshair,
  run: () => controller.focus()
};

const links: CommandDef = {
  key: 'L',
  name: 'Links',
  hint: 'Show or hide link rendering.',
  Icon: GiLinkedRings,
  run: () => controller.links(),
  isActive: (s) => !s.linksOn
};

const clear: CommandDef = {
  key: 'X',
  name: 'Clear',
  hint: 'Clear selection, holds and targeting.',
  Icon: GiBroom,
  run: () => controller.clear()
};

const COSMOS_COMMANDS: CommandDef[] = [
  target,
  stop,
  hold,
  viewCommand('cosmos'),
  focus,
  links,
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
  clear
];

const PAGE_COMMANDS: CommandDef[] = [
  target,
  stop,
  hold,
  viewCommand('page'),
  focus,
  links,
  {
    key: 'D',
    name: 'Depth',
    hint: 'Show connections of connections (two hops) or direct connections only.',
    Icon: GiStairs,
    run: () => controller.depth(),
    isActive: (s) => s.pageHops === 2
  },
  {
    key: 'R',
    name: 'Route',
    hint: 'Trace the route from this page back to the core (toggle).',
    Icon: GiPathDistance,
    run: () => controller.route(),
    isActive: (s) => s.lens === 'routes'
  },
  clear
];

// The browser view's commands are interface placeholders: each answers on the console so the
// card, hotkeys and hints can be designed now; behaviour attaches when the live page does.
const stub = (key: string, name: string, hint: string, Icon: IconType): CommandDef => ({
  key,
  name,
  hint,
  Icon,
  run: () => controller.placeholder(name)
});

const BROWSER_COMMANDS: CommandDef[] = [
  stub('A', 'Annotate', 'Pin a note to an element on the page.', GiNotebook),
  stub('S', 'Snapshot', 'Capture the page as it is now.', GiPhotoCamera),
  stub('H', 'Highlight', 'Outline the interactive elements on the page.', GiLightBulb),
  viewCommand('browser'),
  stub('F', 'Flow', 'Mark this page as a step in a flow.', GiPathDistance),
  stub('L', 'Links', 'List the outbound links on this page.', GiLinkedRings),
  stub('D', 'DOM', 'Inspect the element tree.', GiFamilyTree),
  stub('R', 'Reload', 'Reload the page.', GiCycle),
  stub('X', 'Clear', 'Remove annotations and highlights.', GiBroom)
];

const SETS: Record<ViewId, CommandDef[]> = {
  cosmos: COSMOS_COMMANDS,
  page: PAGE_COMMANDS,
  browser: BROWSER_COMMANDS
};

// The recorded cosmos (owned browser) has nothing to regenerate; its slot holds Scope instead.
const scope: CommandDef = {
  key: 'E',
  name: 'Scope',
  hint: 'Show or hide what lies outside the review scope: other hosts and their pages.',
  Icon: GiRadarSweep,
  run: () => controller.scope(),
  isActive: (s) => !s.showExternal
};
const RECORDED_COSMOS_COMMANDS: CommandDef[] = COSMOS_COMMANDS.map((c) => (c.key === 'R' ? scope : c));

export const commandsFor = (view: ViewId, recorded = false): CommandDef[] => (recorded && view === 'cosmos' ? RECORDED_COSMOS_COMMANDS : SETS[view]);

export const commandByKey = (view: ViewId, key: string, recorded = false): CommandDef | undefined =>
  commandsFor(view, recorded).find((c) => c.key === key);
