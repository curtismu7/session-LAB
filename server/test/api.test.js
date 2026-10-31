import test from 'node:test';
import assert from 'node:assert/strict';
import { withServer, rawHttp } from './helpers.js';
import { createLabs, MAX_WORKSPACES } from '../src/app.js';

// A tiny cookie jar: the lab's IdP reads the real browser cookie, so tests must carry it like a browser does.
let jar = '';
const post = async (base, p, body, ws = 'default', cookie = jar) => {
  const r = await fetch(`${base}/api/lab/${p}?workspace=${ws}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body ?? {}) });
  const set = r.headers.get('set-cookie'); if (set) jar = set.split(';')[0];
  return r;
};

test.beforeEach?.(() => { jar = ''; });
test('health is demo-health/1 and info says simulated', async () => {
  await withServer(async (b) => {
    const h = await (await fetch(`${b}/api/health`)).json();
    assert.equal(h.schema, 'demo-health/1'); assert.equal(h.state, 'ready'); assert.equal(h.demo.id, 'session-lab');
    const i = await (await fetch(`${b}/api/info`)).json();
    assert.deepEqual(i, { mode: 'mock', simulated: true, hosted: false });
  });
});

test('the story over HTTP: sign in, SSO, revoke, re-auth refused, API still 200; the response never repeats raw tokens in `result`', async () => {
  await withServer(async (b) => {
    assert.equal((await post(b, 'sign-in', { methods: ['pwd'] })).status, 200);
    const sso = await (await post(b, 'authorize', { app: 'portal' })).json();
    assert.equal(sso.result.ok, true); assert.equal(sso.result.tokens, undefined);
    assert.ok(sso.lab.apps.find((a) => a.id === 'portal').tokens.access_token); // tokens are shown raw, in the snapshot (rule 4)
    await post(b, 'admin/revoke', { soft: false });
    const again = await post(b, 'authorize', { app: 'portal' });
    assert.equal(again.status, 200); assert.equal((await again.json()).result.error, 'login_required');
    assert.equal((await (await post(b, 'call-api', { app: 'portal' })).json()).result.ok, true);
  });
});

test('workspaces are isolated and reset only touches its own', async () => {
  await withServer(async (b) => {
    await post(b, 'sign-in', {}, 'visitor-a');
    const a = await (await fetch(`${b}/api/lab?workspace=visitor-a`)).json();
    const o = await (await fetch(`${b}/api/lab?workspace=visitor-b`)).json();
    assert.equal(a.sessions.length, 1); assert.equal(o.sessions.length, 0);
    await post(b, 'reset', {}, 'visitor-b');
    assert.equal((await (await fetch(`${b}/api/lab?workspace=visitor-a`)).json()).sessions.length, 1);
    const bad = await (await fetch(`${b}/api/lab?workspace=../../etc`)).json();
    assert.equal(bad.workspace, 'default'); // invalid ids fall back
  });
});

test('hostile input: unknown action, prototype names, non-object and oversize bodies, wrong types', async () => {
  await withServer(async (b) => {
    assert.equal((await post(b, 'nope', {})).status, 404);
    assert.equal((await post(b, 'constructor', {})).status, 404);
    assert.equal((await post(b, '__proto__', {})).status, 404);
    const arr = await fetch(`${b}/api/lab/sign-in`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '[1,2]' });
    assert.equal(arr.status, 200);
    const big = await fetch(`${b}/api/lab/sign-in`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ x: 'a'.repeat(10_000) }) });
    assert.equal(big.status, 413);
    assert.equal((await (await post(b, 'admin/idle-timeout', { seconds: { a: 1 } })).json()).result.ok, false);
    assert.equal((await (await post(b, 'authorize', { app: { $ne: 1 } })).json()).result.ok, false);
    assert.equal((await (await post(b, 'widget/invoke', { method: 'POST', body: 'str' })).json()).result.ok, false);
    const junk = await fetch(`${b}/api/lab/sign-in`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{bad' });
    assert.equal(junk.status, 400);
  });
});

test('loopback Host check and same-origin writes are enforced', async () => {
  await withServer(async (b) => {
    assert.equal((await rawHttp(`${b}/api/lab`, { headers: { Host: 'evil.example' } })).status, 403);
    assert.equal((await rawHttp(`${b}/api/lab/reset`, { method: 'POST', headers: { Origin: 'http://evil.example', 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
    assert.equal((await rawHttp(`${b}/api/lab/reset`, { method: 'POST', headers: { 'Sec-Fetch-Site': 'cross-site', 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
  });
});

test('sign-in sets a real HttpOnly cookie; a hard revoke leaves it in the browser but stale; removing it means SSO fails', async () => {
  jar = '';
  await withServer(async (b) => {
    const r = await fetch(`${b}/api/lab/sign-in`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    const set = r.headers.get('set-cookie');
    assert.match(set, /^mock-ST=mock-sess-[\w-]+; Path=\/; HttpOnly; SameSite=Lax$/);
    const cookie = set.split(';')[0];
    const send = (path, body) => fetch(`${b}/api/lab/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) });
    assert.equal((await send('authorize', { app: 'portal' })).status, 200);
    await send('admin/revoke', { soft: false });
    const snap = await (await fetch(`${b}/api/lab`, { headers: { cookie } })).json();
    assert.equal(snap.cookie.value, cookie.split('=')[1]); assert.equal(snap.cookie.valid, false); // still in the browser, no longer valid
    // no cookie at all (deleted in DevTools): a live session is not recognised
    await fetch(`${b}/api/lab/reset`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    await fetch(`${b}/api/lab/sign-in`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    const none = await fetch(`${b}/api/lab/authorize`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ app: 'portal' }) });
    assert.equal((await none.json()).result.error, 'login_required');
    const noSnap = await (await fetch(`${b}/api/lab`)).json();
    assert.equal(noSnap.cookie, null);
  });
});

