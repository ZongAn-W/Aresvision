/**
 * Earth 年度分析卡片视图。
 *
 * 全部视图只接收已构建好的视图模型，不发起请求、不读 Mars context、
 * 不做单位换算。日期轴统一使用 `type: 'date'` 且按 UTC 渲染。
 */

import React, { useMemo } from 'react';
import Plot from 'react-plotly.js';
import C from '../../../constants/colors';
import { useSettings } from '../../../contexts/SettingsContext';
import {
  bandLabel,
  formatValue,
  peakLagDays,
  variableLabel,
} from './earthResearchModel.js';
import { EARTH_VARIABLE_UNITS } from './earthOverviewModel.js';

const PLOT_HEIGHT = 320;

/**
 * 与火星图表一致的 Plotly 交互配置：保留模式栏（导出 PNG/SVG、缩放）但去掉
 * Plotly 徽标。模式栏位置由 `overviewWorkbench.css` 的 `.overview-card-plot`
 * 统一挪到右下角，与火星卡片表现一致。
 */
export const WORKBENCH_PLOT_CONFIG = {
  displayModeBar: true,
  scrollZoom: true,
  responsive: true,
  displaylogo: false,
};

/** 卡片内的变量切换药丸行（与火星“季节变化”卡片同款）。 */
export function VariableTabs({ value, onChange, options, isZh = true }) {
  if (!Array.isArray(options) || options.length < 2) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {options.map((item) => {
        const selected = item.id === value;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onChange?.(item.id)}
            aria-pressed={selected}
            style={{
              border: `1px solid ${selected ? C.blue : C.border}`,
              background: selected ? 'rgba(74,158,255,0.16)' : 'rgba(255,255,255,0.03)',
              color: selected ? C.blue : C.ice60,
              borderRadius: 999,
              padding: '6px 10px',
              fontSize: 'calc(11px * var(--font-scale, 1))',
              cursor: 'pointer',
              fontFamily: 'var(--font-body)',
            }}
          >
            {isZh ? item.zh : item.en}
          </button>
        );
      })}
    </div>
  );
}

/** “当前变量: X (单位)” 提示行，与火星卡片一致。 */
export function CurrentVariableLine({ label, units, isZh }) {
  return (
    <div style={{ color: C.ice60, fontSize: 'calc(11px * var(--font-scale, 1))' }}>
      {isZh ? '当前变量' : 'Current variable'}:{' '}
      <span style={{ color: C.blue, fontWeight: 700 }}>
        {label}{units ? ` (${units})` : ''}
      </span>
    </div>
  );
}

/** 卡片正文统一头部：标题 + 变量药丸 + 当前变量行。 */
function CardChartHeader({ title, variableOptions, variable, onVariableChange, label, units, isZh }) {
  return (
    <>
      <div
        style={{
          color: C.ice80,
          fontFamily: 'var(--font-display)',
          fontSize: 'calc(13px * var(--font-scale, 1))',
          fontWeight: 700,
          letterSpacing: '-0.01em',
        }}
      >
        {title}
      </div>
      <VariableTabs value={variable} onChange={onVariableChange} options={variableOptions} isZh={isZh} />
      <CurrentVariableLine label={label} units={units} isZh={isZh} />
    </>
  );
}

function usePlotTheme() {
  const { settings } = useSettings();
  const isLight = settings?.theme === 'light';
  return {
    isLight,
    isZh: settings?.language !== 'en',
    text: isLight ? 'rgba(23,33,47,0.88)' : 'rgba(236,244,255,0.94)',
    grid: isLight ? 'rgba(23,33,47,0.12)' : 'rgba(160,196,240,0.15)',
  };
}

function baseLayout({ text, grid }) {
  return {
    autosize: true,
    paper_bgcolor: 'transparent',
    plot_bgcolor: 'transparent',
    margin: { l: 62, r: 18, t: 10, b: 52 },
    font: { color: text, size: 10 },
    xaxis: { gridcolor: grid, tickfont: { color: text, size: 10 }, automargin: true },
    yaxis: { gridcolor: grid, tickfont: { color: text, size: 10 }, automargin: true },
    legend: { orientation: 'h', y: 1.14, x: 0, font: { color: text, size: 10 } },
  };
}

