// The story: the diagram-studio/1 diagram loaded by name, validated, with {{cast}} tokens filled for one vertical.
import fs from 'node:fs';
import { loadCustomerCast } from './customer.js';
import { validateDiagram } from './studioValidate.js';
import { VERTICALS, verticalFrom } from './verticals.js';

const NAME = /^[a-z0-9][a-z0-9-]{0,47}$/;
export function loadDiagram(name = 'session-lab-flow') {
  if (!NAME.test(name)) throw new Error('bad diagram name');
  return JSON.parse(fs.readFileSync(new URL(`../diagrams/${name}.json`, import.meta.url), 'utf8'));
}

const TOKEN = /\{\{(\w+)\}\}/g;
export const tokensIn = (text) => [...String(text).matchAll(TOKEN)].map((m) => m[1]);
export const fill = (text, cast) => String(text).replace(TOKEN, (m, k) => (Object.hasOwn(cast, k) ? cast[k] : m));
export const unfilled = (text, cast) => [...new Set(tokensIn(text))].filter((k) => !Object.hasOwn(cast, k));

export function buildStory(vertical, { customer = true } = {}) {
  const v = verticalFrom(vertical);
  const cast = { ...VERTICALS[v].cast, ...(customer ? loadCustomerCast() : {}) };
  const diagram = JSON.parse(fill(JSON.stringify(loadDiagram()), cast));
  const problems = validateDiagram(diagram);
  if (problems.length) throw new Error(`diagram invalid: ${problems[0]}`);
  return { vertical: v, verticals: Object.entries(VERTICALS).map(([id, x]) => ({ id, label: x.label })), cast, diagram };
}
