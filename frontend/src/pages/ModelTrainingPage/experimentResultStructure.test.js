import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const resultSource = readFileSync(new URL('./ExperimentResultPanel.jsx', import.meta.url), 'utf8');
const logPanelSource = readFileSync(new URL('./ExperimentLogPanel.jsx', import.meta.url), 'utf8');
const pageSource = readFileSync(new URL('../ModelTrainingPage.jsx', import.meta.url), 'utf8');
const selectionSource = readFileSync(new URL('../PredictPage/trainedModelSelection.js', import.meta.url), 'utf8');
const modesSource = readFileSync(new URL('../PredictPage/predictModelModes.js', import.meta.url), 'utf8');
const predictSource = readFileSync(new URL('../PredictPage.jsx', import.meta.url), 'utf8');

test('result panel shows the experiment name, status and weight availability', () => {
  assert.match(resultSource, /buildExperimentSummary\(activeTask\)/);
  assert.match(resultSource, /summary\.name \|\| t\('experimentCenter\.unnamedExperiment'\)/);
  assert.match(resultSource, /statusMeta\.label/);
  assert.match(resultSource, /copy\.weightsAvailable/);
  assert.match(resultSource, /copy\.weightsUnavailable/);
});

test('result panel renders every supported metric only when a value exists', () => {
  assert.match(resultSource, /EXPERIMENT_METRIC_KEYS/);
  assert.match(resultSource, /\.filter\(\(key\) => summary\.metrics\[key\] !== undefined\)/);
  ['metricRmse', 'metricMae', 'metricMse', 'metricR2', 'metricMape', 'metricSmape']
    .forEach((key) => assert.match(resultSource, new RegExp(`experimentCenter\\.${key}`), `${key} should be rendered`));
  assert.match(resultSource, /formatExperimentMetricValue\(summary\.metrics\[key\]\)/);
  assert.match(resultSource, /copy\.metricsUnavailable/);
});

test('result panel shows loss history and the full training parameters', () => {
  assert.match(resultSource, /<LossEvolutionChart/);
  assert.match(resultSource, /<TrainingTaskParameters/);
  assert.match(resultSource, /copy\.noLossHistory/);
  assert.match(resultSource, /hyperparameters/);
});

test('result panel shows dataset identity fields returned by the backend', () => {
  assert.match(resultSource, /activeTask\.dataset_fingerprint/);
  assert.match(resultSource, /activeTask\.dataset_version/);
  assert.match(resultSource, /activeTask\.dataset_identity_status/);
  assert.match(resultSource, /copy\.datasetLabel/);
});

test('result panel exposes prediction, comparison, copy and maintenance actions', () => {
  assert.match(resultSource, /copy\.useForPrediction/);
  assert.match(resultSource, /copy\.goCompare/);
  assert.match(resultSource, /copy\.copyConfig/);
  assert.match(resultSource, /copy\.renameModel/);
  assert.match(resultSource, /copy\.testModel/);
  assert.match(resultSource, /copy\.deleteRecord/);
  assert.match(resultSource, /onPredict\(activeTask\)/);
  assert.match(resultSource, /onCompare\(activeTask\)/);
  assert.match(resultSource, /onCopyConfig\(activeTask\)/);
});

test('failure reason comes from task metrics instead of nonexistent task fields', () => {
  assert.match(resultSource, /getExperimentFailureMessage\(activeTask\)/);
  assert.match(resultSource, /t\(failure\.messageKey\)/);
  assert.match(resultSource, /failure\.suggestionKey/);
  assert.match(resultSource, /failure\.detail/);
  assert.match(resultSource, /failure\.errorCode/);
  // 后端不返回 error_message / metrics_note，不能继续读这些不存在的字段。
  assert.doesNotMatch(resultSource, /activeTask\.error_message/);
  assert.doesNotMatch(resultSource, /activeTask\.metrics_note/);
});

test('result panel offers a collapsed run-log area that reuses the shared panel', () => {
  assert.match(resultSource, /<ExperimentLogPanel/);
  assert.match(resultSource, /collapsible/);
  assert.match(resultSource, /const \[logOpen, setLogOpen\] = useState\(false\)/);
  assert.match(resultSource, /logs=\{logs\}/);
  assert.match(logPanelSource, /aria-expanded=\{open\}/);
  assert.match(logPanelSource, /aria-controls="experiment-result-log-panel"/);
  assert.match(logPanelSource, /copy\.viewRunLogs/);
});

test('result panel does not create a second poller, websocket or log request', () => {
  for (const source of [resultSource, logPanelSource]) {
    assert.doesNotMatch(source, /setInterval/);
    assert.doesNotMatch(source, /new WebSocket/);
    assert.doesNotMatch(source, /fetchLogs/);
    assert.doesNotMatch(source, /startTrainingTask/);
  }
  assert.match(readFileSync(new URL('../../contexts/TrainingContext.jsx', import.meta.url), 'utf8'), /setInterval\(pollLogs, 3000\)/);
});

