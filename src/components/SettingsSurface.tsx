import { useLayoutEffect, useRef } from 'react';
import { Animated, Animator, FrameKranox, Text } from '@arwes/react';
import { setState, useStore } from '../store';
import { CATEGORIES, searchSettings } from '../settings';
import { SETTINGS_SEARCH_ID, applySettings, closeSettings, pendingChanges, setOption } from '../settings-session';
import { useIlluminator } from '../hooks';
import { useSfx } from '../sfx';

/**
 * The configuration view, as drawn in the user's sketch: Settings with a search field and the
 * categories on the left, the chosen category's options as checkboxes on the right, Apply at the
 * bottom right. It covers the stage between the header and the bottom panels; the scope map and
 * the command card stay where they are. Changes wait in a draft until Apply.
 */
export function SettingsSurface() {
  const panelRef = useRef<HTMLDivElement>(null);
  const query = useStore((s) => s.settingsQuery);
  const categoryId = useStore((s) => s.settingsCategory);
  const draft = useStore((s) => s.settingsDraft ?? s.settings);
  const pending = useStore(pendingChanges);
  const play = useSfx();
  useIlluminator(panelRef);

  const results = searchSettings(query);
  const shown = results.find((r) => r.category.id === categoryId) ?? results[0];
  const category = shown?.category ?? CATEGORIES.find((c) => c.id === categoryId) ?? CATEGORIES[0];

  // Stop just above the bottom panels (the command card is the tallest), whatever their size;
  // with the panels folded away (C) the settings take the whole height.
  const panelsHidden = useStore((s) => s.panelsHidden);
  useLayoutEffect(() => {
    const el = panelRef.current;
    const bottom = document.querySelector<HTMLElement>('.hud-bottom');
    if (!el || !bottom) return;
    const fit = () => {
      const top = bottom.getBoundingClientRect().top;
      el.style.bottom = panelsHidden || top <= 0 ? '14px' : `${Math.round(window.innerHeight - top + 14)}px`;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(bottom);
    window.addEventListener('resize', fit);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', fit);
    };
  }, [panelsHidden]);

  const onSearch = (q: string) => {
    const found = searchSettings(q);
    const keep = found.some((r) => r.category.id === categoryId);
    setState({ settingsQuery: q, settingsCategory: keep || !found.length ? categoryId : found[0].category.id });
  };

  return (
    <Animator>
      <Animated
        elementRef={panelRef}
        className="panel settings-surface"
        role="dialog"
        aria-label="Settings"
        animated={['fade', ['y', 14, 0]]}
      >
        <Animator>
          <FrameKranox className="frame" strokeWidth={1.5} squareSize={12} smallLineLength={12} largeLineLength={48} />
        </Animator>
        <aside className="settings-side">
          <Text as="h2" className="settings-title" manager="decipher" fixed>
            Settings
          </Text>
          <input
            id={SETTINGS_SEARCH_ID}
            className="settings-search"
            type="search"
            aria-label="Search settings"
            placeholder="Search"
            spellCheck={false}
            autoComplete="off"
            value={query}
            onChange={(e) => onSearch(e.target.value)}
            onKeyDown={(e) => {
              // Escape clears the search first, then closes the settings.
              if (e.key === 'Escape') {
                if (query) onSearch('');
                else closeSettings();
              }
            }}
          />
          <nav className="settings-nav" aria-label="Setting categories">
            {results.map(({ category: c, options }) => (
              <button
                key={c.id}
                type="button"
                aria-label={c.label}
                aria-current={c.id === category.id ? 'true' : undefined}
                className={c.id === category.id ? 'is-current' : undefined}
                onClick={() => {
                  setState({ settingsCategory: c.id });
                  play('click');
                }}
              >
                <span>{c.label}</span>
                {query.trim() && <span className="settings-count">{options.length}</span>}
              </button>
            ))}
          </nav>
        </aside>

        <section className="settings-main" aria-live="polite">
          {shown ? (
            <>
              <header className="settings-head">
                <h3>{category.label}</h3>
                {!category.live && <span className="settings-tag">Interface only for now</span>}
              </header>
              <p className="settings-desc">{category.description}</p>
              <ul className="settings-options">
                {shown.options.map((o) => (
                  <li key={o.id}>
                    <label>
                      <input type="checkbox" checked={!!draft[o.id]} onChange={(e) => setOption(o.id, e.target.checked)} />
                      <span className="settings-box" aria-hidden />
                      <span className="settings-label">
                        {o.label}
                        {o.hint && <small>{o.hint}</small>}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="settings-empty">No setting matches “{query.trim()}”.</p>
          )}
          <footer className="settings-foot">
            <span className={`settings-pending${pending ? ' is-pending' : ''}`}>
              {pending ? `${pending} change${pending === 1 ? '' : 's'} not applied` : 'No changes'}
            </span>
            <button
              type="button"
              className="settings-apply"
              disabled={!pending}
              onClick={() => {
                const ok = applySettings();
                play(ok ? 'command-ok' : 'command-error');
              }}
            >
              Apply
            </button>
          </footer>
        </section>
      </Animated>
    </Animator>
  );
}
