import type { IconType } from 'react-icons';
import {
  GiBowArrow,
  GiStopSign,
  GiCrosshair,
  GiLinkedRings,
  GiBowman,
  GiCycle,
  GiBroom,
  GiNotebook,
  GiRadarSweep,
  GiCheckMark,
  GiMagnifyingGlass,
  GiNextButton,
  GiSave,
  GiOpenFolder,
  GiBackwardTime,
  GiAnticlockwiseRotation,
  GiTrashCan,
  GiPowerLightning,
  GiPaperPlane,
  GiFastForwardButton,
  GiSandsOfTime,
  GiCrossMark,
  GiRadarDish
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
import { LENSES, type LensId } from './store';
import {
  armTraffic,
  closeInterceptor,
  toggleInterceptor,
  dropSelected,
  focusTrafficEditor,
  focusTrafficSearch,
  forwardAll,
  forwardSelected,
  nextHeld,
  pauseTraffic,
  resetTraffic
} from './interceptor-session';

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

// 3x3 command card, RTS-style, row-major: one card in every view (the maintainer's unification,
// after the Browser view's placeholders went). A, S, D hold the top row (Target, Stop, Autopilot),
// V, F, I the middle (View, Focus, Interceptor), P, R, X the bottom (Artemis, Regenerate or Scope,
// Clear). Only V's hint and the recorded session's Scope vary.

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

const focus: CommandDef = {
  key: 'F',
  name: 'Focus',
  hint: 'Zoom to the selection; with nothing selected, tour the sectors, then fit the whole network.',
  Icon: GiCrosshair,
  run: () => controller.focus()
};

// Links left the card when the Interceptor took its slot; the layer keeps its key (L).
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

// The autopilot (the user's sketch: a yoke, three squares for the speed, hotkey D), third on the
// top row in every view: the machine flying the site.
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

// The Interceptor on the card (I): the traffic inspector and proxy, a panel over the stage. It
// opens from here; while it is open its own card takes over and I closes it again (App).
const interceptor: CommandDef = {
  key: 'I',
  name: 'Interceptor',
  hint: 'Open the Interceptor: every request and response, with the proxy to hold, edit, forward and drop.',
  Icon: GiRadarDish,
  run: () => {
    toggleInterceptor();
    return { ok: true, message: getState().status };
  },
  isActive: (s) => s.interceptorOpen
};

// Player Two (P): Artemis reads the cosmos beside the operator, in red.
const artemis: CommandDef = {
  key: 'P',
  name: 'Artemis',
  hint: 'Let Artemis play: she reads the cosmos node by node, in red, and marks what she finds.',
  Icon: GiBowman,
  run: () => controller.agent(),
  isActive: (s) => s.agent.on
};

const regenerate: CommandDef = {
  key: 'R',
  name: 'Regenerate',
  hint: 'Generate a new network topology.',
  Icon: GiCycle,
  run: () => controller.regenerate()
};

// The recorded session (owned browser) has nothing to regenerate; its slot holds Scope instead.
const scope: CommandDef = {
  key: 'E',
  name: 'Scope',
  hint: 'Show or hide what lies outside the review scope: other hosts and their pages.',
  Icon: GiRadarSweep,
  run: () => controller.scope(),
  isActive: (s) => !s.showExternal
};

const cardCommands = (view: ViewId, recorded: boolean): CommandDef[] => [
  target,
  stop,
  autopilot,
  viewCommand(view),
  focus,
  interceptor,
  artemis,
  recorded ? scope : regenerate,
  clear
];

const CARD_SETS = new Map<string, CommandDef[]>();
const cardSet = (view: ViewId, recorded: boolean) => {
  const id = `${view}:${recorded}`;
  if (!CARD_SETS.has(id)) CARD_SETS.set(id, cardCommands(view, recorded));
  return CARD_SETS.get(id)!;
};

// Commands with a key but no slot: layers the operator toggles without looking.
const HOTKEY_ONLY: CommandDef[] = [links];

// The Interceptor's card (key 1): the proxy and the queue in the six slots under A, S, V. A arms,
// S holds the next request, V closes as it closes the configuration view; the rest walk the held
// queue and send it on.
const interceptorCommands = (view: ViewId): CommandDef[] => [
  {
    key: 'A',
    name: 'Arm',
    hint: 'Arm or disarm the proxy: armed, requests stop here before they reach the site.',
    Icon: GiPowerLightning,
    run: () => {
      const t = armTraffic();
      return { ok: true, message: getState().status, sfx: t.armed ? 'command-ok' : 'click' };
    },
    isActive: (s) => (s.traffic?.armed ?? false)
  },
  {
    key: 'S',
    name: 'Hold',
    hint: 'Hold every request as it arrives, or let them all go (the proxy must be armed).',
    Icon: GiSandsOfTime,
    run: () => {
      pauseTraffic();
      return { ok: true, message: getState().status, sfx: 'command-ok' };
    },
    isActive: (s) => (s.traffic?.paused ?? false)
  },
  {
    key: 'H',
    name: 'Next',
    hint: 'Select the next held request, wrapping round the queue.',
    Icon: GiNextButton,
    run: () => {
      nextHeld();
      return { ok: true, message: getState().status };
    }
  },
  { ...interceptorCommand('V', 'Close', 'Close the Interceptor and return to the view.', FaLayerGroup, closeInterceptor) },
  {
    key: 'E',
    name: 'Edit',
    hint: 'Put the cursor in the selected held request: method, address and body are yours to change.',
    Icon: GiNotebook,
    run: () => {
      focusTrafficEditor();
      return { ok: true, message: getState().status };
    }
  },
  {
    key: 'F',
    name: 'Forward',
    hint: 'Send the selected held request on, as edited if it was.',
    Icon: GiPaperPlane,
    run: () => {
      forwardSelected();
      return { ok: true, message: getState().status };
    }
  },
  {
    key: 'D',
    name: 'Drop',
    hint: 'Refuse the selected held request: it never reaches the site.',
    Icon: GiCrossMark,
    run: () => {
      dropSelected();
      return { ok: true, message: getState().status };
    }
  },
  {
    key: 'L',
    name: 'Forward all',
    hint: 'Everything the proxy is holding, on its way at once.',
    Icon: GiFastForwardButton,
    run: () => {
      forwardAll();
      return { ok: true, message: getState().status };
    }
  },
  {
    key: 'R',
    name: 'Reset',
    hint: 'Back to the sample capture shown before anything was intercepted.',
    Icon: GiAnticlockwiseRotation,
    run: () => {
      resetTraffic();
      return { ok: true, message: getState().status };
    }
  }
];

function interceptorCommand(key: string, name: string, hint: string, Icon: IconType, act: () => unknown): CommandDef {
  return {
    key,
    name,
    hint,
    Icon,
    run: () => {
      act();
      return { ok: true, message: getState().status };
    }
  };
}

const INTERCEPTOR_SETS = new Map<ViewId, CommandDef[]>();
const interceptorSet = (view: ViewId) => {
  if (!INTERCEPTOR_SETS.has(view)) INTERCEPTOR_SETS.set(view, interceptorCommands(view));
  return INTERCEPTOR_SETS.get(view)!;
};

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

export const commandsFor = (view: ViewId, recorded = false, settings = false, interceptor = false): CommandDef[] =>
  interceptor ? interceptorSet(view) : settings ? settingsSet(view) : cardSet(view, recorded);

/** The command a key runs: the card shown, then (in a view, not over a panel) the hotkey-only ones. */
export const commandByKey = (view: ViewId, key: string, recorded = false, settings = false, interceptor = false): CommandDef | undefined =>
  commandsFor(view, recorded, settings, interceptor).find((c) => c.key === key) ?? (settings || interceptor ? undefined : HOTKEY_ONLY.find((c) => c.key === key));

// ---------------------------------------------------------------- the strip
// One row of keys above the command card, the same in every view: the four lenses, 1-4. With no
// lens picked the strip sits on no tab at all, the plain reading of the graph (`overview` in the
// store). The Interceptor used to lead it as key 1; it lives on the card now (I).

export interface StripItem {
  /** The digit printed on the tab. */
  key: string;
  label: string;
  /** The lens the tab picks. */
  lens: LensId;
}

export const STRIP: StripItem[] = LENSES.map((l, i) => ({ key: String(i + 1), label: l.label, lens: l.id }));

/** The lens tabs of the strip. */
export const stripLenses = (): { id: LensId; label: string }[] => STRIP.map((s) => ({ id: s.lens, label: s.label }));

export const stripByKey = (key: string): StripItem | undefined => STRIP.find((s) => s.key === key);
