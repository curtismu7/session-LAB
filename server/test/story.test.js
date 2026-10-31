import test from 'node:test';
import assert from 'node:assert/strict';
import { loadDiagram, tokensIn, unfilled, buildStory } from '../src/story.js';
import { VERTICALS } from '../src/verticals.js';
import { scanHosts, scanKeys } from '../src/safety.js';
import { validateDiagram } from '../src/studioValidate.js';

test('every {{token}} in the raw diagram is filled by all three vertical packs', () => {
  const raw = JSON.stringify(loadDiagram());
  assert.ok(tokensIn(raw).length > 0);
  for (const [id, v] of Object.entries(VERTICALS)) assert.deepEqual(unfilled(raw, v.cast), [], id);
});
test('a pack missing a token is caught', () => assert.deepEqual(unfilled('{{member}} {{ghost}}', { member: 'x' }), ['ghost']));
test('the raw diagram is valid diagram-studio/1 and has no real hosts or keys', () => {
  assert.deepEqual(validateDiagram(loadDiagram()), []);
  const text = JSON.stringify(buildStory('bank'));
  assert.deepEqual(scanHosts(text), []); assert.deepEqual(scanKeys(text), []);
});
test('diagram names cannot traverse', () => assert.throws(() => loadDiagram('../package')));
