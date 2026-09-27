import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const configSource = readFileSync(new URL('./ExperimentConfigWorkspace.jsx', import.meta.url), 'utf8');
const inspectorSource = readFileSync(new URL('./ExperimentConfigInspector.jsx', import.meta.url), 'utf8');
const runBarSource = readFileSync(new URL('./ExperimentRunBar.jsx', import.meta.url), 'utf8');
const pageSource = readFileSync(new URL('../ModelTrainingPage.jsx', import.meta.url), 'utf8');
const lockTestSource = readFileSync(new URL('./transferSourceLockStructure.test.js', import.meta.url), 'utf8');

/**
 * 去掉块注释与整行注释：文档注释会提到训练接口名称，
 * 断言“没有调用训练接口”时必须只看真实代码。
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
    .join('\n');
}

const configCode = stripComments(configSource);

/** 断言 token 在源码中的出现顺序，用于锁定配置画布的信息层级。 */
function assertOrder(source, tokens) {
  let cursor = -1;
  tokens.forEach((token) => {
    const index = source.indexOf(token, cursor + 1);
    assert.notEqual(index, -1, `missing token: ${token}`);
    assert.ok(index > cursor, `token out of order: ${token}`);
    cursor = index;
  });
}

test('canvas head carries the editable name and no duplicated configuration summary', () => {
  assertOrder(configSource, [
    'experiment-canvas-head',
    'experiment-canvas-name',
    'experiment-canvas-state',
    'data-config-group="task"',
  ]);
  // 旧的大段「当前配置」摘要已删除，摘要集中在检查器。
  assert.doesNotMatch(configSource, /experiment-config-summary/);
  assert.doesNotMatch(configSource, /copy\.summaryLabel/);
  assert.doesNotMatch(configSource, /copy\.summaryHint/);
});

test('configuration canvas keeps the agreed section order', () => {
  assertOrder(configSource, [
    'copy.sectionTask',
    'copy.sectionPayload',
    'copy.sectionTraining',
    'copy.sectionExpert',
  ]);
  // 任务定义组内部：数据集与模型来源并排（横向组织）。
  assertOrder(configSource, [
    'experiment-task-grid',
    'copy.trainingDataset',
    'data-model-source-toggle="true"',
  ]);
  assert.match(configSource, /className="experiment-task-grid"/);
  assert.match(configSource, /experiment-choice-block/);
});

test('dataset and model source sit side by side in one row', () => {
  const taskGrid = configSource.slice(
    configSource.indexOf('experiment-task-grid'),
    configSource.indexOf('data-config-group="payload"')
  );
  assert.match(taskGrid, /copy\.trainingDataset/);
  assert.match(taskGrid, /experiment-choice-select/);
  assert.match(taskGrid, /experiment-source-toggle/);
  assert.match(taskGrid, /data-model-source-option=\{option\.value\}/);
  assert.match(
    readFileSync(new URL('./experimentCenter.css', import.meta.url), 'utf8'),
    /\.experiment-task-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*minmax\(0,\s*1fr\)/s
  );
});

