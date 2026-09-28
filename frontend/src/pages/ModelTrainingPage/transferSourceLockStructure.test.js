import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const pageSource = readFileSync(new URL('../ModelTrainingPage.jsx', import.meta.url), 'utf8');
const configSource = readFileSync(new URL('./ExperimentConfigWorkspace.jsx', import.meta.url), 'utf8');
const architectureSource = readFileSync(new URL('./ModelArchitectureSelector.jsx', import.meta.url), 'utf8');
const uploadedPanelSource = readFileSync(new URL('./UploadedModelPanel.jsx', import.meta.url), 'utf8');
const dynamicParamsSource = readFileSync(new URL('./DynamicModelParamsForm.jsx', import.meta.url), 'utf8');

function nearby(source, marker, length = 700) {
  const index = source.indexOf(marker);
  assert.notEqual(index, -1, `Expected marker: ${marker}`);
  return source.slice(index, index + length);
}

/** 取训练参数矩阵的字段定义：窗口/步长的锁定量必须落在这里的输入控件上。 */
function parameterMatrixSource() {
  const start = configSource.indexOf('const parameterFields = [');
  const end = configSource.indexOf('const expertTabLabels');
  assert.notEqual(start, -1, 'the training parameter matrix should exist');
  assert.notEqual(end, -1, 'the expert tab labels should follow the parameter matrix');
  return configSource.slice(start, end);
}

test('locks every structure-defining control for a synchronized task source', () => {
  assert.match(pageSource, /const transferStructureLocked\s*=/);
  assert.match(configSource, /data-model-source-option=\{option\.value\}[\s\S]{0,400}?disabled=\{!resources\.user \|\| transferStructureDisabled\}/);
  assert.match(configSource, /<UploadedModelPanel[\s\S]{0,900}?selectionDisabled=\{transferStructureLocked\}/);
  assert.match(configSource, /<UploadedModelPanel[\s\S]{0,900}?busy=\{isProcessing \|\| transferStructureLocked\}/);
  assert.match(configSource, /<DynamicModelParamsForm[\s\S]{0,900}?disabled=\{transferStructureLocked\}/);
  // 输入通道胶囊与官方模型架构选择器同样被锁。
  assert.match(nearby(configSource, 'data-channel={channel}', 900), /disabled=\{transferStructureLocked\}/);
  assert.match(configSource, /<ModelArchitectureSelector[\s\S]{0,900}?disabled=\{transferStructureLocked\}/);
  assert.match(architectureSource, /disabled = false/);
  assert.match(architectureSource, /disabled=\{disabled\}/);
  assert.match(nearby(configSource, 'checked={useSphere}', 300), /disabled=\{transferStructureLocked\}/);
  // 参数矩阵里窗口/步长带 locked 标记，锁定落到真正的输入控件上。
  const matrix = parameterMatrixSource();
  assert.match(matrix, /key: 'windowValue'[\s\S]{0,220}?locked: true/);
  assert.match(matrix, /key: 'horizon'[\s\S]{0,220}?locked: true/);
  assert.match(configSource, /disabled=\{field\.locked \? transferStructureLocked : undefined\}/);
  assert.match(nearby(configSource, 'value={values.stlstmLayers}', 350), /disabled=\{transferStructureLocked\}/);
  assert.match(nearby(configSource, 'value={dim}', 450), /disabled=\{transferStructureLocked\}/);
  assert.match(nearby(configSource, "type={field.type === 'integerList' ? 'text' : 'number'}", 950), /disabled=\{transferStructureLocked\}/);

  assert.match(uploadedPanelSource, /selectionDisabled = false/);
  assert.match(uploadedPanelSource, /disabled=\{selectionDisabled\}/);
  assert.match(dynamicParamsSource, /disabled = false/);
  assert.match(dynamicParamsSource, /disabled=\{disabled\}/);
});

test('keeps fine-tuning controls editable while source structure is locked', () => {
  const matrix = parameterMatrixSource();
  for (const key of ['epochs', 'batchSize', 'learningRate']) {
    assert.match(matrix, new RegExp(`key: '${key}'`), `${key} should be a matrix field`);
  }
  // 参数矩阵本身不含锁定量，避免把轮次 / 批大小 / 学习率一起锁住。
  assert.doesNotMatch(matrix, /transferStructureLocked/);
  assert.doesNotMatch(nearby(configSource, '{copy.freezeMode}', 700), /transferStructureLocked/);
  assert.doesNotMatch(nearby(configSource, '{copy.finetuneLearningRate}', 800), /transferStructureLocked/);
  assert.doesNotMatch(nearby(configSource, '{copy.randomSeed}', 700), /transferStructureLocked/);
});
