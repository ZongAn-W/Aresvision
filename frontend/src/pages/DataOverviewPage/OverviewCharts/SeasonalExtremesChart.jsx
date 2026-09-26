import { useMarsChartSetting } from '../workbench/MarsAnalysisSettings.jsx';
import ChartRequestError, { useChartRequestError } from './ChartRequestError.jsx';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Plot from 'react-plotly.js';
import C from '../../../constants/colors';
import { useSettings } from '../../../contexts/SettingsContext';
import { fetchOverviewEnvHeatmap, fetchOverviewSeasonalHeatmap } from '../../../services/api';
import {
  convertOzone,
  ozoneLabel,
  convertTemp,
  tempLabel,
  convertWind,
  windLabel,
} from '../../../utils/units';
import useAiInsightRegistration from './useAiInsightRegistration';
import {
  buildOverviewSourceSnapshot,
  formatInsightValue,
  roundValue,
  sampleInsightSeries,
} from './aiInsight';

const VARIABLE_OPTIONS = [
  { id: 'o3col', zh: '臭氧柱浓度', en: 'Ozone Column' },
  { id: 'Temperature', zh: '温度', en: 'Temperature' },
  { id: 'Solar_Flux_DN', zh: '太阳下行辐射', en: 'Solar Downwelling Flux' },
  { id: 'U_Wind', zh: '纬向风 U', en: 'U Wind' },
  { id: 'V_Wind', zh: '经向风 V', en: 'V Wind' },
];

const LATITUDE_BANDS = [
  { id: 'pn', zh: '北极区 (60N-90N)', en: 'Polar North (60N-90N)', min: 60, max: 90 },
  { id: 'mn', zh: '北中纬 (30N-60N)', en: 'Mid-Lat North (30N-60N)', min: 30, max: 60 },
  { id: 'eq', zh: '赤道区 (30S-30N)', en: 'Equatorial (30S-30N)', min: -30, max: 30 },
  { id: 'ms', zh: '南中纬 (30S-60S)', en: 'Mid-Lat South (30S-60S)', min: -60, max: -30 },
  { id: 'ps', zh: '南极区 (60S-90S)', en: 'Polar South (60S-90S)', min: -90, max: -60 },
];

function convertByVariable(value, variable, units) {
  if (!Number.isFinite(value)) return value;
  if (variable === 'o3col') return convertOzone(value, units.ozone);
  if (variable === 'Temperature') return convertTemp(value, units.temperature);
  if (variable === 'U_Wind' || variable === 'V_Wind') return convertWind(value, units.wind);
  return value;
}

function unitByVariable(variable, units) {
  if (variable === 'o3col') return ozoneLabel(units.ozone);
  if (variable === 'Temperature') return tempLabel(units.temperature);
  if (variable === 'U_Wind' || variable === 'V_Wind') return windLabel(units.wind);
  if (variable === 'Solar_Flux_DN') return 'W/m²';
  return '';
}

function buildExtremesFromHeatmap(heatmap, latBands, variable, units) {
  if (!heatmap?.x?.length || !heatmap?.y?.length || !heatmap?.z?.length) return null;
  const ls = heatmap.x;
  const lat = heatmap.y;
  const z = heatmap.z; // [lat, ls]

  const bands = [];
  const amplitude = [];
  const peakLs = [];

  latBands.forEach((band) => {
    const rows = lat
      .map((latValue, index) => ({ latValue, index }))
      .filter(({ latValue }) => Number.isFinite(latValue) && latValue >= band.min && latValue <= band.max)
      .map(({ index }) => index);

    if (!rows.length) {
      bands.push(band.label);
      amplitude.push(NaN);
      peakLs.push(NaN);
      return;
    }

    const bandSeries = ls.map((_, lsIndex) => {
      const values = rows
        .map((rowIndex) => z[rowIndex]?.[lsIndex])
        .filter((value) => Number.isFinite(value));
      if (!values.length) return NaN;
      const meanValue = values.reduce((sum, value) => sum + value, 0) / values.length;
      return convertByVariable(meanValue, variable, units);
    });

    const valid = bandSeries
      .map((value, idx) => ({ value, idx }))
      .filter(({ value }) => Number.isFinite(value));

    if (!valid.length) {
      bands.push(band.label);
      amplitude.push(NaN);
      peakLs.push(NaN);
      return;
    }

    const maxPoint = valid.reduce((a, b) => (b.value > a.value ? b : a), valid[0]);
    const minPoint = valid.reduce((a, b) => (b.value < a.value ? b : a), valid[0]);

    bands.push(band.label);
    amplitude.push(maxPoint.value - minPoint.value);
    peakLs.push(ls[maxPoint.idx]);
  });

  return { bands, amplitude, peak_ls: peakLs };
}

