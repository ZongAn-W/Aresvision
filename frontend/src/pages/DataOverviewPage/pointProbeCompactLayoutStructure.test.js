import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// 紧凑外壳与内容已经拆开：弹窗只是遮罩，内容同时服务于分析区嵌入。
const modalSource = readFileSync(new URL('./PointProbeModal.jsx', import.meta.url), 'utf8');
const contentSource = readFileSync(new URL('./PointProbeContent.jsx', import.meta.url), 'utf8');

test('point probe uses a compact shell instead of a wide analysis board', () => {
  assert.match(contentSource, /point-probe-modal-compact/);
  assert.match(contentSource, /width: dialog \? 'min\(700px, calc\(100vw - 28px\)\)' : '100%'/);
  assert.match(contentSource, /maxHeight: dialog \? 'min\(600px, calc\(100vh - 28px\)\)' : 'none'/);
  assert.match(contentSource, /point-probe-header/);
  assert.match(contentSource, /point-probe-summary-grid/);
  assert.match(contentSource, /point-probe-info-panel/);
  assert.match(contentSource, /point-probe-metric-row/);
  assert.match(contentSource, /overview:/);
  assert.match(contentSource, /comparison:/);
  assert.match(contentSource, /point-probe-chart-panel/);
  assert.match(contentSource, /height:\s*220/);
  // 嵌入分析区时不写死像素宽度，避免窄屏横向溢出。
  assert.match(contentSource, /repeat\(auto-fit, minmax\(140px, 1fr\)\)/);
  assert.doesNotMatch(contentSource, /width:\s*'min\(920px, calc\(100vw - 44px\)\)'/);
  assert.doesNotMatch(contentSource, /height:\s*330/);
});

test('the point probe dialog keeps its own scroll-free overlay shell', () => {
  assert.match(modalSource, /role="dialog"/);
  assert.match(modalSource, /aria-modal="true"/);
  assert.match(modalSource, /PointProbeContent/);
  assert.match(modalSource, /zIndex:\s*2500/);
});
