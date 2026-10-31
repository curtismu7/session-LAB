import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App.jsx";
import { toFlow } from "./Canvas.jsx";
import { edgesForEvent } from "./eventEdges.js";
import { SPEEDS, initial, reduce } from "./stepper.js";
import { createLab } from "../../server/src/engine.js";
import { fill } from "../../server/src/story.js";
import { VERTICALS, verticalFrom } from "../../server/src/verticals.js";
import fs from "node:fs";
import path from "node:path";

// Same as the server's buildStory, but the diagram file is read from the repo root (vitest's import.meta.url is not a file URL).
const RAW = fs.readFileSync(path.resolve(process.cwd(), "../server/diagrams/session-lab-flow.json"), "utf8");
function buildStory(vertical) {
  const v = verticalFrom(vertical);
  return { vertical: v, verticals: Object.entries(VERTICALS).map(([id, x]) => ({ id, label: x.label })), cast: VERTICALS[v].cast, diagram: JSON.parse(fill(RAW, VERTICALS[v].cast)) };
}

// The real engine and story behind a fake fetch, so the UI is tested against real snapshots.
let lab;
const calls = [];
beforeEach(() => {
  lab = createLab({ workspace: "t" }); calls.length = 0;
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const u = String(url); calls.push([u, init.method || "GET"]);
    const ok = (body, status = 200) => ({ status, json: async () => body });
    if (u.startsWith("/api/info")) return ok({ mode: "mock", simulated: true, hosted: false });
    if (u.startsWith("/api/story")) return ok(buildStory(new URL(u, "http://x").searchParams.get("vertical")));
    if (u === "/api/lab") return ok(lab.snapshot());
    const action = u.replace("/api/lab/", ""); const b = JSON.parse(init.body || "{}");
    const r = action === "sign-in" ? lab.signIn(b) : action === "reset" ? (lab.reset(), { ok: true }) : action === "authorize" ? lab.authorize(b.app) : { ok: true };
    return ok({ result: { ...r, tokens: undefined }, lab: lab.snapshot() }, 200);
  });
});

describe("pure parts", () => {
  it("every arrow an event lights exists in the diagram", () => {
    const n = buildStory("airline").diagram.edges.length;
    const kinds = ["session.created", "authorize.sso", "authorize.step_up_required", "widget.sso", "api.200", "session.deleted", "config.idle_timeout"];
    for (const k of kinds) for (const i of edgesForEvent({ kind: k })) expect(i).toBeLessThan(n);
    expect(edgesForEvent({ kind: "unknown" })).toEqual([]);
    expect(edgesForEvent(undefined)).toEqual([]);
  });
  it("toFlow highlights the boxes on hot arrows and honours dragged positions", () => {
    const d = buildStory("bank").diagram;
    const { nodes, edges } = toFlow(d, [0], { browser: { x: 5, y: 6 } });
    expect(edges[0].animated).toBe(true); expect(edges[1].animated).toBe(false);
    expect(nodes.find((x) => x.id === "browser").position).toEqual({ x: 5, y: 6 });
    expect(nodes.find((x) => x.id === "idp").data.hot).toBe(true);
    expect(nodes.find((x) => x.id === "api").data.hot).toBe(false);
  });
  it("the stepper has simulate, pause, resume, prev, next, reset and three speeds", () => {
    let s = initial(6);
    s = reduce(s, { type: "simulate" }); expect(s.step).toBe(0);
    s = reduce(s, { type: "next" }); expect(s.step).toBe(1);
    s = reduce(s, { type: "pause" }); expect(s.paused).toBe(true);
    s = reduce(s, { type: "stop" }); expect(s.step).toBe(-1);
    expect(SPEEDS.map((x) => x.id)).toEqual(["slow", "normal", "fast"]);
  });
});

describe("App", () => {
  it("shows the simulation banner, the diagram boxes and no cookie before sign-in", async () => {
    render(<App />);
    expect(await screen.findByTestId("banner")).toHaveTextContent(/SIMULATION/);
    expect(screen.getByTestId("banner")).toHaveAttribute("data-state", "mock");
    expect(screen.getByTestId("mode-badge")).toHaveTextContent("Mock");
    expect(screen.getByTestId("mode-badge")).toHaveAttribute("data-state", "mock");
    expect(screen.getByTestId("node-idp")).toBeInTheDocument();
    expect(screen.getByTestId("cookie-none")).toBeInTheDocument();
    expect(screen.getByTestId("docookie")).toHaveTextContent('document.cookie = ""');
  });
  it("sign in then open an app: the cookie shows, the app is signed in and the log records it", async () => {
    render(<App />); const user = userEvent.setup();
    await user.click(await screen.findByText("Sign in (password only)"));
    await waitFor(() => expect(screen.getByTestId("cookie")).toHaveTextContent("mock-ST"));
    expect(screen.getByTestId("cookie-status")).toHaveTextContent("recognised");
    await user.click(within(screen.getByTestId("app-portal")).getByText("Open app (SSO)"));
    await waitFor(() => expect(screen.getByTestId("outcome-portal")).toHaveTextContent("signed in"));
    expect(screen.getByTestId("log")).toHaveTextContent("authorize.sso");
    expect(screen.getByTestId("caption")).toHaveTextContent("authorize.sso");
  });
  it("switching vertical renames the apps; Reset posts to the API and clears the cookie", async () => {
    render(<App />); const user = userEvent.setup();
    await screen.findByText("Miles portal", { selector: "h4" });
    await user.selectOptions(screen.getByLabelText("Vertical"), "bank");
    await screen.findByText("Online banking", { selector: "h4" });
    await user.click(screen.getByText("Sign in (password only)"));
    await screen.findByTestId("cookie");
    await user.click(screen.getByText("Reset"));
    await waitFor(() => expect(screen.getByTestId("cookie-none")).toBeInTheDocument());
    expect(calls.some(([u, m]) => u === "/api/lab/reset" && m === "POST")).toBe(true);
    expect(screen.getByTestId("msg")).toHaveTextContent(/box positions/);
  });
  it("Simulate shows a step and the presenter toggle keeps the banner", async () => {
    render(<App />); const user = userEvent.setup();
    await user.click(await screen.findByText("Simulate"));
    expect(screen.getByTestId("step")).toHaveTextContent("Sign in once");
    await user.click(screen.getByText("Presenter mode"));
    expect(document.documentElement.dataset.present).toBe("1");
    expect(screen.getByTestId("banner")).toBeVisible();
    expect(screen.getByTestId("mode-badge")).toBeVisible();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByTestId("step")).toHaveTextContent("A second app");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(document.documentElement.dataset.present).toBe("0");
  });
});

describe("shared UI standard", () => {
  it("imports standalone-ui.css before app.css", () => {
    const main = fs.readFileSync(path.resolve(__dirname, "main.jsx"), "utf8");
    expect(main.indexOf('import "./standalone-ui.css"')).toBeGreaterThan(-1);
    expect(main.indexOf('import "./standalone-ui.css"')).toBeLessThan(main.indexOf('import "./app.css"'));
  });
});
