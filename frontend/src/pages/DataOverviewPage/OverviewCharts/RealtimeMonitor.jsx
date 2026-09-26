import { useMarsChartSetting } from '../workbench/MarsAnalysisSettings.jsx';
import ChartRequestError, { useChartRequestError } from './ChartRequestError.jsx';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Plot from 'react-plotly.js';
import C from '../../../constants/colors';
import { useT } from '../../../i18n';
import { useSettings } from '../../../contexts/SettingsContext';
import { fetchOverviewDiurnal } from '../../../services/api';
import { convertOzone, ozoneLabel } from '../../../utils/units';
import { fmtNum } from '../../../utils/fmt';
import useAiInsightRegistration from './useAiInsightRegistration';
import {
  buildOverviewSourceSnapshot,
  formatInsightValue,
  roundValue,
  sampleInsightSeries,
} from './aiInsight';
import { formatAdaptiveSeries, formatAdaptiveValue } from './chartValueFormat';

const LAT_BANDS = [
  'Polar North (60N-90N)',
  'Mid-Lat North (30N-60N)',
  'Equatorial (30S-30N)',
  'Mid-Lat South (30S-60S)',
  'Polar South (60S-90S)',
];

export default function RealtimeMonitor({ marsYear, lsValue, overviewSourceParams = {} }) {
  const t = useT();
  const { settings } = useSettings();

  const isLight = settings?.theme === 'light';
  const plotText = isLight ? 'rgba(23,33,47,0.88)' : 'rgba(236,244,255,0.94)';
  const plotGrid = isLight ? 'rgba(23,33,47,0.12)' : 'rgba(160,196,240,0.16)';

  const isZh = settings.language !== 'en';
  const copy = isZh ? {
    loading: '正在加载昼夜变化...',
    mean: '均值',
    peak: '峰值',
    amplitude: '振幅',
    selection: '当前选择',
    at: '出现在',
    ampDesc: '最大值 - 最小值',
    localTime: '地方时（小时）',
    ozone: '臭氧',
    hoverHour: '地方时',
    marsYear: '火星年',
    solarLongitude: '太阳黄经',
    polarNorth: '北极区',
    midNorth: '北中纬',
    equatorial: '赤道区',
    midSouth: '南中纬',
    polarSouth: '南极区',
  } : {
    loading: 'LOADING DIURNAL PROFILE...',
    mean: 'MEAN',
    peak: 'PEAK',
    amplitude: 'AMPLITUDE',
    selection: 'SELECTION',
    at: 'at',
    ampDesc: 'max - min',
    localTime: 'Local time (hour)',
    ozone: 'Ozone',
    hoverHour: 'Local hour',
    marsYear: 'MY',
    solarLongitude: 'Ls',
    polarNorth: 'Polar North',
    midNorth: 'Mid-Lat North',
    equatorial: 'Equatorial',
    midSouth: 'Mid-Lat South',
    polarSouth: 'Polar South',
  };
  const shortLabels = {
    'Polar North (60N-90N)': copy.polarNorth,
    'Mid-Lat North (30N-60N)': copy.midNorth,
    'Equatorial (30S-30N)': copy.equatorial,
    'Mid-Lat South (30S-60S)': copy.midSouth,
    'Polar South (60S-90S)': copy.polarSouth,
  };
  const unavailableCopy = isZh
    ? {
      title: '暂无小时臭氧数据',
      body: '当前数据源没有 O3COL/o3col 小时字段，因此这里不再生成模拟臭氧曲线。',
    }
    : {
      title: 'Hourly ozone unavailable',
      body: 'This source has no O3COL/o3col hourly field, so the chart no longer generates simulated ozone.',
    };
  const [latBand, setLatBand, managed] = useMarsChartSetting('realtime', 'band', LAT_BANDS[2]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const { requestError, setRequestError, retryToken, retry } = useChartRequestError();
  const [refreshing, setRefreshing] = useState(false);
  const hasDataRef = useRef(false);

  useEffect(() => {
    let active = true;
    setRequestError(null);
    const hasRenderableData = hasDataRef.current;
    if (hasRenderableData) setRefreshing(true);
    else setLoading(true);

    fetchOverviewDiurnal(marsYear, lsValue, latBand, overviewSourceParams)
      .then((res) => {
        if (active) {
          setData(res);
          hasDataRef.current = !!res?.ozone_values?.length;
          setLoading(false);
          setRefreshing(false);
        }
      })
      .catch((err) => {
        console.error(err);
        if (active) setRequestError(err);
        if (active) {
          setLoading(false);
          setRefreshing(false);
        }
      });
    return () => {
      active = false;
    };
  }, [retryToken, marsYear, lsValue, latBand, overviewSourceParams]);

  const stats = useMemo(() => {
    if (!data?.ozone_values?.length) return null;
    const values = data.ozone_values;
    const max = Math.max(...values);
    const min = Math.min(...values);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const peakHour = data.hours[values.indexOf(max)];
    return { max, min, mean, peakHour, amplitude: max - min };
  }, [data]);
  const ozoneHoverText = useMemo(
    () => formatAdaptiveSeries(data?.ozone_values || [], { fixedDigits: 4 }),
    [data],
  );

  const aiInsightProvider = useCallback(() => ({
    card: 'realtime',
    marsYear,
    source: buildOverviewSourceSnapshot(overviewSourceParams),
    ls: roundValue(lsValue, 2),
    latBand,
    latBandLabel: shortLabels[latBand] || latBand,
    unit: 'μm-atm',
    valueMeaning: 'Hourly ozone column sampled by local time for the selected latitude band.',
    status: loading && !data?.ozone_values?.length ? 'loading' : (data?.ozone_values?.length ? 'ready' : 'empty'),
    emptyReason: !loading && !data?.ozone_values?.length
      ? 'Hourly O3COL/o3col data is unavailable for this MCD source.'
      : null,
    metrics: stats
      ? {
        mean: formatInsightValue(stats.mean),
        max: formatInsightValue(stats.max),
        min: formatInsightValue(stats.min),
        amplitude: formatInsightValue(stats.amplitude),
        peakHour: roundValue(stats.peakHour, 2),
      }
      : null,
    samples: sampleInsightSeries(data?.ozone_values || [], data?.hours || [], 12),
  }), [data, latBand, loading, requestError, lsValue, marsYear, overviewSourceParams, shortLabels, stats]);

  useAiInsightRegistration('realtime', aiInsightProvider);

  if (requestError) return <ChartRequestError isZh={isZh} onRetry={retry} />;

  if (loading && !data?.ozone_values?.length) {
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: C.ice, fontFamily: 'var(--font-display)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 16,
            height: 16,
            border: `2px solid rgba(199,91,57,0.2)`,
            borderTop: `2px solid ${C.mars}`,
            borderRadius: '50%',
            animation: 'spin-slow 1s linear infinite',
          }} />
          {copy.loading}
        </div>
      </div>
    );
  }

  if (!data?.ozone_values?.length) {
    const message = data?.message || unavailableCopy.body;
    return (
      <div style={{ width: '100%', height: '100%', display: 'grid', alignContent: 'start', gap: 14, padding: 20 }}>
        {!managed ? (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {LAT_BANDS.map((item) => {
              const active = item === latBand;
              return (
                <button
                  key={item}
                  onClick={() => setLatBand(item)}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 999,
                    border: `1px solid ${active ? C.mars : C.border}`,
                    background: active ? 'rgba(199,91,57,0.12)' : 'rgba(255,255,255,0.03)',
                    color: active ? C.mars : C.ice60,
                    fontSize: 'calc(11px * var(--font-scale, 1))',
                    cursor: 'pointer',
                    fontFamily: 'var(--font-body)',
                  }}
                >
                  {shortLabels[item]}
                </button>
              );
            })}
          </div>
        ) : null}
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 16, background: 'rgba(255,255,255,0.035)', padding: 18 }}>
          <div style={{ color: C.mars, fontWeight: 800, fontFamily: 'var(--font-display)', fontSize: 'calc(15px * var(--font-scale, 1))' }}>
            {unavailableCopy.title}
          </div>
          <div style={{ color: C.ice60, marginTop: 8, lineHeight: 1.65, fontSize: 'calc(12px * var(--font-scale, 1))' }}>
            {message || t('overview.charts.noData')}
          </div>
          <div style={{ color: C.ice30, marginTop: 10, fontSize: 'calc(11px * var(--font-scale, 1))' }}>
            {copy.marsYear}{marsYear} · {copy.solarLongitude} {fmtNum(lsValue, 0)}° · {shortLabels[latBand]}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ width: '100%', display: 'grid', gridTemplateRows: managed ? 'auto minmax(360px, 1fr)' : 'auto auto minmax(360px, 1fr)', gap: 16, minWidth: 0, paddingRight: 4 }}>
      {!managed ? (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {LAT_BANDS.map((item) => {
            const active = item === latBand;
            return (
              <button
                key={item}
                onClick={() => setLatBand(item)}
                style={{
                  padding: '8px 12px',
                  borderRadius: 999,
                  border: `1px solid ${active ? C.mars : C.border}`,
                  background: active ? 'rgba(199,91,57,0.12)' : 'rgba(255,255,255,0.03)',
                  color: active ? C.mars : C.ice60,
                  fontSize: 'calc(11px * var(--font-scale, 1))',
                  cursor: 'pointer',
                  fontFamily: 'var(--font-body)',
                }}
              >
                {shortLabels[item]}
              </button>
            );
          })}
        </div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <div style={{ padding: '14px 16px', borderRadius: 12, background: 'rgba(199,91,57,0.08)', border: '1px solid rgba(199,91,57,0.18)' }}>
          <div style={{ color: C.ice30, fontSize: 'calc(10px * var(--font-scale, 1))', letterSpacing: 1 }}>{copy.mean}</div>
          <div style={{ marginTop: 6, color: C.mars, fontSize: 'calc(18px * var(--font-scale, 1))', fontWeight: 800, fontFamily: 'var(--font-display)' }}>
            {formatAdaptiveValue(convertOzone(stats.mean, 'um-atm'), { fixedDigits: 3 })}
          </div>
          <div style={{ color: C.ice30, fontSize: 'calc(11px * var(--font-scale, 1))' }}>{ozoneLabel('um-atm')}</div>
        </div>
        <div style={{ padding: '14px 16px', borderRadius: 12, background: 'rgba(74,158,255,0.08)', border: '1px solid rgba(74,158,255,0.18)' }}>
          <div style={{ color: C.ice30, fontSize: 'calc(10px * var(--font-scale, 1))', letterSpacing: 1 }}>{copy.peak}</div>
          <div style={{ marginTop: 6, color: C.blue, fontSize: 'calc(18px * var(--font-scale, 1))', fontWeight: 800, fontFamily: 'var(--font-display)' }}>
            {formatAdaptiveValue(stats.max, { fixedDigits: 3 })}
          </div>
          <div style={{ color: C.ice30, fontSize: 'calc(11px * var(--font-scale, 1))' }}>{copy.at} {fmtNum(stats.peakHour, 1)}h</div>
        </div>
        <div style={{ padding: '14px 16px', borderRadius: 12, background: 'rgba(74,207,172,0.08)', border: '1px solid rgba(74,207,172,0.18)' }}>
          <div style={{ color: C.ice30, fontSize: 'calc(10px * var(--font-scale, 1))', letterSpacing: 1 }}>{copy.amplitude}</div>
          <div style={{ marginTop: 6, color: '#4acfac', fontSize: 'calc(18px * var(--font-scale, 1))', fontWeight: 800, fontFamily: 'var(--font-display)' }}>
            {formatAdaptiveValue(stats.amplitude, { fixedDigits: 3 })}
          </div>
          <div style={{ color: C.ice30, fontSize: 'calc(11px * var(--font-scale, 1))' }}>{copy.ampDesc}</div>
        </div>
        <div style={{ padding: '14px 16px', borderRadius: 12, background: 'rgba(255,255,255,0.03)', border: `1px solid ${C.border}` }}>
          <div style={{ color: C.ice30, fontSize: 'calc(10px * var(--font-scale, 1))', letterSpacing: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <span>{copy.selection}</span>
            {refreshing && (
              <span style={{ color: C.ice60, fontSize: 'calc(9px * var(--font-scale, 1))', letterSpacing: 0.6 }}>
                {isZh ? '更新中...' : 'Updating...'}
              </span>
            )}
          </div>
          <div style={{ marginTop: 6, color: C.ice, fontSize: 'calc(13px * var(--font-scale, 1))', fontWeight: 700 }}>{shortLabels[latBand]}</div>
          <div style={{ color: C.ice30, fontSize: 'calc(11px * var(--font-scale, 1))' }}>{copy.marsYear}{marsYear} · {copy.solarLongitude} {fmtNum(lsValue, 0)}°</div>
        </div>
      </div>

      <div style={{ minHeight: 320 }}>
        <Plot
          data={[{
            x: data.hours,
            y: data.ozone_values,
            type: 'scatter',
            mode: 'lines+markers',
            line: { color: C.mars, width: 3, shape: 'spline' },
            marker: { size: 7, color: C.blue, line: { color: '#fff', width: 1 } },
            fill: 'tozeroy',
            fillcolor: 'rgba(199,91,57,0.12)',
            customdata: ozoneHoverText,
            hovertemplate: `${copy.hoverHour} %{x:.1f}<br>${copy.ozone} %{customdata[0]} μm-atm<extra></extra>`,
          }]}
          layout={{
            autosize: true,
            paper_bgcolor: 'transparent',
            plot_bgcolor: 'transparent',
            margin: { l: 58, r: 24, t: 18, b: 48 },
            xaxis: {
              title: copy.localTime,
              gridcolor: plotGrid,
              tickfont: { color: plotText, size: 10  },
              titlefont: { color: plotText, size: 11  },
              automargin: true,
            },
            yaxis: {
              title: `${copy.ozone} (${ozoneLabel('um-atm')})`,
              gridcolor: plotGrid,
              tickfont: { color: plotText, size: 10  },
              titlefont: { color: plotText, size: 11  },
              automargin: true,
            },
            showlegend: false,
          }}
          config={{ displayModeBar: false, responsive: true }}
          useResizeHandler
          style={{ width: '100%', height: '100%' }}
        />
      </div>
    </div>
  );
}
