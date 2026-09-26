import { useMarsChartSetting } from '../workbench/MarsAnalysisSettings.jsx';
import ChartRequestError, { useChartRequestError } from './ChartRequestError.jsx';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Plot from 'react-plotly.js';
import C from '../../../constants/colors';
import { fetchOverviewCorrelation, fetchOverviewEnvHeatmap, fetchOverviewSeasonalHeatmap } from '../../../services/api';
import { useSettings } from '../../../contexts/SettingsContext';
import { ozoneLabel, convertOzone } from '../../../utils/units';
import { fmtNum } from '../../../utils/fmt';
import useAiInsightRegistration from './useAiInsightRegistration';
import {
  buildOverviewSourceSnapshot,
  formatInsightValue,
  roundValue,
  sampleInsightSeries,
} from './aiInsight';
import { formatAdaptiveSeries, formatAdaptiveValue } from './chartValueFormat';

const VARIABLE_META_BASE = [
  { id: 'U_Wind', color: C.blue, unit: 'm/s' },
  { id: 'V_Wind', color: '#7fb3ff', unit: 'm/s' },
  { id: 'Temperature', color: C.mars, unit: 'K' },
  { id: 'Solar_Flux_DN', color: '#f7cf4a', unit: 'W/m^2' },
];

function meanSeriesFromHeatmap(heatmap) {
  if (!heatmap?.z?.length || !heatmap?.x?.length) return [];
  const timeCount = heatmap.x.length;
  return Array.from({ length: timeCount }, (_, columnIndex) => {
    const values = heatmap.z.map((row) => row[columnIndex]).filter((value) => Number.isFinite(value));
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : NaN;
  });
}

function normalizeSeries(series) {
  const valid = series.filter((value) => Number.isFinite(value));
  if (!valid.length) return series.map(() => 0);
  const mean = valid.reduce((sum, value) => sum + value, 0) / valid.length;
  const std = Math.sqrt(valid.reduce((sum, value) => sum + (value - mean) ** 2, 0) / valid.length) || 1;
  return series.map((value) => (Number.isFinite(value) ? (value - mean) / std : 0));
}

function linearRegression(xs, ys) {
  const n = xs.length;
  if (!n) return { slope: 0, intercept: 0, r2: 0 };
  const meanX = xs.reduce((sum, value) => sum + value, 0) / n;
  const meanY = ys.reduce((sum, value) => sum + value, 0) / n;
  const numerator = xs.reduce((sum, value, index) => sum + (value - meanX) * (ys[index] - meanY), 0);
  const denominator = xs.reduce((sum, value) => sum + (value - meanX) ** 2, 0) || 1;
  const slope = numerator / denominator;
  const intercept = meanY - slope * meanX;
  const predictions = xs.map((value) => intercept + slope * value);
  const ssRes = ys.reduce((sum, value, index) => sum + (value - predictions[index]) ** 2, 0);
  const ssTot = ys.reduce((sum, value) => sum + (value - meanY) ** 2, 0) || 1;
  return { slope, intercept, r2: 1 - ssRes / ssTot };
}

function lagCorrelation(seriesA, seriesB, maxLag = 12) {
  const result = [];
  for (let lag = -maxLag; lag <= maxLag; lag += 1) {
    const xs = [];
    const ys = [];
    for (let index = 0; index < seriesA.length; index += 1) {
      const shiftedIndex = index + lag;
      if (shiftedIndex < 0 || shiftedIndex >= seriesB.length) continue;
      const a = seriesA[index];
      const b = seriesB[shiftedIndex];
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
      xs.push(a);
      ys.push(b);
    }
    if (xs.length < 3) {
      result.push({ lag, corr: 0 });
      continue;
    }
    const meanX = xs.reduce((sum, value) => sum + value, 0) / xs.length;
    const meanY = ys.reduce((sum, value) => sum + value, 0) / ys.length;
    const numerator = xs.reduce((sum, value, index) => sum + (value - meanX) * (ys[index] - meanY), 0);
    const denominatorX = Math.sqrt(xs.reduce((sum, value) => sum + (value - meanX) ** 2, 0));
    const denominatorY = Math.sqrt(ys.reduce((sum, value) => sum + (value - meanY) ** 2, 0));
    result.push({ lag, corr: numerator / ((denominatorX * denominatorY) || 1) });
  }
  return result;
}

