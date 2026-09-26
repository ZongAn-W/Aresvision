import test from 'node:test';
import assert from 'node:assert/strict';
import { getMarsAnalysisFields, updateMarsAnalysisSetting } from './marsAnalysisSettings.js';
import { analysisDescription } from './analysisGuidance.js';

test('analysis conditions only offer choices used by the selected Mars chart', () => {
  assert.deepEqual(getMarsAnalysisFields('seasonal'), ['variable']);
  assert.deepEqual(getMarsAnalysisFields('correlation'), ['variable']);
  assert.deepEqual(getMarsAnalysisFields('realtime'), ['band', 'ls']);
  assert.deepEqual(getMarsAnalysisFields('globalTrend'), []);
  assert.deepEqual(getMarsAnalysisFields('unknown'), []);
});

test('chart choices survive edits to another chart without mutating saved state', () => {
  const seasonal = updateMarsAnalysisSetting({}, 'seasonal', 'variable', 'Temperature');
  const solar = updateMarsAnalysisSetting(seasonal, 'solarsens', 'band', 'Polar North (60N-90N)');
  const updated = updateMarsAnalysisSetting(solar, 'seasonalExtremes', 'variable', 'U_Wind');
  assert.equal(updated.seasonal.variable, 'Temperature');
  assert.equal(updated.solarsens.band, 'Polar North (60N-90N)');
  assert.equal(updated.seasonalExtremes.variable, 'U_Wind');
  assert.deepEqual(seasonal, { seasonal: { variable: 'Temperature' } });
});

test('Mars coupling guidance describes seasonal curves while Earth retains lag analysis', () => {
  assert.match(analysisDescription('coupling', true, 'mars'), /年内曲线/);
  assert.doesNotMatch(analysisDescription('coupling', true, 'mars'), /滞后/);
  assert.match(analysisDescription('coupling', true, 'earth'), /滞后相关/);
  assert.match(analysisDescription('coupling', false, 'mars'), /seasonal evolution/);
});
