import { useEffect, useState } from "react";

const dur = (s) => {
  if (s === null || s === undefined) return "-";
  if (s < 120) return `${s}s`;
  if (s < 7200) return `${Math.round(s / 60)} min`;
  if (s < 172800) return `${(s / 3600).toFixed(1)} h`;
  return `${(s / 86400).toFixed(1)} days`;
};
export { dur };

const STATE_LABEL = { active: "active", idle_expired: "idle timeout passed", signed_out: "signed out (record kept)", deleted: "deleted" };

// What the browser holds vs what page scripts can read. The cookie is HttpOnly, so document.cookie never lists it.
export function CookiePanel({ lab, onSignIn, persona, setPersona }) {
  const [seen, setSeen] = useState("");
  useEffect(() => { try { setSeen(document.cookie); } catch { setSeen("(unavailable)"); } }, [lab]);
  const c = lab.cookie; const s = lab.sessions.at(-1); const w = lab.widgetSessionToken;
  return (
    <section className="panel" aria-labelledby="h-cookie">
      <h3 id="h-cookie">Browser and session</h3>
      <div className="row">
        <label>Sign in as <select value={persona} onChange={(e) => setPersona(e.target.value)} aria-label="Persona">
          <option value="alex">Alex Rivera</option><option value="sam">Sam Okafor</option></select></label>
        <button className="primary" onClick={() => onSignIn(["pwd"])}>Sign in (password only)</button>
        <button onClick={() => onSignIn(["pwd", "mfa"])}>Sign in (password + MFA)</button>
        <button onClick={() => onSignIn(["fido", "pwdless"])}>Sign in (passwordless: fido + pwdless)</button>
      </div>
      <h4>Session cookie the browser holds</h4>
      {c ? (
        <dl className="kv" data-testid="cookie">
          <dt>name</dt><dd><code>{c.name}</code> <span className="muted small">(Ping&apos;s write-up calls the real one the &quot;ST cookie&quot;; this name is a mock label)</span></dd>
          <dt>value</dt><dd><code className="wrap">{c.value}</code></dd>
          <dt>flags</dt><dd>HttpOnly · SameSite={c.sameSite}{c.secure ? " · Secure" : ""} · path {c.path}</dd>
          <dt>status</dt><dd><span className={`pill ${c.valid ? "pill--ok" : "pill--bad"}`} data-testid="cookie-status">{c.valid ? "recognised by PingOne" : "stale: PingOne no longer recognises it"}</span></dd>
        </dl>
      ) : <p className="muted" data-testid="cookie-none">No cookie. PingOne cannot recognise this browser, so every app will ask to sign in.</p>}
      <h4>What this page&apos;s JavaScript can read</h4>
      <p data-testid="docookie"><code>document.cookie</code> = <code>{JSON.stringify(seen)}</code></p>
      <p className="muted small">The cookie is HttpOnly, so scripts never see it; only the browser sends it. To prove it: open DevTools, Application, Cookies, delete <code>mock-ST</code>, then open an app.</p>
      <h4>PingOne session record</h4>
      {s ? (
        <dl className="kv" data-testid="session">
          <dt>state</dt><dd><span className={`pill ${s.state === "active" ? "pill--ok" : "pill--bad"}`}>{STATE_LABEL[s.state]}</span></dd>
          <dt>methods the flow reported</dt><dd><code>{s.amr.join(" ")}</code> <span className="muted small">(labels a flow sets; PingOne does not detect them)</span></dd>
          <dt>mfa last signed on</dt><dd>{s.mfaAgeSec === null ? "never on this session" : `${dur(s.mfaAgeSec)} ago`}</dd>
          <dt>idle timeout</dt><dd>{s.record.idleTimeoutInMinutes} minutes ({dur(s.idleTimeoutSec)}); {s.state === "active" ? `${dur(s.idleRemainingSec)} left, slides with use` : "over"}</dd>
        </dl>
      ) : <p className="muted">No session at PingOne.</p>}
      {s && <details data-testid="session-record"><summary>Session record (mock values, the shape Ping&apos;s write-up shows)</summary><pre>{JSON.stringify({ session: s.record }, null, 2)}</pre>
        <p className="muted small">Check Session reads <code>lastSignOn.withAuthenticator.&lt;method&gt;.at</code> and the idle expiry, not just whether a cookie exists.</p></details>}
      <h4>DaVinci sessionToken (kept by the widget app)</h4>
      {w ? <p data-testid="sessiontoken"><code className="wrap">{w.value}</code> <span className={`pill ${w.valid ? "pill--ok" : "pill--bad"}`}>{w.valid ? "points at a live session" : "points at nothing"}</span></p>
        : <p className="muted" data-testid="sessiontoken-none">The widget app holds no sessionToken.</p>}
      <p className="muted small">Simulated clock: {lab.now}. The cookie is set by this lab on its own origin, not by a PingOne host.</p>
    </section>
  );
}

