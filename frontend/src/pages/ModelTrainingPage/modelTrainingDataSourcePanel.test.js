import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const configSource = readFileSync(new URL('./ExperimentConfigWorkspace.jsx', import.meta.url), 'utf8');
const inspectorSource = readFileSync(new URL('./ExperimentConfigInspector.jsx', import.meta.url), 'utf8');
const runBarSource = readFileSync(new URL('./ExperimentRunBar.jsx', import.meta.url), 'utf8');

/** 去掉块注释与整行注释：文档注释会提到训练接口名称，断言“没有调用”时必须只看代码。 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
    .join('\n');
}

/** 取某个分组（data-config-group）的源码区间。 */
function groupSource(name, nextName) {
  const start = configSource.indexOf(`data-config-group="${name}"`);
  assert.notEqual(start, -1, `the ${name} group should exist`);
  const end = nextName
    ? configSource.indexOf(`data-config-group="${nextName}"`, start)
    : configSource.length;
  assert.notEqual(end, -1, `the ${nextName} group should follow ${name}`);
  return configSource.slice(start, end);
}

test('model training parameters do not render the redundant server data source panel', () => {
  const taskGroup = groupSource('task', 'payload');

  ['{copy.dataSource}', '{copy.sourceDefault}', '{copy.sourceHintDefault}'].forEach((token) => {
    assert.equal(taskGroup.includes(token), false, `${token} should not be rendered in the task group`);
  });
  assert.match(taskGroup, /\{copy\.trainingDataset\}/);
  assert.match(taskGroup, /TRAINING_DATASET_OPENMARS_MCD/);
  assert.match(taskGroup, /TRAINING_DATASET_MCD_OVERVIEW/);
});

test('no duplicated configuration summary remains in the canvas', () => {
  // 摘要集中在右侧检查器；底部只留一行运行摘要。
  assert.doesNotMatch(configSource, /summaryItems/);
  assert.doesNotMatch(configSource, /copy\.summaryLabel/);
  assert.match(inspectorSource, /copy\.inspectorCurrentModel/);
  assert.match(inspectorSource, /copy\.inspectorReadiness/);
  assert.match(inspectorSource, /copy\.inspectorSequence/);
});

test('the live run bar carries a one-line dataset, model, payload and epochs summary', () => {
  assert.match(runBarSource, /experiment-run-bar-meta/);
  assert.match(runBarSource, /data-run-bar-summary="true"/);
  assert.match(runBarSource, /datasetLabel/);
  assert.match(runBarSource, /modelLabel/);
  assert.match(runBarSource, /channelLabel/);
  assert.match(runBarSource, /epochs/);
  // 运行条只做摘要与提交，不自己请求训练接口。
  const runBarCode = stripComments(runBarSource);
  assert.doesNotMatch(runBarCode, /startTrainingTask/);
  assert.doesNotMatch(runBarCode, /fetchLogs/);
  assert.doesNotMatch(runBarCode, /setInterval/);
  assert.doesNotMatch(runBarCode, /new WebSocket/);
});

test('面向开发者的界面说明已从训练页移除', () => {
  // 这些句子属于文档，不属于用户界面。
  const uiSources = [configSource, inspectorSource, runBarSource].join('\n');
  assert.doesNotMatch(uiSources, /只做摘要，不重复整张表单/);
  assert.doesNotMatch(uiSources, /所有字段仍然可编辑/);
  assert.doesNotMatch(uiSources, /训练接口、日志与轮询机制保持不变/);
  assert.doesNotMatch(uiSources, /Experimental console/);
});