function strongestCorrelation(matrix, names) {
  let best = null;
  matrix.forEach((row, rowIndex) => {
    row.forEach((value, columnIndex) => {
      if (rowIndex >= columnIndex || !Number.isFinite(value)) return;
      if (!best || Math.abs(value) > Math.abs(best.value)) {
        best = { a: names[rowIndex], b: names[columnIndex], value };
      }
    });
  });
  return best;
}

export default function CorrelationMatrix({ marsYear, overviewSourceParams = {} }) {
  const { settings } = useSettings();

  const isLight = settings?.theme === 'light';
  const plotText = isLight ? 'rgba(23,33,47,0.88)' : 'rgba(236,244,255,0.94)';
  const plotGrid = isLight ? 'rgba(23,33,47,0.12)' : 'rgba(160,196,240,0.16)';

  const ozoneUnit = settings.units.ozone;
  const precision = settings.precision;
  const isCompact = typeof window !== 'undefined' && window.innerWidth < 1500;
  const isZh = settings.language !== 'en';
  const copy = isZh ? {
    loading: '正在加载关系研究...',
    noData: '暂无变量关系数据。',
    labels: {
      U_Wind: '纬向风',
      V_Wind: '经向风',
      Temperature: '温度',
      Solar_Flux_DN: '太阳辐射',
      o3col: 'O3',
      Temp: '温度',
      Solar: '辐射',
    },
    strongest: '最强相关对',
    scatterR2: '散点 R²',
    lagPeak: '最强时滞',
    lagStep: '5° Ls 步长',
    ozoneRange: 'O3 范围',
    scatter: '散点回归',
    evolution: '季节共演化',
    lagCorr: '时滞相关',
    guide: '研究解读指南',
    guide1: '散点回归用于判断某个驱动量与 O3 是同向还是反向变化，以及线性关系的解释力度。',
    guide2: '季节共演化把标准化后的 O3 与驱动变量放到同一时间轴上，便于观察是否同相或反相。',
    guide3: '时滞相关帮助判断响应时序。若峰值出现在正时滞，通常说明驱动变量先变化，O3 后响应。',
    currentFocus: '当前关注',
    strongestLag: '最强时滞相关',
    normalized: '标准化异常',
    lagTitle: '时滞 (5° Ls 步长)',
    corr: '相关系数',
    solarLs: '太阳黄经 Ls (°)',
    samples: '样本点',
    fit: '拟合线',
    ozoneVs: 'O3 对',
    lsHover: '太阳黄经',
    lagHover: '时滞',
    corrHover: '相关系数',
    ozoneLegend: '臭氧',
  } : {
    loading: 'LOADING RELATION LAB...',
    noData: 'No relationship data available.',
    labels: {
      U_Wind: 'U Wind',
      V_Wind: 'V Wind',
      Temperature: 'Temperature',
      Solar_Flux_DN: 'Solar Flux',
      o3col: 'O3',
      Temp: 'Temp',
      Solar: 'Solar',
    },
    strongest: 'MATRIX STRONGEST',
    scatterR2: 'SCATTER R2',
    lagPeak: 'LAG PEAK',
    lagStep: '5 deg Ls steps',
    ozoneRange: 'O3 RANGE',
    scatter: 'Scatter Regression',
    evolution: 'Seasonal Co-Evolution',
    lagCorr: 'Lead-Lag Correlation',
    guide: 'Research Reading Guide',
    guide1: 'Scatter regression tells us whether a driver and O3 move in the same direction, opposite directions, and how much variance a linear fit can explain.',
    guide2: 'Seasonal co-evolution places normalized O3 and the selected driver on the same timeline, making phase alignment and seasonal opposition much easier to spot.',
    guide3: 'Lead-lag correlation helps judge timing. A positive lag peak often suggests the driver changes first and O3 responds later.',
    currentFocus: 'Current focus',
    strongestLag: 'strongest lag corr',
    normalized: 'Normalized anomaly',
    lagTitle: 'Lag (5 deg Ls steps)',
    corr: 'Correlation',
    solarLs: 'Solar Longitude Ls (deg)',
    samples: 'Samples',
    fit: 'Fit',
    ozoneVs: 'O3 vs',
    lsHover: 'Ls',
    lagHover: 'Lag',
    corrHover: 'corr',
    ozoneLegend: 'O3',
  };

  const variableMeta = useMemo(() => VARIABLE_META_BASE.map((meta) => ({
    ...meta,
    label: copy.labels[meta.id],
  })), [copy.labels]);

  const corrLabels = useMemo(() => ({
    o3col: copy.labels.o3col,
    U_Wind: copy.labels.U_Wind,
    V_Wind: copy.labels.V_Wind,
    Temperature: copy.labels.Temp,
    Solar_Flux_DN: copy.labels.Solar,
  }), [copy.labels]);

  const [selectedVariable, setSelectedVariable, managed] = useMarsChartSetting('correlation', 'variable', VARIABLE_META_BASE[2].id);
  const [loading, setLoading] = useState(true);
  const { requestError, setRequestError, retryToken, retry } = useChartRequestError();
  const [correlationData, setCorrelationData] = useState(null);
  const [ozoneHeatmap, setOzoneHeatmap] = useState(null);
  const [envHeatmaps, setEnvHeatmaps] = useState({});

  useEffect(() => {
    let active = true;
    setRequestError(null);
    setLoading(true);
    Promise.all([
      fetchOverviewCorrelation(marsYear, overviewSourceParams),
      fetchOverviewSeasonalHeatmap(marsYear, overviewSourceParams),
      Promise.all(VARIABLE_META_BASE.map((meta) => fetchOverviewEnvHeatmap(marsYear, meta.id, overviewSourceParams))),
    ])
      .then(([corrRes, ozoneRes, envRes]) => {
        if (!active) return;
        setCorrelationData(corrRes);
        setOzoneHeatmap(ozoneRes);
        const nextHeatmaps = {};
        envRes.forEach((item, index) => {
          nextHeatmaps[VARIABLE_META_BASE[index].id] = item;
        });
        setEnvHeatmaps(nextHeatmaps);
        setLoading(false);
      })
      .catch((error) => {
        console.error(error);
        if (active) setRequestError(error);
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [retryToken, marsYear, overviewSourceParams]);

  const derived = useMemo(() => {
    if (!ozoneHeatmap || !envHeatmaps[selectedVariable]) return null;

    const ozoneSeries = meanSeriesFromHeatmap(ozoneHeatmap);
    const envSeries = meanSeriesFromHeatmap(envHeatmaps[selectedVariable]);
    const paired = ozoneSeries
      .map((ozoneValue, index) => ({
        ozone: ozoneValue,
        driver: envSeries[index],
        ls: ozoneHeatmap.x[index],
      }))
      .filter((item) => Number.isFinite(item.ozone) && Number.isFinite(item.driver));

    const xs = paired.map((item) => item.driver);
    const ys = paired.map((item) => item.ozone);
    const regression = linearRegression(xs, ys);
    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs);
    const lagCurve = lagCorrelation(normalizeSeries(envSeries), normalizeSeries(ozoneSeries), 12);

    return {
      ozoneSeries,
      paired,
      regression,
      regressionLine: [
        { x: xMin, y: regression.intercept + regression.slope * xMin },
        { x: xMax, y: regression.intercept + regression.slope * xMax },
      ],
      lagCurve,
      normalizedOzone: normalizeSeries(ozoneSeries),
      normalizedDriver: normalizeSeries(envSeries),
    };
  }, [ozoneHeatmap, envHeatmaps, selectedVariable]);

  const strongest = useMemo(() => {
    if (!correlationData?.matrix) return null;
    return strongestCorrelation(correlationData.matrix, correlationData.variable_names);
  }, [correlationData]);

  const selectedMeta = variableMeta.find((item) => item.id === selectedVariable);
  const strongestLag = derived?.lagCurve?.reduce((best, item) => (
    !best || Math.abs(item.corr) > Math.abs(best.corr) ? item : best
  ), null);
  const ozoneRangeValues = derived?.ozoneSeries?.filter(Number.isFinite) || [];
  const ozoneRangeMin = ozoneRangeValues.length ? convertOzone(Math.min(...ozoneRangeValues), ozoneUnit) : NaN;
  const ozoneRangeMax = ozoneRangeValues.length ? convertOzone(Math.max(...ozoneRangeValues), ozoneUnit) : NaN;
  const scatterOzoneY = derived?.paired?.map((item) => convertOzone(item.ozone, ozoneUnit)) || [];
  const scatterOzoneHover = formatAdaptiveSeries(scatterOzoneY, { fixedDigits: precision });

  const aiInsightProvider = useCallback(() => ({
    card: 'correlation',
    marsYear,
    source: buildOverviewSourceSnapshot(overviewSourceParams),
    selectedVariable,
    selectedVariableLabel: selectedMeta?.label || selectedVariable,
    driverUnit: selectedMeta?.unit || '',
    ozoneUnit: ozoneLabel(ozoneUnit),
    valueMeaning: 'Correlation matrix, scatter regression, normalized seasonal co-evolution, and lead-lag correlation between O3 and the selected driver.',
    status: requestError ? 'error' : loading ? 'loading' : (derived ? 'ready' : 'empty'),
    strongestPair: strongest
      ? {
        a: corrLabels[strongest.a] || strongest.a,
        b: corrLabels[strongest.b] || strongest.b,
        corr: roundValue(strongest.value),
      }
      : null,
    scatter: derived
      ? {
        r2: roundValue(derived.regression.r2),
        slope: roundValue(derived.regression.slope),
        intercept: roundValue(derived.regression.intercept),
      }
      : null,
    lag: strongestLag
      ? {
        lag: strongestLag.lag,
        corr: roundValue(strongestLag.corr),
      }
      : null,
    ozoneRange: derived?.ozoneSeries?.length
      ? {
        min: formatInsightValue(ozoneRangeMin),
        max: formatInsightValue(ozoneRangeMax),
        unit: ozoneLabel(ozoneUnit),
      }
      : null,
    lagCurveSample: sampleInsightSeries(
      derived?.lagCurve?.map((item) => item.corr) || [],
      derived?.lagCurve?.map((item) => item.lag) || [],
      10,
    ),
  }), [corrLabels, derived, loading, requestError, marsYear, overviewSourceParams, ozoneRangeMax, ozoneRangeMin, ozoneUnit, selectedMeta?.label, selectedMeta?.unit, selectedVariable, strongest, strongestLag]);

  useAiInsightRegistration('correlation', aiInsightProvider);

  if (requestError) return <ChartRequestError isZh={isZh} onRetry={retry} />;

  if (loading) {
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: C.ice, fontFamily: 'var(--font-display)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 16, height: 16, border: `2px solid rgba(74,158,255,0.2)`, borderTop: `2px solid ${C.blue}`, borderRadius: '50%', animation: 'spin-slow 1s linear infinite' }} />
          {copy.loading}
        </div>
      </div>
    );
  }

  if (!correlationData?.matrix?.length || !derived) {
    return <div style={{ color: C.mars, padding: 20 }}>{copy.noData}</div>;
  }

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 16, paddingRight: 4 }}>
      {!managed ? (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          {variableMeta.map((meta) => {
            const active = meta.id === selectedVariable;
            return (
              <button
                key={meta.id}
                onClick={() => setSelectedVariable(meta.id)}
                style={{ padding: '8px 12px', borderRadius: 999, border: `1px solid ${active ? meta.color : C.border}`, background: active ? `${meta.color}20` : 'rgba(255,255,255,0.03)', color: active ? meta.color : C.ice60, fontSize: 'calc(11px * var(--font-scale, 1))', cursor: 'pointer', fontFamily: 'var(--font-body)' }}
              >
                {meta.label}
              </button>
            );
          })}
        </div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <div style={{ padding: '14px 16px', borderRadius: 12, background: 'rgba(74,158,255,0.08)', border: '1px solid rgba(74,158,255,0.18)' }}>
          <div style={{ color: C.ice30, fontSize: 'calc(10px * var(--font-scale, 1))', letterSpacing: 1 }}>{copy.strongest}</div>
          <div style={{ marginTop: 6, color: C.blue, fontSize: 'calc(14px * var(--font-scale, 1))', fontWeight: 800 }}>
            {strongest ? `${corrLabels[strongest.a] || strongest.a} -> ${corrLabels[strongest.b] || strongest.b}` : '--'}
          </div>
          <div style={{ color: C.ice30, fontSize: 'calc(11px * var(--font-scale, 1))', marginTop: 4 }}>r = {strongest ? fmtNum(strongest.value, 3) : '--'}</div>
        </div>
        <div style={{ padding: '14px 16px', borderRadius: 12, background: `${selectedMeta.color}14`, border: `1px solid ${selectedMeta.color}55` }}>
          <div style={{ color: C.ice30, fontSize: 'calc(10px * var(--font-scale, 1))', letterSpacing: 1 }}>{copy.scatterR2}</div>
          <div style={{ marginTop: 6, color: selectedMeta.color, fontSize: 'calc(20px * var(--font-scale, 1))', fontWeight: 800, fontFamily: 'var(--font-display)' }}>{fmtNum(derived.regression.r2, 4)}</div>
          <div style={{ color: C.ice30, fontSize: 'calc(11px * var(--font-scale, 1))' }}>{copy.ozoneVs} {selectedMeta.label}</div>
        </div>
        <div style={{ padding: '14px 16px', borderRadius: 12, background: 'rgba(255,255,255,0.03)', border: `1px solid ${C.border}` }}>
          <div style={{ color: C.ice30, fontSize: 'calc(10px * var(--font-scale, 1))', letterSpacing: 1 }}>{copy.lagPeak}</div>
          <div style={{ marginTop: 6, color: C.ice, fontSize: 'calc(18px * var(--font-scale, 1))', fontWeight: 800, fontFamily: 'var(--font-display)' }}>{strongestLag ? `${strongestLag.lag > 0 ? '+' : ''}${strongestLag.lag}` : '--'}</div>
          <div style={{ color: C.ice30, fontSize: 'calc(11px * var(--font-scale, 1))' }}>{copy.lagStep}</div>
        </div>
        <div style={{ padding: '14px 16px', borderRadius: 12, background: 'rgba(255,255,255,0.03)', border: `1px solid ${C.border}` }}>
          <div style={{ color: C.ice30, fontSize: 'calc(10px * var(--font-scale, 1))', letterSpacing: 1 }}>{copy.ozoneRange}</div>
          <div style={{ marginTop: 6, color: C.ice, fontSize: 'calc(14px * var(--font-scale, 1))', fontWeight: 800 }}>
            {formatAdaptiveValue(ozoneRangeMin, { fixedDigits: precision })}
            {' - '}
            {formatAdaptiveValue(ozoneRangeMax, { fixedDigits: precision })}
          </div>
          <div style={{ color: C.ice30, fontSize: 'calc(11px * var(--font-scale, 1))' }}>{ozoneLabel(ozoneUnit)}</div>
        </div>
      </div>

      <div className="mars-chart-grid mars-correlation-grid">
        <div style={{ padding: 14, borderRadius: 16, background: 'rgba(255,255,255,0.03)', border: `1px solid ${C.border}`, minHeight: 340, display: 'grid', gridTemplateRows: 'auto minmax(0, 1fr)' }}>
          <div style={{ color: C.ice, fontSize: 'calc(13px * var(--font-scale, 1))', fontWeight: 800, marginBottom: 8, fontFamily: 'var(--font-display)' }}>{copy.scatter}</div>
          <div style={{ minHeight: 0 }}>
            <Plot
            data={[
              { x: derived.paired.map((item) => item.driver), y: scatterOzoneY, mode: 'markers', type: 'scatter', marker: { color: selectedMeta.color, size: 8, opacity: 0.75, line: { color: '#fff', width: 0.8 } }, text: derived.paired.map((item) => item.ls), customdata: scatterOzoneHover, hovertemplate: `${selectedMeta.label}: %{x:.3f}<br>${copy.ozoneLegend}: %{customdata[0]} ${ozoneLabel(ozoneUnit)}<br>${copy.lsHover} %{text:.0f}°<extra></extra>`, name: copy.samples },
              { x: derived.regressionLine.map((item) => item.x), y: derived.regressionLine.map((item) => convertOzone(item.y, ozoneUnit)), mode: 'lines', type: 'scatter', line: { color: plotText, width: 2 }, hoverinfo: 'skip', name: copy.fit },
            ]}
            layout={{ autosize: true, paper_bgcolor: 'transparent', plot_bgcolor: 'transparent', margin: { l: 52, r: 18, t: 12, b: 44 }, xaxis: { title: `${selectedMeta.label} (${selectedMeta.unit})`, gridcolor: plotGrid, tickfont: { color: plotText, size: 10  }, titlefont: { color: plotText, size: 11  }, automargin: true }, yaxis: { title: `O3 (${ozoneLabel(ozoneUnit)})`, gridcolor: plotGrid, tickfont: { color: plotText, size: 10  }, titlefont: { color: plotText, size: 11  }, automargin: true }, showlegend: false }}
            config={{ displayModeBar: false, responsive: true }}
            useResizeHandler
            style={{ width: '100%', height: '100%' }}
            />
          </div>
        </div>

        <div style={{ padding: 14, borderRadius: 16, background: 'rgba(255,255,255,0.03)', border: `1px solid ${C.border}`, minHeight: 340, display: 'grid', gridTemplateRows: 'auto minmax(0, 1fr)' }}>
          <div style={{ color: C.ice, fontSize: 'calc(13px * var(--font-scale, 1))', fontWeight: 800, marginBottom: 8, fontFamily: 'var(--font-display)' }}>{copy.evolution}</div>
          <div style={{ minHeight: 0 }}>
            <Plot
            data={[
              { x: ozoneHeatmap.x, y: derived.normalizedOzone, mode: 'lines', type: 'scatter', line: { color: C.mars, width: 3, shape: 'spline' }, name: copy.ozoneLegend },
              { x: ozoneHeatmap.x, y: derived.normalizedDriver, mode: 'lines', type: 'scatter', line: { color: selectedMeta.color, width: 3, shape: 'spline' }, name: selectedMeta.label },
            ]}
            layout={{ autosize: true, paper_bgcolor: 'transparent', plot_bgcolor: 'transparent', margin: { l: 48, r: 18, t: 12, b: 44 }, xaxis: { title: copy.solarLs, gridcolor: plotGrid, tickfont: { color: plotText, size: 10  }, titlefont: { color: plotText, size: 11  }, automargin: true }, yaxis: { title: copy.normalized, gridcolor: plotGrid, tickfont: { color: plotText, size: 10  }, titlefont: { color: plotText, size: 11  }, automargin: true }, showlegend: false }}
            config={{ displayModeBar: false, responsive: true }}
            useResizeHandler
            style={{ width: '100%', height: '100%' }}
            />
          </div>
        </div>

        <div style={{ padding: 14, borderRadius: 16, background: 'rgba(255,255,255,0.03)', border: `1px solid ${C.border}`, minHeight: 340, display: 'grid', gridTemplateRows: 'auto minmax(0, 1fr)' }}>
          <div style={{ color: C.ice, fontSize: 'calc(13px * var(--font-scale, 1))', fontWeight: 800, marginBottom: 8, fontFamily: 'var(--font-display)' }}>{copy.lagCorr}</div>
          <div style={{ minHeight: 0 }}>
            <Plot
            data={[{ x: derived.lagCurve.map((item) => item.lag), y: derived.lagCurve.map((item) => item.corr), mode: 'lines+markers', type: 'scatter', line: { color: C.blue, width: 2.5, shape: 'spline' }, marker: { size: 7, color: selectedMeta.color }, hovertemplate: `${copy.lagHover} %{x:+d}<br>${copy.corrHover} %{y:.3f}<extra></extra>` }]}
            layout={{ autosize: true, paper_bgcolor: 'transparent', plot_bgcolor: 'transparent', margin: { l: 48, r: 18, t: 12, b: 44 }, xaxis: { title: copy.lagTitle, gridcolor: plotGrid, tickfont: { color: plotText, size: 10  }, titlefont: { color: plotText, size: 11  }, zeroline: false, automargin: true }, yaxis: { title: copy.corr, gridcolor: plotGrid, tickfont: { color: plotText, size: 10  }, titlefont: { color: plotText, size: 11  }, range: [-1, 1], automargin: true }, shapes: [{ type: 'line', x0: 0, x1: 0, y0: -1, y1: 1, line: { color: 'rgba(255,255,255,0.14)', width: 1, dash: 'dash' } }], showlegend: false }}
            config={{ displayModeBar: false, responsive: true }}
            useResizeHandler
            style={{ width: '100%', height: '100%' }}
            />
          </div>
        </div>

        <div style={{ padding: '16px 18px', borderRadius: 16, background: 'rgba(255,255,255,0.03)', border: `1px solid ${C.border}`, lineHeight: 1.75, color: C.ice60, fontSize: 'calc(12px * var(--font-scale, 1))', minHeight: 340 }}>
          <div style={{ color: C.ice, fontSize: 'calc(13px * var(--font-scale, 1))', fontWeight: 800, marginBottom: 10, fontFamily: 'var(--font-display)' }}>{copy.guide}</div>
          <div>{copy.guide1}</div>
          <div>{copy.guide2}</div>
          <div>{copy.guide3}</div>
          <div style={{ marginTop: 10, color: selectedMeta.color }}>{copy.currentFocus}: {selectedMeta.label} | {copy.strongestLag}: {strongestLag ? fmtNum(strongestLag.corr, 3) : '--'}</div>
        </div>
      </div>
    </div>
  );
}
