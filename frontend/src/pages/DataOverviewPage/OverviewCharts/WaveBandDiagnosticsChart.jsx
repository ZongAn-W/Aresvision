import { useMarsChartSetting } from '../workbench/MarsAnalysisSettings.jsx';
import ChartRequestError, { useChartRequestError } from './ChartRequestError.jsx';
import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { resolveWaveDiagnosticsSource } from './waveDiagnosticsSource';

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

function transposeMatrix(matrix) {
  if (!Array.isArray(matrix) || !matrix.length || !Array.isArray(matrix[0])) return [];
  const cols = matrix[0].length;
  return Array.from({ length: cols }, (_, c) => matrix.map((row) => row[c]));
}

function normalizeHeatmapMatrix(z, xLength, yLength) {
  if (!Array.isArray(z) || !z.length || !Array.isArray(z[0])) return [];
  const rows = z.length;
  const cols = z[0].length;

  if (rows === yLength && cols === xLength) return z;
  if (rows === xLength && cols === yLength) return transposeMatrix(z);

  const trimmedRows = Math.min(rows, yLength);
  const trimmedCols = Math.min(cols, xLength);
  return z.slice(0, trimmedRows).map((row) => row.slice(0, trimmedCols));
}

function calcRms(values) {
  if (!values.length) return NaN;
  const meanSquare = values.reduce((sum, value) => sum + (value * value), 0) / values.length;
  return Math.sqrt(meanSquare);
}

function calcSpan(values) {
  if (!values.length) return NaN;
  return Math.max(...values) - Math.min(...values);
}

