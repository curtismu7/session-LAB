import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeCast, loadCustomerCast } from '../src/customer.js';
import { buildStory } from '../src/story.js';

test('only the four cast keys with short plain-text values are accepted', () => {
  assert.deepEqual(sanitizeCast({ cast: { member: 'Jo Park', portalApp: 'Acme Portal', other: 'x' } }), { member: 'Jo Park', portalApp: 'Acme Portal' });
  for (const bad of ['<b>x</b>', '{{member}}', 'a'.repeat(41), '', ' lead', 7, ['x'], null]) assert.deepEqual(sanitizeCast({ cast: { member: bad } }), {}, String(bad));
  for (const raw of [null, [], 'x', { cast: [] }, { cast: 'x' }, { cast: JSON.parse('{"__proto__":{"member":"x"}}') }]) assert.deepEqual(sanitizeCast(raw), {});
});

test('a missing or broken customer.config.json changes nothing', () => {
  assert.deepEqual(loadCustomerCast(new URL('file:///nonexistent/customer.config.json')), {});
});

test('buildStory({customer:false}) ignores customer branding and always fills every token', () => {
  const s = buildStory('bank', { customer: false });
  assert.doesNotMatch(JSON.stringify(s.diagram), /\{\{/);
});

test('an oversized or non-file customer config is ignored, and a valid one is read and picked up when it changes', async () => {
  const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-cc-'));
  const f = path.join(dir, 'c.json');
  fs.writeFileSync(f, JSON.stringify({ cast: { member: 'Jo Park' } }));
  assert.deepEqual(loadCustomerCast(f), { member: 'Jo Park' });
  fs.writeFileSync(f, JSON.stringify({ cast: { member: 'Sam Lee' }, pad: 'x'.repeat(10) }));
  assert.deepEqual(loadCustomerCast(f), { member: 'Sam Lee' });
  fs.writeFileSync(f, JSON.stringify({ cast: { member: 'Jo Park' }, pad: 'x'.repeat(5000) }));
  assert.deepEqual(loadCustomerCast(f), {}, 'over 4 KiB');
  assert.deepEqual(loadCustomerCast(dir), {}, 'a directory');
  fs.rmSync(dir, { recursive: true });
});
