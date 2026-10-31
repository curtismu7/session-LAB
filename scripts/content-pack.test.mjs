import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildPack } from './build-content-pack.mjs';
import { validatePack } from './validate-content-pack.mjs';

const committed = JSON.parse(fs.readFileSync(new URL('../content-pack.json', import.meta.url), 'utf8'));

test('the pack validates against the schema and its cross-references hold', () => {
  const errors = validatePack(buildPack());
  assert.deepEqual(errors, []);
});

test('the committed content-pack.json is exactly what the builder makes (no drift)', () => {
  assert.deepEqual(committed, buildPack());
});

test('every diagram step has a story and a try-it card, with no unfilled {{token}}', () => {
  const pack = buildPack();
  assert.equal(pack.stories.length, 6);
  for (const s of pack.stories) assert.ok(pack.cards.find((c) => c.story === s.id), s.id);
  assert.doesNotMatch(JSON.stringify(pack), /\{\{/);
});

test('a broken pack is caught: unknown term and unknown story', () => {
  const pack = buildPack();
  pack.cards[0].terms = ['nope'];
  pack.cards[1].story = 'ghost';
  const errors = validatePack(pack).join('\n');
  assert.match(errors, /unknown term nope/);
  assert.match(errors, /unknown story ghost/);
});
