import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EARTH_CHANNEL_ORDER,
  EARTH_DATASET_ID,
  EARTH_HORIZON,
  EARTH_OPTIONAL_CHANNELS,
  EARTH_WINDOW,
  applyEarthTrainingDefaults,
  buildEarthTrainingHyperparameters,
  captureMarsTrainingSnapshot,
  describeEarthInputUnits,
  describeEarthSplitSamples,
  isEarthTrainingDataset,
  normalizeEarthSelectedChannels,
  readEarthDatasetAvailability,
  resolveMarsTrainingRestore,
  getEarthTrainingReadiness,
} from './earthTrainingConfig.js';
import { sanitizeTrainingDataset } from './trainingParamSanitizers.js';

const AVAILABLE_DESCRIPTOR = {
  dataset_id: EARTH_DATASET_ID,
  display_name: 'MERRA-2 daily global 5 degree compact v2',
  planet: 'earth',
  dataset_version: 'v2',
  dataset_fingerprint: 'f'.repeat(64),
  availability: 'available',
  availability_reason: null,
  capabilities: { metadata: true, training: true, web_overview: true, trained_prediction: true },
  splits: {
    train: { start: '2020-01-01', end: '2020-12-31', days: 366 },
    validation: { start: '2021-01-01', end: '2021-06-30', days: 181 },
    test: { start: '2021-07-01', end: '2021-12-31', days: 184 },
  },
  training_profile: { window: EARTH_WINDOW, horizon: EARTH_HORIZON, grid_shape: [36, 72] },
};

test('Earth payload fixes the dataset, window/horizon and channel order', () => {
  const payload = buildEarthTrainingHyperparameters({ selectedChannels: ['SWGDN', 'U10M'] });
  assert.equal(payload.training_dataset, 'earth_merra2_daily_v2');
  assert.equal(payload.model_architecture, 'dlinear');
  assert.equal(payload.model_source, 'official');
  assert.equal(payload.window, 7);
  assert.equal(payload.horizon, 3);
  assert.equal(payload.use_sphere, false);
  assert.equal(payload.transfer_learning, false);
  // 请求顺序不影响模型通道顺序：规范顺序固定为 U10M、V10M、T2M、SWGDN。
  assert.deepEqual(payload.selected_channels, ['U10M', 'SWGDN']);
});

test('Earth payload preserves the ozone-only selection instead of restoring defaults', () => {
  const payload = buildEarthTrainingHyperparameters({ selectedChannels: [] });
  assert.deepEqual(payload.selected_channels, []);
});

test('Earth payload never carries server identity or Mars-only fields', () => {
  const payload = buildEarthTrainingHyperparameters({ selectedChannels: EARTH_OPTIONAL_CHANNELS });
  [
    'dataset_version',
    'dataset_fingerprint',
    'dataset_identity_status',
    'dataset_snapshot',
    'transfer_source_task_id',
    'transfer_weight_id',
    'freeze_mode',
    '_data_source',
    '_uploaded_model_path',
    'custom_model_params',
  ].forEach((key) => {
    assert.equal(Object.hasOwn(payload, key), false, `${key} must not be sent`);
  });
});

test('Earth payload clamps only to the documented Earth ranges', () => {
  const payload = buildEarthTrainingHyperparameters({
    epochs: 5000,
    batchSize: 500,
    learningRate: 12,
    seed: -3,
    earlyStoppingPatience: 9999,
    linearHiddenLayers: 9,
  });
  assert.equal(payload.epochs, 1000);
  assert.equal(payload.batch_size, 64);
  assert.equal(payload.learning_rate, 1);
  assert.equal(payload.seed, 0);
  assert.equal(payload.early_stopping_patience, 200);
  assert.equal(payload.linear_hidden_layers, 4);
});

test('Earth channel normalisation drops unknown and duplicate channels', () => {
  assert.deepEqual(normalizeEarthSelectedChannels(['U10M', 'U10M', 'NOPE', 't2m']), ['U10M', 'T2M']);
  assert.deepEqual(normalizeEarthSelectedChannels('U10M'), []);
  assert.deepEqual(normalizeEarthSelectedChannels(undefined), []);
});

test('Earth channel order keeps TO3 first', () => {
  assert.deepEqual(EARTH_CHANNEL_ORDER, ['TO3', 'U10M', 'V10M', 'T2M', 'SWGDN']);
});

