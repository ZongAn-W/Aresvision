import ChartRequestError, { useChartRequestError } from './ChartRequestError.jsx';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Plot from 'react-plotly.js';
import C from '../../../constants/colors';
import { fetchOverviewEnvHeatmap, fetchOverviewSeasonalHeatmap } from '../../../services/api';
import { useT } from '../../../i18n';
import { useSettings } from '../../../contexts/SettingsContext';
import { convertTemp, tempLabel, convertWind, windLabel } from '../../../utils/units';
import { fmtNum } from '../../../utils/fmt';
import useAiInsightRegistration from './useAiInsightRegistration';
import {
  buildOverviewSourceSnapshot,
  formatInsightValue,
  roundValue,
  sampleInsightSeries,
  summarizeInsightSeries,
} from './aiInsight';

const VARIABLE_META_BASE = [
  { id: 'Temperature', color: C.mars, unit: 'K' },
  { id: 'Solar_Flux_DN', color: '#f7cf4a', unit: 'W/m^2' },
  { id: 'U_Wind', color: C.blue, unit: 'm/s' },
  { id: 'V_Wind', color: '#7fb3ff', unit: 'm/s' },
];

const LAT_BANDS_BASE = [
  { id: 'polar_north', min: 60, max: 90 },
  { id: 'mid_north', min: 30, max: 60 },
  { id: 'equatorial', min: -30, max: 30 },
  { id: 'mid_south', min: -60, max: -30 },
  { id: 'polar_south', min: -90, max: -60 },
];

function summarizeSeriesWithPeak(values) {
  const valid = values.filter((value) => Number.isFinite(value));
  if (!valid.length) return { peakValue: NaN, troughValue: NaN, peakIndex: 0 };
  const peakValue = Math.max(...valid);
  const troughValue = Math.min(...valid);
  const peakIndex = values.findIndex((value) => value === peakValue);
  return { peakValue, troughValue, peakIndex: peakIndex >= 0 ? peakIndex : 0 };
}

function convertValue(variableId, value) {
  if (variableId === 'Temperature') return convertTemp(value, 'K');
  if (variableId === 'U_Wind' || variableId === 'V_Wind') return convertWind(value, 'm/s');
  return value;
}

function unitLabel(variableId, fallback) {
  if (variableId === 'Temperature') return tempLabel('K');
  if (variableId === 'U_Wind' || variableId === 'V_Wind') return windLabel('m/s');
  return fallback;
}

function meanSeriesFromHeatmap(heatmap) {
  if (!heatmap?.z?.length || !heatmap?.x?.length) return [];
  const timeCount = heatmap.x.length;
  return Array.from({ length: timeCount }, (_, columnIndex) => {
    const values = heatmap.z.map((row) => row[columnIndex]).filter((value) => Number.isFinite(value));
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : NaN;
  });
}

function correlation(seriesA, seriesB) {
  const pairs = seriesA
    .map((value, index) => [value, seriesB[index]])
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
  if (pairs.length < 3) return 0;
  const meanA = pairs.reduce((sum, [a]) => sum + a, 0) / pairs.length;
  const meanB = pairs.reduce((sum, [, b]) => sum + b, 0) / pairs.length;
  const numerator = pairs.reduce((sum, [a, b]) => sum + (a - meanA) * (b - meanB), 0);
  const denomA = Math.sqrt(pairs.reduce((sum, [a]) => sum + (a - meanA) ** 2, 0));
  const denomB = Math.sqrt(pairs.reduce((sum, [, b]) => sum + (b - meanB) ** 2, 0));
  return numerator / ((denomA * denomB) || 1);
}

function bandSeries(heatmap, band) {
  if (!heatmap?.y?.length || !heatmap?.z?.length || !heatmap?.x?.length) return [];
  const indices = heatmap.y
    .map((lat, index) => ({ lat, index }))
    .filter(({ lat }) => Number.isFinite(lat) && lat >= band.min && lat <= band.max)
    .map(({ index }) => index);
  if (!indices.length) return [];
  return heatmap.x.map((_, columnIndex) => {
    const values = indices
      .map((rowIndex) => heatmap.z[rowIndex]?.[columnIndex])
      .filter((value) => Number.isFinite(value));
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : NaN;
  });
}

