// Tiny D1-compatible wrapper over node:sqlite for tests (synthetic data only).
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
export function makeD1(sqlFiles = []) {
  const db = new DatabaseSync(':memory:');
  for (const f of sqlFiles) db.exec(readFileSync(f, 'utf8'));
  const wrap = (sql, args = []) => ({
    bind: (...a) => wrap(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; }
  });
  return { prepare: sql => wrap(sql), raw: db };
}
export function makeR2() {
  const m = new Map();
  return { m, put: async (k, v, o) => { m.set(k, { body: v, o }); }, get: async k => m.get(k) || null };
}
