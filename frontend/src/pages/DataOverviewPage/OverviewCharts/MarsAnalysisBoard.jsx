import React, { useEffect, useMemo, useState } from 'react';
import { useSettings } from '../../../contexts/SettingsContext';
import { fetchOverviewEnvHeatmap, fetchOverviewSeasonalHeatmap, fetchOverviewZonalAnomaly } from '../../../services/api';
import { useMarsChartSetting } from '../workbench/MarsAnalysisSettings.jsx';
import AnalysisBoard from '../workbench/AnalysisBoard.jsx';
import ChartRequestError from './ChartRequestError.jsx';
import { buildMarsAnalysisBoard } from './marsAnalysisBoardModel.js';

/** One data request per theme; panel enlargement does not load a second copy. */
export default function MarsAnalysisBoard({ mode, marsYear, overviewSourceParams }) {
  const { settings } = useSettings();
  const isZh = settings?.language !== 'en';
  const [variable] = useMarsChartSetting(`board-${mode}`, 'variable', mode === 'drivers' ? 'Temperature' : 'o3col');
  const [retryToken, setRetryToken] = useState(0);
  const [result, setResult] = useState(null);
  const identity = JSON.stringify([mode, marsYear, variable, overviewSourceParams, retryToken]);
  useEffect(() => {
    let active = true;
    const load = mode === 'dynamics'
      ? fetchOverviewZonalAnomaly(marsYear, variable, overviewSourceParams).then(data => ({ data }))
      : mode === 'drivers'
        ? Promise.all([
          fetchOverviewEnvHeatmap(marsYear, variable, overviewSourceParams),
          fetchOverviewSeasonalHeatmap(marsYear, overviewSourceParams),
        ]).then(([data, reference]) => ({ data, reference }))
        : (variable === 'o3col'
          ? fetchOverviewSeasonalHeatmap(marsYear, overviewSourceParams)
          : fetchOverviewEnvHeatmap(marsYear, variable, overviewSourceParams)).then(data => ({ data }));
    load.then(payload => { if (active) setResult({ identity, payload }); })
      .catch(error => { if (active) setResult({ identity, error }); });
    return () => { active = false; };
  }, [identity, mode, marsYear, variable, overviewSourceParams]);
  const current = result?.identity === identity ? result : null;
  const model = useMemo(() => current?.payload
    ? buildMarsAnalysisBoard({ mode, ...current.payload, variable, units: settings?.units, isZh })
    : null, [current, mode, variable, settings?.units, isZh]);
  if (!current) return <div className="analysis-state" role="status">{isZh ? '正在加载主题图表…' : 'Loading theme charts…'}</div>;
  if (current.error) return <ChartRequestError isZh={isZh} onRetry={() => setRetryToken(token => token + 1)} />;
  return <AnalysisBoard key={mode} panels={model?.panels} note={model?.note} isZh={isZh} />;
}
