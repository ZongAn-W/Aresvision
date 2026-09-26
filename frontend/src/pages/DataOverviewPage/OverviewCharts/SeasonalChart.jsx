import { useMarsChartSetting } from '../workbench/MarsAnalysisSettings.jsx';
import ChartRequestError, { useChartRequestError } from './ChartRequestError.jsx';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Plot from 'react-plotly.js';
import C from '../../../constants/colors';
import { useSettings } from '../../../contexts/SettingsContext';
import { fetchOverviewEnvHeatmap, fetchOverviewSeasonalHeatmap } from '../../../services/api';
import { PLOTLY_SCALE } from '../../../utils/colormaps';
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
  summarizeInsightSeries,
} from './aiInsight';
import { formatAdaptiveMatrix } from './chartValueFormat';

const VARIABLE_OPTIONS = [
  { id: 'o3col', zh: '臭氧柱浓度', en: 'Ozone Column' },
  { id: 'Temperature', zh: '温度', en: 'Temperature' },
  { id: 'Solar_Flux_DN', zh: '太阳下行辐射', en: 'Solar Downwelling Flux' },
  { id: 'U_Wind', zh: '纬向风 U', en: 'U Wind' },
  { id: 'V_Wind', zh: '经向风 V', en: 'V Wind' },
];

