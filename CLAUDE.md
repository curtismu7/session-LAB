# session-lab

Demo-tier standalone app: how PingOne and DaVinci sessions and cookies work, and what an admin change does to the apps. Mock only.

- Run: `PORT=6880 node server/src/index.js` after `npm run build` (http://127.0.0.1:6880). Dev: `npm start` plus `npm run dev -w web`. Test: `npm test` (server is `node --test test/*.test.js`, a glob; web is vitest). Preflight: `npm run doctor`.
- `server/src/engine.js` is the whole model (session, cookie, sessionToken, tokens, idle timeout, mfa recency) with an injectable clock; one Lab per workspace in `app.js`. Refusals are HTTP 200 with `result.ok: false` (a refusal is the lesson, not an error).
- The IdP reads the REAL browser cookie `mock-ST` (HttpOnly). A hard revoke leaves it in the browser (stale); only Reset clears it.
- The diagram is `server/diagrams/session-lab-flow.json` (diagram-studio/1, validated by `studioValidate.js`, a copy from diagram-studio; never import across repos). All text carries `{{cast}}` tokens filled from `verticals.js`; a test fails on an unfilled token. `web/src/eventEdges.js` maps events to arrow numbers: keep it in step with the diagram.
- Rules that bite: loopback bind only; same-origin writes; zero outbound network (netguard); tokens shown raw but mock-labelled; ports 6880-6899; only `.example`/`.invalid` hosts; no customer or tenant identifiers.
- Docker: `HOST_PORT=6880 docker compose up --build -d` (loopback publish, read-only, non-root). Hosted SE build = same image, `SESSIONLAB_HOSTED=1`; `k8s/` uses `__IMAGE__`/`__SE_HOST__` tokens and `k8s/deploy.sh` (owner-approved, no default namespace). `npm test` also runs `scripts/*.test.mjs` (compose, k8s, content pack, repo files). `customer.config.json` renames the four cast values only (`server/src/customer.js`).
- Open: rule 11 (mock sign-in guards) does not fit this app (no login gate, no live mode, nothing to protect); owner ruled NOT APPLICABLE on 2026-10-27. Refresh-vs-session binding is UNVERIFIED.
