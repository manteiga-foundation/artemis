import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Animated, Animator, FrameKranox, Text } from '@arwes/react';
import { setState, useStore } from '../store';
import { useIlluminator } from '../hooks';
import { useSfx } from '../sfx';
import {
  formatBytes,
  formatMs,
  hostOfEntry,
  isActionable,
  matches,
  pathOfEntry,
  summary,
  type TrafficEntry
} from '../interceptor';
import {
  TRAFFIC_EDITOR_ID,
  TRAFFIC_SEARCH_ID,
  armTraffic,
  currentTraffic,
  dropSelected,
  forwardAll,
  forwardSelected,
  nextHeld,
  pauseTraffic,
  resetTraffic,
  selectTraffic,
  setTrafficQuery
} from '../interceptor-session';

/**
 * The Interceptor (key 1): what went to the site and what came back, and the proxy that can stop
 * it on the way. Laid out the way an inspector is read rather than the way a list is: the traffic
 * on the left with its status, size and time, the selected request on the right whole, request and
 * response, headers and body. A held request is the operator's to edit, forward or drop.
 *
 * It covers the stage between the header and the bottom panels, like the configuration view; the
 * scope map and the command card stay where they are.
 */
export function InterceptorSurface() {
  const panelRef = useRef<HTMLDivElement>(null);
  const traffic = useStore((s) => s.traffic);
  const query = useStore((s) => s.trafficQuery);
  const selectedId = useStore((s) => s.trafficSelected);
  const panelsHidden = useStore((s) => s.panelsHidden);
  const play = useSfx();
  useIlluminator(panelRef);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);

  const t = traffic ?? currentTraffic({ traffic });
  const filtered = useMemo(() => t.entries.filter((e) => matches(e, query)), [t.entries, query]);
  const stats = summary(t.entries);
  const selected = t.entries.find((e) => e.id === selectedId) ?? null;

  // Stop just above the bottom panels (the command card is the tallest), whatever their size;
  // with the panels folded away (C) the panel takes the whole height.
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

  // More traffic than fits: say so at the list's edge rather than letting the last row be sliced
  // with nothing to explain it.
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setMore(el.scrollHeight - el.clientHeight - el.scrollTop > 2);
    measure();
    el.addEventListener('scroll', measure);
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', measure);
      ro.disconnect();
    };
  }, [filtered.length]);

  return (
    <Animator>
      <Animated
        elementRef={panelRef}
        className="panel interceptor-surface"
        role="dialog"
        aria-label="Interceptor"
        animated={['fade', ['y', 14, 0]]}
      >
        <Animator>
          <FrameKranox className="frame" strokeWidth={1.5} squareSize={12} smallLineLength={12} largeLineLength={48} />
        </Animator>

        <header className="inter-head">
          <Text as="h2" className="inter-title" manager="decipher" fixed>
            Interceptor
          </Text>
          <span className={`inter-proxy${t.armed ? ' is-armed' : ''}`}>
            <span className="inter-dot" aria-hidden />
            {t.armed ? 'PROXY ARMED' : 'PROXY DISARMED'}
          </span>
          <button
            type="button"
            className={`inter-toggle${t.armed ? ' is-on' : ''}`}
            aria-pressed={t.armed}
            aria-label="Arm proxy"
            title="Arm or disarm the proxy"
            onClick={() => {
              const next = armTraffic(t);
              play(next.armed ? 'command-ok' : 'click');
            }}
          >
            {t.armed ? 'DISARM' : 'ARM'}
            <kbd>A</kbd>
          </button>
          <button
            type="button"
            className={`inter-toggle${t.paused ? ' is-on' : ''}`}
            aria-pressed={t.paused}
            aria-label="Hold requests"
            title="Hold every request as it arrives"
            onClick={() => {
              const next = pauseTraffic(t);
              play(next.paused ? 'command-ok' : 'click');
            }}
          >
            {t.paused ? 'RELEASE' : 'HOLD'}
            <kbd>H</kbd>
          </button>
          <span className="inter-stats">
            <span className="inter-pair">
              <em>ALL</em> {stats.total}
            </span>
            <span className="inter-pair">
              <em>HELD</em> <span className={stats.held ? 'is-held' : undefined}>{stats.held}</span>
            </span>
            <span className="inter-pair">
              <em>ERR</em> <span className={stats.errors ? 'is-err' : undefined}>{stats.errors}</span>
            </span>
            <span className="inter-pair">
              <em>WS</em> {stats.sockets}
            </span>
            <span className="inter-pair">
              <em>IN</em> {formatBytes(stats.requestBytes)}
            </span>
            <span className="inter-pair">
              <em>OUT</em> {formatBytes(stats.responseBytes)}
            </span>
          </span>
        </header>

        <div className="inter-body">
          <section className="inter-list" aria-label="Traffic">
            <div className="inter-filter">
              <input
                id={TRAFFIC_SEARCH_ID}
                className="inter-search"
                type="search"
                aria-label="Filter traffic"
                placeholder="Filter: method, host, path, status"
                spellCheck={false}
                autoComplete="off"
                value={query}
                onChange={(e) => setTrafficQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    if (query) setTrafficQuery('');
                    else (e.currentTarget as HTMLInputElement).blur();
                  }
                }}
              />
              <span className="inter-count">
                {filtered.length}
                {filtered.length === t.entries.length ? '' : `/${t.entries.length}`}
              </span>
            </div>
            <div className="inter-table-wrap" ref={wrapRef}>
              <table className="inter-table">
                <thead>
                  <tr>
                    <th scope="col">#</th>
                    <th scope="col">Method</th>
                    <th scope="col">Host</th>
                    <th scope="col">Path</th>
                    <th scope="col">Status</th>
                    <th scope="col">Size</th>
                    <th scope="col">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((e) => (
                    <Row
                      key={e.id}
                      entry={e}
                      selected={e.id === selectedId}
                      onSelect={() => {
                        selectTraffic(e.id);
                        play('click');
                      }}
                    />
                  ))}
                </tbody>
              </table>
              {!filtered.length && <p className="inter-empty">{query.trim() ? `Nothing matches “${query.trim()}”.` : 'No traffic yet.'}</p>}
            </div>
            {more && <span className="inter-more" aria-hidden>MORE BELOW</span>}
          </section>

          <section className="inter-detail" aria-label="Request detail">
            {selected ? (
              <Detail key={selected.id} entry={selected} />
            ) : (
              <p className="inter-empty">Select a request to read it whole.</p>
            )}
            <footer className="inter-actions">
              <button type="button" className="inter-act" aria-label="Edit request" disabled={!selected || !isActionable(selected)} onClick={() => document.getElementById(TRAFFIC_EDITOR_ID)?.focus()}>
                EDIT <kbd>E</kbd>
              </button>
              <button type="button" className="inter-act" aria-label="Forward request" disabled={!selected || !isActionable(selected)} onClick={() => forwardSelected()}>
                FORWARD <kbd>F</kbd>
              </button>
              <button type="button" className="inter-act is-danger" aria-label="Drop request" disabled={!selected || !isActionable(selected)} onClick={() => dropSelected()}>
                DROP <kbd>D</kbd>
              </button>
              <button type="button" className="inter-act" aria-label="Forward all held" disabled={!stats.held} onClick={() => forwardAll(t)}>
                FORWARD ALL <kbd>L</kbd>
              </button>
              <button type="button" className="inter-act inter-act-end" aria-label="Next held" disabled={!stats.held} onClick={() => nextHeld()}>
                NEXT HELD
              </button>
              <button type="button" className="inter-act inter-act-end" aria-label="Reset traffic" onClick={() => resetTraffic()}>
                RESET <kbd>R</kbd>
              </button>
            </footer>
          </section>
        </div>
      </Animated>
    </Animator>
  );
}

