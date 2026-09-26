/**
 * 3D 点位探针的结果内容。
 *
 * 从原全屏弹窗中抽出，使同一份「点位数值 + 全球/纬向均值对比 + 全年序列」既能
 * 作为独立弹窗显示，也能嵌进观测台底部分析区。请求模型、单位换算与对比内容
 * 完全不改：组件只接收 `probe / loading / error`。
 */

import Plot from 'react-plotly.js';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import C from '../../constants/colors';
import { getGlobeVariableMeta } from '../../constants/globeVariables';
import { useSettings } from '../../contexts/SettingsContext';
import { convertOzone, ozoneLabel, convertTemp, tempLabel, convertWind, windLabel } from '../../utils/units';
import { fmtNum } from '../../utils/fmt';

function convertByVariable(value, variable, units) {
  if (!Number.isFinite(value)) return null;
  if (variable === 'o3col') return convertOzone(value, units.ozone);
  if (variable === 'Temperature') return convertTemp(value, units.temperature);
  if (variable === 'U_Wind' || variable === 'V_Wind') return convertWind(value, units.wind);
  return value;
}

function unitLabelByVariable(variable, units) {
  if (variable === 'o3col') return ozoneLabel(units.ozone);
  if (variable === 'Temperature') return tempLabel(units.temperature);
  if (variable === 'U_Wind' || variable === 'V_Wind') return windLabel(units.wind);
  if (variable === 'Solar_Flux_DN') return 'W/m^2';
  return '';
}

function formatValue(value, variable, units, precision) {
  const converted = convertByVariable(value, variable, units);
  if (!Number.isFinite(converted)) return '--';
  return fmtNum(converted, precision);
}

