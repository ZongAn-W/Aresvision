import test from 'node:test';
import assert from 'node:assert/strict';
import { createTrainingDraftSession } from './trainingDraftSession.js';
import { DEFAULT_TRAINING_DEFAULTS, getTrainingDefaultUpdates } from '../../utils/trainingDefaults.js';
import { buildTrainingHyperparameters } from './trainingParamSanitizers.js';
import { buildEarthTrainingHyperparameters } from './earthTrainingConfig.js';

const earthId = 'earth_merra2_3hourly_v1';
const defaults = { ...DEFAULT_TRAINING_DEFAULTS, window: 56, horizon: 24 };
const schema = { width: { type: 'int', default: 32 }, bias: { type: 'bool', default: true } };
const marsDraft = (trainingDataset = 'mcd_overview') => ({
  trainingDataset, modelSource: 'uploaded', selectedUploadedModelId: 'shared-model',
  customModelParams: { width: 19, bias: false, nested: { cells: [2, 3] } },
  modelArchitecture: 'convlstm', useSphere: true, selectedChannels: ['U', 'T'],
  hiddenDims: [12, 24], stlstmLayers: 2, architectureParamsByModel: { simvp: { hid_s: 41 } },
  windowValue: 5, horizon: 4, trainRatio: .8, validationRatio: 0, testRatio: .2,
  transferEnabled: true, transferSourceType: 'task', transferSourceTaskId: '17',
  selectedTrainingWeightId: 'weight-1', transferFreezeMode: 'backbone', finetuneLearningRate: .0002,
  transferStructureSnapshot: { customModelParams: { width: 11 }, hiddenDims: [7] },
  editedDefaultFields: ['window', 'horizon', 'trainRatio', 'epochs'],
});

for (const dataset of ['openmars_mcd', 'mcd_overview']) {
  test(`${dataset} round trip keeps full Mars draft and submission contract`, () => {
    const session = createTrainingDraftSession();
    const original = marsDraft(dataset);
    let earth = session.switchDataset(original, earthId, defaults);
    assert.equal(earth.transferEnabled, false);
    assert.equal(earth.transferSourceTaskId, '');
    assert.equal(earth.transferStructureSnapshot, null);
    assert.equal(earth.useSphere, false);
    earth = { ...earth, selectedUploadedModelId: 'shared-model', modelSource: 'uploaded',
      customModelParams: { width: 73, bias: true }, selectedChannels: ['U10M'],
      windowValue: 12, horizon: 8, editedDefaultFields: ['window', 'horizon', 'epochs', 'seed'] };
    session.preserveCustomParams(earthId, 'shared-model');
    assert.equal(session.switchDataset(earth, earthId, defaults), null);
    const restored = session.switchDataset(earth, dataset, defaults);
    assert.deepEqual(restored, { ...original, editedDefaultFields: ['epochs', 'seed', 'window', 'horizon', 'trainRatio'] });
    const params = session.syncCustomParams(dataset, 'shared-model', schema, restored.customModelParams);
    assert.equal(params.width, 19);
    assert.equal(params.bias, false);
    const updates = getTrainingDefaultUpdates(defaults, { editedFields: restored.editedDefaultFields });
    assert.equal(Object.hasOwn(updates, 'window'), false);
    assert.equal(Object.hasOwn(updates, 'trainRatio'), false);
    const submission = buildTrainingHyperparameters({ ...restored, channelOrder: ['U', 'V', 'D', 'S', 'T'],
      transferLearning: { enabled: restored.transferEnabled, sourceType: restored.transferSourceType,
        sourceTaskId: restored.transferSourceTaskId, freezeMode: restored.transferFreezeMode } });
    assert.equal(submission.training_dataset, dataset);
    assert.deepEqual(submission.selected_channels, ['U', 'T']);
    assert.equal(submission.window, 5);
    assert.equal(submission.horizon, 4);
    assert.equal(submission.transfer_source_task_id, 17);
    assert.deepEqual(submission.stlstm_hidden_dims, [12, 24]);
    const back = session.switchDataset(restored, earthId, defaults);
    const earthParams = session.syncCustomParams(earthId, 'shared-model', schema, back.customModelParams);
    assert.deepEqual(earthParams, { width: 73, bias: true });
    const earthSubmission = buildEarthTrainingHyperparameters(back);
    assert.deepEqual(earthSubmission.selected_channels, ['U10M']);
    assert.equal(earthSubmission.window, 12);
    assert.equal(earthSubmission.horizon, 8);
    assert.equal(earthSubmission.transfer_learning, false);
  });
}