const AI_LATITUDE_BANDS = [
  { id: 'pn', min: 60, max: 90, zh: '北极区(60N-90N)', en: 'Polar North (60N-90N)' },
  { id: 'mn', min: 30, max: 60, zh: '北中纬(30N-60N)', en: 'Mid-Lat North (30N-60N)' },
  { id: 'eq', min: -30, max: 30, zh: '赤道区(30S-30N)', en: 'Equatorial (30S-30N)' },
  { id: 'ms', min: -60, max: -30, zh: '南中纬(30S-60S)', en: 'Mid-Lat South (30S-60S)' },
  { id: 'ps', min: -90, max: -60, zh: '南极区(60S-90S)', en: 'Polar South (60S-90S)' },
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

function buildLatitudeBandSummary({ latAxis, matrix, lsAxis, variable, units, isZh }) {
  if (!latAxis.length || !matrix.length || !lsAxis.length) return [];
  return AI_LATITUDE_BANDS.map((band) => {
    const rowIndexes = latAxis
      .map((lat, index) => ({ lat, index }))
      .filter(({ lat }) => Number.isFinite(lat) && lat >= band.min && lat <= band.max)
      .map(({ index }) => index);

    if (!rowIndexes.length) {
      return {
        id: band.id,
        band: isZh ? band.zh : band.en,
        sampleCount: 0,
        stats: null,
        peakLs: null,
        troughLs: null,
        sample: [],
      };
    }

    const series = lsAxis.map((_, lsIndex) => {
      const values = rowIndexes
        .map((rowIndex) => matrix[rowIndex]?.[lsIndex])
        .filter((value) => Number.isFinite(value));
      if (!values.length) return NaN;
      const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
      return convertByVariable(mean, variable, units);
    });

    let peakIdx = -1;
    let troughIdx = -1;
    let peakValue = Number.NEGATIVE_INFINITY;
    let troughValue = Number.POSITIVE_INFINITY;
    series.forEach((value, idx) => {
      if (!Number.isFinite(value)) return;
      if (value > peakValue) {
        peakValue = value;
        peakIdx = idx;
      }
      if (value < troughValue) {
        troughValue = value;
        troughIdx = idx;
      }
    });

    return {
      id: band.id,
      band: isZh ? band.zh : band.en,
      sampleCount: rowIndexes.length,
      stats: summarizeInsightSeries(series),
      peakLs: peakIdx >= 0 ? roundValue(lsAxis[peakIdx], 2) : null,
      troughLs: troughIdx >= 0 ? roundValue(lsAxis[troughIdx], 2) : null,
      amplitude: Number.isFinite(peakValue) && Number.isFinite(troughValue)
        ? formatInsightValue(peakValue - troughValue)
        : null,
      sample: sampleInsightSeries(series, lsAxis, 6),
    };
  });
}

export default function SeasonalChart({ marsYear, overviewSourceParams = {} }) {
  const { settings } = useSettings();
  const isZh = settings?.language !== 'en';
  const isLight = settings?.theme === 'light';
  const plotText = isLight ? 'rgba(23,33,47,0.88)' : 'rgba(236,244,255,0.94)';
  const plotGrid = isLight ? 'rgba(23,33,47,0.12)' : 'rgba(160,196,240,0.16)';
  const colormapName = settings?.colormap;
  const units = settings?.units || { ozone: 'um-atm', temperature: 'K', wind: 'm/s' };

  const [variable, setVariable, managed] = useMarsChartSetting('seasonal', 'variable', 'o3col');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const { requestError, setRequestError, retryToken, retry } = useChartRequestError();

  const copy = isZh
    ? {
      loading: '正在加载热力图...',
      noData: '暂无数据',
      currentVar: '当前变量',
      xAxisTitle: '横轴: 太阳黄经 Ls (°)',
      yAxisTitle: '纵轴: 纬度 (°)',
    }
    : {
      loading: 'Loading heatmap...',
      noData: 'No data',
      currentVar: 'Current Variable',
      xAxisTitle: 'X: Solar Longitude Ls (°)',
      yAxisTitle: 'Y: Latitude (°)',
    };

  const variableOptions = useMemo(
    () => VARIABLE_OPTIONS.map((item) => ({ ...item, label: isZh ? item.zh : item.en })),
    [isZh],
  );

  const variableLabelMap = useMemo(
    () => Object.fromEntries(variableOptions.map((item) => [item.id, item.label])),
    [variableOptions],
  );

  const currentVariableLabel = variableLabelMap[variable] || variable;
  const currentUnitLabel = unitByVariable(variable, units);

  const aiInsightProvider = useCallback(() => {
    const lsAxis = data?.x || [];
    const latAxis = data?.y || [];
    const matrix = data?.z || [];
    let midLatitudeSeries = [];
    if (latAxis.length && matrix.length) {
      let bestIndex = 0;
      let bestAbs = Number.POSITIVE_INFINITY;
      latAxis.forEach((lat, index) => {
        if (!Number.isFinite(lat)) return;
        const abs = Math.abs(lat);
        if (abs < bestAbs) {
          bestAbs = abs;
          bestIndex = index;
        }
      });
      midLatitudeSeries = (matrix[bestIndex] || []).map((value) => convertByVariable(value, variable, units));
    }
    const allValues = matrix
      .flat()
      .map((value) => convertByVariable(value, variable, units))
      .filter((value) => Number.isFinite(value));
    const latitudeBandSummary = buildLatitudeBandSummary({
      latAxis,
      matrix,
      lsAxis,
      variable,
      units,
      isZh,
    });
    return {
      card: 'seasonal',
      marsYear,
      source: buildOverviewSourceSnapshot(overviewSourceParams),
      variable,
      variableLabel: currentVariableLabel,
      unit: currentUnitLabel,
      valueMeaning: 'Latitude-Ls heatmap values for the selected variable, converted to the current display unit.',
      status: requestError ? 'error' : loading ? 'loading' : (data?.z?.length ? 'ready' : 'empty'),
      dimensions: {
        lsCount: lsAxis.length,
        latCount: latAxis.length,
      },
      valueRange: {
        min: formatInsightValue(convertByVariable(data?.min, variable, units)),
        max: formatInsightValue(convertByVariable(data?.max, variable, units)),
      },
      globalStats: summarizeInsightSeries(allValues),
      latitudeBandSummary,
      equatorialSeriesSample: sampleInsightSeries(midLatitudeSeries, lsAxis, 12),
    };
  }, [currentUnitLabel, currentVariableLabel, data, isZh, loading, requestError, marsYear, overviewSourceParams, units, variable]);

  useAiInsightRegistration('seasonal', aiInsightProvider);

  useEffect(() => {
    let active = true;
    setRequestError(null);
    setLoading(true);
    const fetcher = variable === 'o3col'
      ? fetchOverviewSeasonalHeatmap(marsYear, overviewSourceParams)
      : fetchOverviewEnvHeatmap(marsYear, variable, overviewSourceParams);

    Promise.resolve(fetcher)
      .then((res) => {
        if (active) setData(res || null);
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
  }, [retryToken, marsYear, variable, overviewSourceParams]);

  useEffect(() => {
    if (data && !loading) {
      const dispatchResize = () => window.dispatchEvent(new Event('resize'));
      const t1 = setTimeout(dispatchResize, 100);
      const t2 = setTimeout(dispatchResize, 350);
      const t3 = setTimeout(dispatchResize, 800);
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
        clearTimeout(t3);
      };
    }
    return undefined;
  }, [data, loading]);

  if (requestError) return <ChartRequestError isZh={isZh} onRetry={retry} />;

  if (loading) {
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: C.ice, fontFamily: 'var(--font-display)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 16,
              height: 16,
              border: '2px solid rgba(148,163,184,0.24)',
              borderTop: `2px solid ${C.ice}`,
              borderRadius: '50%',
              animation: 'spin-slow 1s linear infinite',
            }}
          />
          {copy.loading}
        </div>
      </div>
    );
  }

  if (!data?.x?.length || !data?.y?.length || !data?.z?.length) {
    return <div style={{ color: C.mars, padding: 20 }}>{copy.noData}</div>;
  }

  const convertedZ = data.z.map((row) => row.map((value) => convertByVariable(value, variable, units)));
  const hoverZ = formatAdaptiveMatrix(convertedZ, { fixedDigits: 3 });
  const zMinRaw = convertByVariable(data.min, variable, units);
  const zMaxRaw = convertByVariable(data.max, variable, units);
  const zMin = Number.isFinite(zMinRaw) ? zMinRaw : undefined;
  const zMax = Number.isFinite(zMaxRaw) ? (zMaxRaw === zMinRaw ? zMaxRaw + 1e-6 : zMaxRaw) : undefined;

  const titleText = isZh
    ? `${currentVariableLabel} 热力图（纵轴: 纬度 - 横轴: Ls）`
    : `${currentVariableLabel} Heatmap (Y: Latitude - X: Ls)`;

  const colorbarTitle = currentUnitLabel
    ? `${currentVariableLabel} (${currentUnitLabel})`
    : currentVariableLabel;

  const hoverTemplate = isZh
    ? `Ls: %{x:.1f}°<br>纬度: %{y:.1f}°<br>${currentVariableLabel}: %{customdata} ${currentUnitLabel}<extra></extra>`
    : `Ls: %{x:.1f}°<br>Lat: %{y:.1f}°<br>${currentVariableLabel}: %{customdata} ${currentUnitLabel}<extra></extra>`;

  return (
    <div className="seasonal-chart-container" style={{ width: '100%', height: '100%', position: 'relative', display: 'grid', gap: 10 }}>
      <style>{`
        .seasonal-chart-container .modebar {
          top: auto !important;
          bottom: 0px !important;
          right: 20px !important;
          left: auto !important;
          border: 1px solid rgba(148, 163, 184, 0.24);
          border-radius: 8px;
          padding: 2px 4px;
          display: flex !important;
        }
        .seasonal-chart-container .modebar-group {
          display: flex !important;
          margin-bottom: 0 !important;
        }
        .seasonal-chart-container .modebar-btn svg {
          fill: rgba(148, 163, 184, 0.78) !important;
        }
        .seasonal-chart-container .modebar-btn:hover svg,
        .seasonal-chart-container .modebar-btn.active svg {
          fill: #ff6b35 !important;
        }
      `}</style>

      {!managed ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {variableOptions.map((item) => (
            <button
              key={item.id}
              onClick={() => setVariable(item.id)}
              style={{
                border: `1px solid ${variable === item.id ? C.blue : C.border}`,
                background: variable === item.id ? 'rgba(74,158,255,0.16)' : 'rgba(255,255,255,0.03)',
                color: variable === item.id ? C.blue : C.ice60,
                borderRadius: 999,
                padding: '6px 10px',
                fontSize: 'calc(11px * var(--font-scale, 1))',
                cursor: 'pointer',
                fontFamily: 'var(--font-body)',
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}

      {!managed ? (
        <div style={{ color: C.ice60, fontSize: 'calc(11px * var(--font-scale, 1))' }}>
          {copy.currentVar}: <span style={{ color: C.blue, fontWeight: 700 }}>{currentVariableLabel}</span>
        </div>
      ) : null}

      <div style={{ minHeight: 360 }}>
        <Plot
          data={[
            {
              z: convertedZ,
              x: data.x,
              y: data.y,
              customdata: hoverZ,
              type: 'heatmap',
              zsmooth: 'best',
              colorscale: PLOTLY_SCALE[colormapName] ?? 'Jet',
              zmin: zMin,
              zmax: zMax,
              hovertemplate: hoverTemplate,
              colorbar: {
                title: {
                  text: colorbarTitle,
                  font: { color: plotText, family: 'Space Grotesk, Segoe UI, PingFang SC, Microsoft YaHei, sans-serif', size: 10 },
                  side: 'top',
                },
                orientation: 'h',
                y: -0.25,
                yanchor: 'top',
                len: 0.8,
                thickness: 10,
                tickfont: { color: plotText, family: 'Space Grotesk, Segoe UI, PingFang SC, Microsoft YaHei, sans-serif' },
              },
            },
          ]}
          layout={{
            title: {
              text: titleText,
              font: { color: plotText, family: 'Space Grotesk, Segoe UI, PingFang SC, Microsoft YaHei, sans-serif', size: 13 },
            },
            xaxis: {
              title: copy.xAxisTitle,
              tickfont: { color: plotText, size: 10 },
              titlefont: { color: plotText, size: 11 },
              gridcolor: plotGrid,
              showgrid: false,
              automargin: true,
            },
            yaxis: {
              title: copy.yAxisTitle,
              tickfont: { color: plotText, size: 10 },
              titlefont: { color: plotText, size: 11 },
              gridcolor: plotGrid,
              showgrid: false,
              automargin: true,
            },
            paper_bgcolor: 'transparent',
            plot_bgcolor: 'transparent',
            margin: { t: 48, r: 20, l: 56, b: 120 },
            autosize: true,
          }}
          useResizeHandler
          style={{ width: '100%', height: '100%' }}
          config={{ displayModeBar: true, scrollZoom: true, responsive: true, displaylogo: false }}
        />
      </div>
    </div>
  );
}
