// The mock PingOne session + DaVinci widget. Pure and in memory, one Lab per workspace, an injectable clock so idle timeouts and
// mfa recency can be shown without waiting. Everything here is a SIMULATION of the model in Ping's "How sessions work in PingOne and
// DaVinci" guide; where the guide is silent the behaviour is marked UNVERIFIED in `notes`, never stated as product fact.
import crypto from 'node:crypto';

export const COOKIE = { name: 'mock-ST', domain: 'auth.mock.invalid', path: '/', httpOnly: true, sameSite: 'Lax' }; // `secure` is added per build (hosted = true). Ping's session write-up calls the real one the "ST cookie"; the flags, host and value here are mock labels
export const DEFAULT_IDLE_SEC = 30 * 24 * 3600; // guide: PingOne's documented default idle timeout is 30 days
export const ACCESS_TTL_SEC = 3600;
const MOCK_KEY = 'mock-token-key-not-a-secret';
const MAX_EVENTS = 200;
// Authentication Methods the lab accepts: the connector's own values plus the custom ones its write-up uses (fido, pwdless). They are LABELS a flow
// sets; PingOne does not detect them.
export const METHODS = Object.freeze(['pwd', 'mfa', 'otp', 'sms', 'rba', 'fido', 'pwdless']);
const MAX_SESSIONS = 50; // per workspace: the oldest go first, so a loop of sign-ins cannot grow the world without bound

export const PERSONAS = Object.freeze({
  alex: { sub: 'user-alex', name: 'Alex Rivera' },
  sam: { sub: 'user-sam', name: 'Sam Okafor' },
});

export const APPS = Object.freeze({
  portal: { id: 'portal', name: 'Member portal', kind: 'redirect', mfaMaxAgeSec: null },
  banking: { id: 'banking', name: 'Payments app', kind: 'redirect', mfaMaxAgeSec: 8 * 3600 }, // a policy window the admin sets; Ping's write-up uses 8 or 9 hours (Check Session's field is "Last Sign On Was Within")
  widget: { id: 'widget', name: 'Embedded DaVinci widget', kind: 'widget', mfaMaxAgeSec: null },
});

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const rid = (prefix) => `${prefix}${crypto.randomBytes(9).toString('base64url')}`;
// Mock JWT, HS256 with a published mock key, `mock: true` in the claims: it is labelled and can never pass for a real token.
export function mockJwt(claims) {
  const head = b64({ alg: 'HS256', typ: 'JWT', mock: true });
  const body = b64({ ...claims, mock: true });
  const sig = crypto.createHmac('sha256', MOCK_KEY).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}
export function decodeJwt(token) {
  try { return JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8')); } catch { return null; }
}
function verifyJwt(token) {
  const [h, p, s] = String(token).split('.');
  if (!h || !p || !s) return false;
  const want = crypto.createHmac('sha256', MOCK_KEY).update(`${h}.${p}`).digest('base64url');
  return want.length === s.length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(s));
}

