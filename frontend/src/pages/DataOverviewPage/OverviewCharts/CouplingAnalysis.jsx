import { useMarsAnalysisManaged } from '../workbench/MarsAnalysisSettings.jsx';
import ChartRequestError, { useChartRequestError } from './ChartRequestError.jsx';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Plot from 'react-plotly.js';
import C from '../../../constants/colors';
import { useSettings } from '../../../contexts/SettingsContext';
import { fetchOverviewCouplingData } from '../../../services/api';
import useAiInsightRegistration from './useAiInsightRegistration';
import {
  buildOverviewSourceSnapshot,
  correlation,
  roundValue,
  sampleInsightSeries,
  summarizeInsightSeries,
} from './aiInsight';
import { movingAverageSeries } from './chartSeries';
import { formatAdaptiveSeries } from './chartValueFormat';

const SMOOTH_WINDOW = 21;

export default function CouplingAnalysis({ marsYear, overviewSourceParams = {} }) {
  const { settings } = useSettings();
  const managed = useMarsAnalysisManaged();

  const isLight = settings?.theme === 'light';
  const plotText = isLight ? 'rgba(23,33,47,0.88)' : 'rgba(236,244,255,0.94)';
  const plotGrid = isLight ? 'rgba(23,33,47,0.12)' : 'rgba(160,196,240,0.16)';

  const isZh = settings.language === 'zh';
  const chartHeight = 360;
  
  const copy = isZh ? {
    title: '温度-臭氧耦合分析',
    desc: '观察全球平均温度与平均臭氧柱含量在火星季节中的同步变化关系。',
    loading: '加载中...',
    noData: '暂无数据',
    ozoneAxis: '全球平均臭氧 (m-atm cm)',
    driverAxis: '全球平均温度 (K)',
    lsAxis: '太阳黄经 Ls',
    ozoneSeries: '臭氧',
    driverSeries: '温度',
  } : {
    title: 'Temperature-Ozone Coupling Analysis',
    desc: 'Compare global mean temperature and ozone column across the Martian seasonal cycle.',
    loading: 'Loading...',
    noData: 'No data',
    ozoneAxis: 'Global Mean O3 (m-atm cm)',
    driverAxis: 'Global Mean Temperature (K)',
    lsAxis: 'Solar Longitude Ls',
    ozoneSeries: 'Ozone',
    driverSeries: 'Temperature',
  };
  const trendNote = isZh
    ? '浅色线为原始日尺度序列，主线为 21 点移动平均趋势；相关系数仍基于原始序列计算。'
    : 'Faint lines are raw daily-scale series; main lines are 21-point moving averages. Correlation is still computed from the raw series.';

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const { requestError, setRequestError, retryToken, retry } = useChartRequestError();

  useEffect(() => {
    let active = true;
    setRequestError(null);
    setLoading(true);
    fetchOverviewCouplingData(marsYear, 'o3col', 'Temperature', overviewSourceParams)
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
    if (!data?.var1?.length || !data?.var2?.length) return null;
    return {
      corr: correlation(data.var1, data.var2),
      ozoneStats: summarizeInsightSeries(data.var1),
      driverStats: summarizeInsightSeries(data.var2),
      ozoneSamples: sampleInsightSeries(data.var1, data.ls || [], 10),
      driverSamples: sampleInsightSeries(data.var2, data.ls || [], 10),
    };
  }, [data]);

  const smoothedData = useMemo(() => {
    if (!data?.var1?.length || !data?.var2?.length) return null;
    return {
      ozone: movingAverageSeries(data.var1, SMOOTH_WINDOW),
      driver: movingAverageSeries(data.var2, SMOOTH_WINDOW),
    };
  }, [data]);

  const ozoneHoverText = useMemo(() => ({
    raw: formatAdaptiveSeries(data?.var1 || [], { fixedDigits: 3 }),
    smoothed: formatAdaptiveSeries(smoothedData?.ozone || data?.var1 || [], { fixedDigits: 3 }),
  }), [data, smoothedData]);

  const aiInsightProvider = useCallback(() => ({
    card: 'coupling',
    marsYear,
    source: buildOverviewSourceSnapshot(overviewSourceParams),
    valueMeaning: 'Global mean O3 and Temperature seasonal coupling; correlation is calculated from raw series while displayed trend lines are smoothed.',
    status: requestError ? 'error' : loading ? 'loading' : (data?.ls?.length ? 'ready' : 'empty'),
    lsCount: data?.ls?.length || 0,
    correlation: diagnostics?.corr ?? null,
    ozone: diagnostics
      ? {
        unit: 'μm-atm',
        stats: diagnostics.ozoneStats,
        samples: diagnostics.ozoneSamples,
      }
      : null,
    driver: diagnostics
      ? {
        name: 'Temperature',
        unit: 'K',
        stats: diagnostics.driverStats,
        samples: diagnostics.driverSamples,
      }
      : null,
    lsRange: {
      min: roundValue(data?.ls?.[0]),
      max: roundValue(data?.ls?.[data?.ls?.length - 1]),
    },
  }), [data, diagnostics, loading, requestError, marsYear, overviewSourceParams]);

  useAiInsightRegistration('coupling', aiInsightProvider);

  if (requestError) return <ChartRequestError isZh={isZh} onRetry={retry} />;

  if (loading) {
    return <div style={{ color: C.ice, padding: 20 }}>{copy.loading}</div>;
  }

  if (!data || !data.ls) {
    return <div style={{ color: C.ice, padding: 20 }}>{copy.noData}</div>;
  }

  return (
    <div style={{ width: '100%', display: 'grid', gridTemplateRows: 'auto auto', gap: 12 }}>
      {!managed ? (
        <div style={{ marginBottom: 12 }}>
          <h3 style={{ color: C.ice, margin: '0 0 4px 0', fontSize: 'calc(16px * var(--font-scale, 1))' }}>{copy.title}</h3>
          <p style={{ color: C.ice60, fontSize: 'calc(12px * var(--font-scale, 1))', margin: 0 }}>{copy.desc}</p>
        </div>
      ) : null}
      <div style={{ minHeight: chartHeight, height: chartHeight }}>
        <Plot
          data={[
            {
              x: data.ls,
              y: data.var1,
              type: 'scatter',
              mode: 'lines',
              name: `${copy.ozoneSeries} raw`,
              line: { color: 'rgba(74,158,255,0.24)', width: 1 },
              yaxis: 'y1',
              customdata: ozoneHoverText.raw,
              hovertemplate: `${copy.lsAxis}: %{x:.1f}<br>${copy.ozoneSeries}: %{customdata[0]}<extra></extra>`,
              showlegend: false,
            },
            {
              x: data.ls,
              y: smoothedData?.ozone || data.var1,
              type: 'scatter',
              mode: 'lines',
              name: copy.ozoneSeries,
              line: { color: C.blue, width: 3 },
              yaxis: 'y1',
              customdata: ozoneHoverText.smoothed,
              hovertemplate: `${copy.lsAxis}: %{x:.1f}<br>${copy.ozoneSeries}: %{customdata[0]}<extra></extra>`
            },
            {
              x: data.ls,
              y: data.var2,
              type: 'scatter',
              mode: 'lines',
              name: `${copy.driverSeries} raw`,
              line: { color: 'rgba(199,91,57,0.24)', width: 1, dash: 'dot' },
              yaxis: 'y2',
              showlegend: false,
            },
            {
              x: data.ls,
              y: smoothedData?.driver || data.var2,
              type: 'scatter',
              mode: 'lines',
              name: copy.driverSeries,
              line: { color: C.mars, width: 3, dash: 'dot' },
              yaxis: 'y2'
            }
          ]}
          layout={{
            autosize: true,
            paper_bgcolor: 'transparent',
            plot_bgcolor: 'transparent',
            margin: { l: 50, r: 74, t: 30, b: 40 },
            xaxis: {
              title: copy.lsAxis,
              gridcolor: plotGrid,
              tickfont: { color: plotText, size: 10  },
              titlefont: { color: plotText, size: 11  },
              automargin: true,
            },
            yaxis: {
              gridcolor: plotGrid,
              tickfont: { color: plotText, size: 10  },
              automargin: true,
              title: {
                text: copy.ozoneAxis,
                standoff: 10,
                font: { color: C.blue, size: 11 },
              },
            },
            yaxis2: {
              side: 'right',
              overlaying: 'y',
              gridcolor: 'transparent',
              tickfont: { color: plotText, size: 10  },
              automargin: true,
              title: {
                text: copy.driverAxis,
                standoff: 14,
                font: { color: C.mars, size: 11 },
              },
            },
            legend: {
              orientation: 'h',
              y: 1.1,
              font: { color: plotText, size: 11  },
            }
          }}
          config={{ displayModeBar: false, responsive: true }}
          useResizeHandler
          style={{ width: '100%', height: chartHeight }}
        />
      </div>
      <div style={{ color: C.ice60, fontSize: 'calc(11px * var(--font-scale, 1))', lineHeight: 1.6 }}>
        {trendNote}
      </div>
    </div>
  );
}
