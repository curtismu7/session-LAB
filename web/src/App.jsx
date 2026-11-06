import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import Canvas from "./Canvas.jsx";
import { AdminPanel, AppCard, CookiePanel, ImpactLog, Sources } from "./panels.jsx";
import { act, getInfo, getLab, getStory, setMode } from "./api.js";
import { edgesForEvent } from "./eventEdges.js";
import { SPEEDS, initial, reduce, speedMs } from "./stepper.js";
import ShelfLink from "./components/ShelfLink.jsx";

const APP_KEY = { portal: "portalApp", banking: "sensitiveApp", widget: "embeddedApp" };
const THEME_KEY = "sess.theme";
const THEMES = [["auto", "Auto"], ["light", "Light"], ["dark", "Dark"]];
function initialTheme() {
  try { const t = localStorage.getItem(THEME_KEY); if (t === "light" || t === "dark") return t; } catch { /* storage blocked */ }
  return "auto";
}

export default function App() {
  const [info, setInfo] = useState({ hosted: false, source: "mock", realAvailable: false, realReason: undefined });
  const [theme, setTheme] = useState(initialTheme);

  // Rule 19: the Mock/Real toggle. This lab is mock only (the server refuses Real with 409 and a reason), so the
  // switch reloads the data after a mock switch and shows the server's reason as Real's disabled tooltip.
  const selectMode = useCallback(async (source) => {
    const r = await setMode(source);
    if (r.status >= 400) { setMsg({ kind: "error", text: r.body?.message || `Could not switch to ${source}.` }); return; }
    if (r.body) setInfo((i) => ({ ...i, ...r.body }));
    getLab().then((x) => setLab(x.body));
  }, []);

  useEffect(() => { if (theme === "auto") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = theme; }, [theme]);

  const pickTheme = (next) => {
    try { if (next === "auto") localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, next); } catch { /* not remembered */ }
    setTheme(next);
  };
  const [vertical, setVertical] = useState("airline");
  const [story, setStory] = useState(null);
  const [lab, setLab] = useState(null);
  const [persona, setPersona] = useState("alex");
  const [msg, setMsg] = useState(null);
  const [present, setPresent] = useState(() => new URLSearchParams(location.search).get("present") === "1");
  const [positions, setPositions] = useState({});
  const [fitKey, setFitKey] = useState(0);
  const total = story?.diagram.steps.length || 0;
  const [st, dispatch] = useReducer(reduce, total, initial);
  const lastRef = useRef(null);

  useEffect(() => { getInfo().then((r) => r.body && setInfo(r.body)); getLab().then((r) => setLab(r.body)); }, []);
  useEffect(() => { getStory(vertical).then((r) => setStory(r.body)); }, [vertical]);
  useEffect(() => { dispatch({ type: "total", total }); }, [total]);
  useEffect(() => {
    if (st.step < 0 || st.paused) return undefined;
    const id = setTimeout(() => dispatch({ type: "tick" }), speedMs(st.speed));
    return () => clearTimeout(id);
  }, [st.step, st.paused, st.speed]);
  useEffect(() => { document.documentElement.dataset.present = present ? "1" : "0"; }, [present]);

  const run = useCallback(async (action, body) => {
    const r = await act(action, body);
    if (r.body?.lab) setLab(r.body.lab);
    setMsg(r.body?.result && r.body.result.ok === false ? { kind: "error", text: `${action}: ${r.body.result.error}${r.body.result.reason ? ` (${r.body.result.reason})` : ""}` } : null);
    if (r.status >= 500 || !r.body) setMsg({ kind: "error", text: "The lab did not answer." });
    dispatch({ type: "stop" }); // a real action takes the diagram back from the walkthrough
  }, []);
  const reset = useCallback(async () => { await run("reset"); setPositions({}); setFitKey((k) => k + 1); setMsg({ kind: "ok", text: "Reset: session, cookie, tokens, policies, clock and box positions are back to the start." }); }, [run]);

  useEffect(() => {
    const onKey = (e) => {
      if (!present || /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
      if (e.key === "ArrowRight") dispatch(st.step < 0 ? { type: "simulate", total } : { type: "next" });
      else if (e.key === "ArrowLeft") dispatch({ type: "prev" });
      else if (e.key === "Escape") setPresent(false);
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [present, st.step, total]);

  const lastEvent = lab?.events.at(-1);
  const steps = story?.diagram.steps || [];
  const hotEdges = useMemo(() => (st.step >= 0 ? steps[st.step]?.edges || [] : edgesForEvent(lastEvent)), [st.step, steps, lastEvent]);
  const onMove = useCallback((id, pos) => setPositions((p) => ({ ...p, [id]: pos })), []);
  if (!lab || !story) return <p className="page">Loading…</p>;
  const step = st.step >= 0 ? steps[st.step] : null;
  const widgetToken = lab.widgetSessionToken?.value;
  const nameOf = (a) => story.cast[APP_KEY[a.id]];

  return (
    <>
      <p className="banner" role="note" data-testid="banner" data-state="mock">
        {info.hosted ? "HOSTED SIMULATION" : "SIMULATION"}: a mock PingOne and DaVinci session. No tenant, no real credentials, nothing leaves this {info.hosted ? "server" : "machine"}. Cookie and token names are labels, not product facts.
      </p>
      <header className="top">
        <h1>PingOne + DaVinci Session Lab</h1>
        <ShelfLink />
        <label>Vertical <select value={vertical} onChange={(e) => setVertical(e.target.value)} aria-label="Vertical">{story.verticals.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}</select></label>
        <span className="banner mode-badge" data-state="mock" data-testid="mode-badge">Mock</span>
        <div className="seg" role="group" aria-label="Mode" data-testid="mode">
          <button type="button" aria-pressed="true" onClick={() => selectMode("mock")} data-testid="mode-mock">Mock</button>
          <button type="button" aria-pressed={info.source === "real"} disabled={info.realAvailable !== true} title={info.realAvailable !== true ? info.realReason : undefined} onClick={() => selectMode("real")} data-testid="mode-real">Real</button>
        </div>
        <button onClick={reset}>Reset</button>
        <label className="shell-theme">Theme
          <select value={theme} onChange={(e) => pickTheme(e.target.value)}>
            {THEMES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </label>
        <button onClick={() => setPresent((p) => !p)} aria-pressed={present}>{present ? "Exit presenter mode" : "Presenter mode"}</button>
      </header>
      <main className="page">
        {msg && <p className={`msg msg--${msg.kind}`} role="status" data-testid="msg">{msg.text}</p>}
        <p className="lede">{story.diagram.lede}</p>
        <div className="bar" role="toolbar" aria-label="Walkthrough controls">
          <button className="primary" onClick={() => dispatch({ type: "simulate", total })}>Simulate</button>
          <button onClick={() => dispatch({ type: st.paused ? "resume" : "pause" })} disabled={st.step < 0}>{st.paused ? "Resume" : "Pause"}</button>
          <button onClick={() => dispatch({ type: "prev" })} disabled={st.step < 0}>Prev</button>
          <button onClick={() => dispatch({ type: "next" })} disabled={st.step < 0}>Next</button>
          <button onClick={() => { dispatch({ type: "stop" }); setPositions({}); setFitKey((k) => k + 1); }}>Reset diagram</button>
          <label>Speed <select value={st.speed} onChange={(e) => dispatch({ type: "speed", speed: e.target.value })} aria-label="Speed">{SPEEDS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
        </div>
        <p className="caption" aria-live="polite" data-testid="caption">
          {step ? `${st.step + 1}/${total} ${step.title}` : lastEvent ? `Last action lit these arrows: ${lastEvent.kind}` : "Press Simulate for the walkthrough, or use the controls below and watch the arrows."}
        </p>
        <Canvas diagram={story.diagram} hotEdges={hotEdges} positions={positions} onMove={onMove} fitKey={fitKey} />
        {step && <div className="step step--active" data-testid="step"><h4>{step.title}</h4><p>{step.what}</p>{step.why && <p className="muted">Why: {step.why}</p>}</div>}
        <div className="cols">
          <div>
            <CookiePanel lab={lab} onSignIn={(methods) => run("sign-in", { persona, methods })} persona={persona} setPersona={setPersona} />
            <section className="panel" aria-labelledby="h-apps">
              <h3 id="h-apps">Apps and the tokens they hold</h3>
              <div className="cards">{lab.apps.map((a) => <AppCard key={a.id} app={a} name={nameOf(a)} run={run} widgetHasToken={widgetToken} persona={persona} />)}</div>
            </section>
          </div>
          <div>
            <AdminPanel lab={lab} run={run} />
            <ImpactLog events={lab.events} />
            <Sources />
            <section className="panel" aria-labelledby="h-talk">
              <h3 id="h-talk">Talk track</h3>
              <ol>{steps.map((s, i) => <li key={s.title}><button className="link" onClick={() => dispatch({ type: "goto", step: i })}>{s.title}</button>: {s.what}</li>)}</ol>
            </section>
          </div>
        </div>
      </main>
    </>
  );
}
