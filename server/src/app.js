// One Express app. /api = health, info, and the lab (one in-memory mock session world per workspace id, rule 13).
// Loopback Host check and same-origin writes on everything. Serves web/dist when it exists.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { hostCheck, publicHostFrom, sameOriginWritesFor } from './safety.js';
import { createHealth } from './health.js';
import { workspaceFrom } from './workspace.js';
import { modeFrom } from './config.js';
import { createLab, COOKIE } from './engine.js';
import { buildStory } from './story.js';
import { verticalFrom } from './verticals.js';
import { shelfInfo } from './shelfLink.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIST = process.env.WEB_DIST || path.resolve(HERE, '../../web/dist');
export const MAX_WORKSPACES = 200;

// Workspaces are created by a write (POST) and evicted least-recently-used past the cap, so one visitor cannot push another out
// by browsing; a GET for an unknown workspace answers with a fresh, empty world and stores nothing.
export function createLabs() {
  const labs = new Map();
  const touch = (ws) => { const l = labs.get(ws); labs.delete(ws); labs.set(ws, l); return l; };
  return {
    peek: (ws) => (labs.has(ws) ? touch(ws) : createLab({ workspace: ws })),
    get: (ws) => {
      if (labs.has(ws)) return touch(ws);
      if (labs.size >= MAX_WORKSPACES) labs.delete(labs.keys().next().value);
      labs.set(ws, createLab({ workspace: ws }));
      return labs.get(ws);
    },
    size: () => labs.size,
  };
}

// The browser's own copy of the session cookie. The IdP reads THIS (not a server-side shortcut), so deleting it in DevTools really signs the user out of SSO.
const cookieOf = (req) => {
  const m = String(req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith(`${COOKIE.name}=`));
  return m ? m.slice(COOKIE.name.length + 1) : null;
};

const ACTIONS = {
  'sign-in': (l, b) => l.signIn({ persona: b.persona, methods: Array.isArray(b.methods) ? b.methods.slice(0, 8) : undefined }),
  authorize: (l, b, c) => l.authorize(String(b.app), { cookie: c }),
  'complete-mfa': (l, _b, c) => l.completeMfa({ cookie: c }),
  'admin/flow-reports': (l, b, c) => l.flowReports({ methods: Array.isArray(b.methods) ? b.methods.slice(0, 8) : [], cookie: c }),
  'widget/sign-in': (l, b) => l.widgetSignIn({ persona: b.persona, methods: Array.isArray(b.methods) ? b.methods.slice(0, 8) : undefined }),
  'widget/invoke': (l, b) => l.widgetInvoke(b.method === 'GET' ? 'GET' : 'POST', b.body),
  'widget/drop-token': (l) => l.dropSessionToken(),
  'call-api': (l, b) => l.callApi(String(b.app)),
  refresh: (l, b) => l.refresh(String(b.app)),
  'admin/revoke': (l, b, c) => l.revokeSession({ soft: b.soft === true, cookie: c }),
  'admin/idle-timeout': (l, b) => l.setIdleTimeout(b.seconds),
  'admin/mfa-policy': (l, b) => l.setMfaPolicy(String(b.app), b.seconds === null ? null : b.seconds),
  'admin/advance-clock': (l, b) => l.advanceClock(b.seconds),
  reset: (l) => { l.reset(); return { ok: true, reset: 'ok' }; },
};

export function createApp({ health = createHealth(), hosted = false, labFor = createLabs() } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(hostCheck);
  app.use(sameOriginWritesFor(hosted ? publicHostFrom() : null));
  app.use((_req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); next(); });

  const api = express.Router();
  api.use(express.json({ limit: '4kb' }));
  api.use('/health', health.router);
  api.get('/info', (_req, res) => { res.set('Cache-Control', 'no-store'); res.json({ mode: modeFrom(), simulated: true, hosted }); });

  // ?workspace= or the X-Workspace header names the visitor's own world; anything invalid falls back to `default`.
  const wsOf = (req) => workspaceFrom(req.query.workspace ?? req.get('x-workspace'));
  api.get('/lab', (req, res) => { res.set('Cache-Control', 'no-store'); res.json(labFor.peek(wsOf(req)).snapshot({ cookie: cookieOf(req), secure: hosted })); });
  api.get('/story', (req, res) => { res.set('Cache-Control', 'no-store'); res.json(buildStory(verticalFrom(req.query.vertical))); });
  api.post('/lab/:action(*)', (req, res) => {
    const run = Object.hasOwn(ACTIONS, req.params.action) ? ACTIONS[req.params.action] : null;
    if (!run) return res.status(404).json({ error: 'unknown_action' });
    const l = labFor.get(wsOf(req));
    const result = run(l, req.body && typeof req.body === 'object' ? req.body : {}, cookieOf(req));
    res.set('Cache-Control', 'no-store');
    // A refusal ('login required', 'must be POST') is the lesson, not an HTTP error: 200 with result.ok false, so DevTools stays clean.
    // Set-Cookie on a new session only. Revoking never clears it: the stale cookie staying in the browser is the lesson.
    if (result.cookie) res.append('Set-Cookie', `${COOKIE.name}=${result.sessionId}; Path=/; HttpOnly; SameSite=Lax${hosted ? '; Secure' : ''}`);
    // Reset is the one thing that clears it: back to a browser that never signed in.
    const wasReset = req.params.action === 'reset';
    if (wasReset) res.append('Set-Cookie', `${COOKIE.name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${hosted ? '; Secure' : ''}`);
    const seen = wasReset ? null : result.cookie ? result.sessionId : cookieOf(req);
    res.json({ result: { ...result, tokens: undefined }, lab: l.snapshot({ cookie: seen, secure: hosted }) });
  });
  api.use((_req, res) => res.status(404).json({ error: 'not_found' }));
  app.use('/api', api);
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = Number(err?.status || err?.statusCode);
    if (status === 413) return res.status(413).json({ error: 'payload_too_large' });
    if (status >= 400 && status < 500) return res.status(status).json({ error: 'bad_request' });
    return res.status(500).json({ error: 'internal_error' });
  });

  if (fs.existsSync(path.join(WEB_DIST, 'index.html'))) {
app.get('/api/shelf', (_req, res) => { res.set('Cache-Control', 'no-store'); res.json(shelfInfo()); }); // the header "Shelf" button
    app.use(express.static(WEB_DIST));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(WEB_DIST, 'index.html')));
  }
  return app;
}

export function startHttpServer({ port, host, app = createApp() } = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => resolve({ server, url: `http://${host}:${server.address().port}/` }));
    server.once('error', reject);
  });
}