export default function WaveBandDiagnosticsChart({
  marsYear,
  overviewSourceParams = {},
  baseData = null,
  baseLoading = false,
  baseVariable = null,
}) {
  const { settings } = useSettings();
  const isLight = settings?.theme === 'light';
  const isZh = settings?.language !== 'en';
  const plotText = isLight ? 'rgba(23,33,47,0.88)' : 'rgba(236,244,255,0.94)';
  const plotGrid = isLight ? 'rgba(23,33,47,0.12)' : 'rgba(160,196,240,0.15)';

  const [variable, setVariable, managed] = useMarsChartSetting('wave', 'variable', 'o3col');
  const [rawData, setRawData] = useState(null);
  const [loading, setLoading] = useState(true);
  const { requestError, setRequestError, retryToken, retry } = useChartRequestError();

  const copy = isZh
    ? {
      loading: '正在加载波动诊断图…',
      noData: '暂无数据',
      variableLabel: '当前参数',
      selectLabel: '参数切换',
      rms: '异常 RMS',
      span: '峰谷跨度',
      valueAxis: '波动指标',
      notePrefix: '视图说明：',
      noteBody: '当前展示的是',
      noteBody2: '在不同纬带上的空间异常波动诊断（RMS 与峰谷跨度），用于识别哪一纬带更不稳定。',
    }
    : {
      loading: 'Loading wave diagnostics...',
      noData: 'No data',
      variableLabel: 'Current Parameter',
      selectLabel: 'Switch Parameter',
      rms: 'Anomaly RMS',
      span: 'Peak-to-Peak',
      valueAxis: 'Diagnostic Metric',
      notePrefix: 'View Note:',
      noteBody: 'This chart diagnoses spatial anomaly variability of',
      noteBody2: 'across latitude bands using RMS and peak-to-peak span.',
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

  useEffect(() => {
    let active = true;
    setRequestError(null);
    const source = resolveWaveDiagnosticsSource({
      variable,
      baseVariable,
      baseData,
      baseLoading,
    });

    if (!source.shouldFetch) {
      setRawData(source.data);
      setLoading(source.loading);
      return undefined;
    }

    setRawData(null);
    setLoading(true);

    fetchOverviewZonalAnomaly(marsYear, variable, overviewSourceParams)
      .then((res) => {
        if (active) setRawData(res || null);
      })
      .catch((err) => {
        console.error(err);
        if (active) setRequestError(err);
        if (active) setRawData(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [retryToken, baseData, baseLoading, baseVariable, marsYear, variable, overviewSourceParams]);

  const diagnostics = useMemo(() => {
    if (!rawData?.z?.length || !rawData?.x?.length || !rawData?.y?.length) return null;

    const xLength = rawData.x.length;
    const yLength = rawData.y.length;
    const matrix = normalizeHeatmapMatrix(rawData.z, xLength, yLength);
    if (!matrix.length) return null;

    const latAxis = rawData.y.slice(0, matrix.length);
    const bands = LATITUDE_BANDS.map((band) => {
      const rowIndices = latAxis
        .map((latValue, index) => ({ latValue, index }))
        .filter(({ latValue }) => Number.isFinite(latValue) && latValue >= band.min && latValue <= band.max)
        .map(({ index }) => index);

      const values = rowIndices
        .flatMap((rowIndex) => matrix[rowIndex] || [])
        .filter((value) => Number.isFinite(value));

      return {
        band: isZh ? band.zh : band.en,
        rms: calcRms(values),
        span: calcSpan(values),
      };
    });

    return {
      bands: bands.map((item) => item.band),
      rms: bands.map((item) => item.rms),
      span: bands.map((item) => item.span),
    };
  }, [isZh, rawData]);

  const aiInsightProvider = useCallback(() => {
    const rms = diagnostics?.rms || [];
    const span = diagnostics?.span || [];
    const bands = diagnostics?.bands || [];
    let strongestRms = null;
    let strongestSpan = null;
    bands.forEach((band, index) => {
      const rmsValue = rms[index];
      const spanValue = span[index];
      if (Number.isFinite(rmsValue) && (!strongestRms || rmsValue > strongestRms.value)) {
        strongestRms = { band, value: rmsValue };
      }
      if (Number.isFinite(spanValue) && (!strongestSpan || spanValue > strongestSpan.value)) {
        strongestSpan = { band, value: spanValue };
      }
    });
    return {
      card: 'waveDiag',
      marsYear,
      source: buildOverviewSourceSnapshot(overviewSourceParams),
      variable,
      variableLabel: currentVariableLabel,
      valueMeaning: 'Latitude-band spatial anomaly diagnostics; RMS measures anomaly strength and span measures peak-to-peak spread.',
      status: requestError ? 'error' : loading ? 'loading' : (bands.length ? 'ready' : 'empty'),
      strongestRms: strongestRms ? { band: strongestRms.band, value: formatInsightValue(strongestRms.value) } : null,
      strongestSpan: strongestSpan ? { band: strongestSpan.band, value: formatInsightValue(strongestSpan.value) } : null,
      rmsSample: sampleInsightSeries(rms, bands, 8),
      spanSample: sampleInsightSeries(span, bands, 8),
    };
  }, [currentVariableLabel, diagnostics, loading, requestError, marsYear, overviewSourceParams, variable]);

  useAiInsightRegistration('waveDiag', aiInsightProvider);

  if (requestError) return <ChartRequestError isZh={isZh} onRetry={retry} />;

  if (loading) return <div style={{ color: C.ice60, fontSize: 'calc(12px * var(--font-scale, 1))' }}>{copy.loading}</div>;
  if (!diagnostics?.bands?.length) return <div style={{ color: C.mars, fontSize: 'calc(12px * var(--font-scale, 1))' }}>{copy.noData}</div>;

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
              title={`${copy.selectLabel}: ${option.label}`}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}

      {!managed ? (
        <div style={{ color: C.ice60, fontSize: 'calc(11px * var(--font-scale, 1))' }}>
          {copy.variableLabel}: <span style={{ color: C.blue, fontWeight: 700 }}>{currentVariableLabel}</span>
        </div>
      ) : null}

      <div style={{ width: '100%', height: 320 }}>
        <Plot
          data={[
            {
              x: diagnostics.bands,
              y: diagnostics.rms,
              type: 'bar',
              name: `${copy.rms} (${currentVariableLabel})`,
              marker: { color: 'rgba(74,158,255,0.7)' },
            },
            {
              x: diagnostics.bands,
              y: diagnostics.span,
              type: 'bar',
              name: `${copy.span} (${currentVariableLabel})`,
              marker: { color: 'rgba(199,91,57,0.7)' },
            },
          ]}
          layout={{
            autosize: true,
            paper_bgcolor: 'transparent',
            plot_bgcolor: 'transparent',
            margin: { l: 56, r: 18, t: 8, b: 84 },
            barmode: 'group',
            xaxis: { tickfont: { color: plotText, size: 10 }, gridcolor: plotGrid, automargin: true },
            yaxis: {
              title: copy.valueAxis,
              titlefont: { color: plotText, size: 11 },
              tickfont: { color: plotText, size: 10 },
              gridcolor: plotGrid,
              automargin: true,
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
        <span style={{ color: C.ice, fontWeight: 700 }}>{copy.notePrefix}</span>
        {' '}
        {copy.noteBody}
        {' '}
        <span style={{ color: C.blue, fontWeight: 700 }}>{currentVariableLabel}</span>
        {' '}
        {copy.noteBody2}
      </div>
    </div>
  );
}
