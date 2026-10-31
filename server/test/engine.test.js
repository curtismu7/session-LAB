import test from 'node:test';
import assert from 'node:assert/strict';
import { createLab, decodeJwt, ACCESS_TTL_SEC, COOKIE, DEFAULT_IDLE_SEC } from '../src/engine.js';
import { TRACEPARENT } from '../src/trace.js';

const lab = () => createLab({ now: () => 1_700_000_000_000 });
const app = (s, id) => s.apps.find((a) => a.id === id);

test('sign-in creates one session, one cookie, and records only the methods really completed', () => {
  const l = lab();
  assert.equal(l.signIn({ methods: ['pwd'] }).ok, true);
  const s = l.snapshot();
  assert.equal(s.sessions.length, 1);
  assert.deepEqual(s.sessions[0].amr, ['pwd']);
  assert.equal(s.cookie.httpOnly, true);
  assert.equal(s.cookie.name, COOKIE.name);
  assert.equal(l.signIn({ methods: [] }).error, 'methods_required'); // no methods = no session (write-up: a null method with no session fails)
  assert.equal(l.signIn({ methods: ['bogus', 3, null] }).error, 'methods_required', 'only known labels count')
  assert.equal(l.signIn({ persona: 'nobody' }).error, 'unknown_persona');
});

test('the session, the cookie value and the widget sessionToken are three different values', () => {
  const l = lab(); l.signIn(); l.widgetSignIn();
  const s = l.snapshot();
  assert.notEqual(s.cookie.value, s.widgetSessionToken.value);
  assert.notEqual(s.sessions[0].id, s.widgetSessionToken.value);
});

test('SSO: a second app gets tokens with no prompt while the session is active', () => {
  const l = lab(); l.signIn();
  assert.equal(l.authorize('portal').ok, true);
  assert.equal(app(l.snapshot(), 'portal').lastResult.reason, 'sso');
});

test('hard revoke: apps must re-authenticate, but the access token they already hold still works until it expires', () => {
  const l = lab(); l.signIn(); l.authorize('portal');
  l.revokeSession({ soft: false });
  assert.deepEqual(l.authorize('portal'), { ok: false, error: 'login_required', reason: 'no_session_cookie_match' });
  assert.equal(l.callApi('portal').ok, true); // token is not the session
  l.advanceClock(ACCESS_TTL_SEC);
  assert.equal(l.callApi('portal').error, 'token_expired');
});

test('soft delete signs the user out but keeps the record', () => {
  const l = lab(); l.signIn(); l.revokeSession({ soft: true });
  const s = l.snapshot();
  assert.equal(s.sessions.length, 1);
  assert.equal(s.sessions[0].state, 'signed_out');
  assert.equal(l.authorize('portal').reason, 'signed_out');
});

test('shorter idle timeout expires the session while the access token is still valid; use slides the timeout', () => {
  const l = lab(); l.signIn(); l.authorize('portal');
  assert.equal(l.setIdleTimeout(300).ok, true);
  l.advanceClock(200); assert.equal(l.authorize('portal').ok, true); // touched: window restarts
  l.advanceClock(200); assert.equal(l.authorize('portal').ok, true);
  l.advanceClock(301);
  assert.equal(l.snapshot().sessions[0].state, 'idle_expired');
  assert.equal(l.authorize('portal').reason, 'idle_expired');
  assert.equal(l.callApi('portal').ok, true);
  assert.equal(l.setIdleTimeout(5).error, 'idle_timeout_out_of_range');
  assert.equal(l.setIdleTimeout('abc').error, 'idle_timeout_out_of_range');
});