function Row({ entry, selected, onSelect }: { entry: TrafficEntry; selected: boolean; onSelect: () => void }) {
  const path = pathOfEntry(entry);
  return (
    <tr
      className={`inter-row${selected ? ' is-selected' : ''} is-${entry.state}${entry.protocol === 'ws' ? ' is-ws' : ''}`}
      tabIndex={0}
      // A plain table's rows do not support aria-selected (that is a grid); aria-current says which
      // request the detail pane is showing, and is valid on any element.
      aria-current={selected ? 'true' : undefined}
      aria-label={`${entry.method} ${path}`}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      <td className="col-n">{entry.id}</td>
      <td className={`col-method m-${entry.method.toLowerCase()}`}>
        {entry.method}
        {entry.protocol === 'ws' && <span className="inter-tag">WS</span>}
        {entry.edited && <span className="inter-tag is-edit">EDIT</span>}
      </td>
      <td className="col-host">{hostOfEntry(entry)}</td>
      <td className="col-path" title={entry.url}>
        {path}
      </td>
      <td className={`col-status${entry.status !== null && entry.status >= 400 ? ' is-err' : ''}`}>{statusText(entry)}</td>
      <td className="col-size">{formatBytes(entry.responseBytes)}</td>
      <td className="col-time">{formatMs(entry.durationMs)}</td>
    </tr>
  );
}