test('Reset expires the cookie and the snapshot shows no cookie', async () => {
  jar = '';
  await withServer(async (b) => {
    await post(b, 'sign-in', {});
    const r = await post(b, 'reset', {});
    assert.match(r.headers.get('set-cookie'), /^mock-ST=; Path=\/; Max-Age=0/);
    assert.equal((await r.json()).lab.cookie, null);
  });
});

test('hosted build adds Secure to the cookie', async () => {
  await withServer(async (b) => {
    const r = await fetch(`${b}/api/lab/sign-in`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.match(r.headers.get('set-cookie'), /; Secure$/);
  }, { hosted: true });
});

test('story: three vertical packs fill every {{token}}, unknown vertical falls back, diagram validates', async () => {
  await withServer(async (b) => {
    for (const v of ['airline', 'health', 'bank']) {
      const s = await (await fetch(`${b}/api/story?vertical=${v}`)).json();
      assert.equal(s.vertical, v); assert.equal(JSON.stringify(s.diagram).includes('{{'), false);
      assert.equal(s.diagram.steps.length, 6);
    }
    assert.equal((await (await fetch(`${b}/api/story?vertical=__proto__`)).json()).vertical, 'airline');
  });
});

test('S1: browsing never creates a workspace, eviction is least-recently-used, and a busy visitor survives a flood', () => {
  const labs = createLabs();
  labs.get('victim').signIn();
  labs.peek('never-written'); assert.equal(labs.size(), 1); // a read stores nothing
  for (let i = 0; i < MAX_WORKSPACES + 20; i++) { labs.get(`flood-${i}`); labs.get('victim'); } // the victim stays in use
  assert.equal(labs.size(), MAX_WORKSPACES);
  assert.equal(labs.peek('victim').snapshot().sessions.length, 1);
  assert.equal(labs.peek('flood-0').snapshot().sessions.length, 0); // the idle ones went
});

test('S1 over HTTP: 250 anonymous GETs do not push out a signed-in workspace', async () => {
  jar = '';
  await withServer(async (b) => {
    await post(b, 'sign-in', {}, 'keeper');
    for (let i = 0; i < 250; i++) await fetch(`${b}/api/lab?workspace=f${i}`);
    assert.equal((await (await fetch(`${b}/api/lab?workspace=keeper`)).json()).sessions.length, 1);
  });
});

test('revoke uses the cookie the browser sent, not a server-side guess', async () => {
  jar = '';
  await withServer(async (b) => {
    await post(b, 'sign-in', {}); // sets the cookie
    const noCookie = await (await post(b, 'admin/revoke', {}, 'default', '')).json();
    assert.equal(noCookie.result.error, 'no_session');
    assert.equal(noCookie.lab.sessions.length, 1);
  });
});

test('persona that is a hostile value is refused, never a 500', async () => {
  await withServer(async (b) => {
    for (const persona of ['__proto__', 'constructor', { toString: 1 }]) {
      const r = await post(b, 'sign-in', { persona }); assert.equal(r.status, 200); assert.equal((await r.json()).result.error, 'unknown_persona');
    }
  });
});

test('widget sign-in sets no cookie over HTTP', async () => {
  jar = '';
  await withServer(async (b) => {
    const r = await fetch(`${b}/api/lab/widget/sign-in`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(r.headers.get('set-cookie'), null);
  });
});

test('SE shape: behind the ingress Host rewrite, a write with the public https Origin works only when hosted with the public host set', async () => {
  const send = (b, origin) => rawHttp(`${b}/api/lab/sign-in`, { method: 'POST', headers: { host: '127.0.0.1:6880', origin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' }, body: '{}' });
  const prev = process.env.SESSIONLAB_PUBLIC_HOST;
  try {
    process.env.SESSIONLAB_PUBLIC_HOST = 'lab.se.example';
    await withServer(async (b) => {
      const ok = await send(b, 'https://lab.se.example');
      assert.equal(ok.status, 200, ok.text);
      assert.match(String(ok.headers['set-cookie']), /Secure/);
      assert.equal((await send(b, 'https://evil.example')).status, 403);
    }, { hosted: true });
    await withServer(async (b) => { assert.equal((await send(b, 'https://lab.se.example')).status, 403, 'not hosted: loopback only'); });
    delete process.env.SESSIONLAB_PUBLIC_HOST;
    await withServer(async (b) => { assert.equal((await send(b, 'https://lab.se.example')).status, 403, 'hosted but unset'); }, { hosted: true });
  } finally { if (prev === undefined) delete process.env.SESSIONLAB_PUBLIC_HOST; else process.env.SESSIONLAB_PUBLIC_HOST = prev; }
});

test('flow-reports over HTTP: acts on the cookie\'s session only, hostile bodies are bounded', async () => {
  await withServer(async (b) => {
    jar = '';
    assert.equal((await (await post(b, 'admin/flow-reports', { methods: ['mfa'] }, 'ws-fr')).json()).result.error, 'login_required');
    await post(b, 'sign-in', { methods: ['pwd'] }, 'ws-fr');
    const ok = await (await post(b, 'admin/flow-reports', { methods: ['mfa'] }, 'ws-fr')).json();
    assert.deepEqual(ok.result, { ok: true, moved: ['mfa'] });
    const sess = ok.lab.sessions[0];
    assert.deepEqual(sess.amr.sort(), ['mfa', 'pwd']);
    for (const bad of [{ methods: 'mfa' }, { methods: { 0: 'mfa' } }, { methods: ['__proto__', 7] }, {}]) {
      const r = await post(b, 'admin/flow-reports', bad, 'ws-fr'); assert.equal(r.status, 200);
      assert.deepEqual((await r.json()).result.moved, []);
    }
  });
});
