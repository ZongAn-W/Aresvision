import React from 'react';
import GlowCard from '../../components/GlowCard';
import C from '../../constants/colors';
import { useSettings } from '../../contexts/SettingsContext';
import { convertOzone, ozoneLabel, convertTemp, tempLabel, convertWind, windLabel } from '../../utils/units';
import { getRgb } from '../../utils/colormaps';
import { useDataOverview } from '../../contexts/DataOverviewContext';
import { getGlobeVariableMeta } from '../../constants/globeVariables';

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

export default function GlobeLegend({ ozoneData, sceneModel, embedded = true }) {
  const { settings } = useSettings();
  const isLight = settings?.theme === 'light';
  const isZh = settings?.language !== 'en';
  const { gestureEnabled } = useDataOverview();
  const variable = ozoneData?.variable || 'o3col';
  const varMeta = getGlobeVariableMeta(variable);
  const varLabel = settings?.language === 'en' ? varMeta.en : varMeta.zh;
  const unitLabel = unitLabelByVariable(variable, settings.units);

  if (!ozoneData || typeof ozoneData.maxVal === 'undefined') return null;

  const panelWidth = gestureEnabled ? 150 : 158;
  const panelBottom = 88;

  const pointsCount = ozoneData.points?.length || 0;
  const maxVal = convertByVariable(ozoneData.maxVal || 0, variable, settings.units).toFixed(3);
  const midVal = convertByVariable(((ozoneData.maxVal || 0) + (ozoneData.minVal || 0)) / 2, variable, settings.units).toFixed(3);
  const minVal = convertByVariable(ozoneData.minVal || 0, variable, settings.units).toFixed(3);
  const horizontalGradient = (() => {
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
      className="overview-globe-legend-compact overview-overlay-anchor"
      data-embedded={embedded ? 'true' : 'false'}
      style={{
        position: 'fixed',
        bottom: `calc(var(--overview-timeline-bottom) + ${panelBottom - 20}px)`,
        left: 'calc(var(--overview-scene-left) + var(--overview-overlay-gap))',
        width: `${panelWidth}px`,
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
              style={{
                color: C.ice60,
                fontSize: 'calc(9px * var(--font-scale, 1))',
                fontWeight: 800,
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
              fontSize: 'calc(8px * var(--font-scale, 1))',
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
                    color: C.ice50,
                    fontSize: 'calc(8px * var(--font-scale, 1))',
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
            <div style={{ display: 'flex', justifyContent: 'space-between', color: C.ice50, fontSize: 'calc(8px * var(--font-scale, 1))', fontWeight: 700 }}>
              <span>{isZh ? 'MCD 偏低' : 'MCD lower'}</span>
              <span>{isZh ? 'MCD 偏高' : 'MCD higher'}</span>
            </div>
            {validation ? (
              <>
                <div style={{ color: C.ice50, fontSize: 'calc(8px * var(--font-scale, 1))', lineHeight: 1.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {isZh ? 'NOMAD 稀疏验证' : 'NOMAD sparse validation'} · Ls {formatMetric(validation.matched_ls, 1)}°
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 4 }}>
                  {validationMetrics.map(([label, value]) => (
                    <div key={label} style={{ padding: '4px', borderRadius: 6, background: 'rgba(255,255,255,0.04)', border: `1px solid ${C.border}` }}>
                      <div style={{ color: C.ice30, fontSize: 'calc(7px * var(--font-scale, 1))', fontWeight: 700 }}>{label}</div>
                      <div style={{ color: label === 'Bias' ? C.blue : C.ice, fontSize: 'calc(8px * var(--font-scale, 1))', fontWeight: 800, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div style={{ color: C.ice40, fontSize: 'calc(8px * var(--font-scale, 1))', lineHeight: 1.35 }}>
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

            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontSize: 'calc(8px * var(--font-scale, 1))',
                color: C.ice,
                fontWeight: 700,
              }}
            >
              <span>{minVal}</span>
              <span style={{ color: C.ice60 }}>{sceneModel?.legendMode === 'diff' ? '0.000' : midVal}</span>
              <span>{maxVal}</span>
            </div>
          </>
        )}
      </GlowCard>
    </div>
  );
}