test('uploaded model is the primary entry with a compact card and secondary management', () => {
  const sourceGroup = configSource.slice(
    configSource.indexOf('data-config-group="task"'),
    configSource.indexOf('data-config-group="payload"')
  );
  assert.match(sourceGroup, /<UploadedModelPanel/);
  assert.match(sourceGroup, /onUpload=\{onUploadModel\}/);
  assert.match(sourceGroup, /onRevalidate=\{onRevalidateModel\}/);
  assert.match(sourceGroup, /onDelete=\{onDeleteUploadedModel\}/);
  assert.match(sourceGroup, /inlineError=\{validation\.uploadedModelInlineError\}/);
  assert.match(sourceGroup, /onEditParams=\{\(\) => \{\s*setActiveTab\('customParams'\);/);
  assert.match(sourceGroup, /templateDownloadUrl=\{resources\.templateDownloadUrl\}/);
  assert.match(sourceGroup, /guideDownloadUrl=\{resources\.guideDownloadUrl\}/);
  // 上传模型面板只在模型来源为 uploaded 时渲染；官方模型时渲染架构选择器。
  assert.match(sourceGroup, /\{isUploaded \? \(\s*<UploadedModelPanel/);
  // 未选择有效上传模型时开始按钮保持不可用。
  assert.match(pageSource, /uploadedModelStartBlocked/);
  assert.match(pageSource, /modelSource === 'uploaded' &&[\s\S]{0,160}?validation_status !== 'valid'/);
  assert.match(pageSource, /const uploadedModelInlineError = modelSource !== 'uploaded'/);
});

test('uploaded model panel keeps management behind a disclosure instead of a permanent list', () => {
  const panelSource = readFileSync(new URL('./UploadedModelPanel.jsx', import.meta.url), 'utf8');
  assert.match(panelSource, /experiment-uploaded-card/);
  assert.match(panelSource, /data-uploaded-model-upload="true"/);
  assert.match(panelSource, /data-uploaded-model-params="true"/);
  assert.match(panelSource, /useState\(false\)/);
  assert.match(panelSource, /experiment-uploaded-manage/);
  assert.match(panelSource, /aria-expanded=\{manageOpen\}/);
  assert.match(panelSource, /data-uploaded-model-manage="true"/);
  // 管理动作仍然完整：重新校验、替换、删除、格式说明。
  assert.match(panelSource, /onRevalidate\(selected\.id\)/);
  assert.match(panelSource, /onDelete\(selected\.id\)/);
  assert.match(panelSource, /labels\.replace/);
  assert.match(panelSource, /formatItems/);
});

test('official model architecture selector only renders for the official source', () => {
  const sourceGroup = configSource.slice(
    configSource.indexOf('data-config-group="task"'),
    configSource.indexOf('data-config-group="payload"')
  );
  assert.match(sourceGroup, /<ModelArchitectureSelector/);
  assert.match(sourceGroup, /onSelect=\{onArchitectureSelect\}/);
  assert.match(sourceGroup, /expanded=\{architecturePickerOpen\}/);
  assert.match(sourceGroup, /onToggleSphere/);
  assert.match(sourceGroup, /\{isUploaded \? \([\s\S]*?<UploadedModelPanel[\s\S]*?\) : \([\s\S]*?<ModelArchitectureSelector/);
  assert.match(pageSource, /getModelTrainingControlVisibility\(modelSource\)/);
});

test('input and prediction group is a compact payload bar with a flow diagram', () => {
  const payloadBlock = configSource.slice(
    configSource.indexOf('data-config-group="payload"'),
    configSource.indexOf('data-config-group="training"')
  );
  assert.match(payloadBlock, /experiment-payload-bar/);
  assert.match(payloadBlock, /data-payload-base="true"/);
  assert.match(payloadBlock, /copy\.inspectorBaseInput/);
  assert.match(payloadBlock, /channelOrder\.map\(\(channel\) =>/);
  assert.match(payloadBlock, /className="experiment-channel-chip"/);
  assert.match(payloadBlock, /onChannelToggle\(channel\)/);
  assert.match(payloadBlock, /copy\.payloadCountLabel\(selectedChannels\.length, channelOrder\.length\)/);
  // 不再把 O₃ / 驱动变量 / 计数分别扩成大块卡片。
  assert.doesNotMatch(payloadBlock, /experiment-payload-base-title/);
  assert.doesNotMatch(payloadBlock, /experiment-payload-drivers/);
  // 输入序列 → 当前模型 → 输出序列，跟随窗口 / 步长 / 模型来源。
  assert.match(payloadBlock, /data-sequence-diagram="true"/);
  assert.match(payloadBlock, /data-sequence="input"/);
  assert.match(payloadBlock, /data-sequence="model"/);
  assert.match(payloadBlock, /data-sequence="output"/);
  assert.match(payloadBlock, /copy\.flowInputCaption\(windowValue \|\| '--'\)/);
  assert.match(payloadBlock, /copy\.flowOutputCaption\(horizon \|\| '--'\)/);
  assert.match(payloadBlock, /frameCount\(windowValue\)/);
  assert.match(payloadBlock, /frameCount\(horizon\)/);
  assert.match(payloadBlock, /flowModelLabel/);
});

test('training parameters render as a readable matrix with short helper codes', () => {
  const trainingBlock = configSource.slice(
    configSource.indexOf('data-config-group="training"'),
    configSource.indexOf('data-config-group="expert"')
  );
  ['windowValue', 'horizon', 'epochs', 'batchSize', 'learningRate'].forEach((key) => {
    assert.match(configSource, new RegExp(`key: '${key}'`), `${key} should be a matrix field`);
  });
  assert.match(trainingBlock, /parameterFields\.map/);
  assert.match(configSource, /experiment-param-grid/);
  assert.match(trainingBlock, /experiment-param-cell/);
  assert.match(trainingBlock, /onFoldChange\(field\.key/);
  const matrix = configSource.slice(
    configSource.indexOf('const parameterFields = ['),
    configSource.indexOf('const expertTabLabels')
  );
  // 辅助标识用 WINDOW / BATCH 这类短码，标签里不出现内部变量名。
  assert.match(configSource, /code: copy\.codeWindow/);
  assert.match(configSource, /code: copy\.codeBatch/);
  assert.match(configSource, /code: copy\.codeLr/);
  assert.match(matrix, /code: copy\.code/);
  const paramLabelStart = trainingBlock.indexOf('experiment-param-label');
  const paramLabelBlock = trainingBlock.slice(paramLabelStart, trainingBlock.indexOf('</span>', paramLabelStart));
  assert.match(paramLabelBlock, /<code>\{field\.code\}<\/code>/);
  assert.doesNotMatch(paramLabelBlock, /field\.key/);
});

test('expert parameters use side tabs whose panels render the matching real fields', () => {
  assert.match(configSource, /const UPLOADED_EXPERT_TABS = \['customParams', 'strategy', 'transfer', 'tags'\]/);
  assert.match(configSource, /const OFFICIAL_EXPERT_TABS = \['structure', 'strategy', 'transfer', 'tags'\]/);
  assert.match(configSource, /role="tablist"/);
  assert.match(configSource, /role="tabpanel"/);
  assert.match(configSource, /aria-selected=\{activeTab === tab\}/);
  assert.match(configSource, /data-expert-panel=\{activeTab\}/);
  assert.match(configSource, /data-expert-tab=\{tab\}/);
  // 每个页签面板渲染真实字段而不是只改标题。
  assert.match(configSource, /activeTab === 'customParams' \? \(/);
  assert.match(configSource, /activeTab === 'structure' \? \(/);
  assert.match(configSource, /activeTab === 'strategy' \? \(/);
  assert.match(configSource, /activeTab === 'transfer' \? \(/);
  assert.match(configSource, /activeTab === 'tags' \? \(/);
  assert.match(configSource, /onFoldChange\('seed'/);
  assert.match(configSource, /onFoldChange\('earlyStoppingPatience'/);
  assert.match(configSource, /onLayersChange/);
  assert.match(configSource, /onDimChange/);
  assert.match(configSource, /onStructureParamChange\(normalizedArchitecture, field/);
  assert.match(configSource, /onTransferSourceTaskChange/);
  assert.match(configSource, /onSelectTrainingWeight/);
  assert.match(configSource, /onUploadWeight/);
  assert.match(configSource, /onDeleteWeight/);
  assert.match(configSource, /copy\.freezeMode/);
  assert.match(configSource, /copy\.finetuneLearningRate/);
  assert.match(configSource, /<TagPicker/);
  // 不适用的参数不做成空页签。
  assert.doesNotMatch(configSource, /expertNeedsOfficial/);
  assert.doesNotMatch(configSource, /expertNeedsUploaded/);
});

test('custom model params stay dynamic and editing them is a first-class action', () => {
  assert.match(configSource, /<DynamicModelParamsForm/);
  assert.match(configSource, /schema=\{selectedUploadedParamSchema\}/);
  assert.match(configSource, /onChange=\{onCustomModelParamChange\}/);
  assert.match(configSource, /copy\.editCustomParams/);
  assert.match(configSource, /onEditParams/);
  assert.match(inspectorSource, /onEditCustomParams/);
  assert.match(pageSource, /onEditCustomParams=\{\(\) => setExpertTab\('customParams'\)\}/);
});

test('the run bar owns the only primary call to action for starting a run', () => {
  const primaryButtons = [...configSource.matchAll(/experiment-center-button-primary/g)];
  assert.equal(primaryButtons.length, 0, '配置画布不应出现主按钮样式');
  assert.equal((configSource.match(/onClick=\{onStart\}/g) || []).length, 0);
  assert.equal((runBarSource.match(/onClick=\{onStart\}/g) || []).length, 1);
  assert.match(runBarSource, /data-run-bar-start="true"/);
  assert.match(runBarSource, /disabled=\{startDisabled\}/);
  assert.match(pageSource, /onStart=\{handleStartTraining\}/);
});

test('configuration canvas reuses the existing training controls instead of reimplementing them', () => {
  assert.match(configSource, /<UploadedModelPanel/);
  assert.match(configSource, /<DynamicModelParamsForm/);
  assert.match(configSource, /<ModelArchitectureSelector/);
  assert.match(configSource, /<TagPicker/);
  assert.match(configSource, /from '\.\/trainingParamSanitizers'/);
  // 模型来源胶囊并入任务定义组，ModelSourceSelector 组件本身不再单独渲染。
  assert.doesNotMatch(configSource, /<ModelSourceSelector/);
  assert.match(configSource, /experiment-source-option/);
});

test('configuration canvas submits through the parent callback only', () => {
  assert.doesNotMatch(configCode, /startTrainingTask/);
  assert.doesNotMatch(configCode, /fetchLogs/);
  assert.doesNotMatch(configCode, /setInterval/);
  assert.doesNotMatch(configCode, /new WebSocket/);
  assert.match(pageSource, /onStart: handleStartTraining/);
});

test('configuration canvas keeps dataset, model source, channels, window/horizon and training folds', () => {
  ['trainingDataset', 'modelSource', 'selectedChannels', 'windowValue', 'horizon', 'epochs', 'batchSize', 'learningRate']
    .forEach((field) => assert.match(configSource, new RegExp(field), `${field} should be part of the form values`));
  assert.match(configSource, /TRAINING_DATASET_OPENMARS_MCD/);
  assert.match(configSource, /TRAINING_DATASET_MCD_OVERVIEW/);
  assert.match(configSource, /onTrainingDatasetChange/);
  assert.match(configSource, /onChannelToggle/);
  assert.match(configSource, /onFoldChange\(field\.key/);
});

test('structure-defining controls stay locked for a synchronized transfer source', () => {
  assert.match(configSource, /const transferStructureLocked\s*=|transferStructureLocked,/);
  assert.match(configSource, /data-model-source-option=\{option\.value\}[\s\S]{0,400}?disabled=\{!resources\.user \|\| transferStructureDisabled\}/);
  assert.match(configSource, /<UploadedModelPanel[\s\S]*?selectionDisabled=\{transferStructureLocked\}/);
  assert.match(configSource, /<UploadedModelPanel[\s\S]*?busy=\{isProcessing \|\| transferStructureLocked\}/);
  assert.match(configSource, /<DynamicModelParamsForm[\s\S]*?disabled=\{transferStructureLocked\}/);
  assert.match(configSource, /data-channel=\{channel\}[\s\S]{0,200}?disabled=\{transferStructureLocked\}/);
  assert.match(configSource, /<ModelArchitectureSelector[\s\S]{0,900}?disabled=\{transferStructureLocked\}/);
  assert.match(configSource, /checked=\{useSphere\}[\s\S]{0,160}?disabled=\{transferStructureLocked\}/);
  // 结构参数与窗口/步长输入的锁定量必须落在真正的输入控件上。
  const trainingBlock = configSource.slice(
    configSource.indexOf('data-config-group="training"'),
    configSource.indexOf('data-config-group="expert"')
  );
  assert.match(trainingBlock, /data-parameter=\{field\.key\}[\s\S]{0,900}?disabled=\{field\.locked \? transferStructureLocked : undefined\}/);
  assert.match(configSource, /value=\{values\.stlstmLayers\}[\s\S]{0,200}?disabled=\{transferStructureLocked\}/);
  assert.match(configSource, /value=\{dim\}[\s\S]{0,300}?disabled=\{transferStructureLocked\}/);
  assert.match(configSource, /type=\{field\.type === 'integerList' \? 'text' : 'number'\}[\s\S]{0,700}?disabled=\{transferStructureLocked\}/);
});

test('fine-tuning controls stay editable while the source structure is locked', () => {
  const matrix = configSource.slice(
    configSource.indexOf('const parameterFields = ['),
    configSource.indexOf('const expertTabLabels')
  );
  for (const key of ['epochs', 'batchSize', 'learningRate']) {
    assert.match(matrix, new RegExp(`key: '${key}'`), `${key} should be a matrix field`);
  }
  // 参数矩阵本身不含锁定量，避免把轮次/批大小/学习率一起锁住。
  assert.doesNotMatch(matrix, /transferStructureLocked/);
  assert.match(matrix, /locked: true/);
  assert.doesNotMatch(configSource, /copy\.freezeMode[\s\S]{0,400}?transferStructureLocked/);
  assert.doesNotMatch(configSource, /copy\.finetuneLearningRate[\s\S]{0,500}?transferStructureLocked/);
  assert.doesNotMatch(configSource, /copy\.randomSeed[\s\S]{0,400}?transferStructureLocked/);
});

test('copy configuration warnings render inside the config canvas', () => {
  assert.match(configSource, /copyConfigWarnings/);
  assert.match(configSource, /experiment-config-warning/);
  assert.match(configSource, /copy\.copyConfigWarningLabels\[code\]/);
});

test('transfer lock coverage moved with the form into the config canvas', () => {
  assert.match(pageSource, /const transferStructureLocked\s*=/);
  assert.match(lockTestSource, /pageSource/);
});
