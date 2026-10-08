export const DEFAULT_TRAINING_DEFAULTS = Object.freeze({
  epochs: 10,
  batchSize: 32,
  learningRate: 0.001,
  window: 3,
  horizon: 3,
  trainRatio: 0.7,
  validationRatio: 0.2,
  testRatio: 0.1,
  earlyStoppingPatience: 0,
  seed: 11,
  transferEnabled: false,
  transferFreezeMode: 'none',
  finetuneLearningRate: 0.0001,
});

const TRANSFER_FREEZE_MODES = new Set(['none', 'backbone', 'head']);

function positiveInteger(value, fallback, { allowZero = false, max = Number.POSITIVE_INFINITY } = {}) {
  const parsed = Number(value);
  const minimum = allowZero ? 0 : 1;
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= max ? parsed : fallback;
}

function positiveNumber(value, fallback, max = 1) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= max ? parsed : fallback;
}

function isValidSplit(ratios) {
  return Number.isFinite(ratios[0]) && ratios[0] > 0 && ratios[0] < 1
    && Number.isFinite(ratios[1]) && ratios[1] >= 0 && ratios[1] < 1
    && Number.isFinite(ratios[2]) && ratios[2] > 0 && ratios[2] < 1
    && Math.abs(ratios.reduce((sum, ratio) => sum + ratio, 0) - 1) < 0.000001;
}

/** Normalize saved settings before they seed the training form. */
export function normalizeTrainingDefaults(value) {
  const source = value && typeof value === 'object' ? value : {};
  const ratios = [Number(source.trainRatio), Number(source.validationRatio), Number(source.testRatio)];
  const split = isValidSplit(ratios)
    ? ratios
    : [
        DEFAULT_TRAINING_DEFAULTS.trainRatio,
        DEFAULT_TRAINING_DEFAULTS.validationRatio,
        DEFAULT_TRAINING_DEFAULTS.testRatio,
      ];

  return {
    epochs: positiveInteger(source.epochs, DEFAULT_TRAINING_DEFAULTS.epochs, { max: 1000 }),
    batchSize: positiveInteger(source.batchSize, DEFAULT_TRAINING_DEFAULTS.batchSize, { max: 64 }),
    learningRate: positiveNumber(source.learningRate, DEFAULT_TRAINING_DEFAULTS.learningRate),
  window: positiveInteger(source.window, DEFAULT_TRAINING_DEFAULTS.window, { max: 240 }),
  horizon: positiveInteger(source.horizon, DEFAULT_TRAINING_DEFAULTS.horizon, { max: 240 }),
    trainRatio: split[0],
    validationRatio: split[1],
    testRatio: split[2],
    earlyStoppingPatience: positiveInteger(
      source.earlyStoppingPatience,
      DEFAULT_TRAINING_DEFAULTS.earlyStoppingPatience,
      { allowZero: true, max: 200 },
    ),
    seed: positiveInteger(source.seed, DEFAULT_TRAINING_DEFAULTS.seed, { allowZero: true, max: 2147483647 }),
    transferEnabled: source.transferEnabled === true,
    transferFreezeMode: TRANSFER_FREEZE_MODES.has(source.transferFreezeMode)
      ? source.transferFreezeMode
      : DEFAULT_TRAINING_DEFAULTS.transferFreezeMode,
    finetuneLearningRate: positiveNumber(
      source.finetuneLearningRate,
      DEFAULT_TRAINING_DEFAULTS.finetuneLearningRate,
    ),
  };
}

/** Read valid defaults that may still update an unedited experiment draft. */
export function getTrainingDefaultUpdates(value, { editedFields = [], excludedFields = [] } = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const normalized = normalizeTrainingDefaults(source);
  const protectedFields = new Set([...editedFields, ...excludedFields]);
  const ratioKeys = ['trainRatio', 'validationRatio', 'testRatio'];
  const isNumericInput = (raw) => (typeof raw === 'number' || typeof raw === 'string')
    && String(raw).trim() !== '' && Number.isFinite(Number(raw));
  // A split is one configuration: never apply an incomplete edit or replace
  // only part of a split that the user has already customized.
  const canUpdateSplit = ratioKeys.every((key) => !protectedFields.has(key) && isNumericInput(source[key]))
    && isValidSplit(ratioKeys.map((key) => Number(source[key])));

  return Object.fromEntries(Object.entries(normalized).filter(([key, nextValue]) => {
    if (protectedFields.has(key)) return false;
    if (ratioKeys.includes(key)) return canUpdateSplit;
    if (typeof nextValue === 'number') return isNumericInput(source[key]) && Number(source[key]) === nextValue;
    return source[key] === nextValue;
  }));
}