export function NoteBlock({ children }) {
  return (
    <div
      style={{
        padding: '12px 14px',
        borderRadius: 12,
        border: `1px solid ${C.border}`,
        background: 'rgba(255,255,255,0.03)',
        color: C.ice60,
        fontSize: 'calc(12px * var(--font-scale, 1))',
        lineHeight: 1.7,
      }}
    >
      {children}
    </div>
  );
}

export function ViewPlaceholder({ isZh, text = null }) {
  return (
    <div style={{ color: C.ice60, fontFamily: 'var(--font-body)', fontSize: 'calc(12px * var(--font-scale, 1))' }}>
      {text || (isZh ? '暂无可用数据。' : 'No data available.')}
    </div>
  );
}

// ── 季节结构：纬度 × 日期热力图 ─────────────────────────────────────────
export function SeasonalHeatmapView({
  model, variable, variableOptions = [], onVariableChange = null, units = '',
}) {
  const { isZh, text, grid } = usePlotTheme();
  if (!model) return <ViewPlaceholder isZh={isZh} />;
  const { x, y, z, xTitle, yTitle } = model;
  const chartUnits = units || model.units || '';
  const flat = z.flat().filter(Number.isFinite);
  const layout = baseLayout({ text, grid });
  return (
    <div className="overview-card-plot" style={{ display: 'grid', gap: 10 }}>
      <CardChartHeader
        title={isZh ? '季节结构热力图（纵轴：纬度 - 横轴：日期）' : 'Seasonal structure (Y: latitude - X: date)'}
        variableOptions={variableOptions}
        variable={variable}
        onVariableChange={onVariableChange}
        label={variableLabel(variable, isZh)}
        units={chartUnits}
        isZh={isZh}
      />
      <div style={{ minHeight: PLOT_HEIGHT }}>
        <Plot
          data={[{
            type: 'heatmap',
            x,
            y,
            z,
            zsmooth: 'best',
            colorscale: 'Viridis',
            zmin: flat.length ? Math.min(...flat) : 0,
            zmax: flat.length ? Math.max(...flat) : 1,
            // 横向色标置于图下方，和火星热力图一致。
            colorbar: {
              title: {
                text: `${variableLabel(variable, isZh)}${chartUnits ? ` (${chartUnits})` : ''}`,
                font: { color: text, size: 10 },
                side: 'top',
              },
              orientation: 'h',
              y: -0.22,
              yanchor: 'top',
              len: 0.8,
              thickness: 10,
              tickfont: { color: text, size: 9 },
            },
            hovertemplate: `${isZh ? '纬度' : 'Lat'}=%{y}<br>%{x}<br>%{z:.2f} ${chartUnits}<extra></extra>`,
          }]}
          layout={{
            ...layout,
            margin: { l: 62, r: 18, t: 8, b: 78 },
            xaxis: { ...layout.xaxis, type: 'date', title: { text: xTitle, font: { size: 11, color: text } } },
            yaxis: { ...layout.yaxis, title: { text: yTitle, font: { size: 11, color: text } } },
          }}
          config={WORKBENCH_PLOT_CONFIG}
          useResizeHandler
          style={{ width: '100%', height: '100%' }}
        />
      </div>
      <NoteBlock>
        {isZh
          ? '每行是该纬度上 72 个等面积经度单元的日均值（equal_longitude_mean），横轴为真实 UTC 日期；该图不表示昼夜变化。'
          : 'Each row is the daily mean over the 72 equal-area longitude cells at that latitude (equal_longitude_mean) on real UTC dates. It does not represent a diurnal cycle.'}
      </NoteBlock>
    </div>
  );
}

