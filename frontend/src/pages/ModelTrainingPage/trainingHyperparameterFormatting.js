import { getVisibleTrainingHyperparameters } from './modelTrainingVisibility.js';

export function formatBooleanHyperparameterValue(value, t) {
  return value
    ? t('modelTraining.hypers.booleanEnabled')
    : t('modelTraining.hypers.booleanDisabled');
}

export function getTrainingParameterLabel(key, t) {
  const path = `modelTraining.hypers.${key}`;
  const label = t(path);
  return label === path ? key.replaceAll('_', ' ') : label;
}

export function buildTrainingHistoryParameters(hyperparameters = {}) {
  const visible = getVisibleTrainingHyperparameters(hyperparameters);
  const summaryKeys = ['window', 'horizon', 'epochs', 'batch_size', 'learning_rate'];
  const summary = summaryKeys.flatMap(key => {
    const entry = visible.find(([name, value]) => name === key && value != null && typeof value !== 'object');
    return entry ? [entry] : [];
  });
  const common = [];
  const groups = [];
  for (const [key, value] of visible) {
    if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length) {
      groups.push({ key, entries: Object.entries(value) });
    } else {
      common.push([key, value]);
    }
  }
  if (common.length) groups.unshift({ key: 'common', entries: common });
  return { summary, groups, count: groups.reduce((count, group) => count + group.entries.length, 0) };
}
