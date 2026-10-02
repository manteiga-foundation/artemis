import { useRef, useState } from 'react';
import { Animated, Animator, FrameKranox, FrameOctagon } from '@arwes/react';
import { commandsFor, type CommandDef } from '../commands';
import { CMD_PRESS_EVENT, useCommandFlash, useIlluminator } from '../hooks';
import { useStore } from '../store';
import { useSfx } from '../sfx';
import { VIEW_BY_ID } from '../views';

export function runCommand(cmd: CommandDef, play: ReturnType<typeof useSfx>) {
  const r = cmd.run();
  play(r.sfx ?? (r.ok ? 'click' : 'error'));
  window.dispatchEvent(new CustomEvent(CMD_PRESS_EVENT, { detail: cmd.key }));
}

function CommandButton({ cmd, onHover }: { cmd: CommandDef; onHover: (c: CommandDef | null) => void }) {
  const play = useSfx();
  const active = useStore((s) => (cmd.isActive ? cmd.isActive(s) : false));
  const flash = useCommandFlash(cmd.key);
  const { Icon } = cmd;

  return (
    <Animator>
      <Animated className="cmd-cell" animated={['flicker']}>
        <button
          type="button"
          className={`cmd-btn${active ? ' is-active' : ''}${flash ? ' is-flash' : ''}`}
          aria-label={`${cmd.name} (${cmd.key})`}
          aria-pressed={cmd.isActive ? active : undefined}
          onMouseEnter={() => {
            onHover(cmd);
            play('hover');
          }}
          onMouseLeave={() => onHover(null)}
          onFocus={() => onHover(cmd)}
          onClick={() => runCommand(cmd, play)}
        >
          <Animator>
            <FrameOctagon
              className="frame"
              leftTop
              rightBottom
              rightTop={false}
              leftBottom={false}
              squareSize={9}
              strokeWidth={1}
            />
          </Animator>
          <Icon className="cmd-icon" aria-hidden />
          <span className="cmd-key">{cmd.key}</span>
        </button>
      </Animated>
    </Animator>
  );
}

export function CommandCard() {
  const panelRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<CommandDef | null>(null);
  const view = useStore((s) => s.view);
  const commands = commandsFor(view);
  useIlluminator(panelRef);

  return (
    <Animator combine manager="stagger" duration={{ stagger: 0.035 }}>
      <Animated elementRef={panelRef} className="panel command-card" animated={['fade', ['x', 18, 0]]}>
        <Animator>
          <FrameKranox className="frame" strokeWidth={1.5} squareSize={10} smallLineLength={10} largeLineLength={36} />
        </Animator>
        <div className="panel-title">
          <span>COMMAND</span>
          <span className="panel-title-right">
            {hover ? (
              <>
                {hover.name.toUpperCase()} <kbd>{hover.key}</kbd>
              </>
            ) : (
              VIEW_BY_ID.get(view)!.label.toUpperCase()
            )}
          </span>
        </div>
        <div className="cmd-grid" data-view-commands={view}>
          {commands.map((c) => (
            <CommandButton key={`${view}-${c.key}`} cmd={c} onHover={setHover} />
          ))}
        </div>
        <div className="cmd-hint">{hover ? hover.hint : 'Hover a command or press its hotkey.'}</div>
      </Animated>
    </Animator>
  );
}