// ── 年内变化：五变量全球面积加权均值 ────────────────────────────────────
export function RegionalTrendView({ model, normalized = false, onToggleNormalized = null }) {
  const { isZh, text, grid } = usePlotTheme();
  if (!model) return <ViewPlaceholder isZh={isZh} />;
  const layout = baseLayout({ text, grid });
  const traces = model.series.map((entry) => ({
    type: 'scatter',
    mode: 'lines',
    name: `${entry.label} (${entry.units || '--'})`,
    x: model.x,
    y: entry.values,
    line: { width: 2, color: entry.color },
    hovertemplate: `${entry.label} %{y:.3f} ${entry.units || ''}<extra></extra>`,
  }));
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <span style={{ color: C.ice60, fontSize: 'calc(11px * var(--font-scale, 1))' }}>
          {isZh ? '聚合：全球 5° 单元球面面积加权均值' : 'Aggregation: global 5° cell spherical area-weighted mean'}
        </span>
        {onToggleNormalized ? (
          <button
            type="button"
            onClick={() => onToggleNormalized(!normalized)}
            style={{
              padding: '4px 10px', borderRadius: 999, border: `1px solid ${C.border}`,
              background: 'transparent', color: C.ice, cursor: 'pointer',
              fontSize: 'calc(11px * var(--font-scale, 1))',
            }}
          >
            {normalized
              ? (isZh ? '显示原始单位' : 'Show physical units')
              : (isZh ? '显示 Z-score 对照' : 'Show Z-score comparison')}
          </button>
        ) : null}
      </div>
      <div style={{ width: '100%', height: PLOT_HEIGHT }}>
        <Plot
          data={traces}
          layout={{
            ...layout,
            xaxis: { ...layout.xaxis, type: 'date', title: { text: model.xTitle, font: { size: 11, color: text } } },
            yaxis: { ...layout.yaxis, title: { text: model.yTitle, font: { size: 11, color: text } } },
          }}
          config={WORKBENCH_PLOT_CONFIG}
          useResizeHandler
          style={{ width: '100%', height: '100%' }}
        />
      </div>
      <NoteBlock>
        {isZh
          ? '每变量使用各自的原始单位；Z-score 仅用于比较同步变化，不代表绝对数值大小，也不用于训练归一化。'
          : 'Each variable keeps its own physical unit. Z-scores only compare synchronised variation; they are not magnitudes and are not used for training normalisation.'}
      </NoteBlock>
    </div>
  );
}

// ── 季节极值：按纬带给出峰/谷日期 ──────────────────────────────────────
export function ExtremesView({ rows, variableId, variableOptions = [], onVariableChange = null }) {
  const { isZh } = usePlotTheme();
  const units = rows?.[0]?.units || EARTH_VARIABLE_UNITS[variableId] || '';
  if (!rows?.length) {
    return (
      <div style={{ display: 'grid', gap: 10 }}>
        <VariableTabs value={variableId} onChange={onVariableChange} options={variableOptions} isZh={isZh} />
        <ViewPlaceholder isZh={isZh} />
      </div>
    );
  }
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <VariableTabs value={variableId} onChange={onVariableChange} options={variableOptions} isZh={isZh} />
      <CurrentVariableLine label={variableLabel(variableId, isZh)} units={units} isZh={isZh} />
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', whiteSpace: 'nowrap', fontSize: 'calc(11px * var(--font-scale, 1))', color: C.ice80 }}>
          <thead>
            <tr style={{ color: C.ice50, textAlign: 'left' }}>
              <th style={{ padding: '6px 8px' }}>{isZh ? '纬带' : 'Band'}</th>
              <th style={{ padding: '6px 8px' }}>{isZh ? '实际纬度' : 'Latitudes'}</th>
              <th style={{ padding: '6px 8px' }}>{isZh ? '网格点' : 'Cells'}</th>
              <th style={{ padding: '6px 8px' }}>{isZh ? '峰值' : 'Max'}</th>
              <th style={{ padding: '6px 8px' }}>{isZh ? '峰日' : 'Max date'}</th>
              <th style={{ padding: '6px 8px' }}>{isZh ? '谷值' : 'Min'}</th>
              <th style={{ padding: '6px 8px' }}>{isZh ? '谷日' : 'Min date'}</th>
              <th style={{ padding: '6px 8px' }}>{isZh ? '峰谷差' : 'Peak-to-peak'}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.bandId} style={{ borderTop: `1px solid ${C.border}` }}>
                <td style={{ padding: '6px 8px' }}>{bandLabel(row.bandId, isZh)}</td>
                <td style={{ padding: '6px 8px' }}>
                  {row.minLatitude === null || row.maxLatitude === null
                    ? '--'
                    : `${row.minLatitude}° ~ ${row.maxLatitude}°`}
                </td>
                <td style={{ padding: '6px 8px' }}>{row.gridPointCount ?? 0}</td>
                <td style={{ padding: '6px 8px' }}>{formatValue(row.max)}</td>
                <td style={{ padding: '6px 8px' }}>{row.maxDate || '--'}</td>
                <td style={{ padding: '6px 8px' }}>{formatValue(row.min)}</td>
                <td style={{ padding: '6px 8px' }}>{row.minDate || '--'}</td>
                <td style={{ padding: '6px 8px' }}>{formatValue(row.peakToPeak)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <NoteBlock>
        {isZh
          ? `单位：${units || '--'}。极值取自各纬带日均曲线；相同极值取最早日期。纬带范围是实际采样的网格纬度，不是阈值本身。`
          : `Units: ${units || '--'}. Extremes come from each band's daily-mean series; ties resolve to the earliest date. Band ranges are the actually sampled grid latitudes, not the thresholds.`}
      </NoteBlock>
    </div>
  );
}

