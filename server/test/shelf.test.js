// The header "Shelf" button needs GET /api/shelf to be reachable, here with no web build (withServer passes no webDist).
import test from 'node:test';
import assert from 'node:assert/strict';
import { rawHttp, withServer } from './helpers.js';

test('GET /api/shelf returns SHELF_URL with the trailing slash trimmed, and a POST is refused', async () => {
  const saved = process.env.SHELF_URL;
  process.env.SHELF_URL = 'https://shelf.example:8443/';
  try {
    await withServer(async (url) => {
      const r = await rawHttp(`${url}/api/shelf`);
      assert.equal(r.status, 200);
      assert.deepEqual(JSON.parse(r.text), { shelfUrl: 'https://shelf.example:8443' });
      const p = await rawHttp(`${url}/api/shelf`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url }, body: '{}' });
      assert.notEqual(p.status, 200);
    });
  } finally {
    if (saved === undefined) delete process.env.SHELF_URL; else process.env.SHELF_URL = saved;
  }
});
