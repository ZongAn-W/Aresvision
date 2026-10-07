import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  EARTH_3HOURLY_DATASET_ID, EARTH_3HOURLY_UPLOAD_SCHEMA,
  getEarthUploadedSelectionBlocker, readEarthUploadedModelCompatibility,
  buildEarthTrainingHyperparameters,
} from './earthTrainingConfig.js';

const selection = { modelSource: 'uploaded', uploadedModelId: 'm1', datasetId: EARTH_3HOURLY_DATASET_ID };
const available = { package_id: 'm1', dataset_id: EARTH_3HOURLY_DATASET_ID, status: 'available', compatible: true,
  datasets: { earth_merra2_3hourly_v1: { schema: EARTH_3HOURLY_UPLOAD_SCHEMA } } };

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
