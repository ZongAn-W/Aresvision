const FULL_VISIBILITY = {
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
};

export function getPredictAnalysisVisibility(modelMode = 'system') {
  if (modelMode === 'earth_compare') return Object.fromEntries(Object.keys(FULL_VISIBILITY).map(key => [key, false]));
  if (modelMode === 'trained_compare') {
    return {
      ...FULL_VISIBILITY,
      predictionFields: false,
      metrics: false,
      errorDistribution: false,
      permutationImportance: false,
      inputVariables: false,
      systemHyperparams: false,
      trainedModelParameters: false,
      compareSummary: true,
      compareMetricBars: true,
      compareParameterMatrix: true,
    };
  }

  if (modelMode === 'earth') {
    // Earth mounts the shared single-model workspace via its adapter entry point.
    // These flags control only the Mars request/analysis assembly in PredictPage.
    return {
      ...FULL_VISIBILITY,
      predictionFields: false,
      metrics: false,
      errorDistribution: false,
      permutationImportance: false,
      inputVariables: false,
      systemHyperparams: false,
      trainedModelParameters: true,
    };
  }

  if (modelMode !== 'trained') return { ...FULL_VISIBILITY };

  return {
    ...FULL_VISIBILITY,
    inputVariables: false,
    systemHyperparams: false,
    trainedModelParameters: true,
  };
}
