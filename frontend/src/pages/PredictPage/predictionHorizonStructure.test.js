import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const pageSource = fs.readFileSync(path.join(currentDir, '..', 'PredictPage.jsx'), 'utf8');
const sidebarSource = fs.readFileSync(path.join(currentDir, 'PredictSidebar.jsx'), 'utf8');
const zhSource = fs.readFileSync(path.join(currentDir, '..', '..', 'i18n', 'zh.js'), 'utf8');
const enSource = fs.readFileSync(path.join(currentDir, '..', '..', 'i18n', 'en.js'), 'utf8');

test('prediction page derives and clamps the horizon from selected trained models', () => {
  assert.match(pageSource, /resolvePredictionHorizonLimit/);
  assert.match(pageSource, /clampPredictionHorizon/);
  assert.match(pageSource, /selectedTrainingOption\?\.task/);
  assert.match(pageSource, /selectedCompareTrainingTasks/);
  assert.match(pageSource, /setPredStep\(\(current\)\s*=>\s*clampPredictionHorizon\(current, predictionHorizonLimit\)\)/);
  assert.match(pageSource, /predictionHorizonLimit=\{isEarthMode \? earthContext\?\.horizon \?\? null : predictionHorizonLimit\}/);
  assert.match(pageSource, /performanceData,\s*performanceKey,\s*predictionHorizonLimit,\s*predStep,/);
});

test('prediction sidebar uses a model-bound numeric horizon control', () => {
  assert.doesNotMatch(sidebarSource, /items=\{\[1, 2, 3\]\.map/);
  assert.match(sidebarSource, /type="number"/);
  assert.match(sidebarSource, /min="1"/);
  assert.match(sidebarSource, /max=\{predictionHorizonLimit\}/);
  assert.match(sidebarSource, /clampPredictionHorizon\(event\.target\.value, predictionHorizonLimit\)/);
  assert.match(sidebarSource, /disabled=\{requestContextLocked \|\| predictionHorizonLimit == null\}/);
});

test('prediction action is disabled without a valid trained-model horizon', () => {
  assert.match(sidebarSource, /predictionHorizonLimit == null/);
  assert.match(sidebarSource, /predStep > predictionHorizonLimit/);
});

test('prediction introduction follows the selected training task instead of promising three steps', () => {
  assert.doesNotMatch(zhSource, /预测后续最多 3 个时间步/);
  assert.doesNotMatch(enSource, /predict up to 3 future steps/);
  assert.match(zhSource, /所选训练任务的输入与输出窗口配置/);
  assert.match(enSource, /selected training task's input and output horizon configuration/);
});