test('step-up: banking demands mfa within 8h; pwd-only session is bounced, MFA fixes it, age bounces it again', () => {
  const l = lab(); l.signIn({ methods: ['pwd'] });
  assert.equal(l.authorize('portal').ok, true); // portal has no mfa rule
  assert.equal(l.authorize('banking').reason, 'no_mfa_on_session');
  assert.equal(l.completeMfa().ok, true);
  assert.deepEqual(l.snapshot().sessions[0].amr, ['pwd', 'mfa']);
  assert.equal(l.authorize('banking').ok, true);
  l.advanceClock(8 * 3600 + 1);
  assert.equal(l.authorize('banking').reason, 'mfa_too_old');
  assert.equal(l.setMfaPolicy('banking', null).ok, true);
  assert.equal(l.authorize('banking').ok, true); // relaxing the rule lets the same session through
  assert.equal(l.setMfaPolicy('widget', 60).error, 'unknown_redirect_app');
  assert.equal(l.setMfaPolicy('banking', 1).error, 'mfa_window_out_of_range');
});

test('widget: sessionToken must be POSTed in global.sessionToken; GET, missing, wrong or dropped token fail', () => {
  const l = lab(); l.widgetSignIn();
  const tok = l.snapshot().widgetSessionToken.value;
  assert.equal(l.widgetInvoke('GET', { global: { sessionToken: tok } }).error, 'sdk_token_request_must_be_post');
  assert.equal(l.widgetInvoke('POST', {}).reason, 'no_sessionToken_sent');
  assert.equal(l.widgetInvoke('POST', { global: { sessionToken: 'mock-sessiontoken-wrong' } }).error, 'login_required');
  const ok = l.widgetInvoke('POST', { global: { sessionToken: tok } });
  assert.equal(ok.ok, true);
  assert.equal(ok.tokens.sessionToken, tok);
  assert.equal(l.widgetInvoke('POST', null).ok, false); // hostile body does not throw
  l.revokeSession({ cookie: l.snapshot().sessions[0].id });
  assert.equal(l.widgetInvoke('POST', { global: { sessionToken: tok } }).error, 'login_required');
});

test('tokens are labelled mock and decode; the access token lifetime is independent of the session', () => {
  const l = lab(); l.signIn(); const r = l.authorize('portal');
  const c = decodeJwt(r.tokens.access_token);
  assert.equal(c.mock, true);
  assert.equal(c.exp - c.iat, ACCESS_TTL_SEC);
  assert.equal(r.tokens.expires_in, ACCESS_TTL_SEC);
  assert.equal(decodeJwt('garbage'), null);
});

test('refresh works from the refresh token alone (labelled UNVERIFIED in the log)', () => {
  const l = lab(); l.signIn(); l.authorize('portal'); l.revokeSession(); l.advanceClock(ACCESS_TTL_SEC);
  assert.equal(l.callApi('portal').ok, false);
  assert.equal(l.refresh('portal').ok, true);
  assert.equal(l.callApi('portal').ok, true);
  assert.ok(l.snapshot().events.some((e) => e.kind === 'token.refreshed' && /UNVERIFIED/.test(e.detail)));
  assert.equal(l.refresh('banking').error, 'no_refresh_token');
});

test('events carry a valid traceparent, workspaces have separate trace ids, reset wipes everything', () => {
  const a = createLab({ workspace: 'ws-a' }); const b = createLab({ workspace: 'ws-b' });
  a.signIn(); b.signIn();
  const ea = a.snapshot().events[0]; const eb = b.snapshot().events[0];
  assert.match(ea.traceparent, TRACEPARENT);
  assert.notEqual(ea.traceparent.split('-')[1], eb.traceparent.split('-')[1]);
  a.reset();
  const s = a.snapshot();
  assert.equal(s.sessions.length, 0); assert.equal(s.cookie, null); assert.equal(s.events.length, 0);
});

test('advanceClock rejects nonsense and the event log is bounded', () => {
  const l = lab();
  for (const bad of [0, -5, 1.5, 'x', 1e12]) assert.equal(l.advanceClock(bad).ok, false);
  for (let i = 0; i < 500; i++) l.advanceClock(1);
  assert.ok(l.snapshot().events.length <= 200);
});

