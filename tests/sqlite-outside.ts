// Another process reading a session database read-only, as another tool would while Artemis runs.
// A Bun child with bun:sqlite, so the tests need no sqlite3 command (Windows has none).
export function queryOutside(path: string, sql: string): Record<string, unknown>[] {
  const script = `const { Database } = require('bun:sqlite');
const db = new Database(process.env.ARTEMIS_DB, { readonly: true });
console.log(JSON.stringify(db.query(process.env.ARTEMIS_SQL).all()));
db.close();`;
  const r = Bun.spawnSync([process.execPath, '-e', script], { env: { ...process.env, ARTEMIS_DB: path, ARTEMIS_SQL: sql } });
  if (r.exitCode !== 0) throw new Error(`reading ${path} from another process failed: ${r.stderr.toString()}`);
  return JSON.parse(r.stdout.toString());
}
