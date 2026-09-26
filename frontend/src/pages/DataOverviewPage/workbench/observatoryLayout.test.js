import test from 'node:test';
import assert from 'node:assert/strict';
// 与同目录其他测试一致：Node ESM 不做扩展名推断，这里显式写 .js。
import { getObservatoryLayout, pickActiveCard } from './observatoryLayout.js';

test('observing and analysing share one finite vertical budget', () => {
  const input = { width: 1440, height: 900, navHeight: 70, toolbarHeight: 64 };
  const observe = getObservatoryLayout(input);
  const analyze = getObservatoryLayout({ ...input, view: 'analyze' });
  assert.equal(observe.flow, false);
  // 观测档没有分析区：画布吃掉全部主体高度。
  assert.equal(observe.sceneHeight, 702);
  assert.equal(observe.dockHeight, 0);
  assert.ok(analyze.dockHeight > observe.dockHeight);
  assert.ok(analyze.sceneHeight >= 160);
  assert.equal(analyze.sceneHeight + analyze.dockHeight + 64, analyze.contentHeight);
});

test('narrow screens, large chrome, and short screens use document flow', () => {
  const base = { width: 1440, height: 900, navHeight: 70, toolbarHeight: 64 };
  assert.equal(getObservatoryLayout({ ...base, width: 390 }).flow, true);
  // 工作区 < 576px（这里 height 700 → content 566）改用文档流；710 起回到两档桌面布局。
  assert.equal(getObservatoryLayout({ ...base, height: 700 }).flow, true);
  assert.equal(getObservatoryLayout({ ...base, height: 710 }).flow, false);
  assert.equal(getObservatoryLayout({ ...base, toolbarHeight: 350 }).flow, true);
  // 时间轨道被撑高到「轨道 + 最小画布」超过工作区时也要转文档流。
  assert.equal(getObservatoryLayout({ ...base, timelineHeight: 500 }).flow, true);
});

test('card selection preserves a valid selection and explains unsupported catalogs', () => {
  const cards = [
    { key: 'diurnal', state: { status: 'unsupported' } },
    { key: 'seasonal', state: { status: 'idle' } },
    { key: 'globalTrend', state: { status: 'idle' } },
  ];
  assert.equal(pickActiveCard(cards, 'missing'), 'globalTrend');
  assert.equal(pickActiveCard(cards, 'seasonal'), 'seasonal');
  assert.equal(pickActiveCard(cards, 'diurnal'), 'diurnal');
  assert.equal(pickActiveCard(cards.slice(0, 1), null), 'diurnal');
  assert.equal(pickActiveCard([], null), null);
});

test('an unknown view falls back to observe instead of producing an empty scene', () => {
  const layout = getObservatoryLayout({ width: 1440, height: 900, navHeight: 70, view: 'sideways' });
  assert.equal(layout.view, 'observe');
  assert.equal(layout.flow, false);
  // 未知档位按观测档处理：同样不预留分析区。
  assert.equal(layout.dockHeight, 0);
  assert.equal(layout.sceneHeight, 702);
});

test('flow layouts never claim a fixed dock height and keep the scene usable', () => {
  // 窄屏先进入文档流：场景固定为可读像素高度，分析区使用自然内容高度。
  const narrow = getObservatoryLayout({ width: 390, height: 844, navHeight: 70 });
  assert.equal(narrow.flow, true);
  assert.equal(narrow.dockHeight, null);
  assert.equal(narrow.sceneHeight, 420);
  const narrowAnalyze = getObservatoryLayout({ width: 390, height: 844, navHeight: 70, view: 'analyze' });
  assert.equal(narrowAnalyze.sceneHeight, 280);
  assert.equal(narrowAnalyze.dockHeight, null);
  // 观测档的画布不小于分析档，窄屏同样成立。
  assert.ok(narrow.sceneHeight > narrowAnalyze.sceneHeight);
  // 矮屏（宽度足够）也要走文档流，不能把主图压到不可读。
  const short = getObservatoryLayout({ width: 1440, height: 600, navHeight: 70 });
  assert.equal(short.flow, true);
  assert.equal(short.dockHeight, null);
  assert.ok(short.sceneHeight >= 280);
});

test('missing measurements degrade to zero instead of NaN heights', () => {
  const layout = getObservatoryLayout({});
  assert.equal(layout.flow, true);
  assert.equal(layout.contentHeight, 0);
  assert.ok(Number.isFinite(layout.sceneHeight));
  const negative = getObservatoryLayout({ width: 1440, height: 900, navHeight: -50, toolbarHeight: -10, timelineHeight: -5 });
  assert.equal(negative.contentHeight, 900);
  assert.ok(Number.isFinite(negative.sceneHeight) && negative.sceneHeight >= 0);
  assert.ok(Number.isFinite(negative.dockHeight) && negative.dockHeight >= 0);
});

test('a tall viewport grows the analysing dock without shrinking the globe away', () => {
  const layout = getObservatoryLayout({ width: 1920, height: 1080, navHeight: 70, view: 'analyze' });
  assert.equal(layout.flow, false);
  assert.ok(layout.sceneHeight >= 160 && layout.sceneHeight <= 240);
  assert.ok(layout.dockHeight >= 288);
});

test('observing never reserves dock space at any desktop size', () => {
  for (const height of [710, 720, 900, 1080, 1440]) {
    const layout = getObservatoryLayout({ width: 1440, height, navHeight: 70 });
    assert.equal(layout.flow, false, `height ${height} should keep the desktop layout`);
    assert.equal(layout.dockHeight, 0, `height ${height} must not reserve an analysis dock`);
    assert.equal(layout.sceneHeight, layout.contentHeight - layout.timelineHeight);
  }
});

test('the rail removes the bottom timeline row from the canvas budget', () => {
  // 观测档把时间轴搬到左侧刻度轨后，底部那一行整行不渲染，
  // 画布因此吃到「工作区 − 条件栏」的全部高度。
  const withRail = getObservatoryLayout({
    width: 1440, height: 900, navHeight: 70, toolbarHeight: 64, timelineHeight: 0,
  });
  assert.equal(withRail.flow, false);
  assert.equal(withRail.sceneHeight, withRail.contentHeight);
  assert.equal(withRail.dockHeight, 0);
  // 分析档仍然为水平轨道留出 64px。
  const analyzing = getObservatoryLayout({
    width: 1440, height: 900, navHeight: 70, toolbarHeight: 64, timelineHeight: 64, view: 'analyze',
  });
  assert.equal(analyzing.timelineHeight, 64);
  assert.ok(analyzing.sceneHeight + analyzing.dockHeight + 64 === analyzing.contentHeight);
});
