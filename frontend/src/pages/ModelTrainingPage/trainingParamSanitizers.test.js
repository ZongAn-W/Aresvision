import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildTrainingHyperparameters,
  getTransferFreezeModes,
  getModelStructureParamLabel,
  sanitizeNonNegativeInteger,
  sanitizePositiveInteger,
  sanitizePositiveNumber,
} from './trainingParamSanitizers.js';

test('returns model structure parameter labels for the selected language', () => {
  assert.equal(getModelStructureParamLabel('spatial_hidden_dim', 'zh'), '空间隐藏维度');
  assert.equal(getModelStructureParamLabel('n_heads', 'zh'), '注意力头数');
  assert.equal(getModelStructureParamLabel('patch_len', 'en'), 'Patch Length');
  assert.equal(getModelStructureParamLabel('unknown_param', 'zh'), 'unknown_param');
});

test('sanitizes negative core training parameters before they are submitted', () => {
  const hyperparameters = buildTrainingHyperparameters({
    epochs: -12,
    batchSize: -3,
    learningRate: -0.2,
    hiddenDims: [-16, '', 48],
    windowValue: -4,
    horizon: 0,
    earlyStoppingPatience: -5,
    seed: -11,
    selectedChannels: ['D', 'T'],
    channelOrder: ['U', 'V', 'D', 'S', 'T'],
    modelArchitecture: 'simvp',
    useSphere: true,
    architectureParamsByModel: {
      simvp: {
        spatial_hidden_dim: -12,
        temporal_hidden_dim: '',
        temporal_depth: 3,
        dropout: 1.8,
      },
    },
  });

  assert.deepEqual(hyperparameters, {
    epochs: 1,
    batch_size: 1,
    learning_rate: 0.000001,
    training_dataset: 'openmars_mcd',
    window: 1,
    horizon: 1,
    early_stopping_patience: 0,
    seed: 0,
    selected_channels: ['D', 'T'],
    model_architecture: 'simvp',
    use_sphere: true,
    train_ratio: 0.7,
    validation_ratio: 0.2,
    test_ratio: 0.1,
    spatial_hidden_dim: 1,
    temporal_hidden_dim: 128,
    temporal_depth: 3,
    dropout: 0.9,
  });
  assert.equal('stlstm_hidden_dims' in hyperparameters, false);
});

test('sanitizes training dataset selection before submitting', () => {
  const defaulted = buildTrainingHyperparameters({
    epochs: 10,
    batchSize: 32,
    learningRate: 0.001,
    hiddenDims: [64, 64, 64],
    windowValue: 3,
    horizon: 3,
    earlyStoppingPatience: 0,
    seed: 11,
    selectedChannels: [],
    channelOrder: ['U', 'V', 'D', 'S', 'T'],
    modelArchitecture: 'predrnnv2',
    useSphere: false,
    architectureParamsByModel: {},
  });
  const selected = buildTrainingHyperparameters({
    epochs: 10,
    batchSize: 32,
    learningRate: 0.001,
    hiddenDims: [64, 64, 64],
    windowValue: 3,
    horizon: 3,
    earlyStoppingPatience: 0,
    seed: 11,
    selectedChannels: [],
    channelOrder: ['U', 'V', 'D', 'S', 'T'],
    modelArchitecture: 'predrnnv2',
    useSphere: false,
    architectureParamsByModel: {},
    trainingDataset: 'mcd_overview',
  });
  const invalid = buildTrainingHyperparameters({
    epochs: 10,
    batchSize: 32,
    learningRate: 0.001,
    hiddenDims: [64, 64, 64],
    windowValue: 3,
    horizon: 3,
    earlyStoppingPatience: 0,
    seed: 11,
    selectedChannels: [],
    channelOrder: ['U', 'V', 'D', 'S', 'T'],
    modelArchitecture: 'predrnnv2',
    useSphere: false,
    architectureParamsByModel: {},
    trainingDataset: 'bad_dataset',
  });

  assert.equal(defaulted.training_dataset, 'openmars_mcd');
  assert.equal(selected.training_dataset, 'mcd_overview');
  assert.equal(invalid.training_dataset, 'openmars_mcd');
});

test('submits recurrent hidden dims only for recurrent architectures', () => {
  const hyperparameters = buildTrainingHyperparameters({
    epochs: 10,
    batchSize: 32,
    learningRate: 0.001,
    hiddenDims: [-16, '', 48],
    windowValue: 3,
    horizon: 3,
    earlyStoppingPatience: 0,
    seed: 11,
    selectedChannels: [],
    channelOrder: ['U', 'V', 'D', 'S', 'T'],
    modelArchitecture: 'convlstm',
    useSphere: false,
    architectureParamsByModel: {},
  });

  assert.deepEqual(hyperparameters.stlstm_hidden_dims, [1, 64, 48]);
});