// --- fixes from the independent review ---
test('boundaries: idle timeout and mfa window are inclusive/exclusive exactly where the guide-style wording says', () => {
  const l = lab(); l.signIn({ methods: ['pwd', 'mfa'] }); l.setIdleTimeout(300);
  l.advanceClock(299); assert.equal(l.snapshot().sessions[0].state, 'active');
  l.advanceClock(1); assert.equal(l.snapshot().sessions[0].state, 'idle_expired'); // at exactly the timeout it is over
  const m = lab(); m.signIn({ methods: ['pwd', 'mfa'] });
  m.advanceClock(8 * 3600); assert.equal(m.authorize('banking').ok, true); // exactly 8h old is still within "8 hours"
  m.advanceClock(1); assert.equal(m.authorize('banking').reason, 'mfa_too_old');
});

test('the default idle timeout is the documented 30 days', () => {
  assert.equal(DEFAULT_IDLE_SEC, 30 * 24 * 3600);
  assert.equal(lab().snapshot().config.idleTimeoutSec, 30 * 24 * 3600);
});

test('S2: an expired session stays expired when the idle timeout is raised', () => {
  const l = lab(); l.signIn(); l.setIdleTimeout(60); l.advanceClock(100);
  assert.equal(l.snapshot().sessions[0].state, 'idle_expired');
  l.setIdleTimeout(86400);
  assert.equal(l.snapshot().sessions[0].state, 'idle_expired');
  assert.equal(l.authorize('portal').reason, 'idle_expired');
  assert.ok(l.snapshot().events.some((e) => e.kind === 'config.idle_timeout' && /UNVERIFIED/.test(e.detail)));
});

test('S3: revoke acts only on the session the cookie names, never on "the last one"', () => {
  const l = lab(); l.signIn({ persona: 'alex' }); const a = l.snapshot().cookie.value; l.signIn({ persona: 'sam' });
  assert.equal(l.revokeSession({ cookie: a }).ok, true);
  const left = l.snapshot().sessions; assert.equal(left.length, 1); assert.equal(left[0].name, 'Sam Okafor');
  assert.equal(l.revokeSession({ cookie: a }).error, 'no_session'); // already gone: must not fall back to Sam
  assert.equal(l.revokeSession({ cookie: null }).error, 'no_session');
  assert.equal(l.snapshot().sessions.length, 1);
});

test('S4: persona must be an own key of the persona table', () => {
  const l = lab();
  for (const bad of ['__proto__', 'constructor', 'toString', { toString: 1 }, ['alex'], 7, null]) assert.equal(l.signIn({ persona: bad }).error, 'unknown_persona', JSON.stringify(bad));
  assert.equal(l.snapshot().sessions.length, 0);
});

test('S5: refresh repeats the original auth_time and amr; it never invents a re-authentication', () => {
  const l = lab(); l.signIn({ methods: ['pwd', 'mfa'] });
  const first = decodeJwt(l.authorize('portal').tokens.id_token);
  l.revokeSession({ cookie: l.snapshot().cookie.value }); l.advanceClock(1800);
  const next = decodeJwt(l.refresh('portal').tokens.id_token);
  assert.equal(next.auth_time, first.auth_time); assert.deepEqual(next.amr, ['pwd', 'mfa']); assert.ok(next.iat > first.iat);
});

test('S6: the session list per workspace is capped', () => {
  const l = lab(); for (let i = 0; i < 120; i++) l.signIn();
  assert.equal(l.snapshot().sessions.length, 50);
});

test('S8: cookie metadata matches what is really sent; secure only on the hosted build', () => {
  const l = lab(); l.signIn();
  assert.equal(l.snapshot().cookie.sameSite, 'Lax'); assert.equal(l.snapshot().cookie.secure, false);
  assert.equal(l.snapshot({ secure: true }).cookie.secure, true);
});

test('S10: a widget flow sign-in returns a sessionToken and does not set the browser cookie', () => {
  const l = lab(); const r = l.widgetSignIn({ persona: 'sam', methods: ['pwd', 'mfa'] });
  assert.equal(r.cookie, false);
  const s = l.snapshot(); assert.equal(s.cookie, null); assert.deepEqual(s.sessions[0].amr, ['pwd', 'mfa']); assert.equal(s.sessions[0].name, 'Sam Okafor');
});

