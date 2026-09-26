import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CARD_TITLES,
  MODE_CARD_KEYS,
  MODE_DEFS,
  getCardTitle,
  getModeCardKeys,
} from './overviewChartLayout.js';

test('overview essentials present the recommended reading path first', () => {
  assert.deepEqual(getModeCardKeys('temporal'), [
    'seasonal',
    'globalTrend',
    'seasonalExtremes',
    'environment',
    'polar',
    'realtime',
  ]);
});

test('advanced diagnostics merges wave diagnostics into the wave card', () => {
  const allCardKeys = Object.values(MODE_CARD_KEYS).flat();

  assert.deepEqual(getModeCardKeys('dynamics'), ['wave']);
  assert.equal(allCardKeys.includes('waveDiag'), false);
});

test('chart titles use beginner-safe names', () => {
  assert.equal(getCardTitle('globalTrend', true), '年内全球变化');
  assert.equal(getCardTitle('globalTrend', false), 'Annual global change');
  assert.equal(getCardTitle('solarsens', true), '太阳辐射-O3关系');
  assert.equal(getCardTitle('wave', true), '波动结构与诊断');
  assert.equal(CARD_TITLES.waveDiag, undefined);
});

test('analysis modes describe the observatory reading levels', () => {
  // 内部 ID 稳定（迁移风险最低），面向用户的名称与观测台分组标题保持一致。
  assert.deepEqual(MODE_DEFS.map((mode) => [mode.id, mode.title.zh, mode.title.en]), [
    ['temporal', '变化规律', 'Change over time'],
    ['drivers', '变量关系', 'Variable relations'],
    ['dynamics', '空间诊断', 'Spatial diagnostics'],
  ]);
});
