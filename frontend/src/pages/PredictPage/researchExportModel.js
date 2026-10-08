const COLORMAPS = ['inferno', 'viridis', 'plasma', 'magma', 'cividis', 'jet', 'rdbu'];
export const MAX_RESEARCH_CURVE_MODELS = 8;

export function initialResearchModelSelection(sources, kind) {
  return kind === 'step_curves' && sources.length > MAX_RESEARCH_CURVE_MODELS
    ? [] : sources.map((source) => source.id);
}

export function selectedResearchSources(sources, selectedIds) {
  return sources.filter((source) => selectedIds.includes(source.id));
}

export function researchSelectionError(kind, count, language) {
  if (kind !== 'step_curves') return '';
  if (count >= 2 && count <= MAX_RESEARCH_CURVE_MODELS) return '';
  return language === 'en'
    ? 'Select 2–8 models for this figure. Larger comparisons can be exported in separate figures.'
    : '请为本图选择 2–8 个模型；更多模型可分组导出。';
}

export function researchExportDefaults(settings, planet = 'mars') {
  return {
    width_mm: 180, height_mm: 85, language: settings.language === 'en' ? 'en' : 'zh',
    font: 'auto', font_size: [8, 10, 12].includes(settings.export?.fontSize) ? settings.export.fontSize : 10,
    line_width: 0.8, colormap: COLORMAPS.includes(settings.colormap) ? settings.colormap : 'viridis',
    format: ['png', 'svg', 'pdf'].includes(settings.export?.format) ? settings.export.format : 'pdf',
    dpi: settings.export?.dpi === 600 ? 600 : 300, panel_labels: true,
    include_title: settings.export?.includeTitle !== false,
    unit: planet === 'earth' || settings.units?.ozone === 'DU' ? 'DU' : 'um-atm',
  };
}

export function researchFigureSize(preset, kind) {
  if (preset === 'single') return { width_mm: 85, height_mm: kind === 'triptych' ? 215 : 85 };
  return { width_mm: 180, height_mm: kind === 'triptych' ? 60 : 100 };
}

export function currentStepScatter(result, step, unit) {
  const truth = result?.ground_truth?.[step]?.field;
  const prediction = result?.prediction?.[step]?.field;
  if (!truth || !prediction) return null;
  const factor = unit === 'DU' ? 0.1 : 1;
  return { trues: truth.flat().map((v) => v * factor), preds: prediction.flat().map((v) => v * factor) };
}

export function convertCompareMetrics(items, unit) {
  const factor = unit === 'DU' ? 0.1 : 1;
  const row = (value) => ({ ...value,
    rmse: value?.rmse == null ? value?.rmse : value.rmse * factor,
    mae: value?.mae == null ? value?.mae : value.mae * factor,
  });
  return items.map((item) => ({ ...item, metrics: { ...item.metrics,
    overall: row(item.metrics?.overall), per_step: (item.metrics?.per_step || []).map(row),
  } }));
}