test('numbers must be real numbers, not strings or arrays', () => {
  const l = lab(); l.signIn();
  assert.equal(l.setIdleTimeout([300]).ok, false); assert.equal(l.setIdleTimeout('300').ok, false);
  assert.equal(l.advanceClock('5').ok, false); assert.equal(l.setMfaPolicy('banking', '60').ok, false);
});

// ---- per-method last sign-on, passwordless, and the "flow reports a method that did not happen" mistake (Ping's session write-up) ----
test('each method has its OWN last sign-on: refreshing mfa does not move pwd', () => {
  const l = lab(); l.signIn({ methods: ['pwd', 'mfa'] });
  const rec0 = l.snapshot().sessions[0].record.lastSignOn.withAuthenticator;
  assert.equal(rec0.pwd.at, rec0.mfa.at);
  l.advanceClock(3 * 3600); l.completeMfa();
  const rec1 = l.snapshot().sessions[0].record.lastSignOn.withAuthenticator;
  assert.equal(rec1.pwd.at, rec0.pwd.at, 'pwd stays at the first sign-on');
  assert.notEqual(rec1.mfa.at, rec0.mfa.at, 'mfa moved');
  assert.equal(l.snapshot().sessions[0].record.lastSignOn.at, rec1.mfa.at, 'lastSignOn.at is the latest method time');
});

test('passwordless: a session with fido and pwdless and no pwd is valid; the record never shows pwd', () => {
  const l = lab(); assert.equal(l.signIn({ methods: ['fido', 'pwdless'] }).ok, true);
  const r = l.snapshot().sessions[0];
  assert.deepEqual(r.amr, ['fido', 'pwdless']);
  assert.equal(r.record.lastSignOn.withAuthenticator.pwd, undefined);
  assert.equal(l.authorize('portal').ok, true);
});

test('the session record has the documented shape, with idle in minutes and a sliding expiry', () => {
  const l = lab(); l.signIn({ methods: ['pwd'] }); l.setIdleTimeout(540 * 60);
  const rec = l.snapshot().sessions[0].record;
  assert.equal(rec.idleTimeoutInMinutes, 540);
  for (const k of ['lastSignOn', 'expiresAt', 'createdAt', 'activeAt', 'id', 'user']) assert.ok(k in rec, k);
  const before = rec.expiresAt; l.advanceClock(3600); l.authorize('portal');
  assert.ok(Date.parse(l.snapshot().sessions[0].record.expiresAt) > Date.parse(before), 'use slides the idle expiry');
});

test('STICKY SSO: a flow that reports mfa with no challenge refreshes mfa, so the step-up gate stops firing', () => {
  const l = lab(); l.signIn({ methods: ['pwd', 'mfa'] }); l.advanceClock(9 * 3600);
  assert.equal(l.authorize('banking').reason, 'mfa_too_old', 'honest: 9h old mfa is bounced');
  const r = l.flowReports({ methods: ['mfa'] });
  assert.deepEqual(r, { ok: true, moved: ['mfa'] });
  assert.equal(l.authorize('banking').ok, true, 'the mis-set flow made an old session look freshly MFA-ed');
  assert.ok(l.snapshot().events.some((e) => e.kind === 'session.method_reported' && /NO user challenge/.test(e.detail)));
});

test('a null report (routing flow) moves nothing, and a report cannot create or revive a session', () => {
  const l = lab(); l.signIn({ methods: ['pwd', 'mfa'] }); l.advanceClock(9 * 3600);
  assert.deepEqual(l.flowReports({ methods: [] }), { ok: true, moved: [] });
  assert.equal(l.authorize('banking').reason, 'mfa_too_old', 'nothing moved');
  assert.equal(l.flowReports({ methods: ['bogus'] }).moved.length, 0);
  assert.equal(lab().flowReports({ methods: ['mfa'] }).error, 'login_required', 'no session, no report');
  const e = lab(); e.signIn({ methods: ['pwd'] }); e.advanceClock(31 * 24 * 3600);
  assert.equal(e.flowReports({ methods: ['pwd'] }).error, 'login_required', 'an idle-expired session is not revived by a report');
});