test('submits only structure parameters used by the selected architecture', () => {
  const hyperparameters = buildTrainingHyperparameters({
    epochs: 10,
    batchSize: 32,
    learningRate: 0.001,
    hiddenDims: [32, 48],
    windowValue: 4,
    horizon: 2,
    earlyStoppingPatience: 0,
    seed: 11,
    selectedChannels: ['U', 'D'],
    channelOrder: ['U', 'V', 'D', 'S', 'T'],
    modelArchitecture: 'patchtst',
    useSphere: false,
    architectureParamsByModel: {
      patchtst: {
        patch_len: 0,
        stride: 2,
        d_model: 96,
        n_heads: 4,
        e_layers: 2,
        d_ff: 192,
        dropout: -0.4,
      },
      simvp: {
        spatial_hidden_dim: 128,
      },
    },
  });

  assert.deepEqual(hyperparameters, {
    epochs: 10,
    batch_size: 32,
    learning_rate: 0.001,
    training_dataset: 'openmars_mcd',
    window: 4,
    horizon: 2,
    early_stopping_patience: 0,
    seed: 11,
    selected_channels: ['U', 'D'],
    model_architecture: 'patchtst',
    use_sphere: false,
    train_ratio: 0.7,
    validation_ratio: 0.2,
    test_ratio: 0.1,
    patch_len: 1,
    stride: 2,
    d_model: 96,
    n_heads: 4,
    e_layers: 2,
    d_ff: 192,
    dropout: 0,
  });
});

test('submits migrated ablation structure parameters with numeric list sanitizing', () => {
  const hyperparameters = buildTrainingHyperparameters({
    epochs: 10,
    batchSize: 32,
    learningRate: 0.001,
    hiddenDims: [32, 48],
    windowValue: 4,
    horizon: 2,
    earlyStoppingPatience: 0,
    seed: 11,
    selectedChannels: ['D'],
    channelOrder: ['U', 'V', 'D', 'S', 'T'],
    modelArchitecture: 'earthformer',
    useSphere: false,
    architectureParamsByModel: {
      earthformer: {
        d_model: 96,
        n_heads: 4,
        e_layers: 2,
        patch_size: [2],
        cuboid_size: '1,0,3',
        mlp_ratio: '',
        dropout: -0.4,
      },
    },
  });

  assert.deepEqual(hyperparameters, {
    epochs: 10,
    batch_size: 32,
    learning_rate: 0.001,
    training_dataset: 'openmars_mcd',
    window: 4,
    horizon: 2,
    early_stopping_patience: 0,
    seed: 11,
    selected_channels: ['D'],
    model_architecture: 'earthformer',
    use_sphere: false,
    train_ratio: 0.7,
    validation_ratio: 0.2,
    test_ratio: 0.1,
    d_model: 96,
    n_heads: 4,
    e_layers: 2,
    patch_size: [1, 2, 2],
    cuboid_size: [1, 3, 2],
    mlp_ratio: 2,
    dropout: 0,
  });
});

test('submits configured dataset split ratios', () => {
  const hyperparameters = buildTrainingHyperparameters({
    epochs: 10,
    batchSize: 32,
    learningRate: 0.001,
    windowValue: 3,
    horizon: 3,
    earlyStoppingPatience: 0,
    seed: 11,
    selectedChannels: ['D'],
    channelOrder: ['U', 'V', 'D', 'S', 'T'],
    modelArchitecture: 'predrnnv2',
    useSphere: false,
    architectureParamsByModel: {},
    trainRatio: 0.6,
    validationRatio: 0.25,
    testRatio: 0.15,
  });

  assert.equal(hyperparameters.train_ratio, 0.6);
  assert.equal(hyperparameters.validation_ratio, 0.25);
  assert.equal(hyperparameters.test_ratio, 0.15);
});

