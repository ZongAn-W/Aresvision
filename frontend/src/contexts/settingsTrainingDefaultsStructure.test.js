import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import zh from '../i18n/zh.js';
import en from '../i18n/en.js';

const contextSource = readFileSync(new URL('./SettingsContext.jsx', import.meta.url), 'utf8');
const panelSource = readFileSync(new URL('../components/SettingsPanel.jsx', import.meta.url), 'utf8');
const zhSource = readFileSync(new URL('../i18n/zh.js', import.meta.url), 'utf8');
const enSource = readFileSync(new URL('../i18n/en.js', import.meta.url), 'utf8');

test('settings persist normalized training defaults while retaining raw edits between renders', () => {
  assert.match(contextSource, /from '\.\.\/utils\/trainingDefaults'/);
  assert.match(contextSource, /trainingDefaults:\s*\{\s*\.\.\.DEFAULT_TRAINING_DEFAULTS/s);
  assert.match(contextSource, /normalizeTrainingDefaults\(result\.trainingDefaults\)/);
  assert.match(contextSource, /rawRatio === ''/);
  assert.match(contextSource, /normalizedTrainingDefaults\[key\] = rawRatio === '' \? '' : ratio/);
  assert.match(contextSource, /obj\[keys\[keys\.length - 1\]\] = value/);
  assert.match(contextSource, /localStorage\.setItem\(STORAGE_KEY, JSON\.stringify\(settings\)\)/);
});

test('settings expose common parameter and strategy defaults with ratio validation', () => {
  for (const key of [
    'epochs', 'batchSize', 'learningRate', 'window', 'horizon', 'trainRatio',
    'validationRatio', 'testRatio', 'seed', 'earlyStoppingPatience',
    'transferEnabled', 'transferFreezeMode', 'finetuneLearningRate',
  ]) {
    assert.match(panelSource, new RegExp(`trainingDefaults\\.${key}|\\['${key}'`));
  }
  assert.match(panelSource, /ratioTotalInvalid/);
  assert.match(panelSource, /data-valid=\{ratioTotalValid/);
  assert.match(panelSource, /\['window',[\s\S]{0,90}\],\s*\['horizon',[\s\S]{0,90}\]/);
});

test('training settings labels and split feedback exist in both supported languages', () => {
  for (const source of [zhSource, enSource]) {
    assert.match(source, /training:\s*\{/);
    assert.match(source, /ratioTotalValid:/);
    assert.match(source, /ratioTotalInvalid:/);
    assert.match(source, /finetuneLearningRate:/);
  }
  assert.equal(zh.settings.training.ratioTotalInvalid({ total: 99 }), '数据集比例合计：99%，需要调整为 100%。');
  assert.equal(en.settings.training.ratioTotalInvalid({ total: 99 }), 'Split ratio total: 99%; adjust the values to 100%.');
});
