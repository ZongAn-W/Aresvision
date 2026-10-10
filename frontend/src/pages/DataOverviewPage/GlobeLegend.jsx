import React from 'react';
import GlowCard from '../../components/GlowCard';
import C from '../../constants/colors';
import { useSettings } from '../../contexts/SettingsContext';
import { convertOzone, ozoneLabel, convertTemp, tempLabel, convertWind, windLabel } from '../../utils/units';
import { getRgb } from '../../utils/colormaps';
import { useDataOverview } from '../../contexts/DataOverviewContext';
import { getGlobeVariableMeta } from '../../constants/globeVariables';
import { pointsToFieldData } from './fieldGrid.js';
import { buildAnomalyField } from '../../components/sphericalFieldLayers.js';

function convertByVariable(value, variable, units) {
  if (!Number.isFinite(value)) return value;
  if (variable === 'o3col') return convertOzone(value, units.ozone);
  if (variable === 'Temperature') return convertTemp(value, units.temperature);
  if (variable === 'U_Wind' || variable === 'V_Wind') return convertWind(value, units.wind);
  return value;
}

function unitLabelByVariable(variable, units) {
  if (variable === 'o3col') return ozoneLabel(units.ozone);
  if (variable === 'Temperature') return tempLabel(units.temperature);
  if (variable === 'U_Wind' || variable === 'V_Wind') return windLabel(units.wind);
  if (variable === 'Dust_Optical_Depth') return 'tau';
  if (variable === 'Solar_Flux_DN') return 'W/m²';
  return '';
}

function formatMetric(value, digits = 3) {
  return Number.isFinite(value) ? Number(value).toFixed(digits) : '--';
}

