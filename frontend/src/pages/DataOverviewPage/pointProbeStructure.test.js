import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pageSource = readFileSync(new URL('../DataOverviewPage.jsx', import.meta.url), 'utf8');
const modalSource = readFileSync(new URL('./PointProbeModal.jsx', import.meta.url), 'utf8');
const contentSource = readFileSync(new URL('./PointProbeContent.jsx', import.meta.url), 'utf8');

test('Data Overview owns the point probe request and keeps it out of selectedCoordinate', () => {
  // 观测台把点位结果嵌进分析区，独立弹窗与嵌入式共用同一份内容组件。
  assert.match(pageSource, /PointProbeContent/);
  assert.match(pageSource, /fetchOverviewPointProbe/);
  assert.doesNotMatch(pageSource, /onGlobeClick=\{\(coord\) => setSelectedCoordinate\(coord\)\}/);
  assert.match(modalSource, /PointProbeContent/);
});

test('point probe content renders point, global mean, and latitude mean series', () => {
  assert.match(contentSource, /point/);
  assert.match(contentSource, /globalMean/);
  assert.match(contentSource, /latitudeMean/);
  assert.match(contentSource, /react-plotly\.js/);
});
