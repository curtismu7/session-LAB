// Builds content-pack.json for the Learning Hub from the story data, so the pack cannot drift from the diagram.
//   node scripts/build-content-pack.mjs        (writes content-pack.json)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDiagram, fill } from '../server/src/story.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

export function buildPack() {
  // A vertical-neutral cast, so the committed pack matches the talk track and never depends on customer.config.json.
  const diagram = JSON.parse(fill(JSON.stringify(loadDiagram()), { member: 'the member', portalApp: 'the member portal', sensitiveApp: 'the payments app', embeddedApp: 'the embedded widget' }));
  const sid = (n) => `S${String(n).padStart(2, '0')}`;
  const steps = diagram.steps.map((s, i) => ({ n: i + 1, title: s.title || s.label || `Step ${i + 1}`, say: [s.what, s.why].filter(Boolean).join(' ') }));
  const terms = { 1: ['pingone-session', 'session-cookie', 'authentication-methods'], 2: ['session-cookie'], 3: ['revoke'], 4: ['mfa-recency', 'authentication-methods'], 5: ['session-token'], 6: ['idle-timeout', 'revoke', 'sticky-sso'] };
  return {
    schema: 'demo-content-pack/1',
    id: 'session-lab',
    title: 'PingOne and DaVinci sessions and cookies',
    version,
    demo: { id: 'session-lab', name: 'Session Lab', catalog: 'A30', baseUrl: 'http://localhost:6890', doctor: '/api/health', tags: ['session', 'cookie', 'pingone', 'davinci', 'step-up', 'mock-only'] },
    glossary: [
      { id: 'pingone-session', term: 'PingOne session', definition: 'The record PingOne keeps that a person authenticated: when, how (pwd, mfa) and when it was last used. Apps do not hold it. It is separate from every token an app holds. Per Ping\'s docs the default idle timeout is 30 days; a shorter value (in minutes) is set on the Return Success Response node. The owner-supplied write-up adds that each Return Success Response pushes the idle window out.', aliases: ['SSO session'] },
      { id: 'session-cookie', term: 'Session cookie', definition: 'A browser cookie set by the identity service on its own origin that points at the session. The page cannot read it (HttpOnly). Ping\'s session write-up calls the real one the "ST cookie"; its flags are unsourced and this lab uses a labelled mock name.', aliases: ['ST cookie'] },
      { id: 'session-token', term: 'DaVinci sessionToken', definition: 'A token a DaVinci flow returns so a widget can reuse an existing session by posting it back as global.sessionToken. It is not the browser cookie and not an OIDC token.', aliases: ['global.sessionToken'] },
      { id: 'idle-timeout', term: 'Idle timeout', definition: 'How long a session can sit unused before it ends. Whether a change applies to sessions that already exist is UNVERIFIED.' },
      { id: 'mfa-recency', term: 'MFA recency (step-up)', definition: 'Check Session requires one method signed on within a window (Ping\'s write-up uses 8 or 9 hours). It reads that method\'s own last sign-on time on the session. The values on Return Success Response are records, not challenges.', aliases: ['step-up'] },
      { id: 'authentication-methods', term: 'Authentication Methods', definition: 'Values a flow sets on Return Success Response to say how the user signed on: pwd (the default), mfa, otp, sms, rba, or custom values such as fido and pwdless. PingOne does not detect them. Each one gets its own last sign-on time on the session.', aliases: ['amr', 'pwd', 'mfa'] },
      { id: 'sticky-sso', term: 'Sticky SSO', definition: 'What happens when a flow reports a method that never ran (for example always sending mfa). That method\'s last sign-on moves to now with no login, so Check Session keeps passing. A flow that authenticated nobody should report no methods.', aliases: ['false mfa'] },
      { id: 'revoke', term: 'Revoke (delete vs soft delete)', definition: 'Per the owner-supplied guide, Delete Session signs the user out and Soft Delete keeps the session record. Tokens an app already holds are separate credentials and are not recalled by it.' },
    ],
    sources: [
      { id: 'p1-auth-connector', title: 'PingOne Authentication connector (DaVinci)', url: 'https://docs.pingidentity.com/connectors/p1_authentication_connector.html', kind: 'vendor-doc', use: 'Check Session, Create or Update Session, Delete Session and Return Success Response fields; Authentication Methods values.', status: 'read', checked: '2026-10-27' },
      { id: 'p1-oidc-app', title: 'Editing an application, OIDC (PingOne)', url: 'https://docs.pingidentity.com/pingone/applications/p1_edit_application_oidc.html', kind: 'vendor-doc', use: 'Default 30-day idle timeout, OIDC session management, refresh token durations, idpSignoff.', status: 'read', checked: '2026-10-27' },
      { id: 'guide', title: 'How sessions work in PingOne and DaVinci (PDF supplied by the owner; no public URL, it cites the two pages above)', url: 'https://docs.pingidentity.com/connectors/p1_authentication_connector.html', kind: 'vendor-doc', use: 'Session facts (also: the owner write-up on Return Success Response, not public): 30 day idle default, pwd/mfa records, Check Session, sessionToken reuse, Delete vs Soft Delete.', status: 'read', checked: '2026-10-27' },
    ],
    cards: [
      ...steps.map((s) => ({ id: `try-step-${s.n}`, label: `Step ${s.n}: ${s.title}`, description: s.say, group: 'try-it', action: { type: 'route', href: '/' }, terms: terms[s.n], story: sid(s.n) })),
      { id: 'concept-separate', label: 'Session, cookie and tokens are separate', description: 'Ending a session does not recall tokens an app already holds.', group: 'concept', action: { type: 'route', href: '/' }, terms: ['pingone-session', 'revoke'] },
      { id: 'ref-doctor', label: 'Doctor and health', description: 'Preflight checks and the demo-health/1 endpoint.', group: 'setup', action: { type: 'route', href: '/api/health' } },
    ],
    stories: steps.map((s) => ({ id: sid(s.n), title: s.title, say: s.say })),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fs.writeFileSync(path.join(ROOT, 'content-pack.json'), `${JSON.stringify(buildPack(), null, 2)}\n`);
  console.log('wrote content-pack.json');
}
