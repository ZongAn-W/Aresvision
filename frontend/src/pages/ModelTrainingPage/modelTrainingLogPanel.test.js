import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const monitorSource = readFileSync(new URL('./ExperimentRunMonitor.jsx', import.meta.url), 'utf8');
const logPanelSource = readFileSync(new URL('./ExperimentLogPanel.jsx', import.meta.url), 'utf8');
const pageSource = readFileSync(new URL('../ModelTrainingPage.jsx', import.meta.url), 'utf8');
const cssSource = readFileSync(new URL('./experimentCenter.css', import.meta.url), 'utf8');

test('monitor workspace renders the shared structured live log panel', () => {
  assert.match(monitorSource, /<ExperimentLogPanel/);
  assert.match(logPanelSource, /experiment-monitor-log-toolbar/);
  assert.match(logPanelSource, /experiment-monitor-log-row/);
  assert.match(logPanelSource, /autoScrollPinned/);
  assert.match(logPanelSource, /copy\.logLines/);
});

test('live log panel scrolls inside a bounded panel instead of stretching the page', () => {
  assert.match(cssSource, /\.experiment-monitor-log\s*\{[^}]*display:\s*flex/s);
  assert.match(cssSource, /\.experiment-monitor-log\s*\{[^}]*min-height:\s*320px/s);
  assert.match(cssSource, /\.experiment-monitor-log-scroll\s*\{[^}]*flex:\s*1/s);
  assert.match(cssSource, /\.experiment-monitor-log-scroll\s*\{[^}]*min-height:\s*0/s);
  assert.match(cssSource, /\.experiment-monitor-log-scroll\s*\{[^}]*overflow-y:\s*auto/s);
  assert.match(cssSource, /\.experiment-monitor-log-scroll\s*\{[^}]*overscroll-behavior:\s*contain/s);
  assert.match(cssSource, /\.experiment-monitor-log-scroll\s*\{[^}]*max-height:\s*min\(46vh,\s*460px\)/s);
});

test('log panel keeps the toolbar chips, task id and the auto-follow switch', () => {
  assert.match(logPanelSource, /experiment-monitor-log-chip/);
  assert.match(logPanelSource, /copy\.autoScrollOn/);
  assert.match(logPanelSource, /copy\.autoScrollPaused/);
  assert.match(logPanelSource, /task #\$\{task\.id\}/);
  assert.match(monitorSource, /copy\.liveLogs/);
});

test('page controller still owns the single log container and scroll pinning', () => {
  assert.match(pageSource, /const logContainerRef = useRef\(null\)/);
  assert.match(pageSource, /const autoScrollRef = useRef\(true\)/);
  assert.match(pageSource, /logContainerRef\.current\.scrollTop = logContainerRef\.current\.scrollHeight/);
  assert.match(pageSource, /logContainerRef=\{logContainerRef\}/);
});

test('experiment directory rows render inside a scrollable compact list', () => {
  assert.match(cssSource, /\.experiment-directory\s*\{[^}]*overflow:\s*hidden/s);
  // 列表在列内自己滚动：桌面端由 sticky 规则给 flex/overflow，窄屏给 max-height 上限。
  assert.match(cssSource, /\.experiment-directory \.experiment-directory-list\s*\{[^}]*overflow-y:\s*auto/s);
  assert.match(cssSource, /\.experiment-directory \.experiment-directory-list\s*\{[^}]*overscroll-behavior:\s*contain/s);
  assert.match(cssSource, /\.experiment-directory \.experiment-directory-list\s*\{[^}]*max-height:\s*46vh/s);
});

test('compact loss chart is bounded by the workspace width rather than the window', () => {
  assert.match(monitorSource, /<LossEvolutionChart[\s\S]*?compact/);
  assert.match(monitorSource, /height=\{240\}/);
  assert.doesNotMatch(monitorSource, /window\.innerWidth/);
  assert.doesNotMatch(readFileSync(new URL('../../components/LossEvolutionChart.jsx', import.meta.url), 'utf8'), /window\.innerWidth/);
});
