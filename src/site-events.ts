// Contract between the recorder (server/recorder.ts, through server/site-feed.ts) and the console
// (src/site-model.ts): what was observed while browsing, as small events. Free of DOM and Bun
// types so both sides can import it. Ids are the session database's row ids.

export type SiteEvent =
  /** Start over (the console reloaded; a snapshot of the session follows). */
  | { type: 'reset' }
  | { type: 'session'; target: string; scopeHost: string }
  /** A page view. A document navigation is `committed` once the page is actually there. */
  | { type: 'visit'; id: number; t: number; url: string; kind: 'document' | 'same-document'; committed: boolean }
  /** The page view's navigation committed, at its final address (after redirects). */
  | { type: 'commit'; id: number; url: string }
  | { type: 'request'; id: number; visitId: number | null; method: string; url: string; resourceType: string; mainDocument: boolean }
  | { type: 'response'; id: number; status: number | null; failed?: boolean };

/** Window event the owned browser dispatches with a SiteEvent[] detail. */
export const SITE_EVENT = 'artemis:site';
/** Set on window once the console listens, so the feed never sends into the void. */
export const SITE_FEED_READY = '__artemisSiteFeed';