test('adds transfer learning parameters when a task source is enabled', () => {
  const hyperparameters = buildTrainingHyperparameters({
    epochs: 10,
    batchSize: 32,
    learningRate: 0.001,
    hiddenDims: [64, 64, 64],
    windowValue: 3,
    horizon: 3,
    earlyStoppingPatience: 0,
    seed: 11,
    selectedChannels: ['U'],
    channelOrder: ['U', 'V', 'D', 'S', 'T'],
    modelArchitecture: 'predrnnv2',
    useSphere: false,
    architectureParamsByModel: {},
    transferLearning: {
      enabled: true,
      sourceType: 'task',
      sourceTaskId: '12',
      weightId: '',
      freezeMode: 'backbone',
      finetuneLearningRate: '0.0001',
    },
  });

  assert.equal(hyperparameters.transfer_learning, true);
  assert.equal(hyperparameters.transfer_source_type, 'task');
  assert.equal(hyperparameters.transfer_source_task_id, 12);
  assert.equal(hyperparameters.transfer_weight_id, '');
  assert.equal(hyperparameters.transfer_load_mode, 'strict');
  assert.equal(hyperparameters.freeze_mode, 'backbone');
  assert.equal(hyperparameters.finetune_learning_rate, 0.0001);
});

test('limits uploaded model transfer freeze mode to none', () => {
  assert.deepEqual(getTransferFreezeModes('uploaded'), ['none']);
  assert.deepEqual(getTransferFreezeModes('official'), ['none', 'backbone', 'head']);

  const hyperparameters = buildTrainingHyperparameters({
    epochs: 10,
    batchSize: 32,
    learningRate: 0.001,
    hiddenDims: [64, 64, 64],
    windowValue: 3,
    horizon: 3,
    earlyStoppingPatience: 0,
    seed: 11,
    selectedChannels: ['U'],
    channelOrder: ['U', 'V', 'D', 'S', 'T'],
    modelArchitecture: 'predrnnv2',
    modelSource: 'uploaded',
    useSphere: false,
    architectureParamsByModel: {},
    transferLearning: {
      enabled: true,
      sourceType: 'task',
      sourceTaskId: '12',
      weightId: '',
      freezeMode: 'head',
      finetuneLearningRate: '0.0001',
    },
  });

  assert.equal(hyperparameters.freeze_mode, 'none');
});

test('omits transfer learning parameters when disabled', () => {
  const hyperparameters = buildTrainingHyperparameters({
    epochs: 10,
    batchSize: 32,
    learningRate: 0.001,
    hiddenDims: [64, 64, 64],
    windowValue: 3,
    horizon: 3,
    earlyStoppingPatience: 0,
    seed: 11,
    selectedChannels: [],
    channelOrder: ['U', 'V', 'D', 'S', 'T'],
    modelArchitecture: 'predrnnv2',
    useSphere: false,
    architectureParamsByModel: {},
    transferLearning: {
      enabled: false,
      sourceType: 'upload',
      sourceTaskId: '99',
      weightId: 'weight-id',
      finetuneLearningRate: '0.0001',
    },
  });

  assert.equal('transfer_learning' in hyperparameters, false);
  assert.equal('transfer_source_type' in hyperparameters, false);
});

test('keeps gated MST initial probabilities inside the backend-supported open interval', () => {
  const hyperparameters = buildTrainingHyperparameters({
    epochs: 10,
    batchSize: 32,
    learningRate: 0.001,
    hiddenDims: [32, 48],
    windowValue: 4,
    horizon: 2,
    earlyStoppingPatience: 0,
    seed: 11,
    selectedChannels: ['D'],
    channelOrder: ['U', 'V', 'D', 'S', 'T'],
    modelArchitecture: 'convlstm_phase_gated_mst',
    useSphere: false,
    architectureParamsByModel: {
      convlstm_phase_gated_mst: {
        initial_history_weight: -1,
        initial_translation_weight: 0,
      },
    },
  });

  assert.ok(hyperparameters.initial_history_weight > 0);
  assert.ok(hyperparameters.initial_translation_weight > 0);
});

test('keeps blank edit states on defaults while clamping finite low values', () => {
  assert.equal(sanitizePositiveInteger('', 10), 10);
  assert.equal(sanitizePositiveInteger(0, 10), 1);
  assert.equal(sanitizePositiveInteger(2.4, 10), 2);

  assert.equal(sanitizePositiveNumber('', 0.001), 0.001);
  assert.equal(sanitizePositiveNumber(0, 0.001), 0.000001);
  assert.equal(sanitizePositiveNumber(0.0007, 0.001), 0.0007);

  assert.equal(sanitizeNonNegativeInteger('', 0), 0);
  assert.equal(sanitizeNonNegativeInteger(-3, 0), 0);
  assert.equal(sanitizeNonNegativeInteger(250, 0, 200), 200);
});
