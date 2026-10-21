import { Animated, Animator, FrameKranox, FrameOctagon, Text } from '@arwes/react';
import { useRef } from 'react';
import { controller } from '../graph/controller';
import { useIlluminator } from '../hooks';
import { getState, useStore } from '../store';
import { useSfx } from '../sfx';
import { speedLabel } from '../autopilot';
import { STRIP } from '../commands';
import { toggleInterceptor } from '../interceptor-session';

/**
 * The key the `<< >>` steppers land on, wrapping. With the Interceptor closed and no lens picked
 * the strip sits on nothing, so the first step is out of that neutral state into the Interceptor.
 */
export function stepStrip(dir: 1 | -1): string {
  const { interceptorOpen, lens } = getState();
  const at = STRIP.findIndex((s) => (s.lens === null ? interceptorOpen : !interceptorOpen && s.lens === lens));
  const from = at < 0 ? (dir > 0 ? STRIP.length - 1 : 0) : at;
  return STRIP[(from + dir + STRIP.length) % STRIP.length].key;
}

/**
 * The strip: one row of keys. 1 is the Interceptor, a panel over the stage; 2-5 pick a lens. With
 * the Interceptor closed and no lens picked the strip sits on nothing: the graph read plainly.
 */
export function TabStrip() {
  const lens = useStore((s) => s.lens);
  const open = useStore((s) => s.interceptorOpen);
  const play = useSfx();

  const pick = (key: string) => {
    const item = STRIP.find((s) => s.key === key);
    if (!item) return;
    if (item.lens === null) {
      toggleInterceptor();
      play('click');
      return;
    }
    if (open) toggleInterceptor();
    if (item.lens !== getState().lens) controller.setLens(item.lens);
    play('click');
  };

  return (
    <div className="tabstrip" role="tablist" aria-label="Lenses">
      <button type="button" className="tab-arrow" aria-label="Previous lens" onClick={() => pick(stepStrip(-1))}>
        {'<<'}
      </button>
      <div className="tabs">
        {STRIP.map((item, i) => {
          const active = item.lens === null ? open : !open && item.lens === lens;
          return (
            <Animator key={item.key}>
              <Animated className={`tab-cell${item.lens === null ? ' is-interceptor' : ''}`} animated={['fade', ['y', 8, 0]]}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={`tab${active ? ' is-active' : ''}${item.lens === null ? ' is-interceptor' : ''}`}
                  onMouseEnter={() => play('hover')}
                  onClick={() => pick(item.key)}
                >
                  <FrameOctagon
                    className="frame"
                    leftTop={i === 0}
                    rightTop={i === STRIP.length - 1}
                    rightBottom={false}
                    leftBottom={false}
                    squareSize={10}
                    strokeWidth={1}
                  />
                  <span className="tab-label">
                    <span className="tab-num">{item.key}</span>
                    {item.label}
                  </span>
                </button>
              </Animated>
            </Animator>
          );
        })}
      </div>
      <button type="button" className="tab-arrow" aria-label="Next lens" onClick={() => pick(stepStrip(1))}>
        {'>>'}
      </button>
      <div className="tab-rail" aria-hidden />
    </div>
  );
}

export function Console() {
  const panelRef = useRef<HTMLDivElement>(null);
  const status = useStore((s) => s.status);
  const tone = useStore((s) => s.statusTone);
  const selected = useStore((s) => s.selected);
  const currentPage = useStore((s) => s.currentPage);
  const targetMode = useStore((s) => s.targetMode);
  const pinnedCount = useStore((s) => s.pinned.length);
  const view = useStore((s) => s.stageView);
  const address = useStore((s) => s.pageUrl ?? s.targetUrl);
  const autopilot = useStore((s) => s.autopilot);
  const meta = (selected !== null ? controller.data.meta[selected] : null) ?? null;
  const pageMeta = controller.data.meta[selected ?? currentPage] ?? null;
  const seq = useStore((s) => s.statusId);
  useIlluminator(panelRef);

  return (
    <Animator combine manager="stagger">
      {/* One instrument, like the command card: the status line, the readouts and the lens strip
          are rows of the same panel, not three floating bars. */}
      <Animated elementRef={panelRef} className="panel console" animated={['fade', ['y', 14, 0]]}>
        <Animator>
          <FrameKranox className="frame" strokeWidth={1.5} squareSize={10} smallLineLength={10} largeLineLength={36} />
        </Animator>
        <div className={`console-status tone-${tone}`}>
          <span className="prompt">&gt;</span>
          <Animator key={seq} duration={{ enter: 0.5 }}>
            <Text as="span" manager="decipher">
              {status}
            </Text>
          </Animator>
        </div>
        {view === 'browser' ? (
          // Page facts for the auditor. Placeholders until the live page reports them.
          <div className="console-readout">
            <span>
              <em>URL</em> {address ?? '--'}
            </span>
            <span>
              <em>TITLE</em> --
            </span>
            <span>
              <em>FORMS</em> --
            </span>
            <span>
              <em>LINKS</em> {pageMeta ? pageMeta.degree : '--'}
            </span>
            <span>
              <em>NOTES</em> 0
            </span>
            <span className="console-mode">
              <em>MODE</em> {autopilot ? `AUTOPILOT ${speedLabel(autopilot).toUpperCase()}` : 'REVIEW'}
            </span>
          </div>
        ) : (
          <div className="console-readout">
            <span>
              <em>SEL</em> {meta ? meta.id : '--'}
            </span>
            <span>
              <em>TIER</em> {meta ? (meta.kind ?? meta.tier).toUpperCase() : '--'}
            </span>
            <span>
              <em>SECTOR</em> {meta ? (meta.sector < 0 ? 'CORE' : String(meta.sector + 1).padStart(2, '0')) : '--'}
            </span>
            <span>
              <em>DEG</em> {meta ? meta.degree : '--'}
            </span>
            <span>
              <em>HOLD</em> {pinnedCount}
            </span>
            <span className={targetMode ? 'is-armed' : ''}>
              <em>MODE</em> {targetMode ? 'TARGET ARMED' : 'IDLE'}
            </span>
          </div>
        )}
        {/* The lens strip is in every view: the Browser included, where it picks the perspective
            the pull-back opens in (and the lens the cosmos will show). */}
        <TabStrip />
      </Animated>
    </Animator>
  );
}
