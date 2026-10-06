// `bun run scripts/har.ts <session.sqlite> [out.har]`: write the HAR 1.2 of a recorded session
// from its database (server/har.ts), whole: every request with its headers, cookies and typed
// posts, the bodies of pages and API calls, assets listed without their bytes. For sessions
// recorded before the live HAR, or to write one again. Default output: `<session>.export.har`
// beside the database (the live `<session>.har` is left alone).
import { exportHar } from '../server/har';

const [session, out = session?.replace(/\.sqlite$/, '') + '.export.har'] = process.argv.slice(2);
if (!session) {
  console.error('usage: bun run scripts/har.ts <session.sqlite> [out.har]');
  process.exit(2);
}
const entries = exportHar(session, out);
console.log(`Artemis: ${entries} entries -> ${out}`);
