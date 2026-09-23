import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DatasetApiError,
  fetchDataset,
  fetchDatasets,
  fetchEarthField,
  fetchEarthPointSeries,
  fetchEarthRegionalSeries,
} from './datasets.js';

const FINGERPRINT = 'c'.repeat(64);

/**
 * Swap in a fetch mock for the duration of ``run``.
 *
 * Node's test runner may interleave tests in one file, so this helper asserts it
 * owns the global mock and keeps each test's URL log separate.
 */
async function withFetch(handler, run) {
  const original = globalThis.fetch;
  const own = async (url, options = {}) => handler(String(url), options);
  own.calls = [];
  globalThis.fetch = (url, options = {}) => {
    own.calls.push({ url: String(url), options });
    return own(url, options);
  };
  try {
    return await run(own.calls);
  } finally {
    globalThis.fetch = original;
  }
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: async () => body,
  };
}

test('catalog requests hit the public datasets endpoints', { concurrency: 1 }, async () => {
  await withFetch(
    () => jsonResponse({ items: [] }),
    async (calls) => {
      await fetchDatasets();
      await fetchDataset('earth_merra2_daily_v1');
      assert.equal(calls.length, 2);
      assert.equal(calls[0].url, '/api/datasets');
      assert.equal(calls[1].url, '/api/datasets/earth_merra2_daily_v1');
      // Public read-only: no auth header, no data_source parameter.
      assert.equal(calls[0].options?.headers, undefined);
      assert.equal(calls[0].url.includes('data_source'), false);
    },
  );
});

test('field request sends date, variable and fingerprint verbatim', { concurrency: 1 }, async () => {
  await withFetch(
    () => jsonResponse({ ok: true }),
    async (calls) => {
      await fetchEarthField('earth_merra2_daily_v1', {
        variable: 'TO3', date: '2020-02-29', fingerprint: FINGERPRINT,
      });
      const url = new URL(calls[0].url, 'http://localhost');
      assert.equal(url.pathname, '/api/datasets/earth_merra2_daily_v1/overview/field');
      assert.equal(url.searchParams.get('variable'), 'TO3');
      assert.equal(url.searchParams.get('date'), '2020-02-29');
      assert.equal(url.searchParams.get('expected_fingerprint'), FINGERPRINT);
      // Earth requests never carry Mars selection parameters.
      for (const forbidden of ['my', 'ls', 'data_source', 'upload_id', 'mars_year']) {
        assert.equal(url.searchParams.has(forbidden), false, forbidden);
      }
    },
  );
});

test('point request passes coordinates as numbers and keeps the signal', { concurrency: 1 }, async () => {
  const controller = new AbortController();
  await withFetch(
    () => jsonResponse({ ok: true }),
    async (calls) => {
      await fetchEarthPointSeries('earth_merra2_daily_v1', {
        variable: 'U10M', lat: 0, lon: -117.5, fingerprint: FINGERPRINT,
        start: '2020-01-01', end: '2020-12-31', signal: controller.signal,
      });
      const url = new URL(calls[0].url, 'http://localhost');
      assert.equal(url.pathname, '/api/datasets/earth_merra2_daily_v1/overview/point-series');
      assert.equal(url.searchParams.get('lat'), '0');
      assert.equal(url.searchParams.get('lon'), '-117.5');
      assert.equal(url.searchParams.get('start'), '2020-01-01');
      assert.equal(url.searchParams.get('end'), '2020-12-31');
      assert.equal(calls[0].options.signal, controller.signal);
    },
  );
});

test('regional request omits an unset window instead of sending empty values', { concurrency: 1 }, async () => {
  await withFetch(
    () => jsonResponse({ ok: true }),
    async (calls) => {
      await fetchEarthRegionalSeries('earth_merra2_daily_v1', {
        variable: 'TO3', fingerprint: FINGERPRINT,
      });
      const url = new URL(calls[0].url, 'http://localhost');
      assert.equal(url.searchParams.has('start'), false);
      assert.equal(url.searchParams.has('end'), false);
      assert.equal(url.searchParams.get('expected_fingerprint'), FINGERPRINT);
    },
  );
});

