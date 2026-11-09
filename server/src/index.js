import { fileURLToPath } from 'node:url';
import { installNetguard } from './netguard.js';
import { startHttpServer, createApp } from './app.js';
import { allPassed, runChecks } from './doctor.js';
import { assertBindAllowed, bindHost, labProxyHosts, resolvePort } from './safety.js';
import { hostedFrom, modeFrom } from './config.js';

installNetguard(); // before anything else can open a socket

try { process.loadEnvFile(fileURLToPath(new URL('../../.env', import.meta.url))); } catch { /* no .env */ }

const checks = await runChecks();
if (!allPassed(checks)) {
  for (const c of checks.filter((x) => x.level === 'fail')) console.error(`[session-lab] refusing to start: ${c.id}: ${c.detail}`);
  process.exit(1);
}
modeFrom(process.env); // refuses anything but MODE=mock
const host = assertBindAllowed(bindHost(), process.env);
const port = resolvePort();
// LAB_ALLOWED_HOSTS (the family lab-proxy's name for this lab) is parsed before the server starts.
const proxyHosts = labProxyHosts(process.env, port);
const { url } = await startHttpServer({ port, host, app: createApp({ hosted: hostedFrom(process.env), proxyHosts }) });
console.log(`[session-lab] mock session lab at ${url} (loopback, no outbound network)`);
console.log(`[session-lab] health: ${url}api/health`);
