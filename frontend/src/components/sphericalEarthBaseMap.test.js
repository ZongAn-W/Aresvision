import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  EARTH_COASTLINE_RADIUS,
  EARTH_COASTLINE_URL,
  EARTH_GLOBE_RADIUS,
  buildEarthBaseMapLines,
  createEarthGlobeMaterial,
  fetchCoastlineGeoJson,
} from './sphericalEarthBaseMap.js';

const REAL_COASTLINE = new URL('../../public/earth/ne_110m_coastline.geojson', import.meta.url);

function fakeResponse(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: async () => payload,
  };
}

test('the coastline shell sits above the globe and below the particle field', () => {
  assert.ok(
    EARTH_COASTLINE_RADIUS > EARTH_GLOBE_RADIUS,
    'coastline must be outside the globe to avoid z-fighting',
  );
  assert.ok(EARTH_COASTLINE_RADIUS - EARTH_GLOBE_RADIUS >= 0.005);
  assert.ok(EARTH_COASTLINE_RADIUS < 0.9, 'coastline must stay under the particle shell');
  assert.equal(EARTH_GLOBE_RADIUS, 0.86);
  assert.equal(EARTH_COASTLINE_RADIUS, 0.868);
  assert.equal(EARTH_COASTLINE_URL, '/earth/ne_110m_coastline.geojson');
});

test('the globe material describes a deep blue ocean and differs between themes', () => {
  const dark = createEarthGlobeMaterial({ isLight: false });
  const light = createEarthGlobeMaterial({ isLight: true });

  assert.equal(typeof dark.color, 'string');
  assert.equal(typeof light.color, 'string');
  assert.notEqual(dark.color.toLowerCase(), light.color.toLowerCase());
  assert.notEqual(dark.emissive.toLowerCase(), light.emissive.toLowerCase());
  assert.equal(JSON.stringify(dark).includes('mars_texture'), false);
  assert.equal(JSON.stringify(light).includes('mars_texture'), false);
  assert.equal(JSON.stringify(dark).includes('.jpg'), false);

  for (const options of [dark, light]) {
    assert.ok(Number.isFinite(options.roughness));
    assert.ok(options.roughness >= 0 && options.roughness <= 1);
    assert.equal(typeof options.color, 'string');
    assert.match(options.color, /^#[0-9a-f]{6}$/i);
  }

  // Calling it without arguments must not throw and must default to the dark theme.
  assert.deepEqual(createEarthGlobeMaterial(), dark);
  assert.deepEqual(createEarthGlobeMaterial({}), dark);
});

test('fetchCoastlineGeoJson accepts a FeatureCollection and rejects anything else', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return fakeResponse({ type: 'FeatureCollection', features: [] });
  };

  const payload = await fetchCoastlineGeoJson({ signal: undefined, fetchImpl });
  assert.equal(payload.type, 'FeatureCollection');
  assert.deepEqual(calls[0].url, EARTH_COASTLINE_URL);
  assert.equal(calls[0].options.signal, undefined);

  const custom = await fetchCoastlineGeoJson({
    url: '/custom/coast.geojson',
    fetchImpl,
  });
  assert.equal(custom.type, 'FeatureCollection');
  assert.equal(calls[1].url, '/custom/coast.geojson');

  await assert.rejects(
    () => fetchCoastlineGeoJson({ fetchImpl: async () => fakeResponse({ type: 'Feature' }) }),
    /must be a GeoJSON FeatureCollection/,
  );
  await assert.rejects(
    () => fetchCoastlineGeoJson({ fetchImpl: async () => fakeResponse({ type: 'FeatureCollection' }) }),
    /must be a GeoJSON FeatureCollection/,
  );
  await assert.rejects(
    () => fetchCoastlineGeoJson({ fetchImpl: async () => fakeResponse(null) }),
    /must be a GeoJSON FeatureCollection/,
  );
  await assert.rejects(
    () => fetchCoastlineGeoJson({
      fetchImpl: async () => fakeResponse({ type: 'FeatureCollection', features: [] }, { ok: false, status: 404 }),
    }),
    /HTTP 404/,
  );
  await assert.rejects(
    () => fetchCoastlineGeoJson({
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad json'); } }),
    }),
    /not valid JSON/,
  );
  await assert.rejects(
    () => fetchCoastlineGeoJson({ fetchImpl: async () => { throw new Error('offline'); } }),
    /offline/,
  );
});

test('fetchCoastlineGeoJson propagates AbortError untouched', async () => {
  const abortError = new Error('The operation was aborted.');
  abortError.name = 'AbortError';
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    () => fetchCoastlineGeoJson({
      signal: controller.signal,
      fetchImpl: async (url, { signal }) => {
        assert.equal(signal, controller.signal);
        if (signal?.aborted) throw abortError;
        return fakeResponse({ type: 'FeatureCollection', features: [] });
      },
    }),
    (error) => error === abortError && error.name === 'AbortError',
  );

  await assert.rejects(
    () => fetchCoastlineGeoJson({
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw abortError; } }),
    }),
    (error) => error === abortError && error.name === 'AbortError',
  );
});

test('buildEarthBaseMapLines returns finite position triples at the coastline radius', () => {
  const geojson = {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', geometry: { type: 'LineString', coordinates: [[0, 0], [1, 0], [2, 0]] } },
      {
        type: 'Feature',
        geometry: {
          type: 'MultiLineString',
          coordinates: [[[10, 10], [11, 10]], [[20, -10], [21, -10]]],
        },
      },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] } },
    ],
  };

  const lines = buildEarthBaseMapLines(geojson);
  assert.equal(lines.length, 3);
  for (const line of lines) {
    assert.ok(line instanceof Float32Array);
    assert.equal(line.length % 3, 0, 'stride must be 3');
    for (let i = 0; i < line.length; i += 3) {
      const length = Math.hypot(line[i], line[i + 1], line[i + 2]);
      assert.ok(Number.isFinite(length));
      assert.ok(Math.abs(length - EARTH_COASTLINE_RADIUS) <= 1e-6, `radius ${length}`);
    }
  }
  // Radius override is honoured.
  const tighter = buildEarthBaseMapLines(geojson, { radius: 1 });
  for (const line of tighter) {
    for (let i = 0; i < line.length; i += 3) {
      assert.ok(Math.abs(Math.hypot(line[i], line[i + 1], line[i + 2]) - 1) <= 1e-6);
    }
  }
  assert.deepEqual(buildEarthBaseMapLines({ type: 'FeatureCollection', features: [] }), []);
});

test('the shipped Natural Earth coastline builds into usable sphere lines', async () => {
  const raw = readFileSync(REAL_COASTLINE, 'utf8');
  const geojson = JSON.parse(raw);
  assert.equal(geojson.type, 'FeatureCollection');
  assert.ok(geojson.features.length > 0);

  const payload = await fetchCoastlineGeoJson({
    fetchImpl: async () => fakeResponse(geojson),
  });
  assert.equal(payload.features.length, geojson.features.length);

  const lines = buildEarthBaseMapLines(payload);
  assert.ok(lines.length > 0);
  let pointCount = 0;
  for (const line of lines) {
    assert.equal(line.length % 3, 0);
    pointCount += line.length / 3;
    for (let i = 0; i < line.length; i += 3) {
      const length = Math.hypot(line[i], line[i + 1], line[i + 2]);
      assert.ok(Number.isFinite(length));
      assert.ok(Math.abs(length - EARTH_COASTLINE_RADIUS) <= 1e-6);
    }
  }
  assert.ok(pointCount > 1000, `expected a real coastline, got ${pointCount} points`);
});
