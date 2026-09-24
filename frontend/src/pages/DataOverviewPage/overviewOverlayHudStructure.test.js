import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const overviewPageSource = readFileSync(new URL('../DataOverviewPage.jsx', import.meta.url), 'utf8');
const globeLegendSource = readFileSync(new URL('./GlobeLegend.jsx', import.meta.url), 'utf8');

test('gesture camera preview is a compact edge HUD instead of a large scene overlay', () => {
  assert.match(overviewPageSource, /className="gesture-capture-hud"/);
  assert.match(overviewPageSource, /const GESTURE_WINDOW_WIDTH = 138/);
  assert.match(overviewPageSource, /const GESTURE_WINDOW_HEIGHT = 96/);
  assert.match(overviewPageSource, /top:\s*'82px'/);
  assert.doesNotMatch(overviewPageSource, /bottom:\s*'116px'/);
});

test('globe legend uses compact edge styling and avoids the tall source-row legend', () => {
  assert.match(globeLegendSource, /className="overview-globe-legend-compact[^\"]*"/);
  assert.match(globeLegendSource, /const panelWidth = gestureEnabled \? 150 : 158/);
  assert.match(globeLegendSource, /source-dot-strip/);
  assert.doesNotMatch(globeLegendSource, /display:\s*'grid',\s*gap:\s*8/);
});
