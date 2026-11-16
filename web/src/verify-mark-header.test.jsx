import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import App from "./App.jsx";
import { setJsonView } from "./components/JsonPane.jsx";
import { createLab } from "../../server/src/engine.js";
import { fill } from "../../server/src/story.js";
import { VERTICALS, verticalFrom } from "../../server/src/verticals.js";

// The header shows this lab's own Verified / In progress mark, read from the same /api/shelf call the Shelf link makes (through the lab-proxy that
// call reaches the shelf, whose payload lists every demo with its mark). The lab's own /api/shelf has only { shelfUrl }, so there is no mark then.
const RAW = fs.readFileSync(path.resolve(process.cwd(), "../server/diagrams/session-lab-flow.json"), "utf8");
function buildStory(vertical) {
  const v = verticalFrom(vertical);
  return { vertical: v, verticals: Object.entries(VERTICALS).map(([id, x]) => ({ id, label: x.label })), cast: VERTICALS[v].cast, diagram: JSON.parse(fill(RAW, VERTICALS[v].cast)) };
}
const mark = (status, label, extra = {}) => ({ status, label, note: "", updatedAt: "2026-11-15", source: "shipped", ...extra });
function stubFetch(shelf) {
  const lab = createLab({ workspace: "t" });
  globalThis.fetch = vi.fn(async (url) => {
    const u = String(url);
    const ok = (body) => ({ ok: true, status: 200, json: async () => body });
    if (u === "/api/shelf") return ok(shelf);
    if (u.startsWith("/api/info")) return ok({ mode: "mock", simulated: true, hosted: false, source: "mock", realAvailable: false, realReason: "n/a" });
    if (u.startsWith("/api/story")) return ok(buildStory(new URL(u, "http://x").searchParams.get("vertical")));
    return ok({ lab: lab.snapshot(), ...lab.snapshot() });
  });
}
beforeEach(() => setJsonView("form"));

describe("verification mark in the header", () => {
  it("shows this lab's own mark inside the top menu beside the Shelf link, and no other lab's", async () => {
    stubFetch({ shelfUrl: "http://shelf.example", demos: [{ id: "other-lab", verification: mark("in-progress", "In progress") }, { id: "session-lab", verification: mark("verified", "Verified", { note: "Every action checked on the mock" }) }] });
    render(<App />);
    const bar = within(await screen.findByTestId("top-menu"));
    expect(await bar.findByText("Verified")).toBeInTheDocument();
    expect(await bar.findByText("Shelf")).toBeInTheDocument();
    expect(bar.queryByText("In progress")).toBeNull();
    expect(document.querySelectorAll(".verify")).toHaveLength(1);
    expect(bar.getByText("Verified").closest(".verify")).toHaveAttribute("title", expect.stringContaining("Every action checked on the mock"));
  });

  it("shows nothing when the lab is opened on its own port (only { shelfUrl }) or the shelf has no mark for it", async () => {
    for (const shelf of [{ shelfUrl: "http://shelf.example" }, { shelfUrl: "http://shelf.example", demos: [{ id: "session-lab", verification: null }] }, { shelfUrl: "http://shelf.example", demos: [{ id: "other-lab", verification: mark("verified", "Verified") }] }]) {
      stubFetch(shelf);
      const { unmount } = render(<App />);
      const bar = within(await screen.findByTestId("top-menu"));
      expect(await bar.findByText("Shelf")).toBeInTheDocument(); // the shelf answered, and still no badge
      expect(document.querySelector(".verify")).toBeNull();
      unmount();
    }
  });
});