// ── 环境因子：纬带内变量对比 ────────────────────────────────────────────
export function EnvironmentView({ model, bandId, onBandChange = null, bandIds = [] }) {
  const { isZh, text, grid } = usePlotTheme();
  if (!model) return <ViewPlaceholder isZh={isZh} />;
  const layout = baseLayout({ text, grid });
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {onBandChange && bandIds.length ? (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {bandIds.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => onBandChange(id)}
              style={{
                padding: '3px 10px', borderRadius: 999,
                border: `1px solid ${id === bandId ? `${C.blue}88` : C.border}`,
                background: id === bandId ? `${C.blue}18` : 'transparent',
                color: id === bandId ? C.blue : C.ice60, cursor: 'pointer',
                fontSize: 'calc(11px * var(--font-scale, 1))',
              }}
            >
              {bandLabel(id, isZh)}
            </button>
          ))}
        </div>
      ) : null}
      <div style={{ width: '100%', height: PLOT_HEIGHT }}>
        <Plot
          data={model.series.map((entry) => ({
            type: 'scatter',
            mode: 'lines',
            name: `${entry.label} (${entry.units})`,
            x: model.x,
            y: entry.values,
            line: { width: 2, color: entry.color },
            hovertemplate: `${entry.label} %{y:.3f} ${entry.units}<extra></extra>`,
          }))}
          layout={{
            ...layout,
            xaxis: { ...layout.xaxis, type: 'date', title: { text: model.xTitle, font: { size: 11, color: text } } },
            yaxis: { ...layout.yaxis, title: { text: model.yTitle, font: { size: 11, color: text } } },
          }}
          config={WORKBENCH_PLOT_CONFIG}
          useResizeHandler
          style={{ width: '100%', height: '100%' }}
        />
      </div>
      <NoteBlock>
        {isZh
          ? '各变量保留原始单位，不同量纲不能直接比较大小，只能比较时间上的同步性。风分量保留正负号，未取绝对值。'
          : 'Each variable keeps its physical unit, so magnitudes are not comparable across variables — only synchrony in time. Wind components keep their sign; no absolute value is applied.'}
      </NoteBlock>
    </div>
  );
}

// ── 变量相关性 5×5 ─────────────────────────────────────────────────────
export function CorrelationView({ model }) {
  const { isZh, text } = usePlotTheme();
  const { labels, r } = model || {};
  if (!model) return <ViewPlaceholder isZh={isZh} />;
  const flat = (r || []).flat().filter(Number.isFinite);
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ width: '100%', height: PLOT_HEIGHT }}>
        <Plot
          data={[{
            type: 'heatmap',
            x: labels,
            y: labels,
            z: r,
            zmin: -1,
            zmax: 1,
            colorscale: 'RdBu',
            reversescale: true,
            colorbar: { title: { text: 'r', side: 'right' }, thickness: 10, tickfont: { size: 9, color: text } },
            hovertemplate: `%{y} vs %{x}<br>r=%{z:.3f}<extra></extra>`,
          }]}
          layout={{
            autosize: true,
            paper_bgcolor: 'transparent',
            plot_bgcolor: 'transparent',
            margin: { l: 62, r: 18, t: 10, b: 46 },
            font: { color: text, size: 10 },
            xaxis: { tickfont: { color: text, size: 10 } },
            yaxis: { tickfont: { color: text, size: 10 }, autorange: 'reversed' },
          }}
          config={WORKBENCH_PLOT_CONFIG}
          useResizeHandler
          style={{ width: '100%', height: '100%' }}
        />
      </div>
      <NoteBlock>
        {isZh
          ? `样本为同一天的区域日均序列（Pearson r，每天一个样本，不混入空间样本）。常量序列与样本不足的格子为 null，不伪造 r=1；有效配对 ${flat.length} 个。相关不代表因果。`
          : `Samples are same-day regional-mean series (Pearson r, one sample per day; no space-time mixing). Constant or too-short pairs are null rather than a fabricated r=1; ${flat.length} valid pairs. Correlation is not causation.`}
      </NoteBlock>
    </div>
  );
}

