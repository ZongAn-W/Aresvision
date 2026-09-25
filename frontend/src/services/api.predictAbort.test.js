import test from 'node:test';
import assert from 'node:assert/strict';

import {
  compareTrainingModelErrorDistributions,
  compareTrainingModelPfi,
  compareTrainingModels,
  fetchErrorDistribution,
  fetchPermutationImportance,
  fetchPredictMetrics,
  runPrediction,
} from './api.js';

function installFetchRecorder() {
  const calls = [];
  globalThis.localStorage = { getItem: () => null, removeItem: () => {} };
  globalThis.window = { dispatchEvent: () => {} };
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({}),
    };
  };
  return calls;
}

test('all protected prediction analysis APIs pass AbortSignal to fetch', async () => {
  const calls = installFetchRecorder();
  const controller = new AbortController();
  const body = {
    selected_variables: ['Temperature'],
    horizon: 3,
    ls_start: 90,
    mars_year: 27,
    training_task_id: 42,
  };

  await runPrediction(body, { dataSource: 'default', signal: controller.signal });
  await fetchPredictMetrics(body, { dataSource: 'default', signal: controller.signal });
  await fetchErrorDistribution(['Temperature'], {
    trainingTaskId: 42,
    horizon: 3,
    signal: controller.signal,
  });
  await fetchPermutationImportance(['Temperature'], {
    trainingTaskId: 42,
    marsYear: 27,
    lsStart: 90,
    horizon: 3,
    signal: controller.signal,
  });
  await compareTrainingModels([42, 43], { horizon: 3, signal: controller.signal });
  await compareTrainingModelErrorDistributions([42, 43], { horizon: 3, signal: controller.signal });
  await compareTrainingModelPfi([42, 43], { horizon: 3, signal: controller.signal });

  assert.equal(calls.length, 7);
  calls.forEach(({ options }) => {
    assert.equal(options.signal, controller.signal);
  });
});

test('AbortSignal stays out of prediction URLs and JSON payloads', async () => {
  const calls = installFetchRecorder();
  const controller = new AbortController();

  await compareTrainingModels([3, 2], { horizon: 4, signal: controller.signal });
  await fetchErrorDistribution(['U_Wind'], { horizon: 4, signal: controller.signal });

  assert.equal(calls[0].url, '/api/predict/training-models/compare');
  assert.deepEqual(JSON.parse(calls[0].options.body), { task_ids: [3, 2], horizon: 4 });
  assert.equal(calls[1].url, '/api/predict/error-distribution?vars=U_Wind&horizon=4');
});
