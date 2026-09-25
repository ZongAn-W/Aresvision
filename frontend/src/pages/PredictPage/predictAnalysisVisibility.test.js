import test from 'node:test';
import assert from 'node:assert/strict';

import { getPredictAnalysisVisibility } from './predictAnalysisVisibility.js';

test('keeps all prediction analysis modules visible for system model mode', () => {
  assert.deepEqual(getPredictAnalysisVisibility('system'), {
    predictionFields: true,
    metrics: true,
    errorDistribution: true,
    permutationImportance: true,
    inputVariables: true,
    systemHyperparams: true,
    trainedModelParameters: true,
    compareSummary: false,
    compareMetricBars: false,
    compareStepCurves: false,
    compareErrorDistribution: false,
    comparePfi: false,
    compareParameterMatrix: false,
  });
});

test('keeps result-level diagnostics but hides system-only controls for trained model mode', () => {
  assert.deepEqual(getPredictAnalysisVisibility('trained'), {
    predictionFields: true,
    metrics: true,
    errorDistribution: true,
    permutationImportance: true,
    inputVariables: false,
    systemHyperparams: false,
    trainedModelParameters: true,
    compareSummary: false,
    compareMetricBars: false,
    compareStepCurves: false,
    compareErrorDistribution: false,
    comparePfi: false,
    compareParameterMatrix: false,
  });
});

test('shows only multi-model comparison modules for trained model compare mode', () => {
  assert.deepEqual(getPredictAnalysisVisibility('trained_compare'), {
    predictionFields: false,
    metrics: false,
    errorDistribution: false,
    permutationImportance: false,
    inputVariables: false,
    systemHyperparams: false,
    trainedModelParameters: false,
    compareSummary: true,
    compareMetricBars: true,
    compareStepCurves: false,
    compareErrorDistribution: false,
    comparePfi: false,
    compareParameterMatrix: true,
  });
});
