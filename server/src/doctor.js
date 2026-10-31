// Preflight checks shared by `npm run doctor` and GET /api/health. Never prints a secret, needs no network.
// Each check: { id, level: 'pass' | 'info' | 'fail', detail }.
import { assertBindAllowed, bindHost, portProblem, scanHosts, scanKeys, DEFAULT_PORT, PORT_MIN, PORT_MAX } from './safety.js';
import { netguardSelfTest } from './netguard.js';
import { createLab, ACCESS_TTL_SEC } from './engine.js';
import { modeFrom } from './config.js';
import { TRACEPARENT } from './trace.js';

export async function runChecks({ env = process.env } = {}) {
  const checks = [];
  const add = (id, level, detail) => checks.push({ id, level, detail });

  const major = Number(process.versions.node.split('.')[0]);
  add('node', major >= 20 ? 'pass' : 'fail', `v${process.versions.node} (need >= 20)`);

  try { add('mode', 'pass', `MODE=${modeFrom(env)} (the only mode this app has${env.SESSIONLAB_HOSTED === '1' ? '; hosted build' : ''})`); }
  catch (e) { add('mode', 'fail', e.message); }

  try { add('bind', 'pass', `${assertBindAllowed(bindHost(env), env)}${env.SESSIONLAB_BIND ? ' (SESSIONLAB_BIND opt-in)' : ' (loopback)'}`); }
  catch (e) { add('bind', 'fail', e.message); }

  const port = env.PORT === undefined || env.PORT === '' ? DEFAULT_PORT : Number(env.PORT);
  const problem = portProblem(port);
  add('port-range', problem ? 'fail' : 'pass', problem || `${port} is inside ${PORT_MIN}-${PORT_MAX} and not reserved`);

  // The engine runs the whole story once: sign in, SSO, revoke, and the access token must outlive the session.
  const lab = createLab();
  lab.signIn(); lab.authorize('portal'); lab.revokeSession();
  const s = lab.snapshot();
  const story = lab.authorize('portal').error === 'login_required' && lab.callApi('portal').ok && s.config.accessTtlSec === ACCESS_TTL_SEC;
  add('engine', story ? 'pass' : 'fail', story ? 'sign-in, SSO, revoke and "token outlives session" behave as the guide describes' : 'the session engine does not behave as expected');
  add('story-trace', s.events.every((e) => TRACEPARENT.test(e.traceparent)) ? 'pass' : 'fail', `all ${s.events.length} events carry a valid W3C traceparent`);

  const blob = JSON.stringify(s);
  const hosts = scanHosts(blob);
  add('story-hosts', hosts.length ? 'fail' : 'pass', hosts.length ? `non-reserved hosts: ${hosts.join(', ')}` : 'every host in the lab is .invalid or .example');
  const keys = scanKeys(blob);
  add('story-keys', keys.length ? 'fail' : 'pass', keys.length ? 'key-looking values that are not sk-MOCK-' : 'no key-looking values');

  const ng = await netguardSelfTest();
  add('netguard', ng.ok ? 'pass' : 'fail', ng.ok ? `blocked fetch, socket, socket-by-IP, dns lookup, dns resolve and udp to a non-loopback host (${ng.blocked}/6)` : ng.detail);

  add('tenant', 'pass', 'mock only: no tenant, no credentials, no outbound network');
  return checks;
}

export const allPassed = (checks) => checks.every((c) => c.level !== 'fail');