/** The status column: a number where there is one, else what happened to it in words. */
function statusText(e: TrafficEntry): string {
  if (e.status !== null) return String(e.status);
  switch (e.state) {
    case 'held':
      return 'HELD';
    case 'inflight':
      return '...';
    case 'dropped':
      return 'DROPPED';
    case 'forwarded':
      return 'SENT';
    default:
      return 'FAILED';
  }
}

/**
 * One request read whole: the request line, its headers and body, then the response's. A held
 * request whose text is the operator's to change is editable in place; what it says goes on the
 * wire when it is forwarded.
 */
function Detail({ entry }: { entry: TrafficEntry }) {
  const [tab, setTab] = useState<'request' | 'response'>('request');
  const [draft, setDraft] = useState<{ method: string; url: string; body: string }>({
    method: entry.method,
    url: entry.url,
    body: entry.requestBody ?? ''
  });
  const editable = isActionable(entry);
  const set = (patch: Partial<typeof draft>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    setState((s) => ({
      traffic: s.traffic ? { ...s.traffic, entries: s.traffic.entries.map((x) => (x.id === entry.id ? { ...x, ...patch, requestBody: patch.body ?? x.requestBody, edited: true } : x)) } : s.traffic
    }));
  };

  return (
    <div className="inter-read">
      <div className="inter-tabs" role="tablist" aria-label="Request and response">
        <button type="button" role="tab" aria-selected={tab === 'request'} className={`inter-tab${tab === 'request' ? ' is-active' : ''}`} onClick={() => setTab('request')}>
          REQUEST
        </button>
        <button type="button" role="tab" aria-selected={tab === 'response'} className={`inter-tab${tab === 'response' ? ' is-active' : ''}`} onClick={() => setTab('response')}>
          RESPONSE
        </button>
        <span className={`inter-state is-${entry.state}`}>{entry.state.toUpperCase()}</span>
      </div>

      {tab === 'request' ? (
        <div className="inter-block">
          {editable ? (
            <div className="inter-line">
              <select
                id={TRAFFIC_EDITOR_ID}
                className="inter-method"
                aria-label="Method"
                value={draft.method}
                onChange={(e) => set({ method: e.target.value })}
              >
                {['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <input className="inter-url" aria-label="Address" value={draft.url} spellCheck={false} onChange={(e) => set({ url: e.target.value })} />
            </div>
          ) : (
            <p className="inter-line is-static">
              <span className="inter-method-label">{entry.method}</span>
              <span className="inter-url-label">{entry.url}</span>
            </p>
          )}
          <Headers title="Request headers" list={entry.requestHeaders} />
          <label className="inter-body-label" htmlFor={editable ? `${TRAFFIC_EDITOR_ID}-body` : undefined}>
            Request body
          </label>
          {editable ? (
            <textarea
              id={`${TRAFFIC_EDITOR_ID}-body`}
              className="inter-body-text"
              aria-label="Request body"
              spellCheck={false}
              rows={5}
              value={draft.body}
              onChange={(e) => set({ body: e.target.value })}
            />
          ) : (
            <pre className="inter-body-text is-static">{entry.requestBody ?? <span className="inter-none">no body</span>}</pre>
          )}
        </div>
      ) : (
        <div className="inter-block">
          <p className="inter-line is-static">
            <span className={`inter-method-label${entry.status !== null && entry.status >= 400 ? ' is-err' : ''}`}>{statusText(entry)}</span>
            <span className="inter-url-label">
              {formatBytes(entry.responseBytes)} · {formatMs(entry.durationMs)}
            </span>
          </p>
          <Headers title="Response headers" list={entry.responseHeaders} />
          <span className="inter-body-label">Response body</span>
          <pre className="inter-body-text is-static">{entry.responseBody ?? <span className="inter-none">no body</span>}</pre>
        </div>
      )}
    </div>
  );
}

function Headers({ title, list }: { title: string; list: { name: string; value: string }[] }) {
  return (
    <div className="inter-headers">
      <span className="inter-body-label">{title}</span>
      {list.length ? (
        <table className="inter-header-table">
          <tbody>
            {list.map((h, i) => (
              <tr key={`${h.name}-${i}`}>
                <th scope="row">{h.name}</th>
                <td>{h.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="inter-none">none</p>
      )}
    </div>
  );
}
