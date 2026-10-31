#!/usr/bin/env node
// Reset a running lab: POST /api/lab/reset for one workspace.
//   node scripts/reset.mjs [base-url] [workspace]      (default http://localhost:${PORT:-6880}, workspace "default")
// Loopback only: refuses any other host. Needs the server already running; sends the same-origin header the server requires.
import { isLoopbackHost } from '../server/src/safety.js';

export async function reset(base = `http://localhost:${process.env.PORT || 6880}`, workspace = 'default') {
  const u = new URL(base);
  if (!isLoopbackHost(u.hostname)) throw new Error(`refusing ${u.hostname}: loopback only`);
  const r = await fetch(new URL('/api/lab/reset', u), { method: 'POST', headers: { 'content-type': 'application/json', origin: u.origin, 'x-workspace': workspace }, body: '{}' });
  if (!r.ok) throw new Error(`reset failed: HTTP ${r.status}`);
  return r.json();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  reset(process.argv[2], process.argv[3]).then(() => console.log('reset: ok'), (e) => { console.error(e.message); process.exit(1); });
}
