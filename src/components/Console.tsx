import { Animated, Animator, FrameOctagon, Text } from '@arwes/react';
import { controller } from '../graph/controller';
import { VIEWS, getState, useStore, type ViewId } from '../store';
import { useSfx } from '../sfx';

export function stepView(dir: 1 | -1): ViewId {
  const i = VIEWS.findIndex((v) => v.id === getState().view);
  return VIEWS[(i + dir + VIEWS.length) % VIEWS.length].id;
}

// Tab strip styled after the ZKN reference (chamfered end caps, active tab with underline,
// dashed rail, << >> steppers), recoloured to Egyptian blue.
export function TabStrip() {
  const view = useStore((s) => s.view);
  const play = useSfx();

  const go = (id: ViewId) => {
    if (id === getState().view) return;
    controller.setView(id);
    play('click');
  };

  return (
    <div className="tabstrip" role="tablist" aria-label="Views">
      <button type="button" className="tab-arrow" aria-label="Previous view" onClick={() => go(stepView(-1))}>
        {'<<'}
      </button>
      <div className="tabs">
        {VIEWS.map((v, i) => {
          const active = v.id === view;
          return (
            <Animator key={v.id}>
              <Animated className="tab-cell" animated={['fade', ['y', 8, 0]]}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={`tab${active ? ' is-active' : ''}`}
                  onMouseEnter={() => play('hover')}
                  onClick={() => go(v.id)}
                >
                  <FrameOctagon
                    className="frame"
                    leftTop={i === 0}
                    rightTop={i === VIEWS.length - 1}
                    rightBottom={false}
                    leftBottom={false}
                    squareSize={10}
                    strokeWidth={1}
                  />
                  <span className="tab-label">
                    <span className="tab-num">{i + 1}</span>
                    {v.label}
                  </span>
                </button>
              </Animated>
            </Animator>
          );
        })}
      </div>
      <button type="button" className="tab-arrow" aria-label="Next view" onClick={() => go(stepView(1))}>
        {'>>'}
      </button>
      <div className="tab-rail" aria-hidden />
    </div>
  );
}

export function Console() {
  const status = useStore((s) => s.status);
  const tone = useStore((s) => s.statusTone);
  const selected = useStore((s) => s.selected);
  const targetMode = useStore((s) => s.targetMode);
  const pinnedCount = useStore((s) => s.pinned.length);
  const meta = selected !== null ? controller.data.meta[selected] : null;
  const seq = useStore((s) => s.statusId);

  return (
    <Animator combine manager="stagger">
      <Animated className="console" animated={['fade', ['y', 14, 0]]}>
        <div className={`console-status tone-${tone}`}>
          <span className="prompt">&gt;</span>
          <Animator key={seq} duration={{ enter: 0.5 }}>
            <Text as="span" manager="decipher">
              {status}
            </Text>
          </Animator>
        </div>
        <div className="console-readout">
          <span>
            <em>SEL</em> {meta ? meta.id : '--'}
          </span>
          <span>
            <em>TIER</em> {meta ? meta.tier.toUpperCase() : '--'}
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
        <TabStrip />
      </Animated>
    </Animator>
  );
}
