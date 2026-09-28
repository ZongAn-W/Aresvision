import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * Earth 数据集的训练页接线测试。
 *
 * 结构断言只用于锁定「数据集选项 → Earth 配置 → 独立提交」这条链路存在，
 * 不替代真实点击验收：真实任务由端到端验收在真实小包上执行。
 */

const pageSource = readFileSync(new URL('../ModelTrainingPage.jsx', import.meta.url), 'utf8');
const workspaceSource = readFileSync(new URL('./ExperimentConfigWorkspace.jsx', import.meta.url), 'utf8');
const apiSource = readFileSync(new URL('../../services/api.js', import.meta.url), 'utf8');

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

test('训练页把 earth_merra2_daily_v2 作为第三个数据集选项列出', () => {
  assert.match(workspaceSource, /TRAINING_DATASET_EARTH_MERRA2_V2/);
  assert.match(workspaceSource, /datasetEarthMerra2V2/);
  assert.match(workspaceSource, /data-training-dataset-option=\{option\.value\}/);
  // 选项仍是直接列出的单选按钮，没有退回原生下拉。
  assert.doesNotMatch(workspaceSource, /<select[^>]*data-training-dataset-list/);
});

test('选中地球数据集时不再渲染任何说明面板', () => {
  const code = stripComments(workspaceSource);
  // 面板既不渲染也不再被引用：地球的发布日期划分、网格、通道单位与发布指纹都由
  // 服务端在创建任务时校验并绑定，页面侧不重复展示。
  assert.doesNotMatch(code, /EarthTrainingDatasetPanel/);
  assert.doesNotMatch(code, /data-earth-dataset-panel/);
  assert.doesNotMatch(code, /experiment-earth-panel/);
  // 去掉的只是说明面板，数据集选项本身仍然渲染。
  assert.match(code, /data-training-dataset-option=\{option\.value\}/);
  assert.match(code, /data-training-dataset-groups|data-training-dataset-option/);
});

test('页面控制器不再保留只为该面板服务的文案键', () => {
  [
    'earthDatasetTitle', 'earthDatasetNote', 'earthGridLabel', 'earthWindowLabel',
    'earthWindowValue', 'earthTargetLabel', 'earthFingerprintLabel',
    'earthFingerprintUnavailable', 'earthSplitsTitle', 'earthSplitsUnavailable',
    'earthSplitLabels', 'earthSplitSamples', 'earthChannelsTitle', 'earthChannelsNote',
    'earthChannelRequired', 'earthChannelOptional', 'earthChannelSelected',
    'earthInputUnitsLabel', 'earthDetailsToggle', 'earthLimitationsNote',
  ].forEach((key) => {
    assert.doesNotMatch(pageSource, new RegExp(`\\b${key}\\b`), `${key} should be removed with the panel`);
  });
  // 地球数据不可用时仍要有可展示的阻塞原因。
  assert.match(pageSource, /earthUnavailableFallback/);
});

test('切换数据集走 Earth 专用换挡逻辑，而不是原始 setter', () => {
  assert.match(pageSource, /onTrainingDatasetChange: handleTrainingDatasetChange/);
  assert.match(pageSource, /const handleTrainingDatasetChange = useCallback/);
  // Earth 与火星各自保存完整草稿，切回时分别恢复。
  assert.match(pageSource, /captureTrainingDraft\(/);
  assert.match(pageSource, /resolveMarsTrainingRestore\(marsSnapshotRef\.current\)/);
  assert.match(pageSource, /resolveEarthTrainingRestore\(earthSnapshotRef\.current\)/);
  // Earth 生效时切到规范通道顺序与 7→3。
  assert.match(pageSource, /setWindow\(EARTH_WINDOW\)/);
  assert.match(pageSource, /setHorizon\(EARTH_HORIZON\)/);
  assert.match(pageSource, /setSelectionChannels|setSelectedChannels\(restore \? restore\.selectedChannels : \[\.\.\.EARTH_OPTIONAL_CHANNELS\]\)/);
});

test('Earth 允许官方与上传两种模型来源，且上传模型受服务端兼容性约束', () => {
  const code = stripComments(pageSource);
  assert.match(code, /EARTH_MODEL_SOURCE_UPLOADED/);
  // 兼容性结论只来自服务端，未取到结论不得放行。
  assert.match(code, /fetchUploadedModelEarthCompatibility\(/);
  assert.match(code, /getEarthUploadedSelectionBlocker\(/);
  assert.match(code, /uploadedModelId: uploadedEarth \? selectedUploadedModelId : null/);
  // Earth 上传模型的自定义参数随请求发送，身份字段由服务端生成。
  assert.match(code, /customModelParams: uploadedEarth/);
});

test('Earth 提交走独立路径并携带顶层 dataset_id', () => {
  const code = stripComments(pageSource);
  assert.match(code, /if \(earthMode\) \{/);
  assert.match(code, /buildEarthTrainingHyperparameters\(/);
  assert.match(code, /datasetId: TRAINING_DATASET_EARTH_MERRA2_V2/);
  // Earth 分支不得复用火星的超参数构造器。
  const earthBranch = code.slice(code.indexOf('if (earthMode) {'), code.indexOf('if (modelSource === \'official\' && !selectedScriptAvailable)'));
  assert.doesNotMatch(earthBranch, /buildTrainingHyperparameters\(/);
  assert.doesNotMatch(earthBranch, /transferLearning/);
});

test('api.startTrainingTask 发送 dataset_id 并保留结构化错误', () => {
  assert.match(apiSource, /if \(options\.datasetId\) body\.dataset_id = options\.datasetId;/);
  assert.match(apiSource, /async function buildTrainingStartError\(res\)/);
  assert.match(apiSource, /error\.code = structured\?\.code \|\| 'training_start_failed'/);
  assert.match(apiSource, /error\.status = res\.status/);
});

test('Earth 模式隐藏火星专属控件（模型来源切换、SPHERE、迁移）', () => {
  assert.match(workspaceSource, /const isEarth = trainingDataset === TRAINING_DATASET_EARTH_MERRA2_V2/);
  assert.match(workspaceSource, /data-earth-model-block="true"/);
  // Earth 的专家页签不含迁移学习；模型结构页签也不出现（DLinear 只有线性隐藏层数）。
  assert.match(workspaceSource, /\? \['payload', 'training', 'strategy', 'tags'\]/);
});

test('predict 页面接入 Earth 模式而不是扩展火星模式', () => {
  const predictSource = readFileSync(new URL('../PredictPage.jsx', import.meta.url), 'utf8');
  assert.match(predictSource, /PREDICT_MODEL_MODE_EARTH/);
  assert.match(predictSource, /<EarthPredictPanel/);
  assert.match(predictSource, /fetchEarthPredictContext/);
  assert.match(predictSource, /runEarthPrediction/);
  // 结果身份包含起点，切换任务/起点会清空旧结果。
  assert.match(predictSource, /buildEarthPredictKey\(/);
  assert.match(predictSource, /setEarthResult\(null\)/);
  // 地球模式隐藏火星侧栏与火星场图。
  assert.match(predictSource, /isEarthMode \? '1fr' : '300px 1fr'/);
});
