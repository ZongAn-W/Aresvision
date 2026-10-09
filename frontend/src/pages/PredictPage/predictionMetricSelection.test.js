import test from 'node:test';
import assert from 'node:assert/strict';
import { selectPredictionMetrics } from './predictionMetricSelection.js';

test('repeating a Mars forecast retains cached full-test evaluation scope and values', () => {
  const cached = { overall: { rmse: 5 }, aggregation: { overall:'pooled_test_set_pixels' } };
  const prediction = { overall: { rmse: 1 }, aggregation: { overall:'mean_over_forecast_steps' } };
  assert.equal(selectPredictionMetrics({trained:true,cached,prediction,cacheMatches:true}),cached);
  assert.equal(selectPredictionMetrics({trained:true,cached,prediction,cacheMatches:false}),prediction);
  const fetched = {overall:{rmse:3},aggregation:cached.aggregation};
  assert.equal(selectPredictionMetrics({trained:true,fetched,cached,prediction,cacheMatches:true}),fetched);
  assert.equal(selectPredictionMetrics({trained:false,cached,prediction,cacheMatches:true}),prediction);
});