// ---- review fix pass: behaviours the first review's mutants showed were untested ----
const idleLeft = (l) => l.snapshot().sessions[0].idleRemainingSec;
test('completeMfa and a method report both slide the idle window; a null report does not', () => {
  for (const act of [(l) => l.completeMfa(), (l) => l.flowReports({ methods: ['mfa'] })]) {
    const l = lab(); l.signIn({ methods: ['pwd'] }); l.setIdleTimeout(600); l.advanceClock(300);
    assert.equal(idleLeft(l), 300); act(l); assert.equal(idleLeft(l), 600, 'idle pushed out to now + timeout');
  }
  const n = lab(); n.signIn({ methods: ['pwd'] }); n.setIdleTimeout(600); n.advanceClock(300); n.flowReports({ methods: [] });
  assert.equal(idleLeft(n), 300, 'a null report moves nothing, idle included');
});

test('flowReports acts on the cookie\'s session only: an unknown cookie never falls back to another session', () => {
  const l = lab(); l.signIn({ methods: ['pwd'] }); const other = l.snapshot().sessions[0].id; l.signIn({ persona: 'sam', methods: ['pwd'] });
  assert.equal(l.flowReports({ methods: ['mfa'], cookie: 'nope' }).error, 'login_required');
  assert.ok(l.snapshot().sessions.every((s) => !s.amr.includes('mfa')), 'no session was touched');
  assert.equal(l.flowReports({ methods: ['mfa'], cookie: other }).ok, true);
  assert.deepEqual(l.snapshot().sessions.find((s) => s.id === other).amr.sort(), ['mfa', 'pwd']);
});

test('duplicate reported methods are listed once; the id_token carries sid and auth_time follows the latest sign-on', () => {
  const l = lab(); l.signIn({ methods: ['pwd'] });
  assert.deepEqual(l.flowReports({ methods: ['mfa', 'mfa', 'mfa'] }).moved, ['mfa']);
  l.advanceClock(5 * 3600); l.flowReports({ methods: ['mfa'] });
  const idt = decodeJwt(l.authorize('portal').tokens.id_token);
  assert.equal(idt.sid, l.snapshot().sessions[0].id);
  assert.equal(idt.auth_time, Math.floor((Date.parse(l.snapshot().sessions[0].record.lastSignOn.at)) / 1000), 'auth_time = latest sign-on (UNVERIFIED how PingOne sets it)');
});

test('a refresh never invents a method', () => {
  const l = lab(); l.signIn({ methods: ['pwd'] }); l.authorize('portal');
  const t = l.refresh('portal').tokens; assert.deepEqual(decodeJwt(t.id_token).amr, ['pwd']);
});

test('idle timeout is whole minutes, and idleTimeoutInMinutes is exact', () => {
  const l = lab(); l.signIn({ methods: ['pwd'] });
  assert.equal(l.setIdleTimeout(90).error, 'idle_timeout_out_of_range');
  assert.equal(l.setIdleTimeout(120).ok, true);
  assert.equal(l.snapshot().sessions[0].record.idleTimeoutInMinutes, 2);
});

test('all eight reported methods survive the HTTP body cap (none are silently dropped)', async () => {
  const { withServer, rawHttp } = await import('./helpers.js');
  await withServer(async (b) => {
    const body = JSON.stringify({ methods: ['sms', 'otp', 'rba', 'fido', 'pwdless', 'mfa', 'pwd'] });
    const r = await rawHttp(`${b}/api/lab/sign-in?workspace=ws-m`, { method: 'POST', headers: { host: '127.0.0.1', 'content-type': 'application/json' }, body });
    assert.deepEqual(JSON.parse(r.text).lab.sessions[0].amr.sort(), ['fido', 'mfa', 'otp', 'pwd', 'pwdless', 'rba', 'sms']);
  });
});
