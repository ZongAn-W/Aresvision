import test from 'node:test';
import assert from 'node:assert/strict';
import { researchExportDefaults, researchFigureSize, currentStepScatter, convertCompareMetrics,
  initialResearchModelSelection, selectedResearchSources, researchSelectionError } from './researchExportModel.js';

test('large comparisons require explicit export selection without silently truncating models', () => {
  const sources = Array.from({ length: 31 }, (_, task_id) => ({ id: `result-${task_id}`, task_id }));
  assert.deepEqual(initialResearchModelSelection(sources, 'step_curves'), []);
  assert.deepEqual(initialResearchModelSelection(sources.slice(0, 8), 'step_curves'), sources.slice(0, 8).map((s) => s.id));
  const selected = selectedResearchSources(sources, ['result-30', 'result-2']);
  assert.deepEqual(selected, [sources[2], sources[30]]);
  assert.equal(selected[0], sources[2]);
  assert.equal(sources.length, 31);
});

test('curve export requires 2–8 selected models and leaves single-source figures usable', () => {
  for (const count of [0, 1, 9, 31]) assert.match(researchSelectionError('step_curves', count, 'zh'), /2–8/);
  for (const count of [2, 8]) assert.equal(researchSelectionError('step_curves', count, 'en'), '');
  assert.match(researchSelectionError('step_curves', 1, 'en'), /Select/);
  assert.equal(researchSelectionError('triptych', 1, 'zh'), '');
  assert.deepEqual(initialResearchModelSelection([{ id: 'prediction-ref' }], 'triptych'), ['prediction-ref']);
});

test('export reuses preferences, restricts DPI, keeps Earth in DU', () => {
  const settings = { language: 'en', colormap: 'cividis', units: { ozone: 'um-atm' }, export: { dpi: 150, format: 'svg', fontSize: 12, includeTitle: false } };
  const options = researchExportDefaults(settings);
  assert.equal(options.dpi, 300);
  assert.equal(options.format, 'svg');
  assert.equal(options.font_size, 12);
  assert.equal(options.include_title, false);
  assert.equal(researchExportDefaults(settings, 'earth').unit, 'DU');
  assert.deepEqual(researchFigureSize('single', 'triptych'), { width_mm: 85, height_mm: 215 });
});

test('scatter selects the current step, converts values and preserves row/column order', () => {
  const result = { ground_truth: [{ field: [[1, 2], [3, 4]] }, { field: [[10, 20], [30, 40]] }],
    prediction: [{ field: [[2, 3], [4, 5]] }, { field: [[20, 30], [40, 50]] }] };
  assert.deepEqual(currentStepScatter(result, 1, 'DU'), { trues: [1, 2, 3, 4], preds: [2, 3, 4, 5] });
  assert.equal(currentStepScatter(result, 5, 'DU'), null);
  assert.equal(result.ground_truth[1].field[0][0], 10);
});

test('compare converts RMSE/MAE once, retaining dimensionless metrics and result identities', () => {
  const ref = { id: 'result' };
  const items = [{ metrics: { export_ref: ref, overall: { rmse: 10, mae: 5, r2: .7, ssim: .8 },
    per_step: [{ step: 1, rmse: 20, mae: 10, r2: .5 }] } }];
  const result = convertCompareMetrics(items, 'DU');
  assert.equal(result[0].metrics.overall.rmse, 1);
  assert.equal(result[0].metrics.per_step[0].mae, 1);
  assert.equal(result[0].metrics.overall.r2, .7);
  assert.equal(result[0].metrics.export_ref, ref);
  assert.equal(items[0].metrics.overall.rmse, 10);
});
