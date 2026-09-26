import { useMarsChartSetting } from '../workbench/MarsAnalysisSettings.jsx';
import ChartRequestError, { useChartRequestError } from './ChartRequestError.jsx';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Plot from 'react-plotly.js';
import C from '../../../constants/colors';
import { useSettings } from '../../../contexts/SettingsContext';
import { fetchOverviewZonalAnomaly } from '../../../services/api';
import useAiInsightRegistration from './useAiInsightRegistration';
import {
  buildOverviewSourceSnapshot,
  formatInsightValue,
  sampleInsightSeries,
} from './aiInsight';
import WaveBandDiagnosticsChart from './WaveBandDiagnosticsChart';
import { formatAdaptiveMatrix } from './chartValueFormat';

export default function WaveExplorer({ marsYear, overviewSourceParams = {} }) {
  const { settings } = useSettings();

  const isLight = settings?.theme === 'light';
  const plotText = isLight ? 'rgba(23,33,47,0.88)' : 'rgba(236,244,255,0.94)';
  const plotGrid = isLight ? 'rgba(23,33,47,0.12)' : 'rgba(160,196,240,0.16)';

  const isZh = settings.language === 'zh';
  
  const copy = isZh ? {
    title: '行星波与纬向距平',
    desc: '展示受塔尔西斯等地形影响产生的臭氧驻波结构。',
    loading: '加载距平数据...',
    noData: '暂无数据',
    lonAxis: '经度 (°E)',
    latAxis: '纬度 (°N)',
    colorbarTitle: '距平 (m-atm cm)',
  } : {
    title: 'Planetary Wave Explorer',
    desc: 'Reveal stationary wave patterns induced by Martian topography.',
    loading: 'Loading zonal anomaly map...',
    noData: 'No data',
    lonAxis: 'Longitude (°E)',
    latAxis: 'Latitude (°N)',
    colorbarTitle: 'Anomaly (m-atm cm)',
  };

  const [variable, , managed] = useMarsChartSetting('wave', 'variable', 'o3col');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const { requestError, setRequestError, retryToken, retry } = useChartRequestError();

  useEffect(() => {
    let active = true;
    setRequestError(null);
    setLoading(true);
    fetchOverviewZonalAnomaly(marsYear, variable, overviewSourceParams)
      .then((res) => {
        if (active) {
          setData(res);
          setLoading(false);
        }
      })
      .catch((err) => {
        console.error(err);
        if (active) setRequestError(err);
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [retryToken, marsYear, variable, overviewSourceParams]);

  const anomalyUnit = { o3col: 'μm-atm', Temperature: 'K', Solar_Flux_DN: 'W/m²', U_Wind: 'm/s', V_Wind: 'm/s' }[variable];
  const diagnostics = useMemo(() => {
    if (!data?.x?.length || !data?.y?.length || !data?.z?.length) return null;
    const rowIndex = Math.floor(data.y.length / 2);
    const equatorSeries = Array.isArray(data.z[rowIndex]) ? data.z[rowIndex] : [];
    return {
      valueRange: {
        min: formatInsightValue(data.min),
        max: formatInsightValue(data.max),
        maxAbs: formatInsightValue(Math.max(Math.abs(data.min || 0), Math.abs(data.max || 0))),
      },
      equatorSamples: sampleInsightSeries(equatorSeries, data.x, 12),
    };
  }, [data]);

  const aiInsightProvider = useCallback(() => ({
    card: 'wave',
    marsYear,
    source: buildOverviewSourceSnapshot(overviewSourceParams),
    variable,
    unit: `${anomalyUnit} anomaly`,
    valueMeaning: 'Zonal anomaly heatmap: positive and negative departures from the zonal mean by longitude and latitude.',
    status: requestError ? 'error' : loading ? 'loading' : (data?.z?.length ? 'ready' : 'empty'),
    dimensions: {
      lonCount: data?.x?.length || 0,
      latCount: data?.y?.length || 0,
    },
    valueRange: diagnostics?.valueRange || null,
    equatorialAnomalySamples: diagnostics?.equatorSamples || [],
  }), [data, diagnostics, loading, requestError, marsYear, overviewSourceParams, variable, anomalyUnit]);

  useAiInsightRegistration('wave', aiInsightProvider);

  const hasHeatmap = Boolean(data?.x?.length && data?.y?.length && data?.z?.length);
  const maxAbs = hasHeatmap ? Math.max(Math.abs(data.min || 0), Math.abs(data.max || 0)) : 0;
  const hoverZ = hasHeatmap ? formatAdaptiveMatrix(data.z, { fixedDigits: 3 }) : [];

  if (requestError) return <ChartRequestError isZh={isZh} onRetry={retry} />;

  return (
    <div className="mars-wave-grid">
      {!managed ? (
        <div>
          <h3 style={{ color: C.ice, margin: '0 0 4px 0', fontSize: 'calc(16px * var(--font-scale, 1))' }}>{copy.title}</h3>
          <p style={{ color: C.ice60, fontSize: 'calc(12px * var(--font-scale, 1))', margin: 0 }}>{copy.desc}</p>
        </div>
      ) : null}
      <div style={{ height: '360px' }}>
        {loading ? (
          <div style={{ color: C.ice, padding: 20 }}>{copy.loading}</div>
        ) : !hasHeatmap ? (
          <div style={{ color: C.ice, padding: 20 }}>{copy.noData}</div>
        ) : (
          <Plot
            data={[
              {
                z: data.z,
                x: data.x,
                y: data.y,
                customdata: hoverZ,
                type: 'heatmap',
                colorscale: 'RdBu',
                zmin: -maxAbs,
                zmax: maxAbs,
                hovertemplate: `${copy.lonAxis}: %{x:.1f}<br>${copy.latAxis}: %{y:.1f}<br>${isZh ? '距平' : 'Anomaly'} (${anomalyUnit}): %{customdata}<extra></extra>`,
                colorbar: {
                  title: `${isZh ? '距平' : 'Anomaly'} (${anomalyUnit})`,
                  titleside: 'right',
                  titlefont: { color: plotText, size: 10  },
                  tickfont: { color: plotText, size: 10  },
                  outlinewidth: 0,
                  xpad: 10
                }
              }
            ]}
            layout={{
              autosize: true,
              paper_bgcolor: 'transparent',
              plot_bgcolor: 'transparent',
              margin: { l: 50, r: 20, t: 30, b: 40 },
              xaxis: {
                title: copy.lonAxis,
                gridcolor: plotGrid,
                tickfont: { color: plotText, size: 10  },
                titlefont: { color: plotText, size: 11  }
              },
              yaxis: {
                title: copy.latAxis,
                gridcolor: plotGrid,
                tickfont: { color: plotText, size: 10  },
                titlefont: { color: plotText, size: 11  }
              }
            }}
            config={{ displayModeBar: false, responsive: true }}
            useResizeHandler
            style={{ width: '100%', height: '100%' }}
          />
        )}
      </div>
      <div className="mars-wave-diagnostics">
        <WaveBandDiagnosticsChart
          marsYear={marsYear}
          overviewSourceParams={overviewSourceParams}
          baseData={data}
          baseLoading={loading}
          baseVariable={variable}
        />
      </div>
    </div>
  );
}