function SummaryTile({ label, value, tone = C.ice }) {
  return (
    <div style={{
      padding: '8px 10px',
      borderRadius: 12,
      background: 'rgba(255,255,255,0.04)',
      border: `1px solid ${C.border}`,
      minWidth: 0,
    }}>
      <div style={{ color: C.ice50, fontSize: 'calc(8px * var(--font-scale, 1))', lineHeight: 1.1, fontWeight: 700 }}>{label}</div>
      <div style={{ marginTop: 4, color: tone, fontSize: 'calc(12px * var(--font-scale, 1))', fontFamily: 'var(--font-display)', fontWeight: 800, fontVariantNumeric: 'tabular-nums', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</div>
    </div>
  );
}

function SectionLabel({ children }) {
  return (
    <div style={{
      color: C.ice50,
      fontSize: 'calc(8px * var(--font-scale, 1))',
      fontWeight: 800,
      letterSpacing: 1,
      textTransform: 'uppercase',
      lineHeight: 1.2,
    }}>
      {children}
    </div>
  );
}

function MetricRow({ label, value, tone = C.ice, compact = false }) {
  return (
    <div
      className="point-probe-metric-row"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
        minHeight: compact ? 26 : 30,
        padding: '5px 0',
      }}
    >
      <div style={{
        color: C.ice50,
        fontSize: 'calc(8px * var(--font-scale, 1))',
        fontWeight: 700,
        lineHeight: 1.2,
        whiteSpace: 'nowrap',
      }}>
        {label}
      </div>
      <div style={{
        color: tone,
        fontSize: compact ? 'calc(10px * var(--font-scale, 1))' : 'calc(12px * var(--font-scale, 1))',
        fontFamily: 'var(--font-display)',
        fontWeight: 800,
        fontVariantNumeric: 'tabular-nums',
        lineHeight: 1.2,
        textAlign: 'right',
        minWidth: 0,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        {value}
      </div>
    </div>
  );
}

export function pointProbeCopy(isZh) {
  return isZh ? {
    title: '3D 点位探针',
    subtitle: '点击球面后定位最近网格点，并对照全年变化。',
    loading: '正在读取全年点位序列...',
    local: '当前先显示切片预览，全年曲线加载完成后会自动更新。',
    requested: '点击位置',
    grid: '最近网格',
    current: '当前值',
    globalDiff: '相对全球均值',
    latDiff: '相对纬向均值',
    annual: '全年点位变化与均值对比',
    point: '点位值',
    globalMean: '全球均值',
    latitudeMean: '同纬度均值',
    noAnnual: '暂无全年序列，仅显示当前切片最近点。',
    overview: '点位概览',
    comparison: '对比结果',
    seriesStatus: '序列概况',
    close: '关闭',
    ls: 'Ls',
  } : {
    title: '3D Point Probe',
    subtitle: 'Resolve the clicked globe location to the nearest grid cell and compare annual behavior.',
    loading: 'Loading annual point series...',
    local: 'Showing current-slice preview until the annual series finishes loading.',
    requested: 'Clicked Location',
    grid: 'Nearest Grid',
    current: 'Current Value',
    globalDiff: 'vs Global Mean',
    latDiff: 'vs Latitude Mean',
    annual: 'Annual Point Series vs Means',
    point: 'Point Value',
    globalMean: 'Global Mean',
    latitudeMean: 'Latitude Mean',
    noAnnual: 'Annual series is unavailable; showing the current-slice nearest point only.',
    overview: 'Point details',
    comparison: 'Comparison',
    seriesStatus: 'Series status',
    close: 'Close',
    ls: 'Ls',
  };
}

/**
 * @param {object} props
 * @param {object} props.probe 已由页面层组装好的探针数据（含 requested/gridPoint/current/series）。
 * @param {boolean} [props.loading]
 * @param {string} [props.error]
 * @param {Function} [props.onClose] 传入时显示关闭按钮。
 * @param {boolean} [props.dialog] true = 弹窗内层卡片样式；false = 嵌入分析区。
 */
export default function PointProbeContent({
  probe,
  loading = false,
  error = '',
  onClose = null,
  dialog = true,
}) {
  const { settings } = useSettings();
  const isLight = settings?.theme === 'light';
  const isZh = settings?.language !== 'en';
  if (!probe) return null;

  const variable = probe.variable || 'o3col';
  const meta = getGlobeVariableMeta(variable);
  const variableLabel = isZh ? meta.zh : meta.en;
  const unitLabel = unitLabelByVariable(variable, settings.units);
  const precision = settings.precision;
  const series = probe.series || {};
  const lsSeries = series.ls || [];
  const hasAnnualSeries = Array.isArray(series.point) && series.point.length > 0;
  const convertedPoint = (series.point || []).map((value) => convertByVariable(value, variable, settings.units));
  const convertedGlobalMean = (series.globalMean || []).map((value) => convertByVariable(value, variable, settings.units));
  const convertedLatitudeMean = (series.latitudeMean || []).map((value) => convertByVariable(value, variable, settings.units));
  const plotText = isLight ? 'rgba(23,33,47,0.88)' : 'rgba(236,244,255,0.94)';
  const plotGrid = isLight ? 'rgba(23,33,47,0.14)' : 'rgba(160,196,240,0.16)';
  const pointSeriesCount = lsSeries.length;
  const copy = pointProbeCopy(isZh);

  return (
    <div
      className="point-probe-modal-compact"
      data-point-probe={dialog ? 'dialog' : 'embedded'}
      style={{
        width: dialog ? 'min(700px, calc(100vw - 28px))' : '100%',
        maxHeight: dialog ? 'min(600px, calc(100vh - 28px))' : 'none',
        overflow: 'auto',
        borderRadius: dialog ? 20 : 0,
        border: dialog ? `1px solid ${isLight ? 'rgba(15,23,42,0.12)' : 'rgba(255,255,255,0.14)'}` : 'none',
        background: dialog
          ? (isLight
            ? 'linear-gradient(145deg, rgba(255,255,255,0.95), rgba(235,242,249,0.90))'
            : 'linear-gradient(145deg, rgba(11,15,25,0.95), rgba(24,16,14,0.92))')
          : 'transparent',
        boxShadow: dialog ? (isLight ? '0 20px 54px rgba(32,48,72,0.18)' : '0 22px 68px rgba(0,0,0,0.50)') : 'none',
        padding: dialog ? 12 : 0,
      }}
    >
      <div className="point-probe-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ color: C.mars, fontFamily: 'var(--font-display)', fontSize: 'calc(11px * var(--font-scale, 1))', fontWeight: 800, whiteSpace: 'nowrap' }}>{variableLabel}</div>
            <div style={{ padding: '2px 6px', borderRadius: 999, border: `1px solid ${C.border}`, color: C.ice50, fontSize: 'calc(8px * var(--font-scale, 1))', fontWeight: 700, whiteSpace: 'nowrap' }}>{unitLabel}</div>
            {probe.status === 'local' && (
              <div style={{ padding: '2px 6px', borderRadius: 999, border: '1px solid rgba(255,143,104,0.28)', color: C.mars, fontSize: 'calc(8px * var(--font-scale, 1))', fontWeight: 700, whiteSpace: 'nowrap' }}>
                {isZh ? '本地预览' : 'Local preview'}
              </div>
            )}
          </div>
          <h2 style={{ color: C.ice, fontFamily: 'var(--font-display)', fontSize: 'calc(17px * var(--font-scale, 1))', margin: '4px 0 0', lineHeight: 1.15 }}>{copy.title}</h2>
          <p style={{ color: C.ice60, margin: '4px 0 0', fontSize: 'calc(10px * var(--font-scale, 1))', lineHeight: 1.4, maxWidth: 500 }}>{copy.subtitle}</p>
        </div>
        {onClose ? (
          <button
            onClick={onClose}
            aria-label={copy.close}
            style={{
              width: 28,
              height: 28,
              display: 'grid',
              placeItems: 'center',
              border: `1px solid ${C.border}`,
              background: isLight ? 'rgba(15,23,42,0.05)' : 'rgba(255,255,255,0.05)',
              color: C.ice70,
              borderRadius: 999,
              padding: 0,
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            <CloseRoundedIcon sx={{ fontSize: 18 }} />
          </button>
        ) : null}
      </div>

      {(loading || probe.status === 'local' || error) && (
        <div style={{ marginBottom: 12, padding: '8px 10px', borderRadius: 12, border: `1px solid ${loading ? 'rgba(121,187,255,0.30)' : 'rgba(255,143,104,0.26)'}`, background: loading ? 'rgba(121,187,255,0.08)' : 'rgba(255,143,104,0.07)', color: loading ? C.blue : C.mars, fontSize: 'calc(10px * var(--font-scale, 1))', lineHeight: 1.4 }}>
          {loading ? copy.loading : (error || copy.local)}
        </div>
      )}

      <div className="point-probe-summary-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 6, marginBottom: 10 }}>
        <SummaryTile label={copy.requested} value={`LAT ${fmtNum(probe.requested?.lat, 1)} / LNG ${fmtNum(probe.requested?.lng, 1)}`} tone={C.blue} />
        <SummaryTile label={copy.grid} value={`LAT ${fmtNum(probe.gridPoint?.lat, 1)} / LNG ${fmtNum(probe.gridPoint?.lng, 1)}`} tone={C.green} />
        <SummaryTile label={copy.current} value={`${formatValue(probe.current?.value, variable, settings.units, precision)} ${unitLabel}`} tone={C.mars} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 8, alignItems: 'stretch' }}>
        <div className="point-probe-info-panel" style={{ display: 'flex', flexDirection: 'column', gap: 8, alignSelf: 'stretch', minWidth: 0, minHeight: 0, padding: 10, borderRadius: 16, background: 'rgba(255,255,255,0.035)', border: `1px solid ${C.border}` }}>
          <SectionLabel>{copy.overview}</SectionLabel>
          <div style={{ display: 'grid' }}>
            <MetricRow label={copy.requested} value={`LAT ${fmtNum(probe.requested?.lat, 1)} / LNG ${fmtNum(probe.requested?.lng, 1)}`} tone={C.blue} />
            <MetricRow label={copy.grid} value={`LAT ${fmtNum(probe.gridPoint?.lat, 1)} / LNG ${fmtNum(probe.gridPoint?.lng, 1)}`} tone={C.green} />
            <MetricRow label={copy.current} value={`${formatValue(probe.current?.value, variable, settings.units, precision)} ${unitLabel}`} tone={C.mars} />
          </div>

          <div style={{ height: 1, background: C.border, opacity: 0.8 }} />

          <SectionLabel>{copy.comparison}</SectionLabel>
          <div style={{ display: 'grid' }}>
            <MetricRow label={copy.globalDiff} value={`${formatValue(probe.comparison?.pointMinusGlobal, variable, settings.units, precision)} ${unitLabel}`} tone={C.blue} compact />
            <MetricRow label={copy.latDiff} value={`${formatValue(probe.comparison?.pointMinusLatitudeMean, variable, settings.units, precision)} ${unitLabel}`} tone={C.green} compact />
          </div>

          <div style={{ height: 1, background: C.border, opacity: 0.8 }} />

          <MetricRow
            label={copy.seriesStatus}
            value={loading
              ? (isZh ? '读取中' : 'Loading')
              : probe.status === 'local'
                ? (isZh ? '本地预览' : 'Local preview')
                : hasAnnualSeries
                  ? `${pointSeriesCount} ${isZh ? '个 Ls 采样点' : 'samples'}`
                  : (isZh ? '暂无序列' : 'No series')}
            tone={C.ice60}
            compact
          />
        </div>

        <div className="point-probe-chart-panel" style={{ padding: 10, borderRadius: 16, background: 'rgba(255,255,255,0.035)', border: `1px solid ${C.border}`, minWidth: 0, minHeight: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', marginBottom: 4 }}>
            <div style={{ color: C.ice, fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 'calc(11px * var(--font-scale, 1))' }}>{copy.annual}</div>
            <div style={{ color: C.ice40, fontSize: 'calc(8px * var(--font-scale, 1))', whiteSpace: 'nowrap' }}>{copy.ls} {fmtNum(probe.current?.ls, 1)}</div>
          </div>
          {hasAnnualSeries ? (
            <Plot
              data={[
                { x: lsSeries, y: convertedPoint, type: 'scatter', mode: 'lines+markers', name: copy.point, line: { color: C.mars, width: 2.2, shape: 'spline' }, marker: { size: 3.5 } },
                { x: lsSeries, y: convertedGlobalMean, type: 'scatter', mode: 'lines', name: copy.globalMean, line: { color: C.blue, width: 1.6, dash: 'dot', shape: 'spline' } },
                { x: lsSeries, y: convertedLatitudeMean, type: 'scatter', mode: 'lines', name: copy.latitudeMean, line: { color: C.green, width: 1.6, dash: 'dash', shape: 'spline' } },
              ]}
              layout={{
                autosize: true,
                paper_bgcolor: 'transparent',
                plot_bgcolor: 'transparent',
                margin: { l: 40, r: 10, t: 2, b: 34 },
                xaxis: { title: copy.ls, gridcolor: plotGrid, tickfont: { color: plotText, size: 8 }, titlefont: { color: plotText, size: 9 }, automargin: true },
                yaxis: { title: `${variableLabel} (${unitLabel})`, gridcolor: plotGrid, tickfont: { color: plotText, size: 8 }, titlefont: { color: plotText, size: 9 }, automargin: true },
                legend: { orientation: 'h', x: 0, y: 1.04, font: { color: plotText, size: 8 } },
              }}
              config={{ displayModeBar: false, responsive: true }}
              useResizeHandler
              style={{ width: '100%', height: 220 }}
            />
          ) : (
            <div style={{ height: 220, display: 'grid', placeItems: 'center', color: C.ice50, fontSize: 'calc(10px * var(--font-scale, 1))', textAlign: 'center', lineHeight: 1.45 }}>
              {copy.noAnnual}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
