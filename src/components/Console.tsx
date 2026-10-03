import { Animated, Animator, FrameOctagon, Text } from '@arwes/react';
import { controller } from '../graph/controller';
import { LENSES, getState, useStore, type LensId } from '../store';
import { useSfx } from '../sfx';

export function stepLens(dir: 1 | -1): LensId {
  const i = LENSES.findIndex((v) => v.id === getState().lens);
  return LENSES[(i + dir + LENSES.length) % LENSES.length].id;
}

// Lens strip styled after the ZKN reference (chamfered end caps, active tab with underline,
// dashed rail, << >> steppers). Colours come from the active view's palette variables.
export function TabStrip() {
  const lens = useStore((s) => s.lens);
  const play = useSfx();

  const go = (id: LensId) => {
    if (id === getState().lens) return;
    controller.setLens(id);
    play('click');
  };

  return (
    <div className="tabstrip" role="tablist" aria-label="Lenses">
      <button type="button" className="tab-arrow" aria-label="Previous lens" onClick={() => go(stepLens(-1))}>
        {'<<'}
      </button>
      <div className="tabs">
        {LENSES.map((v, i) => {
          const active = v.id === lens;
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
                    rightTop={i === LENSES.length - 1}
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
      <button type="button" className="tab-arrow" aria-label="Next lens" onClick={() => go(stepLens(1))}>
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
  const currentPage = useStore((s) => s.currentPage);
  const targetMode = useStore((s) => s.targetMode);
  const pinnedCount = useStore((s) => s.pinned.length);
  const view = useStore((s) => s.stageView);
  const address = useStore((s) => s.pageUrl ?? s.targetUrl);
  const meta = selected !== null ? controller.data.meta[selected] : null;
  const pageMeta = controller.data.meta[selected ?? currentPage];
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
              <em>LINKS</em> {pageMeta.degree}
            </span>
            <span>
              <em>NOTES</em> 0
            </span>
            <span>
              <em>MODE</em> REVIEW
            </span>
          </div>
        ) : (
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
        )}
        {view !== 'browser' && <TabStrip />}
      </Animated>
    </Animator>
  );
}
