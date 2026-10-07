import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const shellSource = readFileSync(new URL('./ExperimentCenterShell.jsx', import.meta.url), 'utf8');
const directorySource = readFileSync(new URL('./ExperimentDirectory.jsx', import.meta.url), 'utf8');
const cssSource = readFileSync(new URL('./experimentCenter.css', import.meta.url), 'utf8');
const pageSource = readFileSync(new URL('../ModelTrainingPage.jsx', import.meta.url), 'utf8');
const historySource = readFileSync(new URL('../../components/TrainingTags/TrainingHistory.jsx', import.meta.url), 'utf8');

/** 去掉块注释与整行注释：文档注释会提到接口名称，断言“没有调用”时必须只看代码。 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
    .join('\n');
}

test('experiment center shell is a console with a directory, a workspace and an inspector', () => {
  // 配置视图：画布 + 检查器；监控视图：目录 + 画布。
  assert.match(
    cssSource,
    /\.experiment-center-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*var\(--experiment-inspector-width\)/s
  );
  assert.match(cssSource, /--experiment-rail-width:\s*235px/);
  assert.match(cssSource, /--experiment-inspector-width:\s*284px/);
  assert.match(cssSource, /--experiment-gap:\s*14px/);
  // 监控视图为两列。
  assert.match(
    cssSource,
    /\.experiment-center-grid\[data-view='monitor'\]\s*\{[^}]*grid-template-columns:\s*var\(--experiment-rail-width\)\s*minmax\(0,\s*1fr\)/s
  );
  assert.match(shellSource, /<aside[\s\S]{0,160}?id="experiment-directory-panel"/);
  assert.match(shellSource, /data-config-inspector-panel="true"/);
  assert.match(shellSource, /data-stage=\{stage\}/);
  assert.match(shellSource, /data-view=\{view\}/);
  assert.match(shellSource, /aria-pressed=\{view === 'config'\}/);
  assert.match(shellSource, /aria-pressed=\{view === 'monitor'\}/);
  assert.doesNotMatch(shellSource, /experiment-center-stage-nav/);
});

test('desktop directory and inspector stick to the viewport while the canvas scrolls', () => {
  // 侧栏用 position: sticky（不是 fixed），并扣除底部运行条净空。
  assert.match(
    cssSource,
    /@media \(min-width: 901px\)[\s\S]*?\.experiment-center-grid\[data-view='monitor'\] \.experiment-directory\s*\{[^}]*position:\s*sticky/s
  );
  assert.match(cssSource, /\.experiment-directory\s*\{[^}]*top:\s*var\(--experiment-sticky-top\)/s);
  assert.match(cssSource, /--experiment-sticky-top:\s*86px/);
  assert.match(cssSource, /--experiment-run-bar-gap:\s*var\(--experiment-run-bar-measured,\s*72px\)/);
  assert.match(
    cssSource,
    /\.experiment-directory\s*\{[^}]*max-height:\s*calc\(\s*100dvh - var\(--experiment-sticky-top\) - var\(--experiment-run-bar-gap\)\s*\)/s
  );
  // 目录外框固定在视口中，里面的列表自己滚动。
  assert.match(cssSource, /\.experiment-directory \.experiment-directory-list\s*\{[^}]*flex:\s*1 1 auto/s);
  assert.match(cssSource, /\.experiment-directory \.experiment-directory-list\s*\{[^}]*overflow-y:\s*auto/s);
  assert.match(cssSource, /\.experiment-directory \.experiment-directory-list\s*\{[^}]*overscroll-behavior:\s*contain/s);
  // 检查器同样是 sticky 且自己滚动。
  assert.match(cssSource, /\.experiment-inspector-panel\s*\{[^}]*position:\s*sticky/s);
  assert.match(cssSource, /\.experiment-inspector-panel\s*\{[^}]*overflow-y:\s*auto/s);
  // 中间画布绝不加 sticky；侧栏也不允许用 fixed。
  assert.doesNotMatch(cssSource, /\.experiment-center-canvas\s*\{[^}]*position:\s*sticky/s);
  assert.doesNotMatch(cssSource, /\.experiment-directory\s*\{[^}]*position:\s*fixed/s);
  assert.doesNotMatch(cssSource, /\.experiment-inspector-panel\s*\{[^}]*position:\s*fixed/s);
});

test('bottom run bar is fixed across the browser and reserving space below the grid', () => {
  assert.match(shellSource, /data-run-bar-slot="true"/);
  assert.match(cssSource, /\.experiment-run-bar\s*\{[^}]*position:\s*fixed/s);
  assert.match(cssSource, /\.experiment-run-bar\s*\{[^}]*bottom:\s*0/s);
  assert.match(cssSource, /\.experiment-run-bar\s*\{[^}]*left:\s*0/s);
  assert.match(cssSource, /\.experiment-run-bar\s*\{[^}]*border-top:\s*1px solid/s);
  // 页面外壳的 transform 过渡会成为 fixed 的包含块，运行条必须 portal 到 body。
  assert.match(shellSource, /import \{ createPortal \} from 'react-dom'/);
  assert.match(shellSource, /createPortal\(node, document\.body\)/);
  assert.match(shellSource, /runBarPortal\(/);
  // 网格按实测运行条高度预留底部空间，最后一个字段不会被底栏遮住。
  assert.match(shellSource, /paddingBottom: `\$\{runBarHeight \+ 20\}px`/);
  assert.match(shellSource, /\{view === 'config' && runBar \? \(/);
});

test('shell exposes the three experiment stages', () => {
  for (const stage of ['configure', 'monitor', 'result']) {
    assert.match(shellSource, new RegExp(`'${stage}'`), `stage ${stage} should be declared`);
  }
  assert.match(shellSource, /data-stage-heading=\{stage\}/);
  assert.match(shellSource, /data-stage-workspace/);
});

test('shell switches between configuration and the selected task without clearing form state', () => {
  assert.match(shellSource, /onChangeView\('config'\)/);
  assert.match(shellSource, /onChangeView\('monitor'\)/);
  assert.match(shellSource, /view === 'monitor' && stage === 'result'/);
});

test('configuration workspace stays mounted so directory filtering cannot clear the form', () => {
  // 配置工作区用 hidden 隐藏而不是条件卸载：切换阶段/筛选时用户输入不丢失。
  assert.match(shellSource, /data-stage-workspace="configure"[\s\S]{0,120}?hidden=\{view !== 'config'\}/);
  assert.match(shellSource, /data-stage-workspace="monitor"[\s\S]*?hidden=\{view !== 'monitor' \|\| stage !== 'monitor' \|\| !activeTask\}/);
  assert.match(shellSource, /data-stage-workspace="result"[\s\S]*?hidden=\{view !== 'monitor' \|\| stage !== 'result'\}/);
  assert.match(shellSource, /\{view === 'config' && inspector \? \(/);
});

test('presentation shell does not start training or poll logs itself', () => {
  for (const source of [stripComments(shellSource), stripComments(directorySource)]) {
    assert.doesNotMatch(source, /startTrainingTask/);
    assert.doesNotMatch(source, /fetchLogs/);
    assert.doesNotMatch(source, /new WebSocket/);
    assert.doesNotMatch(source, /setInterval/);
  }
});

test('experiment directory keeps status grouping, search, tags and bulk tag actions', () => {
  assert.match(directorySource, /EXPERIMENT_STATUS_FILTERS/);
  assert.match(directorySource, /aria-pressed=\{statusFilter === filter\}/);
  assert.match(directorySource, /renderMode="directory"/);
  assert.match(directorySource, /statusMatcher=\{statusMatcher\}/);
  // 搜索、标签筛选与批量标签逻辑保留在 TrainingHistory 中，不在目录里重复实现。
  assert.match(historySource, /type="search"/);
  assert.match(historySource, /TagFilter/);
  assert.match(historySource, /'添加所选标签'/);
  assert.match(historySource, /'Remove selected tags'|移除所选标签/);
  assert.match(historySource, /TagManager/);
});

test('directory rows show name, task id, architecture, dataset, time, status and a core metric', () => {
  assert.match(directorySource, /className="experiment-directory-name"/);
  assert.match(directorySource, /experiment-directory-id/);
  assert.match(directorySource, /experiment-directory-metric/);
  assert.match(directorySource, /EXPERIMENT_METRIC_KEYS/);
  // 目录行日期按 locale 格式化；结束时间优先，未结束时回退开始时间。
  // （原断言写的是 task.start_time，与实现不符，一直是失败项。）
  assert.match(directorySource, /formatDirectoryDate\(task\.end_time \|\| task\.start_time, locale\)/);
  assert.match(directorySource, /experiment-directory-badge/);
});

test('directory mode does not reference props it never declares', () => {
  // 目录模式曾因调用未解构的回调而在运行时抛 ReferenceError。
  const check = (source) => {
    const signature = source.match(/export default function \w+\(\{([\s\S]*?)\}\)/) || [];
    const declared = new Set(String(signature[1] || '').split(/[\s,]+/).filter(Boolean));
    const used = [...source.matchAll(/\b(on[A-Z]\w+)\??\.?\s*\(/g)].map((match) => match[1]);
    return [...new Set(used)].filter((name) => !declared.has(name));
  };
  assert.deepEqual(check(historySource), [], 'TrainingHistory 引用了未声明的回调');
  const rowSignature = directorySource.match(/function ExperimentDirectoryRow\(\{([\s\S]*?)\}\) \{/) || [];
  const rowDeclared = new Set(String(rowSignature[1] || '').split(/[\s,]+/).filter(Boolean));
  const rowUsed = [...directorySource.matchAll(/\b(on[A-Z]\w+)\??\.?\s*\(/g)].map((match) => match[1]);
  const rowUndeclared = [...new Set(rowUsed)].filter((name) => !rowDeclared.has(name));
  assert.deepEqual(rowUndeclared, [], `ExperimentDirectoryRow 引用了未声明的回调: ${rowUndeclared.join(', ')}`);
});

test('directory keeps only the progress row and the stop action for running tasks', () => {
  assert.match(directorySource, /experiment-directory-progress/);
  assert.match(directorySource, /role="progressbar"/);
  assert.match(directorySource, /onStop\(task\.id\)/);
  // 目录只负责找到实验：重命名、测试、删除都移到右侧结果工作区。
  assert.doesNotMatch(directorySource, /onRename\(task\)/);
  assert.doesNotMatch(directorySource, /onDelete\(task\.id\)/);
  assert.doesNotMatch(directorySource, /onTest\(task\.id\)/);
  assert.doesNotMatch(directorySource, /copy\.viewLogs/);
});

test('directory rows no longer render the full parameter disclosure', () => {
  assert.doesNotMatch(directorySource, /TrainingTaskParameters/);
  assert.doesNotMatch(directorySource, /onFormatValue/);
  assert.match(cssSource, /\.experiment-directory-row\s*\{[^}]*display:\s*grid/s);
});

test('directory rows are keyboard reachable and highlight the active experiment', () => {
  assert.match(directorySource, /role="button"/);
  assert.match(directorySource, /tabIndex=\{0\}/);
  assert.match(directorySource, /event\.key === 'Enter' \|\| event\.key === ' '/);
  assert.match(directorySource, /data-active=\{isActive \? 'true' : 'false'\}/);
  assert.match(directorySource, /aria-pressed=\{isActive\}/);
});

test('view state selects exactly one pair of work areas', () => {
  assert.match(pageSource, /const \[view, setView\] = useState\('config'\)/);
  assert.match(pageSource, /if \(activeTask && !isCreating && !viewChosenRef\.current\) setView\('monitor'\)/);
  assert.match(shellSource, /\{view === 'monitor' \? \(\s*<aside/);
  assert.match(shellSource, /\{view === 'config' && inspector \? \(/);
  assert.match(cssSource, /\.experiment-center-grid\[data-view='monitor'\]/);
});

test('header has three accessible view buttons', () => {
  assert.match(shellSource, /role="group" aria-label=\{t\('experimentCenter\.viewLabel'\)\}/);
  assert.match(shellSource, /aria-pressed=\{view === 'config'\}/);
  assert.match(shellSource, /aria-pressed=\{view === 'monitor'\}/);
  assert.match(shellSource, /aria-pressed=\{view === 'matrix'\}/);
  assert.doesNotMatch(shellSource, /experiment-center-stage-nav/);
});

test('header exposes the experiment matrix as a third view and keeps it mounted', () => {
  assert.match(shellSource, /view === 'matrix'/);
  assert.match(shellSource, /t\('experimentCenter\.matrixView'\)/);
  assert.match(shellSource, /data-stage-workspace="matrix"[\s\S]*workspace\?\.matrix/);
});

test('page controller owns the stage derivation and wires the experiment workspaces', () => {
  assert.match(pageSource, /getExperimentStage\(\{ activeTask, isCreating \}\)/);
  assert.match(pageSource, /<ExperimentCenterShell/);
  assert.match(pageSource, /<ExperimentDirectory/);
  assert.match(pageSource, /<ExperimentConfigInspector/);
  assert.match(pageSource, /<ExperimentRunBar/);
  assert.match(pageSource, /configure: configWorkspace,/);
  assert.match(pageSource, /monitor: monitorWorkspace,/);
  assert.match(pageSource, /result: resultWorkspace,/);
  assert.match(pageSource, /matrix: matrixWorkspace,/);
  assert.match(pageSource, /inspector=\{configInspector\}/);
  assert.match(pageSource, /runBar=\{configRunBar\}/);
  assert.match(pageSource, /runBarHeight=\{runBarHeight\}/);
});

test('page keeps the fixed-navbar offset and page chrome', () => {
  // 全站导航是固定定位，训练页必须保留 104px 顶部留白，否则内容会钻到导航下面。
  assert.match(pageSource, /padding: '104px 0 40px'/);
  assert.match(pageSource, /className="model-training-page"/);
  assert.match(pageSource, /minHeight: '100vh'/);
});

test('narrow viewports turn off sticky sidebars and stack the console', () => {
  assert.match(cssSource, /@media \(max-width: 900px\)[\s\S]*?\.experiment-center-grid[^{]*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  // ≤900px 时目录与检查器都是普通流式内容。
  const narrow = cssSource.slice(cssSource.indexOf('@media (max-width: 900px)'));
  assert.match(narrow, /\.experiment-directory,\s*\n\s*\.experiment-inspector-panel\s*\{\s*\n\s*position:\s*static/);
  // 运行条回到普通流（不再 fixed 覆盖内容）。
  assert.match(narrow, /\.experiment-run-bar\s*\{\s*\n\s*position:\s*static/);
  assert.match(cssSource, /@media \(max-width: 640px\)[\s\S]*?min-height:\s*44px/);
});
