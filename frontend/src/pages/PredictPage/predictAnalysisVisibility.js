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
    // 地球模式自己渲染 DU 场图与指标，不显示火星的 MY/Ls 侧栏输入与系统超参数，
    // 也不显示火星场图/误差分布/PFI：这些分析当前只对火星口径定义。
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
