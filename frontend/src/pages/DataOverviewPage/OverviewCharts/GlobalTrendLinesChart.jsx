import ChartRequestError, { useChartRequestError } from './ChartRequestError.jsx';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Plot from 'react-plotly.js';
import C from '../../../constants/colors';
import { useSettings } from '../../../contexts/SettingsContext';
import { loadResearchSuiteCached } from './ResearchDataClient';
import useAiInsightRegistration from './useAiInsightRegistration';
import {
  buildOverviewSourceSnapshot,
  formatInsightValue,
  sampleInsightSeries,
  summarizeInsightSeries,
} from './aiInsight';
import { movingAverageSeries } from './chartSeries';

const LABELS = {
  o3: { zh: '臭氧', en: 'O3' },
  temp: { zh: '温度', en: 'Temperature' },
  solar: { zh: '太阳辐射', en: 'Solar Flux' },
  wind: { zh: '风速', en: 'Wind Speed' },
};

const DISPLAY_SERIES_KEYS = ['o3', 'temp', 'solar', 'wind'];
const SMOOTH_WINDOW = 21;
/** 紧凑预览的高度下限：够宽以画出真实趋势，又不会把分析区撑高。 */
const COMPACT_PLOT_HEIGHT = 84;

function alphaColor(color, alpha = '33') {
  return typeof color === 'string' && color.startsWith('#') && color.length === 7
    ? `${color}${alpha}`
    : color;
}

