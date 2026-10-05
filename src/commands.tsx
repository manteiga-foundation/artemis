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
  GiPathDistance,
  GiFamilyTree,
  GiRadarSweep,
  GiCheckMark,
  GiMagnifyingGlass,
  GiNextButton,
  GiSave,
  GiOpenFolder,
  GiBackwardTime,
  GiAnticlockwiseRotation,
  GiTrashCan
} from 'react-icons/gi';
import { FaLayerGroup } from 'react-icons/fa6';
import { controller, type CommandResult } from './graph/controller';
import { getState, setState, type UIState } from './store';
import { VIEW_BY_ID, nextView, viewDepth, type ViewId } from './views';
import {
  applySettings,
  closeSettings,
  discardChanges,
  exportSettings,
  focusSearch,
  nextCategory,
  pendingChanges,
  resetCategory,
  restoreDefaults
} from './settings-session';
import { stepAutopilot } from './autopilot';
import { YokeIcon } from './icons';

export interface CommandDef {
  key: string; // hotkey (single uppercase letter)
  name: string;
  hint: string;
  Icon: IconType;
  run: () => CommandResult;
  /** Returns true when the command is a toggle currently in its "on" state. */
  isActive?: (s: UIState) => boolean;
  /** A level shown as three squares under the icon (the autopilot's speed), 0 to 3. */
  pips?: (s: UIState) => number;
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

// The autopilot (the user's sketch: a yoke, three squares for the speed, hotkey D) took the bulb's
// slot; Highlight went, and DOM moved from D to O. Only in the Browser view for now.
const autopilot: CommandDef = {
  key: 'D',
  name: 'Autopilot',
  hint: 'Fly the site on its own, branch by branch. Each press steps the speed: slow, regular, max, off.',
  Icon: YokeIcon,
  run: () => {
    stepAutopilot();
    return { ok: true, message: getState().status };
  },
  isActive: (s) => s.autopilot > 0,
  pips: (s) => s.autopilot
};

const BROWSER_COMMANDS: CommandDef[] = [
  stub('A', 'Annotate', 'Pin a note to an element on the page.', GiNotebook),
  stub('S', 'Snapshot', 'Capture the page as it is now.', GiPhotoCamera),
  autopilot,
  viewCommand('browser'),
  stub('F', 'Flow', 'Mark this page as a step in a flow.', GiPathDistance),
  stub('L', 'Links', 'List the outbound links on this page.', GiLinkedRings),
  stub('O', 'DOM', 'Inspect the element tree.', GiFamilyTree),
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

// The configuration view keeps the card: A applies, S searches, V closes back to the view it was
// opened over; the rest edit the draft. Each answers on the console like any command.
const settingsCommand = (key: string, name: string, hint: string, Icon: IconType, act: () => unknown, isActive?: CommandDef['isActive']): CommandDef => ({
  key,
  name,
  hint,
  Icon,
  isActive,
  run: () => {
    const ok = act() !== false;
    return { ok, message: getState().status };
  }
});

const settingsCommands = (view: ViewId): CommandDef[] => [
  settingsCommand('A', 'Apply', 'Apply the changes and keep them for the next start.', GiCheckMark, () => applySettings(), (s) => pendingChanges(s) > 0),
  settingsCommand('S', 'Search', 'Search the settings by name.', GiMagnifyingGlass, focusSearch),
  settingsCommand('N', 'Next', 'Show the next category (only those a search found).', GiNextButton, nextCategory),
  { ...settingsCommand('V', 'View', `Close the settings and return to the ${VIEW_BY_ID.get(view)!.label} view.`, FaLayerGroup, closeSettings) },
  settingsCommand('E', 'Export', 'Save the settings in effect as a file (artemis-settings.json).', GiSave, exportSettings),
  settingsCommand('I', 'Import', 'Load settings from a file: interface only for now.', GiOpenFolder, () => {
    setState((s) => ({ status: 'Import: interface only for now.', statusTone: 'info', statusId: s.statusId + 1 }));
  }),
  settingsCommand('D', 'Defaults', 'Every setting back to its default (Apply to keep).', GiBackwardTime, restoreDefaults),
  settingsCommand('R', 'Reset', 'This category back to its defaults (Apply to keep).', GiAnticlockwiseRotation, resetCategory),
  settingsCommand('X', 'Discard', 'Drop the changes not applied yet.', GiTrashCan, discardChanges)
];
const SETTINGS_SETS = new Map<ViewId, CommandDef[]>();
const settingsSet = (view: ViewId) => {
  if (!SETTINGS_SETS.has(view)) SETTINGS_SETS.set(view, settingsCommands(view));
  return SETTINGS_SETS.get(view)!;
};

export const commandsFor = (view: ViewId, recorded = false, settings = false): CommandDef[] =>
  settings ? settingsSet(view) : recorded && view === 'cosmos' ? RECORDED_COSMOS_COMMANDS : SETS[view];

export const commandByKey = (view: ViewId, key: string, recorded = false, settings = false): CommandDef | undefined =>
  commandsFor(view, recorded, settings).find((c) => c.key === key);