// ── 辐射/温度 与 O3 的关系（散点 + 回归 + 滞后） ────────────────────────
export function RelationshipView({ model, colorByDate = true }) {
  const { isZh, text, grid } = usePlotTheme();
  if (!model) return <ViewPlaceholder isZh={isZh} />;
  const layout = baseLayout({ text, grid });
  const peak = peakLagDays(model.lag);
  const traces = [
    {
      type: 'scattergl',
      mode: 'markers',
      x: model.x,
      y: model.y,
      marker: {
        size: 5,
        // 数值型日期索引：把日期字符串交给 Plotly 作为 marker.color 会让色标
        // 量到 NaN 尺寸，日期改由 tooltip 与色标刻度表达。
        color: colorByDate ? model.colorValues : model.x,
        colorscale: 'Viridis',
        showscale: Boolean(colorByDate),
        colorbar: colorByDate
          ? {
            title: { text: isZh ? '日期' : 'Date', side: 'right' },
            thickness: 10,
            tickfont: { size: 9, color: text },
            tickmode: 'array',
            tickvals: (model.colorTicks || []).map((tick) => tick.index),
            ticktext: (model.colorTicks || []).map((tick) => tick.date),
          }
          : undefined,
      },
      text: model.dates,
      hovertemplate: `${model.driverVariable} %{x:.2f} ${model.driverUnits}<br>TO3 %{y:.2f} ${model.referenceUnits}<br>%{text}<extra></extra>`,
      name: isZh ? '逐日区域均值' : 'Daily regional means',
    },
  ];
  if (model.regression && Number.isFinite(model.regression.slope)) {
    const xs = model.x.filter(Number.isFinite);
    const min = Math.min(...xs);
    const max = Math.max(...xs);
    traces.push({
      type: 'scatter',
      mode: 'lines',
      x: [min, max],
      y: [min * model.regression.slope + model.regression.intercept, max * model.regression.slope + model.regression.intercept],
      line: { color: C.mars, width: 2, dash: 'dot' },
      name: isZh ? '最小二乘拟合' : 'Least-squares fit',
      hoverinfo: 'skip',
    });
  }

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ width: '100%', height: PLOT_HEIGHT }}>
        <Plot
          data={traces}
          layout={{
            ...layout,
            xaxis: {
              ...layout.xaxis,
              title: { text: `${model.driverVariable} (${model.driverUnits})`, font: { size: 11, color: text } },
            },
            yaxis: {
              ...layout.yaxis,
              title: { text: `TO3 (${model.referenceUnits})`, font: { size: 11, color: text } },
            },
          }}
          config={WORKBENCH_PLOT_CONFIG}
          useResizeHandler
          style={{ width: '100%', height: '100%' }}
        />
      </div>
      <div
        style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8,
          color: C.ice70, fontSize: 'calc(11px * var(--font-scale, 1))',
        }}
      >
        <Metric label="Pearson r" value={Number.isFinite(model.r) ? model.r.toFixed(3) : '--'} />
        <Metric label={isZh ? '有效样本 n' : 'Samples n'} value={model.n ?? '--'} />
        <Metric
          label={isZh ? '回归斜率' : 'Slope'}
          value={model.regression && Number.isFinite(model.regression.slope)
            ? `${model.regression.slope.toFixed(4)} ${model.regressionUnits}`
            : '--'}
        />
        <Metric
          label={isZh ? '最大 |r| 滞后' : 'Peak |r| lag'}
          value={peak === null ? '--' : `${peak} ${isZh ? '天' : 'd'}`}
        />
      </div>
      {model.lag?.length ? (
        <div style={{ width: '100%', height: 200 }}>
          <Plot
            data={[{
              type: 'bar',
              x: model.lag.map((row) => row.lag_days),
              y: model.lag.map((row) => row.r),
              marker: { color: model.lag.map((row) => (row.r >= 0 ? C.blue : C.mars)) },
              hovertemplate: `lag %{x} d<br>r=%{y:.3f}<extra></extra>`,
            }]}
            layout={{
              ...layout,
              margin: { l: 52, r: 18, t: 6, b: 40 },
              bargap: 0.15,
              xaxis: { ...layout.xaxis, title: { text: isZh ? '滞后（天，正=驱动领先）' : 'Lag (days, positive = driver leads)', font: { size: 10, color: text } } },
              yaxis: { ...layout.yaxis, range: [-1, 1], title: { text: 'r', font: { size: 10, color: text } } },
              showlegend: false,
            }}
            config={WORKBENCH_PLOT_CONFIG}
            useResizeHandler
          style={{ width: '100%', height: '100%' }}
          />
        </div>
      ) : null}
      <NoteBlock>
        {isZh
          ? '正滞后表示驱动变量领先臭氧若干天；滞后相关使用重叠样本，不环绕、不跨年补点。共同季节性与时间自相关会同时抬高各滞后阶的相关，因此不得据此声称物理响应时间。'
          : 'A positive lag means the driver leads ozone by that many days. Lagged correlations use overlapping samples only — no wraparound, no cross-year padding. Shared seasonality and autocorrelation inflate every lag, so this is not a physical response time.'}
      </NoteBlock>
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div style={{ padding: '8px 10px', borderRadius: 10, border: `1px solid ${C.border}`, background: 'rgba(255,255,255,0.03)' }}>
      <div style={{ color: C.ice45, fontSize: 'calc(10px * var(--font-scale, 1))' }}>{label}</div>
      <div style={{ color: C.ice, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

// ── 空间距平与纬带 RMS ─────────────────────────────────────────────────
export function SpatialAnomalyView({
  anomaly, rows, variableId, variableOptions = [], onVariableChange = null,
}) {
  const { isZh, text } = usePlotTheme();
  if (!anomaly || !rows) {
    return (
      <div style={{ display: 'grid', gap: 10 }}>
        <VariableTabs value={variableId} onChange={onVariableChange} options={variableOptions} isZh={isZh} />
        <ViewPlaceholder isZh={isZh} />
      </div>
    );
  }
  const bound = Math.max(
    Math.abs(anomaly.colorRange?.min ?? 0),
    Math.abs(anomaly.colorRange?.max ?? 0),
    1e-9,
  );
  return (
    <div className="overview-card-plot" style={{ display: 'grid', gap: 10 }}>
      <VariableTabs value={variableId} onChange={onVariableChange} options={variableOptions} isZh={isZh} />
      <CurrentVariableLine label={variableLabel(variableId, isZh)} units={anomaly.units} isZh={isZh} />
      <div style={{ minHeight: PLOT_HEIGHT }}>
        <Plot
          data={[{
            type: 'heatmap',
            x: anomaly.x,
            y: anomaly.y,
            z: anomaly.z,
            zmin: -bound,
            zmax: bound,
            colorscale: 'RdBu',
            reversescale: true,
            colorbar: {
              title: {
                text: `${variableLabel(variableId, isZh)}${anomaly.units ? ` (${anomaly.units})` : ''}`,
                font: { color: text, size: 10 },
                side: 'top',
              },
              orientation: 'h',
              y: -0.22,
              yanchor: 'top',
              len: 0.8,
              thickness: 10,
              tickfont: { color: text, size: 9 },
            },
            hovertemplate: `${isZh ? '纬度' : 'Lat'}=%{y} ${isZh ? '经度' : 'Lon'}=%{x}<br>%{z:.2f} ${anomaly.units}<extra></extra>`,
          }]}
          layout={{
            autosize: true,
            paper_bgcolor: 'transparent',
            plot_bgcolor: 'transparent',
            margin: { l: 62, r: 18, t: 10, b: 78 },
            font: { color: text, size: 10 },
            xaxis: { title: { text: isZh ? '经度' : 'Longitude', font: { size: 11, color: text } }, tickfont: { color: text, size: 10 } },
            yaxis: { title: { text: isZh ? '纬度' : 'Latitude', font: { size: 11, color: text } }, tickfont: { color: text, size: 10 } },
          }}
          config={WORKBENCH_PLOT_CONFIG}
          useResizeHandler
          style={{ width: '100%', height: '100%' }}
        />
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', whiteSpace: 'nowrap', fontSize: 'calc(11px * var(--font-scale, 1))', color: C.ice80 }}>
          <thead>
            <tr style={{ color: C.ice50, textAlign: 'left' }}>
              <th style={{ padding: '6px 8px' }}>{isZh ? '纬带' : 'Band'}</th>
              <th style={{ padding: '6px 8px' }}>RMS ({rows[0]?.units || anomaly.units})</th>
              <th style={{ padding: '6px 8px' }}>{isZh ? '峰谷跨度' : 'Peak-to-peak'}</th>
              <th style={{ padding: '6px 8px' }}>{isZh ? '网格点' : 'Cells'}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.bandId} style={{ borderTop: `1px solid ${C.border}` }}>
                <td style={{ padding: '6px 8px' }}>{bandLabel(row.bandId, isZh)}</td>
                <td style={{ padding: '6px 8px' }}>{formatValue(row.rms)}</td>
                <td style={{ padding: '6px 8px' }}>{formatValue(row.peakToPeak)}</td>
                <td style={{ padding: '6px 8px' }}>{row.gridPointCount ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <NoteBlock>
        {isZh
          ? `距平＝年平均场减去同纬度经度均值（${variableLabel(variableId, isZh)}），不是多年气候距平，也不是全球行星波。RMS 使用单元面积权重，分母包含经度点数。`
          : `Anomaly = annual mean field minus the same-latitude longitude mean (${variableLabel(variableId, isZh)}). It is not a multi-year climatological anomaly or a global planetary wave. RMS uses cell-area weights with longitude points in the denominator.`}
      </NoteBlock>
    </div>
  );
}

// ── 极区统计（日平均，|latitude| >= 60°） ──────────────────────────────
export function PolarView({ polar, isZh: forcedZh = null }) {
  const theme = usePlotTheme();
  const isZh = forcedZh === null ? theme.isZh : forcedZh;
  const { text, grid } = theme;
  if (!polar) return <ViewPlaceholder isZh={isZh} />;
  const variables = useMemo(() => ['TO3', 'U10M', 'V10M', 'T2M', 'SWGDN'], []);

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <NoteBlock>
        {isZh
          ? `极区统计范围固定为 |latitude| ≥ ${polar.minAbsLatitude}°，使用 UTC 日平均数据；返回的是实际采样纬度，阈值本身不是网格点。日平均数据不保留日内变化，因此极区日变化无法给出。`
          : `Polar statistics use |latitude| ≥ ${polar.minAbsLatitude}° on UTC daily means. The returned latitudes are the actually sampled grid rows; the threshold itself is not a grid point. Daily means retain no intra-day variation, so a polar diurnal cycle cannot be provided.`}
      </NoteBlock>

      {polar.bands.map((band) => (
        <div key={band.id} style={{ display: 'grid', gap: 8 }}>
          <div style={{ color: C.ice, fontFamily: 'var(--font-display)', fontSize: 'calc(12px * var(--font-scale, 1))', fontWeight: 700 }}>
            {bandLabel(band.id, isZh)}
            <span style={{ color: C.ice45, fontWeight: 500, marginLeft: 8 }}>
              {band.min_latitude === null
                ? '--'
                : `${band.min_latitude}° ~ ${band.max_latitude}°`}
              {' · '}
              {band.grid_point_count ?? 0} {isZh ? '个网格点' : 'cells'}
            </span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', whiteSpace: 'nowrap', fontSize: 'calc(11px * var(--font-scale, 1))', color: C.ice80 }}>
              <thead>
                <tr style={{ color: C.ice50, textAlign: 'left' }}>
                  <th style={{ padding: '6px 8px' }}>{isZh ? '变量' : 'Variable'}</th>
                  <th style={{ padding: '6px 8px' }}>{isZh ? '单位' : 'Unit'}</th>
                  <th style={{ padding: '6px 8px' }}>{isZh ? '年内均值' : 'Mean'}</th>
                  <th style={{ padding: '6px 8px' }}>{isZh ? '最低' : 'Min'}</th>
                  <th style={{ padding: '6px 8px' }}>{isZh ? '最低日期' : 'Min date'}</th>
                  <th style={{ padding: '6px 8px' }}>{isZh ? '最高' : 'Max'}</th>
                  <th style={{ padding: '6px 8px' }}>{isZh ? '最高日期' : 'Max date'}</th>
                  <th style={{ padding: '6px 8px' }}>{isZh ? '峰谷差' : 'Peak-to-peak'}</th>
                </tr>
              </thead>
              <tbody>
                {variables.map((variableId) => {
                  const entry = band.variables?.[variableId];
                  return (
                    <tr key={variableId} style={{ borderTop: `1px solid ${C.border}` }}>
                      <td style={{ padding: '6px 8px' }}>{variableLabel(variableId, isZh)}</td>
                      <td style={{ padding: '6px 8px' }}>{entry?.units || EARTH_VARIABLE_UNITS[variableId] || '--'}</td>
                      <td style={{ padding: '6px 8px' }}>{formatValue(entry?.mean)}</td>
                      <td style={{ padding: '6px 8px' }}>{formatValue(entry?.min_value)}</td>
                      <td style={{ padding: '6px 8px' }}>{entry?.min_date || '--'}</td>
                      <td style={{ padding: '6px 8px' }}>{formatValue(entry?.max_value)}</td>
                      <td style={{ padding: '6px 8px' }}>{entry?.max_date || '--'}</td>
                      <td style={{ padding: '6px 8px' }}>{formatValue(entry?.peak_to_peak)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {band.variables?.TO3?.series?.length ? (
            <div style={{ width: '100%', height: 200 }}>
              <Plot
                data={[
                  {
                    type: 'scatter', mode: 'lines', name: `TO3 (${band.variables.TO3.units})`,
                    x: polar.dates, y: band.variables.TO3.series,
                    line: { color: '#ff8f68', width: 2 },
                    hovertemplate: 'TO3 %{y:.2f}<extra></extra>',
                  },
                  {
                    type: 'scatter', mode: 'lines', name: `T2M (${band.variables.T2M?.units || 'K'})`,
                    x: polar.dates, y: band.variables.T2M?.series || [],
                    line: { color: '#4acfac', width: 2 },
                    yaxis: 'y2',
                    hovertemplate: 'T2M %{y:.2f}<extra></extra>',
                  },
                ]}
                layout={{
                  autosize: true, paper_bgcolor: 'transparent', plot_bgcolor: 'transparent',
                  margin: { l: 56, r: 56, t: 6, b: 40 },
                  font: { color: text, size: 10 },
                  xaxis: { type: 'date', gridcolor: grid, tickfont: { color: text, size: 10 } },
                  yaxis: { gridcolor: grid, tickfont: { color: text, size: 10 }, title: { text: 'TO3 (DU)', font: { size: 10, color: text } } },
                  yaxis2: { overlaying: 'y', side: 'right', tickfont: { color: text, size: 10 }, title: { text: 'T2M (K)', font: { size: 10, color: text } } },
                  legend: { orientation: 'h', y: 1.16, x: 0, font: { color: text, size: 10 } },
                }}
                config={WORKBENCH_PLOT_CONFIG}
                useResizeHandler
          style={{ width: '100%', height: '100%' }}
              />
            </div>
          ) : null}
        </div>
      ))}

      {polar.contrast ? (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', whiteSpace: 'nowrap', fontSize: 'calc(11px * var(--font-scale, 1))', color: C.ice80 }}>
            <thead>
              <tr style={{ color: C.ice50, textAlign: 'left' }}>
                <th style={{ padding: '6px 8px' }}>{isZh ? '南北极对比' : 'Hemisphere contrast'}</th>
                <th style={{ padding: '6px 8px' }}>r</th>
                <th style={{ padding: '6px 8px' }}>n</th>
                <th style={{ padding: '6px 8px' }}>{isZh ? '均值差（南−北）' : 'Mean difference (S−N)'}</th>
              </tr>
            </thead>
            <tbody>
              {variables.map((variableId) => {
                const entry = polar.contrast[variableId];
                return (
                  <tr key={variableId} style={{ borderTop: `1px solid ${C.border}` }}>
                    <td style={{ padding: '6px 8px' }}>{variableLabel(variableId, isZh)}</td>
                    <td style={{ padding: '6px 8px' }}>{Number.isFinite(entry?.r) ? entry.r.toFixed(3) : '--'}</td>
                    <td style={{ padding: '6px 8px' }}>{entry?.n ?? '--'}</td>
                    <td style={{ padding: '6px 8px' }}>{formatValue(entry?.mean_difference)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

export default {
  SeasonalHeatmapView,
  RegionalTrendView,
  ExtremesView,
  EnvironmentView,
  CorrelationView,
  RelationshipView,
  SpatialAnomalyView,
  PolarView,
};
