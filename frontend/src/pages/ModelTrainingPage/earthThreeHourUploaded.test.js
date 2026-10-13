import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  EARTH_3HOURLY_DATASET_ID, EARTH_3HOURLY_UPLOAD_SCHEMA, EARTH_3HOURLY_FULL_GRID_SCHEMA,
  getEarthUploadedSelectionBlocker, readEarthUploadedModelCompatibility,
  buildEarthTrainingHyperparameters,
} from './earthTrainingConfig.js';
import { UPLOADED_MODEL_VALIDATION_TIMEOUT } from './uploadedModelValidation.js';

const selection = { modelSource: 'uploaded', uploadedModelId: 'm1', datasetId: EARTH_3HOURLY_DATASET_ID };
const available = { package_id: 'm1', dataset_id: EARTH_3HOURLY_DATASET_ID, status: 'available', compatible: true,
  datasets: { earth_merra2_3hourly_v1: { schema: EARTH_3HOURLY_UPLOAD_SCHEMA } } };

test('full-grid models have a separate schema and count global windows per batch', () => {
  const compatibility = { ...available, contract_schema: EARTH_3HOURLY_FULL_GRID_SCHEMA,
    datasets: { earth_merra2_3hourly_v1: { schema: EARTH_3HOURLY_FULL_GRID_SCHEMA, window: [20], horizon: [20] } } };
  for (const batchSize of [1, 2, 3, 4, 8, 32, 64]) {
    assert.equal(getEarthUploadedSelectionBlocker({ ...selection, compatibility, batchSize, windowValue: 20, horizon: 20 }), null);
    assert.equal(buildEarthTrainingHyperparameters({ modelSource: 'uploaded', batchSize }).batch_size, batchSize);
  }
  for (const batchSize of [0, 65, 1.5, '', NaN]) assert.equal(getEarthUploadedSelectionBlocker({ ...selection, compatibility, batchSize }), 'earth_full_grid_batch_invalid');
  assert.equal(getEarthUploadedSelectionBlocker({ ...selection, compatibility: { ...compatibility, package_id: 'other' }, batchSize: 1 }), 'earth_compatibility_unknown');
});

test('three-hour upload requires a verdict for the exact dataset and schema', () => {
  assert.equal(getEarthUploadedSelectionBlocker({ ...selection, compatibility: available }), null);
  for (const compatibility of [
    { compatible: true },
    { ...available, dataset_id: 'earth_merra2_daily_v2' },
    { ...available, status: 'unknown' },
    { ...available, datasets: {} },
    { ...available, package_id: 'm2' },
  ]) assert.ok(getEarthUploadedSelectionBlocker({ ...selection, compatibility }));
});

test('unknown and unavailable remain distinct with concrete reasons', () => {
  assert.equal(readEarthUploadedModelCompatibility({ status: 'unknown', reasons: ['revalidate'] }).known, false);
  const failed = { ...available, compatible: false, status: 'unavailable', reasons: ['wrong output dtype'] };
  assert.equal(readEarthUploadedModelCompatibility(failed).known, true);
  assert.equal(getEarthUploadedSelectionBlocker({ ...selection, compatibility: failed }), 'wrong output dtype');
});

test('validation timeouts keep compatibility unknown and training blocked with a retry reason', () => {
  for (const timeout of [
    { code: UPLOADED_MODEL_VALIDATION_TIMEOUT, status: 'unknown' },
    { status: 'unavailable', reasons: ['User model validation timed out after 30.0 seconds'] },
  ]) {
    const compatibility = { ...available, ...timeout };
    const verdict = readEarthUploadedModelCompatibility(compatibility);
    assert.equal(verdict.known, false);
    assert.equal(verdict.compatible, false);
    assert.equal(verdict.reason, UPLOADED_MODEL_VALIDATION_TIMEOUT);
    assert.equal(getEarthUploadedSelectionBlocker({ ...selection, compatibility }), UPLOADED_MODEL_VALIDATION_TIMEOUT);
    assert.equal(getEarthUploadedSelectionBlocker({ ...selection,
      compatibility: { ...compatibility, package_id: 'other-model' } }), 'earth_compatibility_unknown');
  }
});

test('three-hour upload payload carries parameters and preserves server-owned identity', () => {
  const payload = buildEarthTrainingHyperparameters({ datasetId: EARTH_3HOURLY_DATASET_ID,
    modelSource: 'uploaded', selectedChannels: ['T2M'], customModelParams: { bias: false } });
  assert.equal(payload.window, 56);
  assert.equal(payload.horizon, 24);
  assert.equal(payload.model_architecture, 'uploaded');
  assert.deepEqual(payload.custom_model_params, { bias: false });
  for (const field of ['data_path', 'dataset_snapshot', 'dataset_version', 'dataset_fingerprint'])
    assert.equal(Object.hasOwn(payload, field), false);
});

test('upload controls and custom parameters are open with dataset-specific downloads', () => {
  const workspace = readFileSync(new URL('./ExperimentConfigWorkspace.jsx', import.meta.url), 'utf8');
  const page = readFileSync(new URL('../ModelTrainingPage.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(workspace, /isUploaded && !isEarthThreeHourly/);
  assert.match(page, /earth-3hourly-template/);
  assert.match(page, /earth-3hourly-guide/);
  assert.match(page, /datasetId: trainingDataset/);
});
