import { useLayoutEffect, useState } from 'react';
import { useT } from '../../i18n';
import { useSettings } from '../../contexts/SettingsContext';
import { VIEW_MODE_IDS, TRIPTYCH_PANEL_DEFS } from './PredictComponents';
import PredictDisplay from './PredictDisplay';
import PredictMetrics from './PredictMetrics';
import PredictFullscreenHUD from './PredictFullscreenHUD';
import PredictStatus from './PredictStatus';

/** The common single-model layout owns view/fullscreen state, independent of API state. */
export default function SingleModelWorkbench({ adapter, result, loading, metrics, metricsLoading,
  metricPresentation, activeStep = 0, onStepChange, identityKey, error, onRetry, children,
  hasAvailableModels = false, modelsLoading = false,
  viewMode: controlledView, setViewMode: onViewChange,
  fullscreen: controlledFullscreen, onFullscreenChange }) {
  const t = useT();
  const { settings } = useSettings();
  const [localView, setLocalView] = useState('triptych');
  const viewMode = controlledView ?? localView;
  const setViewMode = onViewChange || setLocalView;
  const [localFullscreen, setLocalFullscreen] = useState(null);
  const fullscreen = controlledFullscreen === undefined ? localFullscreen : controlledFullscreen;
  const setFullscreen = onFullscreenChange || setLocalFullscreen;
  useLayoutEffect(() => { setFullscreen(null); }, [identityKey, loading]);
  const step = Math.max(0, Math.min(activeStep, (result?.horizon || 1) - 1));
  const truthField = result?.ground_truth?.[step] ?? null;
  const predField = result?.prediction?.[step] ?? null;
  const residField = result?.residual?.[step] ?? null;
  const panels = TRIPTYCH_PANEL_DEFS.map(panel => ({ ...panel, title: t(`predict.panels.${panel.key}`) }));
  return <div className="single-model-workbench" data-single-model-workbench={adapter.id}>
    <PredictStatus error={error} onRetry={onRetry} retryLabel={settings.language === 'en' ? 'Retry prediction' : '重试预测'} />
    <PredictDisplay adapter={adapter} results={result} viewMode={viewMode} setViewMode={setViewMode}
      VIEW_MODES={VIEW_MODE_IDS.map(id => ({ id, label: id === 'original'
        ? (settings.language === 'en' ? 'Reference' : '参考') : t(`predict.viewModes.${id}`) }))}
      activeHorizon={step} setActiveHorizon={onStepChange} loading={loading}
      truthField={truthField} predField={predField} residField={residField}
      stepLabel={() => ''} TRIPTYCH_PANELS={panels} setFullscreen3D={setFullscreen}
      hasAvailableModels={hasAvailableModels} modelsLoading={modelsLoading} />
    {result || metrics || metricsLoading || loading ? <PredictMetrics metrics={metrics} loading={metricsLoading || loading} presentation={metricPresentation || adapter.presentation.metrics}
      modelMode="trained" precision={settings.precision} ozoneUnit={settings.units.ozone} /> : null}
    {adapter.secondaryMetrics ? <PredictMetrics metrics={adapter.secondaryMetrics.data} loading={adapter.secondaryMetrics.loading}
      presentation={adapter.secondaryMetrics.presentation} precision={settings.precision} /> : null}
    {hasAvailableModels || result || loading ? children : null}
    <PredictFullscreenHUD fullscreen3D={fullscreen} setFullscreen3D={setFullscreen} adapter={adapter}
      results={result} activeHorizon={step} truthField={truthField}
      precision={settings.precision} ozoneUnit={settings.units.ozone} />
  </div>;
}