export default function GlobeLegend({ ozoneData, sceneModel, showAnomaly = false, showWindVectors = false, windStatus = 'idle', windError = '', onRetryWind = null, embedded = true }) {
  const { settings } = useSettings();
  const isLight = settings?.theme === 'light';
  const isZh = settings?.language !== 'en';
  const { gestureEnabled } = useDataOverview();
  const variable = ozoneData?.variable || 'o3col';
  const varMeta = getGlobeVariableMeta(variable);
  const varLabel = settings?.language === 'en' ? varMeta.en : varMeta.zh;
  const unitLabel = unitLabelByVariable(variable, settings.units);

  if (!ozoneData || typeof ozoneData.maxVal === 'undefined') return null;

  const panelWidth = gestureEnabled ? 244 : 252;

  const pointsCount = ozoneData.points?.length || 0;
  const anomalyStats = showAnomaly ? buildAnomalyField(pointsToFieldData(ozoneData), {}) : null;
  const anomalyAbs = anomalyStats ? Math.max(Math.abs(anomalyStats.minVal), Math.abs(anomalyStats.maxVal)) : 0;
  const maxVal = convertByVariable(ozoneData.maxVal || 0, variable, settings.units).toFixed(3);
  const midVal = convertByVariable(((ozoneData.maxVal || 0) + (ozoneData.minVal || 0)) / 2, variable, settings.units).toFixed(3);
  const minVal = convertByVariable(ozoneData.minVal || 0, variable, settings.units).toFixed(3);
  const horizontalGradient = showAnomaly ? 'linear-gradient(90deg, #2b6cb0 0%, #f8fafc 50%, #c2410c 100%)' : (() => {
    const n = 10;
    const pts = Array.from({ length: n }, (_, i) => {
      const t = i / (n - 1);
      const [r, g, b] = getRgb(settings.colormap, t);
      return `rgb(${r},${g},${b}) ${(i / (n - 1) * 100).toFixed(0)}%`;
    });
    return `linear-gradient(90deg, ${pts.join(', ')})`;
  })();

  const sourceItems = [
    { id: 'mcd', label: 'MCD', color: '#f97316' },
    { id: 'openmars', label: 'OpenMARS', color: '#38bdf8' },
    { id: 'nomad', label: 'NOMAD', color: '#34d399' },
  ];

  const activeSourceIds = new Set((sceneModel?.layers || []).map((layer) => layer.source || layer.id));
  const diffGradient = 'linear-gradient(90deg, #2b6cb0 0%, #f8fafc 50%, #c2410c 100%)';
  const validation = sceneModel?.validation?.nomad || null;
  const isValidation = sceneModel?.legendMode === 'validation';
  const validationMetrics = validation
    ? [
      ['N', validation.sample_count],
      ['Bias', formatMetric(validation.bias)],
      ['MAE', formatMetric(validation.mae)],
      ['RMSE', formatMetric(validation.rmse)],
      ['R', formatMetric(validation.correlation, 2)],
    ]
    : [];

  return (
    <div
      className="overview-globe-legend-compact overview-overlay-anchor overview-science-legend"
      data-embedded={embedded ? 'true' : 'false'}
      style={{
        // 观测台画布已是全幅场景：图例相对画布左下角定位，不再按窗口减栏宽。
        position: 'absolute',
        bottom: `calc(var(--overview-overlay-gap) + 28px)`,
        left: 'var(--overview-overlay-gap)',
        width: `${panelWidth}px`,
        maxWidth: 'calc(100% - 2 * var(--overview-overlay-gap))',
        zIndex: 1000,
        pointerEvents: 'none',
        transition: 'left 0.2s ease, bottom 0.2s ease, width 0.2s ease',
      }}
    >
      <GlowCard style={{ padding: '8px', background: 'var(--overview-panel-bg-strong)', border: '1px solid var(--overview-panel-border)' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 8,
            marginBottom: 6,
            minWidth: 0,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div
              title={`${varLabel} (${unitLabel})`}
              className="overview-science-legend__variable"
              style={{
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {varLabel} ({unitLabel})
            </div>
          </div>
          <div
            title={isZh ? `${pointsCount} 个数据点` : `${pointsCount} points`}
            style={{
              padding: '2px 5px',
              borderRadius: 999,
              border: `1px solid ${C.border}`,
              color: C.mars,
              fontSize: 'calc(12px * var(--font-scale, 1))',
              fontWeight: 800,
              fontFamily: 'var(--font-display)',
              flexShrink: 0,
              lineHeight: 1,
            }}
          >
            {pointsCount}
          </div>
        </div>

        {sceneModel?.legendMode === 'sources' ? (
          <div className="source-dot-strip" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
            {sourceItems.map((item) => {
              const active = activeSourceIds.has(item.id);
              return (
                <span
                  key={item.id}
                  title={`${item.label} ${active ? (isZh ? '可用' : 'available') : (isZh ? '无数据' : 'no data')}`}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    color: 'var(--text-secondary)',
                    fontSize: 'calc(12px * var(--font-scale, 1))',
                    fontWeight: 800,
                    opacity: active ? 1 : 0.34,
                    whiteSpace: 'nowrap',
                  }}
                >
                  <span style={{ width: 6, height: 6, borderRadius: 999, background: item.color, boxShadow: active ? `0 0 8px ${item.color}88` : 'none' }} />
                  {item.label}
                </span>
              );
            })}
          </div>
        ) : isValidation ? (
          <div style={{ display: 'grid', gap: 5 }}>
            <div
              style={{
                height: 7,
                borderRadius: 999,
                border: `1px solid ${C.border}`,
                background: diffGradient,
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-secondary)', fontSize: 'calc(12px * var(--font-scale, 1))', fontWeight: 700 }}>
              <span>{isZh ? 'MCD 偏低' : 'MCD lower'}</span>
              <span>{isZh ? 'MCD 偏高' : 'MCD higher'}</span>
            </div>
            {validation ? (
              <>
                <div style={{ color: 'var(--text-secondary)', fontSize: 'calc(12px * var(--font-scale, 1))', lineHeight: 1.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {isZh ? 'NOMAD 稀疏验证' : 'NOMAD sparse validation'} · Ls {formatMetric(validation.matched_ls, 1)}°
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 4 }}>
                  {validationMetrics.map(([label, value]) => (
                    <div key={label} className="overview-science-legend__metric">
                      <div style={{ color: C.ice30, fontSize: 'calc(12px * var(--font-scale, 1))', fontWeight: 700 }}>{label}</div>
                      <div className="overview-science-legend__metric-value" title={String(value)} style={{ color: label === 'Bias' ? C.blue : C.ice }}>{value}</div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div style={{ color: C.ice40, fontSize: 'calc(12px * var(--font-scale, 1))', lineHeight: 1.5 }}>
                {isZh ? '当前 Ls 附近暂无 NOMAD 匹配点。' : 'No NOMAD match near the current Ls.'}
              </div>
            )}
          </div>
        ) : (
          <>
            <div
              style={{
                height: 7,
                borderRadius: 999,
                border: `1px solid ${C.border}`,
                background: sceneModel?.legendMode === 'diff' ? diffGradient : horizontalGradient,
                marginBottom: 5,
              }}
            />

            <div className="overview-science-legend__range">
              <span>{showAnomaly ? `−${formatMetric(convertByVariable(anomalyAbs, variable, settings.units))}` : minVal}</span>
              <span style={{ color: C.ice60 }}>{sceneModel?.legendMode === 'diff' || showAnomaly ? '0.000' : midVal}</span>
              <span>{showAnomaly ? `+${formatMetric(convertByVariable(anomalyAbs, variable, settings.units))}` : maxVal}</span>
            </div>
            <div style={{ marginTop: 5, color: 'var(--text-secondary)', fontSize: 'calc(12px * var(--font-scale, 1))', lineHeight: 1.5 }}>
              {showAnomaly
                ? (isZh ? '距当前场空间加权均值的偏差；点位读数保留原始值。' : 'Spatial deviation from the current weighted field mean; point probes keep raw values.')
                : (isZh ? '颜色表示当前场数值。' : 'Colour encodes the current field value.')}
            </div>
            {showWindVectors ? (
              <div style={{ marginTop: 5, display: 'grid', gap: 4, color: 'var(--text-secondary)', fontSize: 'calc(12px * var(--font-scale, 1))' }}>
                <span>{isZh ? '风矢量：m/s；箭头长度表示速度。' : 'Wind vectors: m/s; arrow length indicates speed.'}</span>
                {windStatus === 'error' ? (
                  <>
                    <span role="alert" style={{ color: 'var(--status-warning)' }}>{windError || (isZh ? '风场加载失败。' : 'Wind fields failed to load.')}</span>
                    {onRetryWind ? <button type="button" onClick={onRetryWind} style={{ justifySelf: 'start', padding: '3px 6px', borderRadius: 5, border: `1px solid ${C.border}`, color: C.ice, background: 'transparent', cursor: 'pointer' }}>{isZh ? '重试' : 'Retry'}</button> : null}
                  </>
                ) : windStatus === 'loading' ? <span>{isZh ? '正在加载风场…' : 'Loading wind fields…'}</span> : null}
              </div>
            ) : null}
          </>
        )}
      </GlowCard>
    </div>
  );
}
