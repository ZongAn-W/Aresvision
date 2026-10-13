import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const overviewPageSource = readFileSync(new URL('../DataOverviewPage.jsx', import.meta.url), 'utf8');
const globeLegendSource = readFileSync(new URL('./GlobeLegend.jsx', import.meta.url), 'utf8');

test('gesture camera preview is a compact edge HUD inside the canvas', () => {
  assert.match(overviewPageSource, /className="gesture-capture-hud"/);
  assert.match(overviewPageSource, /const GESTURE_WINDOW_WIDTH = 138/);
  assert.match(overviewPageSource, /const GESTURE_WINDOW_HEIGHT = 96/);
  // 观测台画布已经是全幅场景：HUD 相对画布左上角定位，不再使用窗口偏移。
  assert.match(overviewPageSource, /top:\s*'12px'/);
  assert.match(overviewPageSource, /left:\s*'12px'/);
  assert.doesNotMatch(overviewPageSource, /bottom:\s*'116px'/);
  assert.doesNotMatch(overviewPageSource, /--overview-scene-left/);
});

test('globe legend uses compact edge styling and avoids the tall source-row legend', () => {
  assert.match(globeLegendSource, /className="overview-globe-legend-compact[^\"]*"/);
  const widths = globeLegendSource.match(/const panelWidth = gestureEnabled \? (\d+) : (\d+)/);
  assert.ok(widths, 'legend keeps an explicit compact width in both interaction states');
  for (const width of widths.slice(1).map(Number)) {
    assert.ok(width >= 240 && width <= 280, 'legend fits readable values without dominating the globe');
  }
  assert.match(globeLegendSource, /source-dot-strip/);
  assert.doesNotMatch(globeLegendSource, /display:\s*'grid',\s*gap:\s*8/);
});
