// Whether Artemis is running inside the browser it owns (see server/owned-browser.ts).
// In that browser the website under review can always be framed; in an external browser,
// sites that refuse framing stay blank.
export const isOwnedBrowser = (): boolean =>
  typeof location !== 'undefined' && new URLSearchParams(location.search).has('owned');
