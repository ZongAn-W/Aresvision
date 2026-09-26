import { useMarsAnalysisManaged } from '../workbench/MarsAnalysisSettings.jsx';
import ChartRequestError, { useChartRequestError } from './ChartRequestError.jsx';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Plot from 'react-plotly.js';
import C from '../../../constants/colors';
import { useSettings } from '../../../contexts/SettingsContext';
import { fetchOverviewPolarDynamics } from '../../../services/api';
import useAiInsightRegistration from './useAiInsightRegistration';
import {
  buildOverviewSourceSnapshot,
  formatInsightValue,
  roundValue,
  sampleInsightSeries,
  summarizeInsightSeries,
} from './aiInsight';
import { movingAverageSeries } from './chartSeries';
import { formatAdaptiveSeries } from './chartValueFormat';

const SMOOTH_WINDOW = 21;

export default function PolarDynamics({ marsYear, overviewSourceParams = {} }) {
  const { settings } = useSettings();
  const managed = useMarsAnalysisManaged();

  const isLight = settings?.theme === 'light';
  const plotText = isLight ? 'rgba(23,33,47,0.88)' : 'rgba(236,244,255,0.94)';
  const plotGrid = isLight ? 'rgba(23,33,47,0.12)' : 'rgba(160,196,240,0.16)';

  const isZh = settings.language === 'zh';
  
  const copy = isZh ? {
    title: '极地涡旋与动力输送',
    desc: '对比南北极极夜前后的臭氧急剧积聚趋势及其与温度的关系。',
    loading: '加载极地数据...',
    noData: '暂无数据',
    ozoneAxis: '极地平均 O3 (m-atm cm)',
    tempAxis: '极地平均空气温度 (K)',
    lsAxis: '太阳黄经 Ls (°)',
    northOzone: '北半球 O3 (>60N)',
    southOzone: '南半球 O3 (<60S)',
    northTemp: '北半球温度 (>60N)',
    southTemp: '南半球温度 (<60S)',
  } : {
    title: 'Polar Dynamics & Vortex Tracker',
    desc: 'Compare rapid polar ozone buildup before and after polar night.',
    loading: 'Loading polar data...',
    noData: 'No data',
    ozoneAxis: 'Polar Mean O3 (m-atm cm)',
    tempAxis: 'Polar Mean Air Temp (K)',
    lsAxis: 'Solar Longitude Ls (°)',
    northOzone: 'North O3 (>60N)',
    southOzone: 'South O3 (<60S)',
    northTemp: 'North Temp (>60N)',
    southTemp: 'South Temp (<60S)',
  };

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const { requestError, setRequestError, retryToken, retry } = useChartRequestError();

  useEffect(() => {
    let active = true;
    setRequestError(null);
    setLoading(true);
    fetchOverviewPolarDynamics(marsYear, overviewSourceParams)
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
  }, [retryToken, marsYear, overviewSourceParams]);

  const diagnostics = useMemo(() => {
    if (!data?.ls?.length) return null;
    const northOzone = data?.north?.ozone || [];
    const southOzone = data?.south?.ozone || [];
    const northTemp = data?.north?.temp || [];
    const southTemp = data?.south?.temp || [];

    const findPeak = (series) => {
      if (!series.length) return { value: null, ls: null };
      let bestIndex = -1;
      let bestValue = Number.NEGATIVE_INFINITY;
      series.forEach((value, index) => {
        if (!Number.isFinite(value)) return;
        if (value > bestValue) {
          bestValue = value;
          bestIndex = index;
        }
      });
      if (bestIndex < 0) return { value: null, ls: null };
      return { value: formatInsightValue(series[bestIndex]), ls: roundValue(data.ls[bestIndex]) };
    };

    return {
      northOzoneStats: summarizeInsightSeries(northOzone),
      southOzoneStats: summarizeInsightSeries(southOzone),
      northTempStats: summarizeInsightSeries(northTemp),
      southTempStats: summarizeInsightSeries(southTemp),
      northOzonePeak: findPeak(northOzone),
      southOzonePeak: findPeak(southOzone),
      northOzoneSamples: sampleInsightSeries(northOzone, data.ls, 8),
      southOzoneSamples: sampleInsightSeries(southOzone, data.ls, 8),
    };
  }, [data]);

  const smoothedData = useMemo(() => {
    if (!data?.ls?.length) return null;
    return {
      northOzone: movingAverageSeries(data?.north?.ozone || [], SMOOTH_WINDOW),
      southOzone: movingAverageSeries(data?.south?.ozone || [], SMOOTH_WINDOW),
      northTemp: movingAverageSeries(data?.north?.temp || [], SMOOTH_WINDOW),
      southTemp: movingAverageSeries(data?.south?.temp || [], SMOOTH_WINDOW),
    };
  }, [data]);

  const ozoneHoverText = useMemo(() => ({
    northRaw: formatAdaptiveSeries(data?.north?.ozone || [], { fixedDigits: 3 }),
    northSmoothed: formatAdaptiveSeries(smoothedData?.northOzone || data?.north?.ozone || [], { fixedDigits: 3 }),
    southRaw: formatAdaptiveSeries(data?.south?.ozone || [], { fixedDigits: 3 }),
    southSmoothed: formatAdaptiveSeries(smoothedData?.southOzone || data?.south?.ozone || [], { fixedDigits: 3 }),
  }), [data, smoothedData]);

  const aiInsightProvider = useCallback(() => ({
    card: 'polar',
    marsYear,
    source: buildOverviewSourceSnapshot(overviewSourceParams),
    valueMeaning: 'North and south polar O3 and temperature seasonal series; ozone is in μm-atm and temperature is in K.',
    status: requestError ? 'error' : loading ? 'loading' : (data?.ls?.length ? 'ready' : 'empty'),
    lsCount: data?.ls?.length || 0,
    north: diagnostics
      ? {
        ozoneUnit: 'μm-atm',
        tempUnit: 'K',
        ozoneStats: diagnostics.northOzoneStats,
        tempStats: diagnostics.northTempStats,
        ozonePeak: diagnostics.northOzonePeak,
        ozoneSamples: diagnostics.northOzoneSamples,
      }
      : null,
    south: diagnostics
      ? {
        ozoneUnit: 'μm-atm',
        tempUnit: 'K',
        ozoneStats: diagnostics.southOzoneStats,
        tempStats: diagnostics.southTempStats,
        ozonePeak: diagnostics.southOzonePeak,
        ozoneSamples: diagnostics.southOzoneSamples,
      }
      : null,
  }), [data, diagnostics, loading, requestError, marsYear, overviewSourceParams]);

  useAiInsightRegistration('polar', aiInsightProvider);

  if (requestError) return <ChartRequestError isZh={isZh} onRetry={retry} />;

  if (loading) {
    return <div style={{ color: C.ice, padding: 20 }}>{copy.loading}</div>;
  }

  if (!data || !data.ls) {
    return <div style={{ color: C.ice, padding: 20 }}>{copy.noData}</div>;
  }

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 12 }}>
      {!managed ? (
        <div>
          <h3 style={{ color: C.ice, margin: '0 0 4px 0', fontSize: 'calc(16px * var(--font-scale, 1))' }}>{copy.title}</h3>
          <p style={{ color: C.ice60, fontSize: 'calc(12px * var(--font-scale, 1))', margin: 0 }}>{copy.desc}</p>
        </div>
      ) : null}

      <div className="mars-chart-grid mars-polar-grid">
        
        {/* Ozone vs Ls (North and South) */}
        <Plot
          data={[
            {
              x: data.ls,
              y: data.north.ozone,
              type: 'scatter',
              mode: 'lines',
              name: `${copy.northOzone} raw`,
              line: { color: 'rgba(74,158,255,0.22)', width: 1 },
              customdata: ozoneHoverText.northRaw,
              hovertemplate: `${copy.lsAxis}: %{x:.1f}<br>${copy.northOzone}: %{customdata[0]}<extra></extra>`,
              showlegend: false,
            },
            {
              x: data.ls,
              y: smoothedData?.northOzone || data.north.ozone,
              type: 'scatter',
              mode: 'lines',
              name: copy.northOzone,
              line: { color: C.blue, width: 2.5 },
              customdata: ozoneHoverText.northSmoothed,
              hovertemplate: `${copy.lsAxis}: %{x:.1f}<br>${copy.northOzone}: %{customdata[0]}<extra></extra>`
            },
            {
              x: data.ls,
              y: data.south.ozone,
              type: 'scatter',
              mode: 'lines',
              name: `${copy.southOzone} raw`,
              line: { color: 'rgba(199,91,57,0.22)', width: 1, dash: 'dot' },
              customdata: ozoneHoverText.southRaw,
              hovertemplate: `${copy.lsAxis}: %{x:.1f}<br>${copy.southOzone}: %{customdata[0]}<extra></extra>`,
              showlegend: false,
            },
            {
              x: data.ls,
              y: smoothedData?.southOzone || data.south.ozone,
              type: 'scatter',
              mode: 'lines',
              name: copy.southOzone,
              line: { color: C.mars, width: 2.5, dash: 'dot' },
              customdata: ozoneHoverText.southSmoothed,
              hovertemplate: `${copy.lsAxis}: %{x:.1f}<br>${copy.southOzone}: %{customdata[0]}<extra></extra>`
            }
          ]}
          layout={{
            autosize: true,
            paper_bgcolor: 'transparent',
            plot_bgcolor: 'transparent',
            margin: { l: 50, r: 20, t: 10, b: 30 },
            xaxis: {
              title: copy.lsAxis,
              gridcolor: plotGrid,
              tickfont: { color: plotText, size: 10  },
              titlefont: { color: plotText, size: 11  }
            },
            yaxis: {
              title: copy.ozoneAxis,
              gridcolor: plotGrid,
              tickfont: { color: plotText, size: 10  },
              titlefont: { color: plotText, size: 11  }
            },
            legend: {
              x: 0.05,
              y: 0.95,
              font: { color: plotText, size: 10  },
              bgcolor: 'rgba(0,0,0,0.5)'
            }
          }}
          config={{ displayModeBar: false, responsive: true }}
          useResizeHandler
          style={{ width: '100%', height: '100%' }}
        />

        {/* Temperature vs Ls (North and South) */}
        <Plot
          data={[
            {
              x: data.ls,
              y: data.north.temp,
              type: 'scatter',
              mode: 'lines',
              name: `${copy.northTemp} raw`,
              line: { color: 'rgba(0,210,255,0.20)', width: 1 },
              showlegend: false,
            },
            {
              x: data.ls,
              y: smoothedData?.northTemp || data.north.temp,
              type: 'scatter',
              mode: 'lines',
              name: copy.northTemp,
              line: { color: '#00d2ff', width: 1.5 }
            },
            {
              x: data.ls,
              y: data.south.temp,
              type: 'scatter',
              mode: 'lines',
              name: `${copy.southTemp} raw`,
              line: { color: 'rgba(255,123,0,0.20)', width: 1, dash: 'dot' },
              showlegend: false,
            },
            {
              x: data.ls,
              y: smoothedData?.southTemp || data.south.temp,
              type: 'scatter',
              mode: 'lines',
              name: copy.southTemp,
              line: { color: '#ff7b00', width: 1.5, dash: 'dot' }
            }
          ]}
          layout={{
            autosize: true,
            paper_bgcolor: 'transparent',
            plot_bgcolor: 'transparent',
            margin: { l: 50, r: 20, t: 10, b: 30 },
            xaxis: {
              title: copy.lsAxis,
              gridcolor: plotGrid,
              tickfont: { color: plotText, size: 10  },
              titlefont: { color: plotText, size: 11  }
            },
            yaxis: {
              title: copy.tempAxis,
              gridcolor: plotGrid,
              tickfont: { color: plotText, size: 10  },
              titlefont: { color: plotText, size: 11  }
            },
            legend: {
              x: 0.05,
              y: 0.95,
              font: { color: plotText, size: 10  },
              bgcolor: 'rgba(0,0,0,0.5)'
            }
          }}
          config={{ displayModeBar: false, responsive: true }}
          useResizeHandler
          style={{ width: '100%', height: '100%' }}
        />

      </div>
    </div>
  );
}
