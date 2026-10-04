import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const viteConfig = readFileSync(new URL('../../vite.config.js', import.meta.url), 'utf8');
const productionServer = readFileSync(new URL('../../../scripts/serve-prod.mjs', import.meta.url), 'utf8');

test('front-end proxies default to the backend port used by the project', () => {
  assert.match(viteConfig, /target:\s*['"]http:\/\/localhost:8000['"]/);
  assert.match(productionServer, /API_PORT\s*\|\|\s*8000/);
});