function Tokens({ tokens }) {
  if (!tokens) return null;
  return (
    <details>
      <summary>Raw tokens (mock, labelled)</summary>
      {["access_token", "id_token"].map((k) => <p key={k}><strong>{k}</strong><br /><code className="wrap">{tokens[k]}</code></p>)}
      <p><strong>refresh_token</strong><br /><code className="wrap">{tokens.refresh_token}</code></p>
      {tokens.sessionToken && <p><strong>sessionToken</strong><br /><code className="wrap">{tokens.sessionToken}</code></p>}
    </details>
  );
}

const OUTCOME = { signed_in: ["pill--ok", "signed in"], login_required: ["pill--bad", "asks to sign in"], step_up_required: ["pill--warn", "asks for MFA"], error: ["pill--bad", "error"] };

export function AppCard({ app, name, run, widgetHasToken, persona }) {
  const r = app.lastResult; const [cls, label] = r ? OUTCOME[r.outcome] || ["", r.outcome] : ["", "not opened yet"];
  const isWidget = app.kind === "widget";
  return (
    <article className="card" data-testid={`app-${app.id}`}>
      <h4>{name}</h4>
      <p><span className={`pill ${cls}`} data-testid={`outcome-${app.id}`}>{label}</span> {r && <span className="muted small">{r.reason}</span>}</p>
      {app.mfaMaxAgeSec !== null && <p className="muted small">Requires mfa within {dur(app.mfaMaxAgeSec)}.</p>}
      <div className="row">
        {!isWidget && <button onClick={() => run("authorize", { app: app.id })}>Open app (SSO)</button>}
        {!isWidget && r?.outcome === "step_up_required" && <button className="primary" onClick={() => run("complete-mfa")}>Complete MFA</button>}
        {isWidget && <button onClick={() => run("widget/sign-in", { persona, methods: ["pwd"] })}>Sign in through the flow</button>}
        {isWidget && <button onClick={() => run("widget/invoke", { method: "POST", body: { global: { sessionToken: widgetHasToken } } })} disabled={false}>Reuse sessionToken (POST)</button>}
        {isWidget && <button onClick={() => run("widget/invoke", { method: "GET", body: { global: { sessionToken: widgetHasToken } } })}>Try as GET</button>}
        {isWidget && <button onClick={() => run("widget/drop-token")}>Forget sessionToken</button>}
        <button onClick={() => run("call-api", { app: app.id })} disabled={!app.tokens}>Call API with its token</button>
        <button onClick={() => run("refresh", { app: app.id })} disabled={!app.tokens}>Refresh token</button>
      </div>
      {app.access ? (
        <p data-testid={`access-${app.id}`}>Access token: <strong>{dur(app.access.remainingSec)}</strong> left. It lapses on its own clock, whatever the session does.</p>
      ) : <p className="muted small">No tokens held.</p>}
      {app.access && <details><summary>Decoded access token</summary><pre>{JSON.stringify(app.access.claims, null, 2)}</pre></details>}
      <Tokens tokens={app.tokens} />
    </article>
  );
}