test('prediction entry is only offered when the backend reports usable weights', () => {
  assert.match(resultSource, /const modelAvailable = canUseTaskForPrediction\(activeTask\)/);
  assert.match(resultSource, /modelAvailable \? \([\s\S]*?copy\.useForPrediction/);
  assert.match(resultSource, /copy\.modelUnavailableTitle/);
  assert.match(resultSource, /copy\.notCompletedReason/);
});

test('prediction handoff keeps using the existing session handoff contract', () => {
  assert.match(pageSource, /buildTrainingTaskHandoff\(task, createUserPredictScope\(user\?\.id\)\)/);
  assert.match(pageSource, /sessionStorage\.setItem\(TRAINING_TASK_HANDOFF_KEY, JSON\.stringify\(handoff\)\)/);
  assert.match(pageSource, /buildPredictHash\(\{ from: 'training', mode \}\)/);
  assert.match(selectionSource, /TRAINING_TASK_HANDOFF_KEY/);
});

test('comparison navigation explicitly requests the compare mode', () => {
  assert.match(pageSource, /navigateToPredict\(\{ mode: PREDICT_MODEL_MODE_COMPARE \}\)/);
  assert.match(pageSource, /canUseTaskForPrediction\(task\)/);
  assert.match(modesSource, /export function readPredictModeFromHash/);
  assert.match(modesSource, /export function buildPredictHash/);
  assert.match(predictSource, /readPredictModeFromHash\(window\.location\.hash\)/);
  assert.match(predictSource, /setModelMode\(hashRequestedMode\)/);
  assert.match(predictSource, /experimentCenter\.compareModeHint/);
  // hash 请求的模式必须压过预测缓存里的模式，否则上次浏览留下的 trained 会把比较模式顶掉。
  assert.match(predictSource, /const urlRequestedMode = readPredictModeFromHash\(window\.location\.hash\)/);
  assert.match(predictSource, /urlRequestedMode \|\| restoredModelMode/);
  // 比较模式只导航，不伪造预选：页面里不能出现被写入的比较任务列表。
  assert.doesNotMatch(pageSource, /selectedCompareTrainingTaskIds|compareTaskIds/);
  assert.doesNotMatch(resultSource, /localStorage|sessionStorage/);
});

test('copy configuration loads the task config into the form without starting training', () => {
  assert.match(pageSource, /const handleCopyConfig =/);
  assert.match(pageSource, /readExperimentConfig\(task, \{/);
  assert.match(pageSource, /setEpochs\(config\.epochs\)/);
  assert.match(pageSource, /setBatchSize\(config\.batchSize\)/);
  assert.match(pageSource, /setLearningRate\(config\.learningRate\)/);
  assert.match(pageSource, /setSeed\(config\.seed\)/);
  assert.match(pageSource, /setEarlyStoppingPatience\(config\.earlyStoppingPatience\)/);
  assert.match(pageSource, /setCopyConfigWarnings\(config\.warnings\)/);
  assert.match(pageSource, /copyConfigWarnings=\{copyConfigWarnings\}/);
  // 复制配置只切换阶段并清空选中任务，路径中不出现任何训练提交调用。
  const handler = pageSource.slice(pageSource.indexOf('const handleCopyConfig ='));
  assert.doesNotMatch(handler.slice(0, handler.indexOf('const presetStatusText')), /startTrainingTask/);
});

test('copy configuration restores uploaded-model custom params', () => {
  const handler = pageSource.slice(pageSource.indexOf('const handleCopyConfig ='));
  const block = handler.slice(0, handler.indexOf('const presetStatusText'));
  // 上传模型的自定义参数必须一起回填，不再无条件清空。
  assert.match(block, /setCustomModelParams\(cloneExperimentConfigValue\(config\.customModelParams\)\)/);
  assert.doesNotMatch(block, /setCustomModelParams\(\{\}\)/);
  assert.match(block, /setModelSource\(config\.modelSource\)/);
  assert.match(block, /setSelectedUploadedModelId\(config\.selectedUploadedModelId\)/);
  // 回填后要登记来源模型，避免 schema 同步 effect 立刻把参数重置成默认值。
  assert.match(block, /copiedCustomModelParamsRef\.current = config\.customModelParams/);
  assert.match(pageSource, /const copiedCustomModelParamsRef = useRef\(''\)/);
  assert.match(pageSource, /copiedCustomModelParamsRef\.current === selectedUploadedModelId/);
  // 「新建实验」清空登记，回到正常默认参数流程。
  const createHandler = pageSource.slice(pageSource.indexOf('const handleCreateExperiment ='));
  assert.match(createHandler.slice(0, createHandler.indexOf('const handleSelectTask')), /copiedCustomModelParamsRef\.current = ''/);
});

test('uploaded model param form still receives state through the canvas and inspector', () => {
  const workspaceSource = readFileSync(new URL('./ExperimentConfigWorkspace.jsx', import.meta.url), 'utf8');
  const inspectorSource = readFileSync(new URL('./ExperimentConfigInspector.jsx', import.meta.url), 'utf8');
  assert.match(workspaceSource, /values=\{values\.customModelParams\}/);
  assert.match(workspaceSource, /schema=\{selectedUploadedParamSchema\}/);
  assert.match(workspaceSource, /errors=\{visibleCustomModelParamErrors\}/);
  assert.match(workspaceSource, /onChange=\{onCustomModelParamChange\}/);
  // 检查器显示自定义参数数量，并可一键把画布切到「自定义模型参数」页签。
  assert.match(inspectorSource, /customParamCount/);
  assert.match(inspectorSource, /onEditCustomParams/);
  assert.match(pageSource, /customParamCount,/);
});

test('model copy helpers are exported from the model module', () => {
  const modelSource = readFileSync(new URL('./experimentCenterModel.js', import.meta.url), 'utf8');
  assert.match(modelSource, /export function cloneExperimentConfigValue\(value\)/);
  assert.match(modelSource, /customModelParams: \{\},/);
  assert.match(modelSource, /customModelParams = isPlainObject\(rawCustomModelParams\)/);
  assert.match(modelSource, /addWarning\('custom_model_params_missing'\)/);
});

test('new experiment clears previous copy warnings', () => {
  const handler = pageSource.slice(pageSource.indexOf('const handleCreateExperiment ='));
  assert.match(handler.slice(0, handler.indexOf('const handleSelectTask')), /setCopyConfigWarnings\(\[\]\)/);
});