test('dataset availability separates wiring from data state', () => {
  const available = readEarthDatasetAvailability(AVAILABLE_DESCRIPTOR);
  assert.equal(available.selectable, true);
  assert.equal(available.datasetVersion, 'v2');
  assert.equal(available.fingerprint, 'f'.repeat(64));

  const missing = readEarthDatasetAvailability({ ...AVAILABLE_DESCRIPTOR, availability: 'missing', availability_reason: 'package_missing' });
  assert.equal(missing.selectable, false);
  assert.equal(missing.reason, 'package_missing');

  const notWired = readEarthDatasetAvailability({
    ...AVAILABLE_DESCRIPTOR,
    capabilities: { metadata: true, training: false, web_overview: true, trained_prediction: false },
  });
  assert.equal(notWired.selectable, false);

  assert.equal(readEarthDatasetAvailability(null).selectable, false);
});

test('split sample counts follow the published days instead of hard-coded numbers', () => {
  const rows = describeEarthSplitSamples(AVAILABLE_DESCRIPTOR.splits);
  assert.deepEqual(rows.map((row) => row.name), ['train', 'validation', 'test']);
  assert.deepEqual(rows.map((row) => row.windows), [357, 172, 175]);
  assert.deepEqual(describeEarthSplitSamples(null), []);
});

test('input units list the target first and follow the current selection', () => {
  assert.deepEqual(describeEarthInputUnits(['SWGDN', 'U10M']), [
    { channel: 'TO3', unit: 'DU' },
    { channel: 'U10M', unit: 'm s-1' },
    { channel: 'SWGDN', unit: 'W m-2' },
  ]);
});

test('readiness blocks unavailable data, missing name and out-of-range values', () => {
  const ready = getEarthTrainingReadiness({
    datasetAvailability: readEarthDatasetAvailability(AVAILABLE_DESCRIPTOR),
    epochs: 10,
    batchSize: 8,
    learningRate: 0.001,
    modelName: 'Earth DLinear',
  });
  assert.equal(ready.ready, true);
  assert.deepEqual(ready.blockers, []);

  const blocked = getEarthTrainingReadiness({
    datasetAvailability: readEarthDatasetAvailability({ ...AVAILABLE_DESCRIPTOR, availability: 'invalid' }),
    epochs: 0,
    batchSize: 999,
    learningRate: 0,
    modelName: '   ',
  });
  assert.equal(blocked.ready, false);
  ['dataset_unavailable', 'model_name_required', 'epochs_out_of_range', 'batch_size_out_of_range', 'learning_rate_out_of_range']
    .forEach((code) => assert.ok(blocked.blockers.includes(code), `${code} should block`));
});

test('switching to Earth stores the Mars form and switching back restores it', () => {
  const marsValues = {
    trainingDataset: 'mcd_overview',
    modelSource: 'uploaded',
    selectedUploadedModelId: 'model-1',
    modelArchitecture: 'simvp',
    useSphere: true,
    windowValue: 5,
    horizon: 4,
    transferEnabled: true,
    selectedChannels: ['U', 'T'],
  };
  const snapshot = captureMarsTrainingSnapshot(marsValues);
  const earth = applyEarthTrainingDefaults({ storedMarsSnapshot: snapshot });

  // Earth 生效值必须覆盖火星字段（快照只保存、不应用）。
  assert.equal(earth.trainingDataset, EARTH_DATASET_ID);
  assert.equal(earth.modelSource, 'official');
  assert.equal(earth.modelArchitecture, 'dlinear');
  assert.equal(earth.useSphere, false);
  assert.equal(earth.windowValue, EARTH_WINDOW);
  assert.equal(earth.horizon, EARTH_HORIZON);
  assert.equal(earth.transferEnabled, false);
  assert.equal(earth.selectedUploadedModelId, '');
  assert.deepEqual(earth.selectedChannels, EARTH_OPTIONAL_CHANNELS);
  assert.deepEqual(earth.storedMarsSnapshot, snapshot);

  // 切回火星恢复原值，避免 Earth 通道流入火星请求。
  assert.deepEqual(resolveMarsTrainingRestore(snapshot), marsValues);
  assert.equal(resolveMarsTrainingRestore(null), null);
});

test('the shared sanitizer keeps Earth out of Mars requests unless Earth is allowed', () => {
  assert.equal(sanitizeTrainingDataset(EARTH_DATASET_ID), 'openmars_mcd');
  assert.equal(sanitizeTrainingDataset(EARTH_DATASET_ID, { allowEarth: true }), EARTH_DATASET_ID);
  assert.equal(isEarthTrainingDataset(EARTH_DATASET_ID), true);
  assert.equal(isEarthTrainingDataset('openmars_mcd'), false);
});
