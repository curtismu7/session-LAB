// Same-origin calls only. The workspace id (rule 13) is this BROWSER's own random id (localStorage), so one visitor's Reset never touches
// another's, and two tabs of one visitor share one world, just as they share the one session cookie.
let ws = null;
export function workspaceId() {
  if (ws) return ws;
  try { ws = localStorage.getItem("session-lab-ws"); } catch { /* storage blocked */ }
  if (!ws) {
    ws = `v-${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    try { localStorage.setItem("session-lab-ws", ws); } catch { /* ignore */ }
  }
  return ws;
}
const headers = () => ({ "content-type": "application/json", "x-workspace": workspaceId() });
async function json(res) {
  let body = null;
  try { body = await res.json(); } catch { /* not JSON */ }
  return { status: res.status, body };
}
export const getLab = () => fetch("/api/lab", { headers: headers() }).then(json);
export const getStory = (vertical) => fetch(`/api/story?vertical=${encodeURIComponent(vertical)}`).then(json);
export const getInfo = () => fetch("/api/info").then(json);
export const act = (action, body = {}) => fetch(`/api/lab/${action}`, { method: "POST", headers: headers(), body: JSON.stringify(body) }).then(json);