export function createLab({ now = () => Date.now(), workspace = 'default' } = {}) {
  let skewMs; let seq; let events; let sessions; let jar; let apps; let config; let appPolicy;
  const t = () => now() + skewMs;
  const sec = (ms) => Math.floor(ms / 1000);

  function reset() {
    skewMs = 0; seq = 0; events = []; sessions = new Map();
    jar = { sessionCookie: null, sessionToken: null }; // what the BROWSER holds (cookie) and what the APP holds (widget sessionToken)
    config = { idleTimeoutSec: DEFAULT_IDLE_SEC };
    appPolicy = Object.fromEntries(Object.values(APPS).map((a) => [a.id, { mfaMaxAgeSec: a.mfaMaxAgeSec }]));
    apps = Object.fromEntries(Object.values(APPS).map((a) => [a.id, { tokens: null, lastResult: null }]));
  }
  reset();

  const traceId = () => crypto.createHash('sha256').update(`${workspace}:trace`).digest('hex').slice(0, 32);
  function log(kind, actor, detail, extra = {}) {
    const n = seq++;
    const span = crypto.createHash('sha256').update(`${workspace}:span:${n}`).digest('hex').slice(0, 16);
    const ev = { n, at: new Date(t()).toISOString(), kind, actor, detail, traceparent: `00-${traceId()}-${span}-01`, ...extra };
    events.push(ev); if (events.length > MAX_EVENTS) events.shift();
    return ev;
  }

  // The state of one PingOne session, computed from the clock: the idle timeout slides with use (guide: "idle timeout").
  function stateOf(s) {
    if (s.deleted) return 'deleted';
    if (s.signedOut) return 'signed_out';
    if (s.expired || sec(t() - s.lastActiveAt) >= s.idleTimeoutSec) return 'idle_expired';
    return 'active';
  }
  const bySession = (id) => (id ? sessions.get(id) : undefined);
  const byToken = (tok) => (tok ? [...sessions.values()].find((s) => s.sessionToken === tok) : undefined);

  function issueTokens(app, s) {
    const iat = sec(t());
    const base = { iss: 'https://auth.mock.invalid/mock-env/as', sub: s.sub, aud: app.id, iat };
    return {
      access_token: mockJwt({ ...base, exp: iat + ACCESS_TTL_SEC, scope: 'openid profile' }),
      id_token: mockJwt({ ...base, exp: iat + ACCESS_TTL_SEC, amr: Object.keys(s.authenticators), auth_time: sec(s.authTime ?? Math.max(...Object.values(s.authenticators))), sid: s.id }),
      refresh_token: rid('mock-rt-'),
      expires_in: ACCESS_TTL_SEC,
      issuedAt: iat,
    };
  }

  // Sign in at the IdP (a DaVinci flow ending in Return Success Response): creates the PingOne session. `methods` is what the flow
  // reports it really performed; each gets its OWN last-sign-on time (lastSignOn.withAuthenticator). The platform never detects a
  // method, so the lab never invents one. No methods = no session (Ping's write-up: a null method with no existing session fails).
  function signIn({ persona = 'alex', methods = ['pwd'], setCookie = true } = {}) {
    const p = typeof persona === 'string' && Object.hasOwn(PERSONAS, persona) ? PERSONAS[persona] : undefined;
    if (!p) return { ok: false, error: 'unknown_persona' };
    const list = [...new Set((Array.isArray(methods) ? methods : []).filter((m) => METHODS.includes(m)))];
    if (!list.length) return { ok: false, error: 'methods_required' };
    const n = t();
    const s = { id: rid('mock-sess-'), sessionToken: rid('mock-sessiontoken-'), sub: p.sub, name: p.name, authenticators: Object.fromEntries(list.map((m) => [m, n])), createdAt: n, lastActiveAt: n, idleTimeoutSec: config.idleTimeoutSec, signedOut: false, deleted: false };
    sessions.set(s.id, s);
    while (sessions.size > MAX_SESSIONS) sessions.delete(sessions.keys().next().value);
    if (setCookie) jar.sessionCookie = s.id; // Set-Cookie on the IdP host (a widget flow returns a sessionToken instead: the write-up does not say it sets a cookie)
    log('session.created', 'idp', `PingOne session created for ${p.name}; authenticators=[${list}]; idle timeout ${s.idleTimeoutSec}s`, { sessionId: s.id });
    return { ok: true, sessionId: s.id, cookie: setCookie };
  }

  // An application sends the browser to the IdP. The IdP reads the session COOKIE (redirect apps) and decides.
  function authorize(appId, { cookie = jar.sessionCookie } = {}) {
    const app = APPS[appId];
    if (!app || app.kind !== 'redirect') return { ok: false, error: 'unknown_redirect_app' };
    const s = bySession(cookie);
    const st = s ? stateOf(s) : 'none';
    if (st !== 'active') {
      apps[appId].lastResult = { outcome: 'login_required', reason: st === 'none' ? 'no_session_cookie_match' : st };
      log('authorize.login_required', appId, `${app.name}: no usable session (${apps[appId].lastResult.reason}) → the user must sign in again`, { app: appId });
      return { ok: false, error: 'login_required', reason: apps[appId].lastResult.reason };
    }
    const need = appPolicy[appId].mfaMaxAgeSec;
    const mfaAt = s.authenticators.mfa;
    if (need !== null && (!mfaAt || sec(t() - mfaAt) > need)) {
      const reason = mfaAt ? 'mfa_too_old' : 'no_mfa_on_session';
      apps[appId].lastResult = { outcome: 'step_up_required', reason };
      log('authorize.step_up_required', appId, `${app.name}: Check Session needs mfa signed on within ${need}s (that method's own last sign-on) → ${reason}; MFA challenge required`, { app: appId });
      return { ok: false, error: 'step_up_required', reason };
    }
    s.lastActiveAt = t();
    apps[appId].tokens = issueTokens(app, s);
    apps[appId].lastResult = { outcome: 'signed_in', reason: 'sso' };
    log('authorize.sso', appId, `${app.name}: SSO from the existing session, tokens issued (access token ${ACCESS_TTL_SEC}s)`, { app: appId, sessionId: s.id });
    return { ok: true, tokens: apps[appId].tokens };
  }

  // The user completes the MFA challenge for the current session (step-up). Records `mfa` because MFA was really performed.
  function completeMfa({ cookie = jar.sessionCookie } = {}) {
    const s = bySession(cookie);
    if (!s || stateOf(s) !== 'active') return { ok: false, error: 'login_required' };
    s.authenticators.mfa = t(); s.lastActiveAt = t();
    log('session.mfa_recorded', 'idp', `MFA really performed: mfa last sign-on = now; authenticators=[${Object.keys(s.authenticators)}]`, { sessionId: s.id });
    return { ok: true };
  }

  // A flow ends in Return Success Response and REPORTS methods for the session in the cookie, whether or not it ran them. This is the
  // write-up's "biggest mistake": a flow that always sends `mfa` moves that method's last sign-on to now with no challenge, so Check
  // Session keeps passing. `methods: []` is the correct answer for a routing flow that authenticated nobody: nothing moves.
  function flowReports({ methods = [], cookie = jar.sessionCookie } = {}) {
    const s = bySession(cookie);
    if (!s || stateOf(s) !== 'active') return { ok: false, error: 'login_required' };
    const list = [...new Set((Array.isArray(methods) ? methods : []).filter((m) => METHODS.includes(m)))];
    if (!list.length) {
      log('session.report_null', 'idp', 'Return Success Response reported no methods: no last sign-on moved (correct for a flow that authenticated nobody)', { sessionId: s.id });
      return { ok: true, moved: [] };
    }
    for (const m of list) s.authenticators[m] = t();
    s.lastActiveAt = t();
    log('session.method_reported', 'idp', `Return Success Response reported [${list}] with NO user challenge: last sign-on for ${list.join(', ')} = now, idle window pushed out. Check Session now sees a "recent login" that never happened`, { sessionId: s.id });
    return { ok: true, moved: list };
  }

  // DaVinci widget: the SDK-token request must be a POST with the existing reference in global.sessionToken (guide, "Widget-specific session handoff").
  function widgetInvoke(method, body = {}) {
    const wid = APPS.widget;
    if (String(method).toUpperCase() !== 'POST') {
      apps.widget.lastResult = { outcome: 'error', reason: 'sdk_token_request_must_be_post' };
      log('widget.rejected', 'widget', 'SDK-token request was not a POST, so the session reference in the body cannot be sent', { app: 'widget' });
      return { ok: false, error: 'sdk_token_request_must_be_post' };
    }
    const ref = body?.global?.sessionToken;
    const s = byToken(ref);
    const st = s ? stateOf(s) : 'none';
    if (st === 'active') {
      s.lastActiveAt = t();
      const tokens = issueTokens(wid, s);
      apps.widget.tokens = { ...tokens, sessionToken: s.sessionToken };
      jar.sessionToken = s.sessionToken;
      apps.widget.lastResult = { outcome: 'signed_in', reason: 'sessionToken_reused' };
      log('widget.sso', 'widget', 'flow checked the PingOne session via global.sessionToken: no prompt, tokens returned with the same sessionToken', { app: 'widget', sessionId: s.id });
      return { ok: true, tokens: apps.widget.tokens, sdkToken: rid('mock-sdk-') };
    }
    apps.widget.lastResult = { outcome: 'login_required', reason: ref ? st : 'no_sessionToken_sent' };
    log('widget.login_required', 'widget', `no usable session (${apps.widget.lastResult.reason}): the flow shows its sign-in form`, { app: 'widget' });
    return { ok: false, error: 'login_required', reason: apps.widget.lastResult.reason };
  }
  // The widget app "signs in" through the flow (a fresh session) and keeps the returned sessionToken for next time.
  function widgetSignIn(opts) {
    const r = signIn({ ...opts, setCookie: false }); if (!r.ok) return r;
    const s = sessions.get(r.sessionId);
    jar.sessionToken = s.sessionToken;
    apps.widget.tokens = { ...issueTokens(APPS.widget, s), sessionToken: s.sessionToken };
    apps.widget.lastResult = { outcome: 'signed_in', reason: 'flow_sign_in' };
    log('widget.sign_in', 'widget', 'flow authenticated the user: tokens plus sessionToken returned; the app stores the sessionToken', { app: 'widget', sessionId: s.id });
    return { ok: true, sessionId: s.id, cookie: false };
  }
  const dropSessionToken = () => { jar.sessionToken = null; log('widget.token_dropped', 'widget', 'the app forgot the sessionToken (the PingOne session is untouched)'); return { ok: true }; };

  // An API call with the access token the app already holds. The resource server checks signature and expiry only: the
  // token is not the session, so ending the session does not recall it.
  function callApi(appId) {
    const tok = apps[appId]?.tokens?.access_token;
    if (!tok) return { ok: false, error: 'no_token' };
    const c = decodeJwt(tok);
    if (!verifyJwt(tok) || !c) return { ok: false, error: 'bad_token' };
    if (sec(t()) >= c.exp) { log('api.401', appId, 'access token expired', { app: appId }); return { ok: false, error: 'token_expired' }; }
    log('api.200', appId, `API accepted the access token (${c.exp - sec(t())}s left), whatever the session state`, { app: appId });
    return { ok: true, remainingSec: c.exp - sec(t()) };
  }
  // A refresh token is its own credential (guide). UNVERIFIED: whether PingOne also ties it to the session depends on the app's configuration.
  function refresh(appId) {
    const a = apps[appId]; if (!a?.tokens?.refresh_token) return { ok: false, error: 'no_refresh_token' };
    // The new tokens repeat what the user actually did at sign-in (sub, amr, auth_time): a refresh is not a re-authentication.
    const old = decodeJwt(a.tokens.id_token) || {};
    a.tokens = { ...issueTokens(APPS[appId], { sub: old.sub, amr: old.amr || [], authenticators: Object.fromEntries((old.amr || []).map((m) => [m, 0])), authTime: (old.auth_time || 0) * 1000, id: old.sid }), refresh_token: a.tokens.refresh_token, ...(a.tokens.sessionToken ? { sessionToken: a.tokens.sessionToken } : {}) };
    log('token.refreshed', appId, 'new access token from the refresh token alone; the session was not consulted (UNVERIFIED for apps that bind refresh to the session)', { app: appId });
    return { ok: true, tokens: a.tokens };
  }

  // ADMIN CHANGES
  function revokeSession({ soft = false, cookie = jar.sessionCookie } = {}) {
    const s = bySession(cookie);
    if (!s) return { ok: false, error: 'no_session' };
    if (soft) { s.signedOut = true; log('session.soft_deleted', 'admin', 'Delete Session with Soft Delete: user signed out, session record kept', { sessionId: s.id }); }
    else { s.deleted = true; sessions.delete(s.id); log('session.deleted', 'admin', 'Delete Session: user signed out and the PingOne session deleted', { sessionId: s.id }); }
    return { ok: true, soft };
  }
  function setIdleTimeout(seconds) {
    const n = seconds;
    if (!Number.isInteger(n) || n < 60 || n > DEFAULT_IDLE_SEC || n % 60 !== 0) return { ok: false, error: 'idle_timeout_out_of_range' }; // whole minutes: the Idle Timeout field is in minutes
    config.idleTimeoutSec = n;
    // A session that already timed out stays timed out: changing the setting cannot revive it.
    for (const s of sessions.values()) { if (stateOf(s) === 'idle_expired') s.expired = true; else s.idleTimeoutSec = n; }
    log('config.idle_timeout', 'admin', `idle timeout set to ${n}s. Lab choice: it also applies to live sessions so the effect is visible; the guide sets it on the success path, so for an existing PingOne session that is UNVERIFIED`);
    return { ok: true, idleTimeoutSec: n };
  }
  function setMfaPolicy(appId, seconds) {
    if (!APPS[appId] || APPS[appId].kind !== 'redirect') return { ok: false, error: 'unknown_redirect_app' };
    const n = seconds === null ? null : seconds;
    if (n !== null && (!Number.isInteger(n) || n < 60 || n > 30 * 24 * 3600)) return { ok: false, error: 'mfa_window_out_of_range' };
    appPolicy[appId].mfaMaxAgeSec = n;
    log('config.mfa_policy', 'admin', `${APPS[appId].name}: ${n === null ? 'no mfa requirement' : `mfa required, signed on within ${n}s`}`, { app: appId });
    return { ok: true };
  }
  function advanceClock(seconds) {
    const n = seconds;
    if (!Number.isInteger(n) || n < 1 || n > 90 * 24 * 3600) return { ok: false, error: 'advance_out_of_range' };
    skewMs += n * 1000;
    log('clock.advanced', 'lab', `simulated clock +${n}s (nothing in the real world waited)`);
    return { ok: true };
  }

  function snapshot({ cookie: seen, secure = false } = {}) {
    const browserCookie = seen === undefined ? jar.sessionCookie : seen; // what the browser actually sent, when the caller knows
    const list = [...sessions.values()].map((s) => {
      const state = stateOf(s);
      const last = Math.max(...Object.values(s.authenticators));
      const iso = (ms) => new Date(ms).toISOString();
      return {
        id: s.id, sub: s.sub, name: s.name, amr: Object.keys(s.authenticators), state, idleTimeoutSec: s.idleTimeoutSec,
        idleRemainingSec: state === 'active' ? Math.max(0, s.idleTimeoutSec - sec(t() - s.lastActiveAt)) : 0,
        mfaAgeSec: s.authenticators.mfa ? sec(t() - s.authenticators.mfa) : null, createdAt: iso(s.createdAt),
        // The shape Ping's write-up shows for a session (mock values): per-method last sign-on, a sliding idle window.
        record: {
          idleTimeoutInMinutes: s.idleTimeoutSec / 60,
          lastSignOn: { at: iso(last), authenticators: Object.keys(s.authenticators), withAuthenticator: Object.fromEntries(Object.entries(s.authenticators).map(([m, at]) => [m, { at: iso(at) }])) },
          expiresAt: iso(s.lastActiveAt + s.idleTimeoutSec * 1000), createdAt: iso(s.createdAt), activeAt: iso(s.lastActiveAt), id: s.id, user: { id: s.sub },
        },
      };
    });
    const cookieSession = bySession(browserCookie);
    return {
      workspace, now: new Date(t()).toISOString(), simulated: true,
      config: { ...config, accessTtlSec: ACCESS_TTL_SEC },
      cookie: browserCookie ? { ...COOKIE, secure, value: browserCookie, valid: !!cookieSession && stateOf(cookieSession) === 'active' } : null,
      widgetSessionToken: jar.sessionToken ? { value: jar.sessionToken, valid: !!byToken(jar.sessionToken) && stateOf(byToken(jar.sessionToken)) === 'active' } : null,
      sessions: list,
      apps: Object.values(APPS).map((a) => {
        const tk = apps[a.id].tokens; const acc = tk && decodeJwt(tk.access_token);
        return { id: a.id, name: a.name, kind: a.kind, mfaMaxAgeSec: appPolicy[a.id].mfaMaxAgeSec, lastResult: apps[a.id].lastResult,
          tokens: tk, access: acc ? { claims: acc, remainingSec: Math.max(0, acc.exp - sec(t())) } : null };
      }),
      events: [...events],
      notes: [
        'auth_time here is the latest method sign-on and amr lists every method on the session however old; how PingOne sets auth_time and amr on SSO is UNVERIFIED. Each sign-in here creates a new session; whether a real second sign-in reuses the first is UNVERIFIED.',
        'Ping\'s session write-up calls the real cookie the "ST cookie"; its flags, host and value here are mock labels. Methods (pwd, mfa, fido, ...) are labels a flow sets; PingOne does not detect them.',
        'Idle timeout (minutes, default 30 days, set on the Return Success Response node), per-method last sign-on and sessionToken behaviour follow Ping\'s docs and session write-ups; whether a refresh token is bound to the session is UNVERIFIED (the OIDC app page gives refresh durations only).',
      ],
    };
  }

  return { signIn, authorize, completeMfa, flowReports, widgetInvoke, widgetSignIn, dropSessionToken, callApi, refresh, revokeSession, setIdleTimeout, setMfaPolicy, advanceClock, snapshot, reset };
}
