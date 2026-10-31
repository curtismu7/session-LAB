// Rule 12: customer.config.json (git-ignored, outside the image) renames the four cast values in the story. Nothing else is read.
// Values are short plain text; anything else is dropped so branding can never inject markup or {{tokens}}.
import fs from 'node:fs';

export const CAST_KEYS = ['member', 'portalApp', 'sensitiveApp', 'embeddedApp'];
const SAFE = /^[A-Za-z0-9][A-Za-z0-9 .'&-]{0,39}$/;

export function sanitizeCast(raw) {
  const out = {};
  const cast = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw.cast : undefined;
  if (!cast || typeof cast !== 'object') return out;
  for (const k of CAST_KEYS) if (Object.hasOwn(cast, k) && typeof cast[k] === 'string' && SAFE.test(cast[k])) out[k] = cast[k];
  return out;
}

const MAX_BYTES = 4096;
let memo = { key: '', value: {} };
// Read at most 4 KiB, and only again when the file's mtime or size changes (the story is built on every request).
export function loadCustomerCast(file = new URL('../../customer.config.json', import.meta.url)) {
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > MAX_BYTES) return {};
    const key = `${String(file)}:${st.mtimeMs}:${st.size}`;
    if (memo.key !== key) memo = { key, value: sanitizeCast(JSON.parse(fs.readFileSync(file, 'utf8'))) };
    return memo.value;
  } catch { return {}; }
}
