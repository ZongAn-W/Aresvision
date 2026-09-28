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
  // 默认（收起目录）：画布 + 检查器两列，尺寸与设计参照一致。
  assert.match(
    cssSource,
    /\.experiment-center-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*var\(--experiment-inspector-width\)/s
  );
  assert.match(cssSource, /--experiment-rail-width:\s*235px/);
  assert.match(cssSource, /--experiment-inspector-width:\s*284px/);
  assert.match(cssSource, /--experiment-gap:\s*14px/);
  // 视图 1 是画布 + 检查器两列，视图 2 是目录 + 画布两列。
  assert.match(
    cssSource,
    /\.experiment-center-grid\[data-mode='config'\]\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*var\(--experiment-inspector-width\)/s
  );
  assert.match(
    cssSource,
    /\.experiment-center-grid\[data-mode='run'\]\s*\{[^}]*grid-template-columns:\s*var\(--experiment-rail-width\)\s*minmax\(0,\s*1fr\)/s
  );
  assert.match(shellSource, /<aside[\s\S]{0,160}?id="experiment-directory-panel"/);
  assert.match(shellSource, /data-config-inspector-panel="true"/);
  assert.match(shellSource, /data-stage=\{stage\}/);
  assert.match(shellSource, /data-mode=\{mode\}/);
});

test('desktop directory and inspector stick to the viewport while the canvas scrolls', () => {
  // 侧栏用 position: sticky（不是 fixed），并扣除底部运行条净空。
  assert.match(
    cssSource,
    /@media \(min-width: 901px\)[\s\S]*?\.experiment-center-grid\[data-directory='open'\] \.experiment-directory\s*\{[^}]*position:\s*sticky/s
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
  // 运行条在配置视图承载提交；监控视图只在任务真的在跑时保留（停止入口）。
  assert.match(shellSource, /\{runBar && \(isConfigMode \? isConfigure : isRunning\) \? \(/);
  assert.match(shellSource, /isMonitoredExperimentStatus\(activeTask\?\.status\)/);
});

test('shell exposes the three experiment stages', () => {
  for (const stage of ['configure', 'monitor', 'result']) {
    assert.match(shellSource, new RegExp(`'${stage}'`), `stage ${stage} should be declared`);
  }
  assert.match(shellSource, /data-stage-heading=\{stage\}/);
  assert.match(shellSource, /data-stage-workspace/);
});

test('shell offers a new-experiment action and a directory handoff', () => {
  assert.match(shellSource, /onClick=\{onCreate\}/);
  assert.match(shellSource, /onClick=\{onBackToDirectory\}/);
  assert.match(shellSource, /experimentCenter\.newExperiment/);
});

test('configuration workspace stays mounted so directory filtering cannot clear the form', () => {
  // 配置工作区用 hidden 隐藏而不是条件卸载：切换阶段/筛选时用户输入不丢失。
  assert.match(shellSource, /data-stage-workspace="configure"[\s\S]{0,120}?hidden=\{stage !== 'configure'\}/);
  assert.match(shellSource, /data-stage-workspace="monitor"\s*hidden=\{!showMonitor\}/);
  assert.match(shellSource, /data-stage-workspace="result"[\s\S]{0,120}?hidden=\{!showResult\}/);
  // 检查器只在配置视图渲染；工作区本身始终挂载，切视图不会清空表单。
  assert.match(shellSource, /\{isConfigMode && inspector \? \(/);
  // 监控视图里监控常驻、结果接在下面（任务完成后不再用结果顶替监控）。
  assert.match(shellSource, /const showMonitor = !isConfigMode \|\| stage === 'monitor'/);
  assert.match(shellSource, /const showResult = !isConfigMode \? Boolean\(activeTask\) : stage === 'result'/);
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
  // 目录行的日期按 locale 格式化；结束时间优先，未结束时回退开始时间。
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

test('the two views replace the old collapsible directory and stage indicator', () => {
  // 视图状态是唯一的列组合开关：初始值跟随当前记录，有记录就直接看它。
  assert.match(shellSource, /useState\(\(\) => \(activeTask \? 'run' : 'config'\)\)/);
  assert.match(shellSource, /const isConfigMode = mode === 'config'/);
  assert.match(shellSource, /if \(!activeTask\) setMode\('config'\)/);
  assert.doesNotMatch(shellSource, /directoryCollapsed/);
  assert.doesNotMatch(shellSource, /experiment-center-stage-nav/);
  assert.doesNotMatch(shellSource, /experiment-center-stage-tab/);
  assert.doesNotMatch(shellSource, /experiment-center-header/);
  assert.doesNotMatch(shellSource, /AddRoundedIcon|CheckRoundedIcon/);
  // 数据属性仍从视图推导，CSS 与测试都读它们。
  assert.match(shellSource, /data-directory=\{isConfigMode \? 'closed' : 'open'\}/);
  assert.match(shellSource, /data-inspector=\{isConfigMode && inspector \? 'present' : 'absent'\}/);
  // 配置视图里检查器可用时是两列；没有检查器时不留空轨道。
  assert.match(
    cssSource,
    /\.experiment-center-grid\[data-mode='config'\]\[data-inspector='absent'\]\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s
  );
});

test('the view bar is a fixed two-button group and no longer a stage flow', () => {
  assert.match(shellSource, /className="experiment-view-bar"[\s\S]{0,80}?data-experiment-view-bar="true"/);  assert.match(shellSource, /role="group"/);
  assert.match(shellSource, /\{\['config', 'run'\]\.map\(\(key\) => \{/);
  assert.match(shellSource, /data-experiment-view=\{key\}/);
  assert.match(shellSource, /data-view-state=\{active \? 'current' : 'idle'\}/);
  assert.match(shellSource, /aria-pressed=\{active\}/);
  assert.match(shellSource, /onClick=\{\(\) => setMode\(key\)\}/);
  // 原来的标题、元信息按钮与阶段指示都不在外壳里了。
  assert.doesNotMatch(shellSource, /experimentCenter\.newExperimentTitle/);
  assert.doesNotMatch(shellSource, /experimentCenter\.hideDirectory/);
  assert.doesNotMatch(shellSource, /experimentCenter\.showDirectory/);
  assert.doesNotMatch(shellSource, /experiment-center-eyebrow/);
  // 视图按钮是真实控件，且样式里不再是默认光标。
  assert.match(cssSource, /\.experiment-view-tab\s*\{[^}]*cursor:\s*pointer/s);
});

test('page controller owns the stage derivation and wires the three workspaces', () => {
  assert.match(pageSource, /getExperimentStage\(\{ activeTask, isCreating \}\)/);
  assert.match(pageSource, /<ExperimentCenterShell/);
  assert.match(pageSource, /<ExperimentDirectory/);
  assert.match(pageSource, /<ExperimentConfigInspector/);
  assert.match(pageSource, /<ExperimentRunBar/);
  assert.match(pageSource, /configure: configWorkspace,/);
  assert.match(pageSource, /monitor: monitorWorkspace,/);
  assert.match(pageSource, /result: resultWorkspace,/);
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