test('dataset ids are URL encoded in the path', { concurrency: 1 }, async () => {
  await withFetch(
    () => jsonResponse({ ok: true }),
    async (calls) => {
      await fetchEarthField('a b/c', { variable: 'TO3', date: '2020-01-01', fingerprint: FINGERPRINT });
      assert.ok(calls[0].url.startsWith('/api/datasets/a%20b%2Fc/overview/field'), calls[0].url);
    },
  );
});

test('structured dataset errors keep code, status and availability reason', { concurrency: 1 }, async () => {
  await withFetch(
    () => jsonResponse({
      detail: {
        code: 'dataset_unavailable',
        message: 'The registered Earth dataset is not available',
        availability_reason: 'package_missing',
      },
    }, 503),
    async () => {
      await assert.rejects(
        () => fetchEarthField('earth_merra2_daily_v1', {
          variable: 'TO3', date: '2020-01-01', fingerprint: FINGERPRINT,
        }),
        (error) => {
          assert.ok(error instanceof DatasetApiError);
          assert.equal(error.code, 'dataset_unavailable');
          assert.equal(error.status, 503);
          assert.equal(error.availabilityReason, 'package_missing');
          return true;
        },
      );
    },
  );
});

test('a version change surfaces as a 409 with a stable code', { concurrency: 1 }, async () => {
  await withFetch(
    () => jsonResponse({ detail: { code: 'dataset_version_changed', message: 'changed' } }, 409),
    async () => {
      await assert.rejects(
        () => fetchEarthRegionalSeries('earth_merra2_daily_v1', { variable: 'TO3', fingerprint: FINGERPRINT }),
        (error) => {
          assert.equal(error.code, 'dataset_version_changed');
          assert.equal(error.status, 409);
          return true;
        },
      );
    },
  );
});

test('reason phrases explain domain errors without leaking internals', { concurrency: 1 }, async () => {
  await withFetch(
    () => jsonResponse({ detail: { code: 'point_outside_coverage', message: 'Point is outside the data coverage' } }, 422),
    async () => {
      await assert.rejects(
        () => fetchEarthPointSeries('earth_merra2_daily_v1', {
          variable: 'TO3', lat: 90, lon: 0, fingerprint: FINGERPRINT,
        }),
        (error) => {
          assert.equal(error.code, 'point_outside_coverage');
          assert.equal(error.message, 'Point is outside the data coverage');
          assert.equal(error.message.includes('Traceback'), false);
          return true;
        },
      );
    },
  );
});

test('validation arrays become a readable message', { concurrency: 1 }, async () => {
  await withFetch(
    () => jsonResponse({
      detail: [{ loc: ['query', 'expected_fingerprint'], msg: 'String should match pattern' }],
    }, 422),
    async () => {
      await assert.rejects(
        () => fetchEarthField('earth_merra2_daily_v1', { variable: 'TO3', date: '2020-01-01', fingerprint: 'x' }),
        (error) => {
          assert.equal(error.code, 'invalid_request');
          assert.match(error.message, /expected_fingerprint/);
          return true;
        },
      );
    },
  );
});

test('a string detail is used directly and a network failure is reported', { concurrency: 1 }, async () => {
  await withFetch(
    () => jsonResponse({ detail: 'Task not found' }, 404),
    async () => {
      await assert.rejects(
        () => fetchDataset('missing'),
        (error) => {
          assert.equal(error.message, 'Task not found');
          assert.equal(error.status, 404);
          return true;
        },
      );
    },
  );

  await withFetch(
    () => { throw new TypeError('fetch failed'); },
    async () => {
      await assert.rejects(
        () => fetchDatasets(),
        (error) => {
          assert.ok(error instanceof DatasetApiError);
          assert.equal(error.code, 'network_error');
          return true;
        },
      );
    },
  );
});

test('AbortError propagates unchanged so callers can ignore cancellations', { concurrency: 1 }, async () => {
  await withFetch(
    () => { const error = new Error('aborted'); error.name = 'AbortError'; throw error; },
    async () => {
      await assert.rejects(
        () => fetchEarthField('earth_merra2_daily_v1', {
          variable: 'TO3', date: '2020-01-01', fingerprint: FINGERPRINT,
        }),
        (error) => {
          assert.equal(error.name, 'AbortError');
          assert.equal(error instanceof DatasetApiError, false);
          return true;
        },
      );
    },
  );
});
