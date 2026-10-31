import test from 'node:test';
import assert from 'node:assert/strict';
import { isLoopbackHost, assertBindAllowed, bindHost, portProblem, resolvePort, isReservedHost, scanHosts, scanKeys, cleanText, hostCheck, sameOriginWrites, sameOriginWritesFor, publicHostFrom } from '../src/safety.js';

test('loopback names', () => {
  for (const h of ['localhost', '127.0.0.1', '127.9.9.9', '::1', '[::1]']) assert.ok(isLoopbackHost(h), h);
  for (const h of ['0.0.0.0', '192.168.1.5', 'example.com', 'localhost.evil.invalid']) assert.ok(!isLoopbackHost(h), h);
});

test('bind: loopback only unless SESSIONLAB_BIND is set', () => {
  assert.equal(bindHost({}), '127.0.0.1');
  assert.throws(() => assertBindAllowed('0.0.0.0', {}), /loopback only/);
  assert.equal(assertBindAllowed('127.0.0.1', {}), '127.0.0.1');
  assert.equal(assertBindAllowed('0.0.0.0', { SESSIONLAB_BIND: '0.0.0.0' }), '0.0.0.0');
});

test('ports: 6880-6899 only, never a reserved or another agent\'s one', () => {
  assert.equal(portProblem(6880), null); assert.equal(portProblem(6899), null);
  for (const p of [5000, 5010, 6879, 6900, 8080, 5173, 3900, 4000, 4400, 4510, 4600, 4601, 4840, 18080, 19080, 19090, 4771, 4700]) assert.ok(portProblem(p), String(p));
  assert.ok(portProblem(NaN));
  assert.equal(resolvePort({}), 6880);
  assert.equal(resolvePort({ PORT: '6890' }), 6890);
  assert.throws(() => resolvePort({ PORT: '5010' }));
  assert.throws(() => resolvePort({ PORT: '6900' }));
});

test('reserved hosts and the host scan', () => {
  assert.ok(isReservedHost('a.b.invalid')); assert.ok(isReservedHost('mcp.northwind.example')); assert.ok(!isReservedHost('example.com'), 'the rulebook allows only .example and .invalid'); assert.ok(!isReservedHost('example.org')); assert.ok(!isReservedHost('sub.example.com'));
  assert.deepEqual(scanHosts('https://as.example.invalid/x and mail a@agent.example and http://localhost:6880/'), []);
  assert.deepEqual(scanHosts('https://example.com/mcp'), ['example.com']);
  assert.deepEqual(scanHosts('see https://real.com/x and 10.1.2.3'), ['10.1.2.3', 'real.com']);
});

test('key scan: only sk-MOCK- values are allowed in shipped text', () => {
  assert.deepEqual(scanKeys('sk-MOCK-ABCDEF and sk-MOCK-REAL-UPSTREAM-PLACEHOLDER'), []);
  assert.equal(scanKeys('key sk-proj-abcdefghijklmnop1234').length, 1);
  assert.equal(scanKeys('sk-ant-api03-abcdefghijkl').length, 1);
});

test('cleanText strips control and bidi characters and caps the length', () => {
  assert.equal(cleanText('a\u0000b\nc‮d', 80), 'a b c d');
  assert.equal(cleanText('x'.repeat(100), 10).length, 10);
  assert.equal(cleanText(undefined), '');
});

const run = (mw, req) => { const out = {}; const res = { status(c) { out.status = c; return this; }, json(b) { out.body = b; return this; } }; mw(req, res, () => { out.next = true; }); return out; };

test('hostCheck refuses a non-loopback Host (DNS rebinding)', () => {
  assert.ok(run(hostCheck, { headers: { host: 'localhost:6880' } }).next);
  assert.ok(run(hostCheck, { headers: { host: '[::1]:6880' } }).next);
  assert.equal(run(hostCheck, { headers: { host: 'evil.example.invalid:6880' } }).status, 403);
  assert.equal(run(hostCheck, { headers: {} }).status, 403);
});

test('sameOriginWrites: GET passes, cross-origin and cross-site writes refused', () => {
  const h = { host: 'localhost:6880' };
  assert.ok(run(sameOriginWrites, { method: 'GET', headers: { ...h, origin: 'http://evil.example.invalid' } }).next);
  assert.ok(run(sameOriginWrites, { method: 'POST', headers: h }).next, 'no Origin (curl) is allowed');
  assert.ok(run(sameOriginWrites, { method: 'POST', headers: { ...h, origin: 'http://localhost:6880' } }).next);
  assert.equal(run(sameOriginWrites, { method: 'POST', headers: { ...h, origin: 'http://localhost:9999' } }).status, 403);
  assert.equal(run(sameOriginWrites, { method: 'POST', headers: { ...h, origin: 'null' } }).status, 403);
  assert.equal(run(sameOriginWrites, { method: 'DELETE', headers: { ...h, 'sec-fetch-site': 'cross-site' } }).status, 403);
  assert.equal(run(sameOriginWrites, { method: 'PUT', headers: { ...h, 'sec-fetch-site': 'same-site' } }).status, 403);
  assert.ok(run(sameOriginWrites, { method: 'POST', headers: { ...h, 'sec-fetch-site': 'same-origin' } }).next);
});

test('sameOriginWritesFor: the SE public host is accepted behind the Host rewrite, and nothing else is', () => {
  const h = { host: '127.0.0.1:6880' };
  const mw = sameOriginWritesFor('lab.se.example');
  assert.ok(run(mw, { method: 'POST', headers: { ...h, origin: 'https://lab.se.example', 'sec-fetch-site': 'same-origin' } }).next);
  assert.equal(run(mw, { method: 'POST', headers: { ...h, origin: 'http://lab.se.example' } }).status, 403, 'https only');
  assert.equal(run(mw, { method: 'POST', headers: { ...h, origin: 'https://evil.example' } }).status, 403);
  assert.equal(run(mw, { method: 'POST', headers: { ...h, origin: 'https://lab.se.example.evil.example' } }).status, 403);
  assert.equal(run(mw, { method: 'POST', headers: { ...h, origin: 'https://lab.se.example', 'sec-fetch-site': 'cross-site' } }).status, 403);
  assert.equal(run(sameOriginWrites, { method: 'POST', headers: { ...h, origin: 'https://lab.se.example' } }).status, 403, 'unconfigured = loopback only');
});

test('publicHostFrom accepts a plain host name only', () => {
  assert.equal(publicHostFrom({ SESSIONLAB_PUBLIC_HOST: 'lab.se.example' }), 'lab.se.example');
  for (const bad of ['', undefined, 'Bad Host', 'a/b', 'a:80', '-x', 'x.', 'a;b', 'a'.repeat(300)]) assert.equal(publicHostFrom({ SESSIONLAB_PUBLIC_HOST: bad }), null, String(bad));
});