const ADVANCE = [["+5 min", 300], ["+1 hour", 3600], ["+9 hours", 9 * 3600], ["+1 day", 86400], ["+31 days", 31 * 86400]];
export function AdminPanel({ lab, run }) {
  const [idle, setIdle] = useState("5");
  const banking = lab.apps.find((a) => a.id === "banking");
  return (
    <section className="panel" aria-labelledby="h-admin">
      <h3 id="h-admin">Admin changes</h3>
      <h4>End the session</h4>
      <div className="row">
        <button onClick={() => run("admin/revoke", { soft: false })}>Delete session</button>
        <button onClick={() => run("admin/revoke", { soft: true })}>Soft delete (sign out, keep record)</button>
      </div>
      <h4>Idle timeout (now {dur(lab.config.idleTimeoutSec)})</h4>
      <div className="row">
        {[["5 min", 300], ["1 hour", 3600], ["30 days (default)", 30 * 86400]].map(([l, s]) => <button key={s} onClick={() => run("admin/idle-timeout", { seconds: s })}>{l}</button>)}
        <label>minutes <input type="number" min="1" step="1" value={idle} onChange={(e) => setIdle(e.target.value)} aria-label="Idle timeout minutes" style={{ width: "7rem" }} /></label>
        <button onClick={() => run("admin/idle-timeout", { seconds: Number(idle) * 60 })}>Set</button>
      </div>
      <h4>Payments app: mfa required within ({banking.mfaMaxAgeSec === null ? "no rule" : dur(banking.mfaMaxAgeSec)})</h4>
      <div className="row">
        <button onClick={() => run("admin/mfa-policy", { app: "banking", seconds: null })}>No rule</button>
        <button onClick={() => run("admin/mfa-policy", { app: "banking", seconds: 8 * 3600 })}>8 hours</button>
        <button onClick={() => run("admin/mfa-policy", { app: "banking", seconds: 60 })}>1 minute</button>
      </div>
      <h4>A flow reports a method that did not happen</h4>
      <div className="row">
        <button onClick={() => run("admin/flow-reports", { methods: ["mfa"] })}>Report mfa with no challenge (the mistake)</button>
        <button onClick={() => run("admin/flow-reports", { methods: [] })}>Report no methods (correct for a routing flow)</button>
      </div>
      <p className="muted small">Ping&apos;s write-up: a flow that always sends <code>mfa</code> on Return Success Response moves that method&apos;s last sign-on to now with no login, so Check Session keeps passing (&quot;sticky SSO&quot;). Try it: sign in with MFA, move the clock +9 hours, open the payments app (bounced), report mfa, open it again.</p>
      <h4>Move the simulated clock</h4>
      <div className="row">{ADVANCE.map(([l, s]) => <button key={s} onClick={() => run("admin/advance-clock", { seconds: s })}>{l}</button>)}</div>
      <p className="muted small">Nothing waits in real time: the lab&apos;s own clock jumps. The session and each token run on separate clocks. The cookie here is a session cookie with no expiry of its own; it is only how the browser presents the session.</p>
    </section>
  );
}

export function ImpactLog({ events }) {
  return (
    <section className="panel" aria-labelledby="h-log">
      <h3 id="h-log">Impact log</h3>
      {events.length === 0 && <p className="muted">Nothing yet. Sign in, open an app, then change the session.</p>}
      <ol className="log" data-testid="log">
        {[...events].reverse().map((e) => (
          <li key={e.n}>
            <strong>{e.kind}</strong> <span className="muted">({e.actor})</span>: {e.detail}
            <details><summary className="small">raw</summary><pre>{`${e.at}\ntraceparent: ${e.traceparent}\n${JSON.stringify(e, null, 2)}`}</pre></details>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function Sources() {
  return (
    <section className="panel" aria-labelledby="h-src">
      <h3 id="h-src">What is sourced and what is a lab choice</h3>
      <p className="small"><strong>From Ping&apos;s docs</strong> (<a href="https://docs.pingidentity.com/connectors/p1_authentication_connector.html" target="_blank" rel="noreferrer">PingOne Authentication connector</a>, <a href="https://docs.pingidentity.com/pingone/applications/p1_edit_application_oidc.html" target="_blank" rel="noreferrer">Editing an application, OIDC</a>): one PingOne user authentication session; Return Success Response (redirect and widget) creates it; Authentication Methods are values the flow sets (pwd by default, mfa, otp, sms, rba, custom); Check Session requires one method signed on within a window; Delete Session signs out and, with Soft Delete, keeps the record; the default idle timeout is 30 days and a shorter one is set on the Return Success Response node; OIDC session management (<code>session_state</code>) needs a custom domain and works only between apps in the same browsing mode; <code>/idpSignoff</code> can end a session from the ID token alone.</p>
      <p className="small"><strong>From the owner-supplied guide and write-up:</strong> the session, cookie, sessionToken, SDK token and OIDC tokens are separate; a widget reuses the session by POSTing <code>global.sessionToken</code>; each method keeps its own last sign-on time and the idle window slides on every Return Success Response; reporting a method that did not happen makes SSO sticky; a null method with no existing session cannot create the cookie.</p>
      <p className="small"><strong>Lab choices (UNVERIFIED as product behaviour):</strong> cookie flags, host and token names; the 8-hour payments rule (a policy window the admin sets); the 60 s to 30 day limits on the controls; an idle-timeout change also applying to a live session; whether a refresh token is bound to the session (the OIDC app page gives refresh durations only: 30 days, 180 days rolling); the idle window also sliding on SSO through an app; and redirect apps receiving tokens directly (a real redirect flow returns a code through the browser).</p>
    </section>
  );
}