function EnvCard({ meta, dataset, copy, plotText, plotGrid }) {
  const summary = useMemo(() => summarizeSeriesWithPeak(dataset.series), [dataset.series]);
  const convertedMean = convertValue(meta.id, dataset.mean);
  const convertedPeak = convertValue(meta.id, summary.peakValue);
  const convertedSpread = Number.isFinite(summary.peakValue) && Number.isFinite(summary.troughValue)
    ? Math.abs(convertValue(meta.id, summary.peakValue) - convertValue(meta.id, summary.troughValue))
    : NaN;
  const label = unitLabel(meta.id, meta.unit);
  const numericValueStyle = {
    fontFamily: 'var(--font-display)',
    fontVariantNumeric: 'tabular-nums',
    letterSpacing: '0.01em',
    lineHeight: 1.15,
    whiteSpace: 'nowrap',
  };

  return (
    <div style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${C.border}`, borderRadius: 16, padding: 18, display: 'grid', gridTemplateRows: 'auto auto 200px', gap: 12, minWidth: 0 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(96px, auto)', alignItems: 'start', gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: meta.color, fontSize: 'calc(14px * var(--font-scale, 1))', fontWeight: 800, fontFamily: 'var(--font-display)' }}>{meta.label}</div>
          <div style={{ color: C.ice30, fontSize: 'calc(11px * var(--font-scale, 1))' }}>{copy.summary}</div>
        </div>
        <div style={{ minWidth: 96, padding: '8px 10px', borderRadius: 10, background: 'rgba(255,255,255,0.03)', border: `1px solid ${C.border}`, textAlign: 'right', boxSizing: 'border-box' }}>
          <div style={{ color: C.ice30, fontSize: 'calc(10px * var(--font-scale, 1))' }}>{copy.mean}</div>
          <div style={{ ...numericValueStyle, color: meta.color, fontSize: 'calc(15px * var(--font-scale, 1))', fontWeight: 800, marginTop: 2 }}>
            {fmtNum(convertedMean, 2)}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
        <div style={{ padding: '10px 12px', borderRadius: 12, background: 'rgba(255,255,255,0.025)', border: `1px solid ${C.border}`, minWidth: 0 }}>
          <div style={{ color: C.ice30, fontSize: 'calc(10px * var(--font-scale, 1))' }}>{copy.peakLs}</div>
          <div style={{ ...numericValueStyle, color: C.ice, fontSize: 'calc(15px * var(--font-scale, 1))', fontWeight: 800, marginTop: 4 }}>
            {fmtNum(dataset.ls?.[summary.peakIndex] ?? NaN, 0)}°
          </div>
          <div style={{ color: C.ice30, fontSize: 'calc(10px * var(--font-scale, 1))', marginTop: 4, display: 'flex', alignItems: 'baseline', gap: 4, flexWrap: 'wrap' }}>
            <span style={numericValueStyle}>{fmtNum(convertedPeak, 2)}</span>
            <span>{label}</span>
          </div>
        </div>
        <div style={{ padding: '10px 12px', borderRadius: 12, background: 'rgba(255,255,255,0.025)', border: `1px solid ${C.border}`, minWidth: 0 }}>
          <div style={{ color: C.ice30, fontSize: 'calc(10px * var(--font-scale, 1))' }}>{copy.spread}</div>
          <div style={{ ...numericValueStyle, color: C.ice, fontSize: 'calc(15px * var(--font-scale, 1))', fontWeight: 800, marginTop: 4 }}>
            {fmtNum(convertedSpread, 2)}
          </div>
          <div style={{ color: C.ice30, fontSize: 'calc(10px * var(--font-scale, 1))', marginTop: 2 }}>{label}</div>
        </div>
      </div>

      <div style={{ minHeight: 0 }}>
        <Plot
          data={[{
            x: dataset.ls,
            y: dataset.series.map((value) => convertValue(meta.id, value)),
            type: 'scatter',
            mode: 'lines',
            line: { color: meta.color, width: 2.5, shape: 'spline' },
            fill: 'tozeroy',
            fillcolor: `${meta.color}22`,
            hovertemplate: `${copy.lsLabel} %{x:.0f}°<br>%{y:.3f} ${label}<extra></extra>`,
          }]}
          layout={{ autosize: true, paper_bgcolor: 'transparent', plot_bgcolor: 'transparent', margin: { l: 28, r: 12, t: 8, b: 24 }, xaxis: { tickfont: { color: plotText, size: 9  }, gridcolor: plotGrid, showline: false }, yaxis: { tickfont: { color: plotText, size: 9  }, gridcolor: plotGrid, zeroline: false }, showlegend: false }}
          config={{ displayModeBar: false, responsive: true }}
          useResizeHandler
          style={{ width: '100%', height: '100%' }}
        />
      </div>
    </div>
  );
}

export default function EnvironmentDashboard({ marsYear, overviewSourceParams = {} }) {
  const t = useT();
  const { settings } = useSettings();

  const isLight = settings?.theme === 'light';
  const plotText = isLight ? 'rgba(23,33,47,0.88)' : 'rgba(236,244,255,0.94)';
  const plotGrid = isLight ? 'rgba(23,33,47,0.12)' : 'rgba(160,196,240,0.16)';

  const isZh = settings.language !== 'en';
  const copy = isZh ? {
    loading: '正在加载环境驱动...',
    summary: '纬向季节均值摘要',
    mean: '均值',
    peakLs: '峰值 Ls',
    spread: '季节波动',
    influence: '纬带影响矩阵',
    dominant: '各纬带主导驱动',
    driverVar: '驱动变量',
    lsLabel: '太阳黄经',
    corr: '相关系数',
    absCorr: '|相关系数|',
    note: '这组图适合做分区研究。左侧热图回答不同纬带里谁和 O3 关系最强，右侧柱图则把每个纬带的主导驱动因子直接提炼出来。',
    labels: {
      Temperature: '温度',
      Solar_Flux_DN: '太阳辐射',
      U_Wind: '纬向风',
      V_Wind: '经向风',
      polar_north: '北极区',
      mid_north: '北中纬',
      equatorial: '赤道区',
      mid_south: '南中纬',
      polar_south: '南极区',
    },
  } : {
    loading: 'LOADING ENVIRONMENT...',
    summary: 'Seasonal zonal mean summary',
    mean: 'mean',
    peakLs: 'peak Ls',
    spread: 'seasonal spread',
    influence: 'Latitude-Band Influence Matrix',
    dominant: 'Dominant Driver by Latitude',
    driverVar: 'Driver variable',
    lsLabel: 'Ls',
    corr: 'correlation',
    absCorr: '|corr|',
    note: 'This pair of charts is suited to regional analysis. The heatmap shows which driver is most strongly linked to O3 in each latitude band, while the bar chart summarizes the dominant driver band by band.',
    labels: {
      Temperature: 'Temperature',
      Solar_Flux_DN: 'Solar Flux',
      U_Wind: 'U Wind',
      V_Wind: 'V Wind',
      polar_north: 'Polar North',
      mid_north: 'Mid-Lat North',
      equatorial: 'Equatorial',
      mid_south: 'Mid-Lat South',
      polar_south: 'Polar South',
    },
  };

  const variableMeta = useMemo(() => VARIABLE_META_BASE.map((meta) => ({ ...meta, label: copy.labels[meta.id] || meta.id })), [copy.labels]);
  const latBands = useMemo(() => LAT_BANDS_BASE.map((band) => ({ ...band, label: copy.labels[band.id] })), [copy.labels]);

  const [datasets, setDatasets] = useState({});
  const [ozoneHeatmap, setOzoneHeatmap] = useState(null);
  const [loading, setLoading] = useState(true);
  const { requestError, setRequestError, retryToken, retry } = useChartRequestError();

  useEffect(() => {
    let active = true;
    setRequestError(null);
    setLoading(true);
    Promise.all([
      fetchOverviewSeasonalHeatmap(marsYear, overviewSourceParams),
      ...VARIABLE_META_BASE.map((meta) => fetchOverviewEnvHeatmap(marsYear, meta.id, overviewSourceParams)),
    ])
      .then(([ozoneRes, ...envResults]) => {
        if (!active) return;
        const next = {};
        envResults.forEach((item, index) => {
          const meta = VARIABLE_META_BASE[index];
          const series = meanSeriesFromHeatmap(item);
          const allValues = (item?.z ?? []).flat().filter((value) => Number.isFinite(value));
          next[meta.id] = {
            ls: item?.x ?? [],
            series,
            mean: allValues.length ? allValues.reduce((sum, value) => sum + value, 0) / allValues.length : NaN,
            heatmap: item,
          };
        });
        setOzoneHeatmap(ozoneRes);
        setDatasets(next);
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        if (active) setRequestError(err);
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [retryToken, marsYear, overviewSourceParams]);

  const bandInfluence = useMemo(() => {
    if (!ozoneHeatmap || !Object.keys(datasets).length) return null;
    return latBands.map((band) => {
      const ozoneBand = bandSeries(ozoneHeatmap, band);
      return variableMeta.map((meta) => correlation(ozoneBand, bandSeries(datasets[meta.id]?.heatmap, band)));
    });
  }, [datasets, ozoneHeatmap, latBands, variableMeta]);

  const dominantDrivers = useMemo(() => {
    if (!bandInfluence) return [];
    return latBands.map((band, bandIndex) => {
      let best = null;
      variableMeta.forEach((meta, varIndex) => {
        const value = bandInfluence[bandIndex]?.[varIndex];
        if (!best || Math.abs(value) > Math.abs(best.value)) best = { band: band.label, variable: meta.label, value };
      });
      return best;
    }).filter(Boolean);
  }, [bandInfluence, latBands, variableMeta]);

  const aiInsightProvider = useCallback(() => {
    const variableSummary = variableMeta.map((meta) => {
      const dataset = datasets[meta.id];
      return {
        variable: meta.id,
        label: meta.label,
        unit: unitLabel(meta.id, meta.unit),
        mean: formatInsightValue(convertValue(meta.id, dataset?.mean)),
        seriesStats: summarizeInsightSeries((dataset?.series || []).map((value) => convertValue(meta.id, value))),
        seriesSample: sampleInsightSeries(
          (dataset?.series || []).map((value) => convertValue(meta.id, value)),
          dataset?.ls || [],
          8,
        ),
      };
    });
    return {
      card: 'environment',
      marsYear,
      source: buildOverviewSourceSnapshot(overviewSourceParams),
      valueMeaning: 'Environment variables are global/latitude-band seasonal summaries; dominantDrivers are correlations with O3 by latitude band.',
      status: requestError ? 'error' : loading ? 'loading' : (variableSummary.length ? 'ready' : 'empty'),
      dominantDrivers: dominantDrivers.map((item) => ({
        band: item.band,
        variable: item.variable,
        corr: roundValue(item.value),
      })),
      variableSummary,
    };
  }, [datasets, dominantDrivers, loading, requestError, marsYear, overviewSourceParams, variableMeta]);

  useAiInsightRegistration('environment', aiInsightProvider);

  if (requestError) return <ChartRequestError isZh={isZh} onRetry={retry} />;

  if (loading) {
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: C.ice, fontFamily: 'var(--font-display)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 16, height: 16, border: `2px solid rgba(74,207,172,0.2)`, borderTop: '2px solid #4acfac', borderRadius: '50%', animation: 'spin-slow 1s linear infinite' }} />
          {copy.loading}
        </div>
      </div>
    );
  }

  if (!Object.keys(datasets).length || !bandInfluence) {
    return <div style={{ color: C.mars, padding: 20 }}>{t('overview.charts.noData')}</div>;
  }

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 18, paddingRight: 4 }}>
      <div className="mars-chart-grid">
        {variableMeta.map((meta) => (
          <EnvCard key={meta.id} meta={meta} dataset={datasets[meta.id]} copy={copy} plotText={plotText} plotGrid={plotGrid} />
        ))}
      </div>

      <div className="mars-chart-grid">
        <div style={{ padding: 16, borderRadius: 16, background: 'rgba(255,255,255,0.03)', border: `1px solid ${C.border}`, minHeight: 320, display: 'grid', gridTemplateRows: 'auto minmax(0, 1fr)' }}>
          <div style={{ color: C.ice, fontSize: 'calc(14px * var(--font-scale, 1))', fontWeight: 800, marginBottom: 10, fontFamily: 'var(--font-display)' }}>{copy.influence}</div>
          <div style={{ minHeight: 0 }}>
            <Plot
              data={[{
                z: bandInfluence,
                x: variableMeta.map((meta) => meta.label),
                y: latBands.map((band) => band.label),
                type: 'heatmap',
                colorscale: 'RdBu',
                zmin: -1,
                zmax: 1,
                hovertemplate: `%{y}<br>%{x}<br>${copy.corr} %{z:.3f}<extra></extra>`,
                colorbar: {
                  title: copy.corr,
                  tickfont: { color: plotText, size: 10  },
                  titlefont: { color: plotText, size: 10  },
                },
              }]}
              layout={{ autosize: true, paper_bgcolor: 'transparent', plot_bgcolor: 'transparent', margin: { l: 96, r: 34, t: 16, b: 56 }, xaxis: { tickfont: { color: plotText, size: 10  }, title: copy.driverVar, titlefont: { color: plotText, size: 11  }, automargin: true }, yaxis: { tickfont: { color: plotText, size: 10  }, automargin: true } }}
              config={{ displayModeBar: false, responsive: true }}
              useResizeHandler
              style={{ width: '100%', height: '100%' }}
            />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateRows: 'minmax(0, 1fr) auto', gap: 16, minHeight: 0 }}>
          <div style={{ padding: 16, borderRadius: 16, background: 'rgba(255,255,255,0.03)', border: `1px solid ${C.border}`, minHeight: 320, display: 'grid', gridTemplateRows: 'auto minmax(0, 1fr)' }}>
            <div style={{ color: C.ice, fontSize: 'calc(14px * var(--font-scale, 1))', fontWeight: 800, marginBottom: 10, fontFamily: 'var(--font-display)' }}>{copy.dominant}</div>
            <div style={{ minHeight: 0 }}>
              <Plot
                data={[{
                  x: dominantDrivers.map((item) => item.band),
                  y: dominantDrivers.map((item) => Math.abs(item.value)),
                  type: 'bar',
                  marker: { color: dominantDrivers.map((item) => variableMeta.find((meta) => meta.label === item.variable)?.color || C.blue) },
                  text: dominantDrivers.map((item) => item.variable),
                  textposition: 'auto',
                  hovertemplate: `%{x}<br>%{text}<br>${copy.absCorr} %{y:.3f}<extra></extra>`,
                }]}
                layout={{ autosize: true, paper_bgcolor: 'transparent', plot_bgcolor: 'transparent', margin: { l: 52, r: 18, t: 16, b: 64 }, xaxis: { tickfont: { color: plotText, size: 9  }, automargin: true }, yaxis: { tickfont: { color: plotText, size: 10  }, gridcolor: plotGrid, title: copy.absCorr, automargin: true }, showlegend: false }}
                config={{ displayModeBar: false, responsive: true }}
                useResizeHandler
                style={{ width: '100%', height: '100%' }}
              />
            </div>
          </div>
          <div style={{ padding: '14px 16px', borderRadius: 14, background: 'rgba(255,255,255,0.03)', border: `1px solid ${C.border}`, lineHeight: 1.7, fontSize: 'calc(12px * var(--font-scale, 1))', color: C.ice60 }}>
            {copy.note}
          </div>
        </div>
      </div>
    </div>
  );
}