export default function GlobalTrendLinesChart({ marsYear, overviewSourceParams = {}, compact = false, height = 340 }) {
  const { settings } = useSettings();
  const isLight = settings?.theme === 'light';
  const isZh = settings?.language !== 'en';
  const plotText = isLight ? 'rgba(23,33,47,0.88)' : 'rgba(236,244,255,0.94)';
  const plotGrid = isLight ? 'rgba(23,33,47,0.12)' : 'rgba(160,196,240,0.15)';
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const { requestError, setRequestError, retryToken, retry } = useChartRequestError();

  const copy = isZh
    ? {
      loading: '正在加载全局趋势线…',
      noData: '暂无数据',
      x: 'Ls',
      y: '标准化值',
      noteTitle: '视图说明：',
      noteBody: '该图对 O3、温度、太阳辐射、风速做全球平均后再标准化（Z-score），用于比较变量间同步变化趋势，不表示绝对数值大小。',
    }
    : {
      loading: 'Loading trend lines...',
      noData: 'No data',
      x: 'Ls',
      y: 'Z-score',
      noteTitle: 'View Note:',
      noteBody: 'This chart compares globally averaged O3, temperature, solar flux and wind after Z-score normalization. It emphasizes synchronized trends rather than absolute magnitudes.',
    };

  useEffect(() => {
    let active = true;
    setRequestError(null);
    setLoading(true);

    loadResearchSuiteCached(marsYear, overviewSourceParams)
      .then((res) => {
        if (active) setData(res?.trend_lines || null);
      })
      .catch((err) => {
        console.error(err);
        if (active) setRequestError(err);
        if (active) setData(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [retryToken, marsYear, overviewSourceParams]);

  const traces = useMemo(() => {
    const ls = data?.ls || [];
    const series = data?.series || {};
    const palette = {
      o3: C.mars,
      temp: '#4acfac',
      solar: '#6aa9ff',
      wind: '#d2b48c',
    };

    const smoothSuffix = isZh ? '平滑趋势' : 'smoothed trend';
    const rawSuffix = isZh ? '原始' : 'raw';

    return DISPLAY_SERIES_KEYS.filter((key) => Array.isArray(series[key])).flatMap((key) => {
      const label = LABELS[key] ? (isZh ? LABELS[key].zh : LABELS[key].en) : key.toUpperCase();
      const color = palette[key] || C.blue;
      const smoothed = movingAverageSeries(series[key], SMOOTH_WINDOW);
      return [
        {
          x: ls,
          y: series[key],
          type: 'scatter',
          mode: 'lines',
          name: `${label} ${rawSuffix}`,
          line: { width: 1, color: alphaColor(color, '30') },
          hovertemplate: `${label} ${rawSuffix} %{y:.3f}<extra></extra>`,
          showlegend: false,
        },
        {
          x: ls,
          y: smoothed,
          type: 'scatter',
          mode: 'lines',
          name: `${label} ${smoothSuffix}`,
          line: { width: key === 'o3' ? 3 : 2.5, color, shape: 'spline' },
          hovertemplate: `${label} ${smoothSuffix} %{y:.3f}<extra></extra>`,
        },
      ];
    });
  }, [data, isZh]);

  const aiInsightProvider = useCallback(() => {
    const lsAxis = data?.ls || [];
    const series = data?.series || {};
    const seriesSummary = DISPLAY_SERIES_KEYS
      .filter((key) => Array.isArray(series[key]))
      .map((key) => {
        const values = series[key];
        const first = values.find((value) => Number.isFinite(value));
        const reversed = [...values].reverse();
        const last = reversed.find((value) => Number.isFinite(value));
        return {
          variable: key,
          label: LABELS[key] ? (isZh ? LABELS[key].zh : LABELS[key].en) : key,
          stats: summarizeInsightSeries(values),
          delta: Number.isFinite(first) && Number.isFinite(last) ? formatInsightValue(last - first) : null,
          sample: sampleInsightSeries(values, lsAxis, 8),
        };
      });
    return {
      card: 'globalTrend',
      marsYear,
      source: buildOverviewSourceSnapshot(overviewSourceParams),
      unit: 'Z-score',
      valueMeaning: 'Globally averaged variables normalized as Z-scores for seasonal co-variation comparison; values are not absolute physical units.',
      status: requestError ? 'error' : loading ? 'loading' : (seriesSummary.length ? 'ready' : 'empty'),
      lsCount: lsAxis.length,
      series: seriesSummary,
    };
  }, [data, isZh, loading, requestError, marsYear, overviewSourceParams]);

  useAiInsightRegistration('globalTrend', aiInsightProvider);

  if (requestError) return <ChartRequestError isZh={isZh} onRetry={retry} />;

  if (loading) return <div style={{ color: C.ice60, fontSize: 'calc(12px * var(--font-scale, 1))' }}>{copy.loading}</div>;
  if (!traces.length) return <div style={{ color: C.mars, fontSize: 'calc(12px * var(--font-scale, 1))' }}>{copy.noData}</div>;

  // 紧凑预览：同一份序列、同样的单位与配色，只是更矮并隐藏图例与说明块，
  // 不做抽样、不做重采样，也不改数值。
  //
  // 高度优先取调用方给的确定像素；观测档预览位是 Grid 项，百分比高度在自动行高
  // 的轨道上解析为 0，Plotly 会量不到尺寸而只画出左上角，因此紧凑预览一律用像素。
  // 分析档主图由外层 flex 容器给高度，此时才允许 '100%' 撑满。
  const fillParent = !compact && height === '100%';
  const numericHeight = Number.isFinite(Number(height)) ? Number(height) : null;
  const heightValue = fillParent ? '100%' : (numericHeight ?? (compact ? COMPACT_PLOT_HEIGHT : 420));

  return (
    <div style={{ width: '100%', display: 'grid', gap: compact ? 4 : 10, flex: fillParent ? '1 1 auto' : undefined, minHeight: 0, minWidth: 0 }}>
      <div
        style={{
          width: '100%',
          height: heightValue,
          minHeight: fillParent ? 200 : heightValue,
          flex: fillParent ? '1 1 auto' : undefined,
          minWidth: 0,
        }}
      >
        <Plot
          data={traces}
          layout={{
            autosize: true,
            paper_bgcolor: 'transparent',
            plot_bgcolor: 'transparent',
            margin: compact ? { l: 40, r: 8, t: 4, b: 22 } : { l: 56, r: 18, t: 8, b: 52 },
            xaxis: {
              title: compact ? '' : copy.x,
              titlefont: { color: plotText, size: 11 },
              tickfont: { color: plotText, size: compact ? 8 : 10 },
              gridcolor: plotGrid,
              automargin: true,
            },
            yaxis: {
              title: compact ? '' : copy.y,
              titlefont: { color: plotText, size: 11 },
              tickfont: { color: plotText, size: compact ? 8 : 10 },
              gridcolor: plotGrid,
              automargin: true,
            },
            showlegend: !compact,
            legend: compact ? undefined : { orientation: 'h', y: 1.13, x: 0, font: { color: plotText, size: 10 } },
          }}
          config={{ displayModeBar: !compact, responsive: true, displaylogo: false }}
          useResizeHandler
          style={{ width: '100%', height: '100%' }}
        />
      </div>

      {!compact ? (
        <div
          style={{
            padding: '12px 14px',
            borderRadius: 12,
            border: `1px solid ${C.border}`,
            background: 'rgba(255,255,255,0.03)',
            color: C.ice60,
            fontSize: 'calc(12px * var(--font-scale, 1))',
            lineHeight: 1.65,
          }}
        >
          <span style={{ color: C.ice, fontWeight: 700 }}>{copy.noteTitle}</span> {copy.noteBody}
          <span> {isZh ? '淡线为原始日尺度序列，粗线为 21 点移动平均趋势。' : 'Faint lines are raw daily-scale series; bold lines are 21-point moving averages.'}</span>
        </div>
      ) : null}
    </div>
  );
}
