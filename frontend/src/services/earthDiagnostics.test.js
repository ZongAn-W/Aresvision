import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchEarthDiagnosticContext, runEarthDiagnostics } from './earthPredict.js';
import { performTaskAction } from './api.js';
import { buildEarthDiagnosticParameters } from '../pages/PredictPage/earthDiagnosticsModel.js';

function installFetch(handler) {
  globalThis.localStorage = { getItem: () => 'synthetic-token', removeItem: () => {} };
  globalThis.window = { dispatchEvent: () => {} };
  globalThis.fetch = handler;
}

test('Earth availability and diagnosis are authed, abortable and never use Mars paths', async () => {
  const calls = [];
  installFetch(async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => ({ task_id: 31, available: true }) };
  });
  const controller = new AbortController();
  await fetchEarthDiagnosticContext(31, { signal: controller.signal });
  await runEarthDiagnostics(buildEarthDiagnosticParameters(31), { signal: controller.signal });
  assert.equal(calls[0].url, '/api/earth/predict/diagnostics/context?training_task_id=31');
  assert.equal(calls[1].url, '/api/earth/predict/diagnostics');
  assert.equal(calls[1].options.headers.Authorization, 'Bearer synthetic-token');
  assert.equal(calls[1].options.signal, controller.signal);
  assert.deepEqual(JSON.parse(calls[1].options.body), buildEarthDiagnosticParameters(31));
});

test('identical diagnostic requests still reach backend identity validation; browser does not cache them', async () => {
  let count = 0;
  installFetch(async () => ({ ok: true, json: async () => ({ task_id: 31, request: ++count }) }));
  const parameters = buildEarthDiagnosticParameters(31);
  assert.equal((await runEarthDiagnostics(parameters)).request, 1);
  assert.equal((await runEarthDiagnostics(parameters)).request, 2);
});

test('Earth structured diagnostic failures preserve message, code and status', async () => {
  installFetch(async () => ({ ok: false, status: 409, statusText: 'Conflict', json: async () => ({
    detail: { code: 'dataset_version_changed', message: 'Dataset fingerprint changed' },
  }) }));
  await assert.rejects(runEarthDiagnostics(buildEarthDiagnosticParameters(31)), (error) => {
    assert.equal(error.code, 'dataset_version_changed');
    assert.equal(error.status, 409);
    assert.equal(error.message, 'Dataset fingerprint changed'); return true;
  });
});

test('Mars test retains action=test and passes abort; structured failures never become object Object', async () => {
  const controller = new AbortController();
  let request;
  installFetch(async (url, options) => {
    request = { url, options };
    return { ok: false, status: 409, json: async () => ({ detail: { code: 'not_ready', message: 'Task not complete' } }) };
  });
  await assert.rejects(performTaskAction(44, 'test', { signal: controller.signal }), /Task not complete/);
  assert.equal(request.url, '/api/training/tasks/44/action?action=test');
  assert.equal(request.options.signal, controller.signal);
});

test('aborted Earth diagnostic calls propagate cancellation instead of network failure', async () => {
  installFetch(async () => { const error = new Error('Cancelled'); error.name = 'AbortError'; throw error; });
  await assert.rejects(runEarthDiagnostics(buildEarthDiagnosticParameters(31)), (error) => error.name === 'AbortError');
});