export default function SeasonalExtremesChart({ marsYear, overviewSourceParams = {} }) {
  const { settings } = useSettings();
  const isLight = settings?.theme === 'light';
  const isZh = settings?.language !== 'en';
  const plotText = isLight ? 'rgba(23,33,47,0.88)' : 'rgba(236,244,255,0.94)';
  const plotGrid = isLight ? 'rgba(23,33,47,0.12)' : 'rgba(160,196,240,0.15)';
  const units = settings?.units || { ozone: 'um-atm', temperature: 'K', wind: 'm/s' };

  const [variable, setVariable, managed] = useMarsChartSetting('seasonalExtremes', 'variable', 'o3col');
  const [heatmapData, setHeatmapData] = useState(null);
  const [loading, setLoading] = useState(true);
  const { requestError, setRequestError, retryToken, retry } = useChartRequestError();

  const copy = isZh
    ? {
      loading: '正在加载季节极值图…',
      noData: '暂无数据',
      amp: '振幅',
      peak: '峰值 Ls',
      currentVar: '当前变量',
      noteTitle: '图表说明：',
      noteBodyA: '柱状图表示各纬带',
      noteBodyB: '全年振幅（最大值-最小值）；折线表示峰值出现的 Ls，用于比较不同纬带的强度与时相差异。',
    }
    : {
      loading: 'Loading seasonal extremes...',
      noData: 'No data',
      amp: 'Amplitude',
      peak: 'Peak Ls',
      currentVar: 'Current Variable',
      noteTitle: 'Chart Note:',
      noteBodyA: 'Bars show annual amplitude (max-min) of',
      noteBodyB: 'for each latitude band; the line shows peak Ls timing to compare strength and phase differences.',
    };

  const variableOptions = useMemo(
    () => VARIABLE_OPTIONS.map((option) => ({ ...option, label: isZh ? option.zh : option.en })),
    [isZh],
  );
  const variableLabelMap = useMemo(
    () => Object.fromEntries(variableOptions.map((option) => [option.id, option.label])),
    [variableOptions],
  );
  const currentVariableLabel = variableLabelMap[variable] || variable;
  const currentUnitLabel = unitByVariable(variable, units);
  const latBands = useMemo(
    () => LATITUDE_BANDS.map((band) => ({ ...band, label: isZh ? band.zh : band.en })),
    [isZh],
  );

  useEffect(() => {
    let active = true;
    setRequestError(null);
    setLoading(true);

    const fetcher = variable === 'o3col'
      ? fetchOverviewSeasonalHeatmap(marsYear, overviewSourceParams)
      : fetchOverviewEnvHeatmap(marsYear, variable, overviewSourceParams);

    Promise.resolve(fetcher)
      .then((res) => {
        if (active) setHeatmapData(res || null);
      })
      .catch((err) => {
        console.error(err);
        if (active) setRequestError(err);
        if (active) setHeatmapData(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [retryToken, marsYear, variable, overviewSourceParams]);

  const data = useMemo(
    () => buildExtremesFromHeatmap(heatmapData, latBands, variable, units),
    [heatmapData, latBands, variable, units],
  );

  const aiInsightProvider = useCallback(() => {
    const amplitudes = data?.amplitude || [];
    const peaks = data?.peak_ls || [];
    let strongestBand = null;
    amplitudes.forEach((value, index) => {
      if (!Number.isFinite(value)) return;
      if (!strongestBand || value > strongestBand.amplitude) {
        strongestBand = {
          band: data.bands[index],
          amplitude: value,
          peakLs: peaks[index],
        };
      }
    });
    return {
      card: 'seasonalExtremes',
      marsYear,
      source: buildOverviewSourceSnapshot(overviewSourceParams),
      variable,
      variableLabel: currentVariableLabel,
      unit: currentUnitLabel,
      valueMeaning: 'Annual latitude-band amplitude equals max minus min across Ls; peakLs is the Ls where the band reaches its maximum.',
      status: requestError ? 'error' : loading ? 'loading' : (data?.bands?.length ? 'ready' : 'empty'),
      strongestBand: strongestBand
        ? {
          band: strongestBand.band,
          amplitude: formatInsightValue(strongestBand.amplitude),
          peakLs: roundValue(strongestBand.peakLs, 2),
        }
        : null,
      amplitudeSample: sampleInsightSeries(amplitudes, data?.bands || [], 10),
      peakLsSample: sampleInsightSeries(peaks, data?.bands || [], 10),
    };
  }, [currentUnitLabel, currentVariableLabel, data, loading, requestError, marsYear, overviewSourceParams, variable]);

  useAiInsightRegistration('seasonalExtremes', aiInsightProvider);

  if (requestError) return <ChartRequestError isZh={isZh} onRetry={retry} />;

  if (loading) return <div style={{ color: C.ice60, fontSize: 'calc(12px * var(--font-scale, 1))' }}>{copy.loading}</div>;
  if (!data?.bands?.length) return <div style={{ color: C.mars, fontSize: 'calc(12px * var(--font-scale, 1))' }}>{copy.noData}</div>;

  return (
    <div style={{ width: '100%', display: 'grid', gap: 10 }}>
      {!managed ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {variableOptions.map((option) => (
            <button
              key={option.id}
              onClick={() => setVariable(option.id)}
              style={{
                border: `1px solid ${variable === option.id ? C.blue : C.border}`,
                background: variable === option.id ? 'rgba(74,158,255,0.16)' : 'rgba(255,255,255,0.03)',
                color: variable === option.id ? C.blue : C.ice60,
                borderRadius: 999,
                padding: '6px 10px',
                fontSize: 'calc(11px * var(--font-scale, 1))',
                cursor: 'pointer',
                fontFamily: 'var(--font-body)',
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}

      {!managed ? (
        <div style={{ color: C.ice60, fontSize: 'calc(11px * var(--font-scale, 1))' }}>
          {copy.currentVar}: <span style={{ color: C.blue, fontWeight: 700 }}>{currentVariableLabel}</span>
        </div>
      ) : null}

      <div style={{ width: '100%', height: 340 }}>
        <Plot
          data={[
            {
              x: data.bands,
              y: data.amplitude,
              type: 'bar',
              name: `${copy.amp} (${currentUnitLabel})`,
              marker: { color: 'rgba(199,91,57,0.75)' },
            },
            {
              x: data.bands,
              y: data.peak_ls,
              type: 'scatter',
              mode: 'lines+markers',
              name: copy.peak,
              yaxis: 'y2',
              line: { color: C.blue, width: 2.5, shape: 'spline' },
              marker: { size: 7, color: C.blue },
            },
          ]}
          layout={{
            autosize: true,
            paper_bgcolor: 'transparent',
            plot_bgcolor: 'transparent',
            margin: { l: 56, r: 58, t: 8, b: 76 },
            barmode: 'group',
            xaxis: { tickfont: { color: plotText, size: 10 }, gridcolor: plotGrid, automargin: true },
            yaxis: {
              title: `${copy.amp}${currentUnitLabel ? ` (${currentUnitLabel})` : ''}`,
              titlefont: { color: plotText, size: 11 },
              tickfont: { color: plotText, size: 10 },
              gridcolor: plotGrid,
              automargin: true,
            },
            yaxis2: {
              title: copy.peak,
              titlefont: { color: plotText, size: 11 },
              tickfont: { color: plotText, size: 10 },
              overlaying: 'y',
              side: 'right',
              showgrid: false,
            },
            legend: { orientation: 'h', y: 1.12, x: 0, font: { color: plotText, size: 10 } },
          }}
          config={{ displayModeBar: false, responsive: true }}
          useResizeHandler
          style={{ width: '100%', height: '100%' }}
        />
      </div>

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
        <span style={{ color: C.ice, fontWeight: 700 }}>{copy.noteTitle}</span>{' '}
        {copy.noteBodyA}{' '}
        <span style={{ color: C.blue, fontWeight: 700 }}>{currentVariableLabel}</span>
        {copy.noteBodyB}
      </div>
    </div>
  );
}
