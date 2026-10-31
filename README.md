# Session LAB

How PingOne and DaVinci sessions and cookies work, and how an admin change to the session shows up in the apps. A simulation: no tenant, no real credentials, no outbound network.

Tier: Demo
Repo: https://github.com/ping-sandbox/session-LAB
Catalog: A30 (accepted by the owner, 2026-10-31; defined in the shelf catalog of cmuir_pingcorp/demo-shelf).

## What is simulated

**Mock mode** (the only mode): a mock identity provider with a cookie jar, a PingOne-shaped session record, a DaVinci-shaped `sessionToken`, an SDK token, access and ID tokens, and two or three mock apps. Admin changes (hard and soft revoke, idle timeout, mfa step-up, sessionToken reuse in a widget) are applied by an in-process engine with an injectable clock. Every token, cookie name and claim is a label, not a product fact. Refresh-versus-session binding is UNVERIFIED. Nothing leaves your machine: a netguard blocks all outbound calls and the diagnostics prove it.

**Live mode**: there is none. `MODE=live` (or anything other than `mock`) makes the server refuse to start.

## Run from a clone

Prerequisites: Node 26 or newer. Docker only for the Docker form.

```
git clone https://github.com/ping-sandbox/session-LAB.git
cd session-LAB
npm ci
npm run build
PORT=6880 node server/src/index.js
```

Open http://127.0.0.1:6880/ (or `./scripts/run.sh`). Everything works in mock mode with no setup: no settings file, no account, no network.

## Settings file

This app needs no settings. It reads an optional `.env` in the repo root (git-ignored). It does not read the shared `~/Development/.env`. All keys are optional:

- `PORT`: listen port (default 6880, must be 6880-6899).
- `MODE`: only `mock` (the default) is accepted.
- `SESSIONLAB_BIND`: bind address (default `127.0.0.1`; non-loopback is refused unless it is a container).
- `SESSIONLAB_HOSTED`: `1` changes the banner wording to HOSTED SIMULATION; behaviour is unchanged.
- `SESSIONLAB_PUBLIC_HOST`: one extra https host accepted for writes behind an ingress (hosted build only).
- `WEB_DIST`: path of the built web files (default: `web/dist`).
- `HOST_PORT`: Docker published port (default 6880).
- `customer.config.json` (git-ignored, copy of `customer.config.example.json`): renames the four cast values.

## Ports, and what to do if the port is taken

```
Ports: session-lab listens on 6880 (set with PORT, default 6880).
Port range for this app: 6880-6899.

If the port is taken:
1. Find what is using it:
   lsof -iTCP:6880 -sTCP:LISTEN -n -P
2. If it is an old copy of this app, stop that process: kill <PID>.
3. If it is something else, stop it, or start this app on another port:
   PORT=6881 npm start
4. Do not use 8080, 5173, 3000, 4000, 4400, 4510, 4600-4601, 18080, 19080 or 19090.
```

The app refuses ports outside 6880-6899 and the reserved ones, so pick another free number inside 6880-6899 (6881-6884 are assigned to other labs; 6885-6899 are free; 6898 and 6899 are used by CI). The Vite dev server (`npm run dev -w web`) is a development convenience and uses Vite's own port.

## Mock and live modes

Mock only. The header shows `Mode: mock identity provider` and the banner on every view, including presenter mode, says `SIMULATION: a mock PingOne and DaVinci session. No tenant, no real credentials, nothing leaves this machine.` There is no Mock/Live toggle because there is no live mode to switch to; the owner ruling is that this app does not get one.

## Health, doctor and reset

- `GET /api/health` returns `demo-health/1` (public, GET only, no detail).
- `npm run doctor` prints one line per check (mode, bind, port range, engine, trace, hosts, keys, netguard, port free) and exits 1 on failure.
- `npm run reset` resets a running lab (the current workspace only; default workspace is `default`, sent as `x-workspace`). Reset also clears the mock browser cookie.
- Presenter mode and the talk track: see `docs/talk-track.md`.

## Docker (optional)

```
HOST_PORT=6880 docker compose up --build -d
```

The port is published on 127.0.0.1 only; the container is non-root with a read-only filesystem. Use OrbStack, not Docker Desktop, on a Mac.

## Tests

```
npm test
```

On Node v26.8.2: 99 tests pass (75 server, 7 web, 17 repo-file checks; the counts add to 99). The `browser` CI job and `npm run e2e` additionally drive the real UI with Playwright (installed outside the repo).

## Troubleshooting

1. **Port taken**: see the Ports section above.
2. **Blank page or "Cannot GET /"**: the web build is missing. Run `npm run build`.
3. **`MODE=live is not available`**: this app has a mock mode only; unset `MODE`.
4. **"engines" or syntax errors on start**: you are on an older Node. Use Node 26.
5. **A revoked session still shows a cookie**: expected. A hard revoke leaves the browser cookie stale; only Reset clears it.

## Ownership

Owner: the Ping demo-lab owner (see the org's LAB owners list). Licence: MIT (`LICENSE`). Report problems as GitHub issues on this repo. The `k8s/` folder is the earlier hosted mock-only build; it is deferred and not part of this LAB's checks.
