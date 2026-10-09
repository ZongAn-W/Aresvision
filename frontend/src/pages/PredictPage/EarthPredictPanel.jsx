import { useMemo } from 'react';
import GlowCard from '../../components/GlowCard';
import { useSettings } from '../../contexts/SettingsContext';
import { describeEarthModelIdentity, readEarthResponseModelIdentity } from './earthPredictModel';
import SingleModelWorkbench from './SingleModelWorkbench';
import ForecastMetricDetails from './ForecastMetricDetails';
import EarthDiagnosticPanel from './EarthDiagnosticPanel';
import PredictStatus from './PredictStatus';
import { createEarthPredictionPresentation } from './predictionPresentation';
import './earthPredictPanel.css';

/** Earth owns adaptation and context details; the workspace owns all display interactions. */
export default function EarthPredictPanel({ copy, adapter, context, result, loading, selectedDay, onSelectDay,
  selectedTaskId, taskOptions, identityKey, origin, scope }) {
  const { settings } = useSettings();
  const normalized = useMemo(() => adapter.normalizeResult(result), [adapter, result]);
  const modelIdentity = readEarthResponseModelIdentity(result || context);
  const warnings = result?.warnings?.length ? result.warnings : context?.warnings;
  const inputs = result?.input_timestamps || result?.input_dates || [];
  const workbenchAdapter = { ...adapter, secondaryMetrics: context ? {
    data: context.metrics?.splits?.test,
    presentation: createEarthPredictionPresentation({ settings, scope: 'full_test' }).metrics,
  } : null };
  return <div className="earth-predict-panel" data-earth-predict-panel="true">
    {context ? <GlowCard style={{ padding: 20 }}>
      <header className="earth-predict-head"><div><h2>{copy.title}</h2><p className="earth-predict-note">{copy.threeHourlyNote || copy.note}</p></div>
        <span className="earth-predict-unit" data-earth-unit="DU">TO3 · DU</span></header>
      <details className="prediction-context-details"><summary>{settings.language === 'en' ? 'Model and dataset context' : '模型与数据集上下文'}</summary>
        <dl className="earth-predict-facts">
          <div><dt>{copy.factModel}</dt><dd data-earth-context-model data-model-source={modelIdentity.modelSource}>{describeEarthModelIdentity(modelIdentity, copy)}</dd></div>
          <div><dt>{copy.factDataset}</dt><dd>{context.dataset_id} · {context.dataset_version}</dd></div>
          <div><dt>{copy.factGrid}</dt><dd>{context.grid?.shape?.join(' × ')}</dd></div>
          <div><dt>{copy.factWindow}</dt><dd>{context.window} → {context.horizon} {copy.stepUnit}</dd></div>
          <div><dt>{copy.factFrequency}</dt><dd>3h UTC</dd></div>
          <div><dt>{copy.factChannels}</dt><dd>{context.input_channel_order?.join(', ')}</dd></div>
          <div><dt>{copy.factBestEpoch}</dt><dd>{context.run?.best_epoch ?? '—'}</dd></div>
        </dl>
      </details>
      {result ? <p className="earth-predict-origin-line" data-earth-origin-line>{copy.originLine(result.forecast_origin, inputs[0], inputs.at(-1), true, result.window, result.horizon)}
        {result.origin_split ? ` · ${copy.originSplit(result.origin_split)}` : ''}</p> : null}
      {Array.isArray(warnings) && warnings.length ? <PredictStatus message={warnings.join(' · ')} /> : null}
    </GlowCard> : null}
    <SingleModelWorkbench adapter={workbenchAdapter} result={normalized} metrics={result?.metrics} loading={loading}
      activeStep={selectedDay} onStepChange={onSelectDay} identityKey={identityKey}>
      {result ? <ForecastMetricDetails result={result} adapter={adapter} precision={settings.precision} /> : null}
      {result ? <p className="earth-predict-note" data-earth-reference-note>{copy.referenceNote}</p> : null}
      <EarthDiagnosticPanel key={`${scope}:${selectedTaskId || 'no-task'}`} taskId={selectedTaskId}
        identity={{ ...(taskOptions.find(option => Number(option.id) === Number(selectedTaskId))?.task || {}), ...(context || {}) }} />
    </SingleModelWorkbench>
  </div>;
}
