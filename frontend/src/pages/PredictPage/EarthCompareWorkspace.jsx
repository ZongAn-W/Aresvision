import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { compareEarthModels } from '../../services/earthPredict';
import { useT } from '../../i18n';
import PredictSidebar from './PredictSidebar';
import CompareTrainingModelsPanel from './CompareTrainingModels/CompareTrainingModelsPanel';
import { getCompareSelectionState, buildCompareModelSummary } from './CompareTrainingModels/compareTrainingModelsData';
import { getEarthTrainingModelOptions, resolveEarthPredictErrorMessage } from './earthPredictModel';
import { PREDICT_MODEL_MODE_COMPARE } from './predictModelModes';
import { earthPredictionAdapter } from './PredictionPlanetAdapter';

export default function EarthCompareWorkspace({ tasks, scope, tasksLoading, isLight, precision, isZh, plotTextColor, plotGridColor }) {
  const t = useT();
  const options = useMemo(() => getEarthTrainingModelOptions(tasks), [tasks]);
  const [ids, setIds] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const requestRef = useRef(null);
  const selection = getCompareSelectionState(ids);
  const selectedOptions = options.filter(option => selection.ids.includes(option.id));
  const horizons = selectedOptions.map(option => Number(buildCompareModelSummary(option.task).horizon));
  const horizon = horizons.length && horizons.every(value => Number.isInteger(value) && value >= 1 && value <= 240 && value === horizons[0]) ? horizons[0] : null;
  const key = `${scope}:${selection.ids.join(',')}`;
  useLayoutEffect(() => {
    requestRef.current?.abort();
    setData(null); setError(null); setLoading(false);
    return () => requestRef.current?.abort();
  }, [key]);
  useEffect(() => {
    const allowed = new Set(options.map(option => option.id));
    setIds(current => current.filter(id => allowed.has(id)));
  }, [options]);
  const run = async () => {
    if (!selection.canCompare || loading) return;
    const controller = new AbortController();
    requestRef.current?.abort(); requestRef.current = controller;
    setLoading(true); setError(null);
    try {
      const result = await compareEarthModels(selection.ids, { signal: controller.signal });
      if (!controller.signal.aborted) setData(result);
    } catch (e) {
      if (controller.signal.aborted) return;
      const message = resolveEarthPredictErrorMessage(e);
      setError(message.key ? t(`predict.${message.key}`) : message.fallback);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  };
  return <div className="predict-workspace" data-earth-compare-workspace>
    <PredictSidebar adapter={earthPredictionAdapter({ context: horizon ? { horizon, dataset_id: 'earth_merra2_3hourly_v1' } : null, isZh })} isLight={isLight} modelMode={PREDICT_MODEL_MODE_COMPARE}
      trainingModelOptions={options} selectedCompareTrainingTaskIds={ids} setSelectedCompareTrainingTaskIds={setIds}
      trainingTasksLoading={tasksLoading} loading={loading} requestContextLocked={loading} error={error}
      predStep={horizon ?? ''} predictionHorizonLimit={horizon} handlePredict={run}
      analysisVisibility={{ inputVariables: false, systemHyperparams: false }} precision={precision} />
    <div style={{ minWidth: 0 }}>
      <p className="earth-predict-note">{t('predict.earthCompareNote')}</p>
      <CompareTrainingModelsPanel planet="earth" key={key} data={data} loading={loading} selectedCount={selection.count}
        precision={precision} isZh={isZh} plotTextColor={plotTextColor} plotGridColor={plotGridColor} />
    </div>
  </div>;
}
