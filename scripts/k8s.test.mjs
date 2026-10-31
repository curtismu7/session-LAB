// Rule 18 (mock-only SE build): the manifests keep their safety properties. Text checks, no cluster, no yaml dependency.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { test } from 'node:test';

const root = new URL('..', import.meta.url).pathname;
const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const dep = read('k8s/deployment.yaml');
const run = (env, ...args) => spawnSync('bash', ['k8s/deploy.sh', ...args], { cwd: root, env: { PATH: process.env.PATH, ...env }, encoding: 'utf8' });

test('the deployment is mock-only, hosted, non-root, read-only, limited and probed on /api/health', () => {
  for (const re of [/name: MODE, value: mock/, /SESSIONLAB_HOSTED, value: "1"/, /SESSIONLAB_PUBLIC_HOST, value: __SE_HOST__/, /runAsNonRoot: true/, /readOnlyRootFilesystem: true/, /allowPrivilegeEscalation: false/, /drop: \["ALL"\]/,
    /limits: \{ cpu: 500m, memory: 256Mi \}/, /automountServiceAccountToken: false/, /seccompProfile/, /image: __IMAGE__/]) assert.match(dep, re);
  assert.equal((dep.match(/path: \/api\/health/g) || []).length, 2, 'readiness and liveness');
  assert.match(dep, /replicas: 1/, 'state is per pod, so one replica');
  assert.doesNotMatch(dep, /MODE, value: (live|prod)/i);
});

test('no secret, tenant id, credential, real host or namespace sits in the manifests', () => {
  for (const f of ['k8s/deployment.yaml', 'k8s/service.yaml', 'k8s/ingress.yaml', 'k8s/deploy.sh']) {
    const t = read(f);
    assert.doesNotMatch(t, /secretKeyRef|kind: Secret|password|(^|\s)token:|apiKey|ping-devops|ghcr\.io\/[a-z]|^\s*namespace:/mi, f);
    if (f.endsWith('.yaml')) assert.doesNotMatch(t, /\$\{/, `${f}: use __TOKEN__ placeholders, not envsubst`);
  }
  assert.match(read('k8s/ingress.yaml'), /host: __SE_HOST__/, 'the host is supplied, never defaulted');
});

test('the public ingress is rate limited and rewrites Host to loopback', () => {
  const ing = read('k8s/ingress.yaml');
  for (const re of [/limit-rps/, /limit-connections/, /proxy-body-size/, /ssl-redirect: "true"/, /upstream-vhost: "127\.0\.0\.1:6880"/]) assert.match(ing, re);
});

test('the Dockerfile has one image for both forms: MODE defaults to mock, no fork', () => {
  const d = read('Dockerfile');
  assert.match(d, /ENV[^\n]*MODE=mock/);
  assert.equal((d.match(/^FROM /gm) || []).length, 2);
  assert.match(d, /USER node/);
});

test('deploy.sh refuses without approval, namespace, an immutable tag, or a clean host; renders every token', () => {
  const ok = { OWNER_APPROVED: '1', NAMESPACE: 'ns-x', IMAGE: 'registry.example/team/session-lab:abc1234', SE_HOST: 'lab.demo.example' };
  assert.equal(run({}, '--dry-run').status, 2, 'no approval');
  assert.equal(run({ ...ok, OWNER_APPROVED: '0' }, '--dry-run').status, 2);
  const { NAMESPACE: _n, ...noNs } = ok;
  assert.equal(run(noNs, '--dry-run').status, 2, 'NAMESPACE has no default');
  assert.equal(run({ ...ok, NAMESPACE: 'Bad;ns' }, '--dry-run').status, 2);
  for (const IMAGE of ['registry.example/x:latest', 'registry.example/x:HEAD', 'registry.example/x', 'registry.example/x:', 'reg;rm/x:1']) assert.equal(run({ ...ok, IMAGE }, '--dry-run').status, 2, IMAGE);
  assert.equal(run({ ...ok, SE_HOST: 'Bad Host' }, '--dry-run').status, 2);
  for (const IMAGE of [':v1', 'reg.example/x:__SE_HOST__', 'reg.example/x@sha256:abc']) assert.equal(run({ ...ok, IMAGE }, '--dry-run').status, 2, IMAGE);
  assert.equal(run({ ...ok, IMAGE: `reg.example/x@sha256:${'a'.repeat(64)}` }, '--dry-run').status, 0, 'a digest is allowed');
  for (const SE_HOST of ['-.', 'a'.repeat(300), '.x']) assert.equal(run({ ...ok, SE_HOST }, '--dry-run').status, 2, SE_HOST);
  assert.equal(run({ ...ok, NAMESPACE: '-x' }, '--dry-run').status, 2);
  assert.equal(run(ok, '--dryrun').status, 2, 'an unknown argument must not fall through to a real apply');
  const r = run(ok, '--dry-run');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /image: registry\.example\/team\/session-lab:abc1234/);
  assert.match(r.stdout, /host: lab\.demo\.example/);
  assert.doesNotMatch(r.stdout, /__[A-Z_]+__/);
});