test('direct Mars dataset changes preserve draft and cannot erase the saved scene', () => {
  const session = createTrainingDraftSession();
  const draft = marsDraft('openmars_mcd');
  const mcd = session.switchDataset(draft, 'mcd_overview', defaults);
  assert.deepEqual(mcd, { ...draft, trainingDataset: 'mcd_overview', editedDefaultFields: ['epochs', 'window', 'horizon', 'trainRatio'] });
  const earth = session.switchDataset(mcd, earthId, defaults);
  assert.equal(session.switchDataset(earth, earthId, defaults), null);
  const restored = session.switchDataset(earth, 'mcd_overview', defaults);
  assert.equal(restored.customModelParams.width, 19);
  assert.deepEqual(restored.selectedChannels, ['U', 'T']);
});

test('saved structures are deep copies and retain migration undo state', () => {
  const session = createTrainingDraftSession();
  const draft = marsDraft();
  const earth = session.switchDataset(draft, earthId, defaults);
  draft.customModelParams.nested.cells[0] = 99;
  draft.hiddenDims[0] = 99;
  draft.transferStructureSnapshot.hiddenDims[0] = 99;
  const restored = session.switchDataset(earth, 'mcd_overview', defaults);
  assert.deepEqual(restored.hiddenDims, [12, 24]);
  assert.deepEqual(restored.customModelParams.nested.cells, [2, 3]);
  assert.deepEqual(restored.transferStructureSnapshot.hiddenDims, [7]);
});

test('copied and edited params survive late/equivalent schemas, model changes use defaults', () => {
  const session = createTrainingDraftSession();
  session.preserveCustomParams(earthId, 'model-a');
  let params = session.syncCustomParams(earthId, 'model-a', {}, { width: 71, bias: false });
  params = session.syncCustomParams(earthId, 'model-a', schema, params);
  assert.deepEqual(params, { width: 71, bias: false });
  params.width = 81;
  params = session.syncCustomParams(earthId, 'model-a', structuredClone(schema), params);
  assert.equal(params.width, 81);
  params = session.syncCustomParams(earthId, 'model-b', schema, params);
  assert.deepEqual(params, { width: 32, bias: true });
  params = session.syncCustomParams(earthId, 'model-a', schema, params);
  assert.deepEqual(params, { width: 32, bias: true });
});

test('copy and new experiment reset old scene snapshots', () => {
  const session = createTrainingDraftSession();
  const earth = session.switchDataset(marsDraft(), earthId, defaults);
  session.reset();
  session.preserveCustomParams(earthId, 'copied-model');
  const copied = { ...earth, modelSource: 'uploaded', selectedUploadedModelId: 'copied-model',
    customModelParams: { width: 55 }, windowValue: 9 };
  const mars = session.switchDataset(copied, 'mcd_overview', defaults);
  assert.equal(mars.transferSourceTaskId, '');
  assert.equal(mars.transferEnabled, defaults.transferEnabled);
  assert.equal(mars.windowValue, defaults.window);
  const copiedAgain = session.switchDataset(mars, earthId, defaults);
  assert.equal(copiedAgain.windowValue, 9);
  assert.equal(copiedAgain.customModelParams.width, 55);
  session.reset();
  assert.deepEqual(session.syncCustomParams(earthId, 'copied-model', schema, copiedAgain.customModelParams),
    { width: 32, bias: true });
});
