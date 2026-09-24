import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createEarthResearchClient,
  validatePolarDynamics,
  validateResearchSuite,
  validateSpatialDiagnostics,
} from './earthResearchClient.js';

const DATASET_ID = 'earth_merra2_daily_v2';
const FINGERPRINT = 'a'.repeat(64);

function suitePayload(overrides = {}) {
  return {
    planet: 'earth',
    dataset_id: DATASET_ID,
    dataset_fingerprint: FINGERPRINT,
    year: 2020,
    day_count: 2,
    dates: ['2020-01-01', '2020-01-02'],
    latitude: [-87.5, 87.5],
    bands: [{ id: 'north_polar', grid_point_count: 6 }],
    seasonal: { TO3: { z: [[1, 2], [3, 4]] } },
    ...overrides,
  };
}

test('a shared research request is issued once and reused by every card', async () => {
  let calls = 0;
  const client = createEarthResearchClient({
    datasetId: DATASET_ID,
    fingerprint: FINGERPRINT,
    fetchImpl: async () => {
      calls += 1;
      return suitePayload();
    },
  });

  const [first, second] = await Promise.all([
    client.getSuite({ year: 2020 }),
    client.getSuite({ year: 2020 }),
  ]);
  assert.equal(calls, 1, 'two cards must share one request');
  assert.equal(first, second);

  await client.getSuite({ year: 2020 });
  assert.equal(calls, 1, 'a cached year must not be requested again');
  assert.equal(client.size, 1);
});

test('a new year is a different payload and a fingerprint change invalidates everything', async () => {
  const seen = [];
  const client = createEarthResearchClient({
    datasetId: DATASET_ID,
    fingerprint: FINGERPRINT,
    fetchImpl: async (datasetId, { year }) => {
      seen.push(year);
      return suitePayload({ year });
    },
  });

  await client.getSuite({ year: 2020 });
  await client.getSuite({ year: 2021 });
  assert.deepEqual(seen, [2020, 2021]);

  client.invalidate();
  await client.getSuite({ year: 2020 });
  assert.deepEqual(seen, [2020, 2021, 2020], 'invalidate must drop the cache');
});

test('a failed request is not cached and can be retried', async () => {
  let calls = 0;
  const client = createEarthResearchClient({
    datasetId: DATASET_ID,
    fingerprint: FINGERPRINT,
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) throw Object.assign(new Error('boom'), { code: 'dataset_unavailable' });
      return suitePayload();
    },
  });

  await assert.rejects(() => client.getSuite({ year: 2020 }), /boom/);
  const payload = await client.getSuite({ year: 2020 });
  assert.equal(payload.year, 2020);
  assert.equal(calls, 2, 'the failed promise must not be cached');
});

test('a caller that detached receives AbortError without cancelling the shared request', async () => {
  let resolveFetch;
  const client = createEarthResearchClient({
    datasetId: DATASET_ID,
    fingerprint: FINGERPRINT,
    fetchImpl: () => new Promise((resolve) => { resolveFetch = resolve; }),
  });

  const controller = new AbortController();
  const detached = client.getSuite({ year: 2020, signal: controller.signal });
  const attached = client.getSuite({ year: 2020 });
  controller.abort();
  resolveFetch(suitePayload());

  await assert.rejects(() => detached, (error) => error.name === 'AbortError');
  const payload = await attached;
  assert.equal(payload.dataset_fingerprint, FINGERPRINT);
});

test('payload identity validation rejects the wrong planet, dataset, version or year', () => {
  const expected = { datasetId: DATASET_ID, fingerprint: FINGERPRINT, year: 2020 };
  assert.equal(validateResearchSuite(suitePayload(), expected).year, 2020);
  assert.throws(() => validateResearchSuite(suitePayload({ planet: 'mars' }), expected), /Earth/);
  assert.throws(
    () => validateResearchSuite(suitePayload({ dataset_id: 'earth_merra2_daily_v1' }), expected),
    /dataset mismatch/,
  );
  assert.throws(
    () => validateResearchSuite(suitePayload({ dataset_fingerprint: 'b'.repeat(64) }), expected),
    /version changed/,
  );
  assert.throws(() => validateResearchSuite(suitePayload({ year: 2021 }), expected), /year mismatch/);
  assert.throws(
    () => validateResearchSuite(suitePayload({ dates: ['2020-01-01'], day_count: 2 }), expected),
    /Invalid suite dates/,
  );
  assert.throws(
    () => validateResearchSuite(suitePayload({ seasonal: { TO3: { z: [[1, 2]] } } }), expected),
    /Invalid seasonal matrix/,
  );
});

test('spatial diagnostics validation enforces the 36x72 style shape', () => {
  const expected = { datasetId: DATASET_ID, fingerprint: FINGERPRINT, year: 2020, variable: 'TO3' };
  const payload = {
    planet: 'earth',
    dataset_id: DATASET_ID,
    dataset_fingerprint: FINGERPRINT,
    year: 2020,
    variable: 'TO3',
    lat: [-87.5, 87.5],
    lon: [-177.5, 177.5],
    anomaly: [[1, 2], [3, 4]],
  };
  assert.equal(validateSpatialDiagnostics(payload, expected).variable, 'TO3');
  assert.throws(
    () => validateSpatialDiagnostics({ ...payload, variable: 'T2M' }, expected),
    /variable mismatch/,
  );
  assert.throws(
    () => validateSpatialDiagnostics({ ...payload, anomaly: [[1, 2, 3], [4, 5, 6]] }, expected),
    /Invalid anomaly width/,
  );
});

test('polar validation requires polar bands and the Earth identity', () => {
  const expected = { datasetId: DATASET_ID, fingerprint: FINGERPRINT, year: 2021 };
  const payload = {
    planet: 'earth',
    dataset_id: DATASET_ID,
    dataset_fingerprint: FINGERPRINT,
    year: 2021,
    bands: [{ id: 'north_polar' }, { id: 'south_polar' }],
  };
  assert.equal(validatePolarDynamics(payload, expected).bands.length, 2);
  assert.throws(() => validatePolarDynamics({ ...payload, bands: [] }, expected), /Invalid polar bands/);
});
