import React from 'react';
import { createPortal } from 'react-dom';
import Plot from 'react-plotly.js';
import SphericalFieldCanvas from '../../components/SphericalFieldCanvas';
import GlowCard from '../../components/GlowCard';
import C from '../../constants/colors';
import { useT } from '../../i18n';
import { fmtNum } from '../../utils/fmt';
import { convertOzone, ozoneDeltaLabel, ozoneLabel } from '../../utils/units';
import { useSettings } from '../../contexts/SettingsContext';
import { PLOTLY_SCALE } from '../../utils/colormaps';
import { marsPredictionGrid } from './marsPredictionGrid';

function InfoCard({ label, value, hint, accent }) {
  return (
    <div
      style={{
        padding: '14px 16px',
        borderRadius: 16,
        background: C.bgMuted,
        border: `1px solid ${C.border}`,
      }}
    >
      <div style={{ fontSize: 'calc(10px * var(--font-scale, 1))', color: C.ice40, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {label}
      </div>
      <div style={{ marginTop: 8, fontSize: 'calc(20px * var(--font-scale, 1))', fontWeight: 800, color: accent || C.ice, fontFamily: 'var(--font-display)', letterSpacing: '-0.03em' }}>
        {value}
      </div>
      {hint ? (
        <div style={{ marginTop: 6, fontSize: 'calc(10px * var(--font-scale, 1))', color: C.ice50, lineHeight: 1.5 }}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}

export default function PredictFullscreenHUD({
  fullscreen3D,
  setFullscreen3D,
  truthField,
  stepLs,
  precision,
  ozoneUnit,
}) {
  const t = useT();
  const { settings } = useSettings();
  const colormapName = settings.colormap;
  const isLight = settings.theme === 'light';
  const isZh = settings?.language !== 'en';

  if (!fullscreen3D) return null;
  const grid = marsPredictionGrid(fullscreen3D.fieldData);
  if (!grid) return null;

  const titleText = fullscreen3D.colorMode === 'rdbu'
    ? t('predict.fullscreen3D.residual')
    : (fullscreen3D.fieldData === truthField ? t('predict.fullscreen3D.truth') : t('predict.fullscreen3D.prediction'));

  const rawMin = fullscreen3D.fieldData.minVal;
  const rawMax = fullscreen3D.fieldData.maxVal;
  const minValStr = fmtNum(convertOzone(rawMin, ozoneUnit), precision);
  const maxValStr = fmtNum(convertOzone(rawMax, ozoneUnit), precision);
  const rangeStr = fmtNum(convertOzone(rawMax - rawMin, ozoneUnit), precision);
  const colorTitle = fullscreen3D.colorMode === 'rdbu' ? ozoneDeltaLabel(ozoneUnit) : ozoneLabel(ozoneUnit);

  const field = fullscreen3D.fieldData.field;
  const nLat = field.length;
  const nLon = field[0].length;
  const latitudes = grid.latitude;
  const longitudes = grid.longitude;
  const latProfile = field.map((row) => convertOzone(row.reduce((sum, value) => sum + value, 0) / nLon, ozoneUnit));
  const heatmapZ = field.map((row) => row.map((value) => convertOzone(value, ozoneUnit)));

  let absMax = 0;
  if (fullscreen3D.colorMode === 'rdbu') {
    field.forEach((row) => row.forEach((value) => {
      absMax = Math.max(absMax, Math.abs(value));
    }));
  }

  const absMaxOzone = convertOzone(absMax, ozoneUnit);
  const minOzone = convertOzone(rawMin, ozoneUnit);
  const maxOzone = convertOzone(rawMax, ozoneUnit);
  const averageValue = heatmapZ.flat().reduce((sum, value) => sum + value, 0) / Math.max(1, nLat * nLon);

  const chartTheme = {
    paper_bgcolor: 'transparent',
    plot_bgcolor: 'transparent',
    font: {
      family: 'var(--font-body)',
      color: isLight ? '#0f172a' : '#f3f6fb',
      size: 10,
    },
    margin: { t: 16, r: 12, l: 38, b: 30 },
  };

  const copy = {
    title: isZh ? '3D 场景放大查看' : 'Expanded 3D field view',
    subtitle: isZh
      ? '聚焦单个时间步的全球场分布，并同步查看数值范围、二维展开和纬向剖面。'
      : 'Focus on a single global field while keeping the value range, 2D map, and latitudinal profile in view.',
    range: isZh ? '数值范围' : 'Range',
    average: isZh ? '场均值' : 'Field mean',
    resolution: isZh ? '网格分辨率' : 'Resolution',
    mapTitle: isZh ? '二维展开视图' : '2D map view',
    profileTitle: isZh ? '纬向平均剖面' : 'Latitudinal mean profile',
    close: isZh ? '关闭' : 'Close',
    viewLabel: isZh ? '当前视图' : 'Current view',
  };

  const overlay = (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-3 md:p-5"
      style={{ background: isLight ? 'rgba(15,23,42,0.18)' : 'rgba(2,6,23,0.62)', backdropFilter: 'blur(10px)' }}
      onDoubleClick={() => setFullscreen3D(null)}
    >
      <GlowCard
        className="relative w-full max-w-[1680px] h-[94vh] cursor-default overflow-hidden"
        style={{
          padding: 0,
          borderRadius: 28,
          background: isLight ? 'rgba(255,255,255,0.96)' : 'rgba(7,10,18,0.96)',
          border: `1px solid ${isLight ? 'rgba(15,23,42,0.08)' : 'rgba(255,255,255,0.08)'}`,
          boxShadow: isLight ? '0 24px 80px rgba(15,23,42,0.12)' : '0 30px 90px rgba(0,0,0,0.4)',
        }}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr 360px', height: '100%' }}>
          <div style={{ padding: 24, borderRight: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', gap: 14, background: isLight ? 'rgba(248,250,252,0.92)' : 'rgba(255,255,255,0.02)' }}>
            <div>
              <div style={{ fontSize: 'calc(18px * var(--font-scale, 1))', fontWeight: 700, color: C.ice, fontFamily: 'var(--font-display)' }}>
                {copy.title}
              </div>
              <div style={{ marginTop: 8, fontSize: 'calc(11px * var(--font-scale, 1))', color: C.ice50, lineHeight: 1.6 }}>
                {copy.subtitle}
              </div>
            </div>

            <div style={{ padding: '10px 12px', borderRadius: 14, background: C.bgMuted, border: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 'calc(10px * var(--font-scale, 1))', color: C.ice40, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {copy.viewLabel}
              </div>
              <div style={{ marginTop: 8, fontSize: 'calc(16px * var(--font-scale, 1))', color: C.blue, fontWeight: 700, fontFamily: 'var(--font-display)' }}>
                {titleText}
              </div>
              <div style={{ marginTop: 6, fontSize: 'calc(11px * var(--font-scale, 1))', color: C.ice50 }}>
                {t('predict.tableHeaders.lsShort')} {stepLs?.toFixed(1)}°
              </div>
            </div>

            <InfoCard label={t('predict.hud.maxValue')} value={maxValStr} hint={colorTitle} accent={C.mars} />
            <InfoCard label={t('predict.hud.minValue')} value={minValStr} hint={colorTitle} accent={C.green} />
            <InfoCard label={copy.range} value={rangeStr} hint={colorTitle} accent={C.blue} />
            <InfoCard label={copy.average} value={fmtNum(averageValue, precision)} hint={colorTitle} accent={C.purple} />
            <InfoCard label={copy.resolution} value="72 × 36" hint={isZh ? '5° × 5° 全球网格' : '5° × 5° global grid'} accent={C.ice} />

            <button
              onClick={() => setFullscreen3D(null)}
              style={{
                marginTop: 'auto',
                padding: '12px 14px',
                borderRadius: 14,
                border: `1px solid ${C.borderStrong}`,
                background: C.bgMuted,
                color: C.ice,
                fontSize: 'calc(12px * var(--font-scale, 1))',
                fontWeight: 700,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
            >
              {copy.close}
            </button>
          </div>

          <div style={{ position: 'relative', minWidth: 0, background: isLight ? '#f8fafc' : '#030712' }}>
            <div style={{ position: 'absolute', top: 20, left: 20, zIndex: 2, padding: '8px 12px', borderRadius: 999, background: isLight ? 'rgba(255,255,255,0.82)' : 'rgba(7,10,18,0.72)', border: `1px solid ${C.border}`, color: C.ice, fontSize: 'calc(11px * var(--font-scale, 1))', fontWeight: 600 }}>
              {titleText}
            </div>
            <SphericalFieldCanvas
              fieldData={grid.sphericalFieldData}
              geometry={{ latCenters: grid.latitude, lonCenters: grid.longitude }}
              colorMode={fullscreen3D.colorMode}
              h="100%"
              zoom={3.25}
              showMars={false}
            />
            <div
              style={{
                position: 'absolute',
                inset: 0,
                pointerEvents: 'none',
                background: isLight
                  ? 'linear-gradient(180deg, rgba(255,255,255,0.12), rgba(255,255,255,0))'
                  : 'radial-gradient(circle at center, transparent 0%, rgba(0,0,0,0.58) 100%)',
              }}
            />
          </div>

          <div style={{ padding: 24, borderLeft: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', gap: 16, background: isLight ? 'rgba(248,250,252,0.88)' : 'rgba(255,255,255,0.02)', overflowY: 'auto' }}>
            <div>
              <div style={{ fontSize: 'calc(13px * var(--font-scale, 1))', fontWeight: 700, color: C.ice, fontFamily: 'var(--font-display)' }}>
                {copy.mapTitle}
              </div>
              <div style={{ marginTop: 6, fontSize: 'calc(10px * var(--font-scale, 1))', color: C.ice50, lineHeight: 1.55 }}>
                {isZh ? '查看同一时间步在经纬度平面上的展开分布。' : 'Flatten the same field onto latitude-longitude coordinates.'}
              </div>
            </div>

            <div style={{ height: 240, borderRadius: 18, background: C.bgMuted, border: `1px solid ${C.border}`, overflow: 'hidden' }}>
              <Plot
                data={[
                  {
                    z: heatmapZ,
                    x: longitudes,
                    y: latitudes,
                    type: 'heatmap',
                    zsmooth: 'best',
                    colorscale: fullscreen3D.colorMode === 'rdbu' ? 'RdBu' : (PLOTLY_SCALE[colormapName] ?? 'Jet'),
                    zmin: fullscreen3D.colorMode === 'rdbu' ? -absMaxOzone : minOzone,
                    zmax: fullscreen3D.colorMode === 'rdbu' ? absMaxOzone : maxOzone,
                    showscale: false,
                    hovertemplate: 'Lat: %{y:.1f}°<br>Lon: %{x:.1f}°<br>Val: %{z:.2f}<extra></extra>',
                  },
                ]}
                layout={{
                  ...chartTheme,
                  autosize: true,
                  xaxis: { showgrid: false, zeroline: false, ticksuffix: '°', nticks: 4 },
                  yaxis: { showgrid: false, zeroline: false, ticksuffix: '°', nticks: 4 },
                }}
                config={{ displayModeBar: false, responsive: true }}
                useResizeHandler
                style={{ width: '100%', height: '100%' }}
              />
            </div>

            <div>
              <div style={{ fontSize: 'calc(13px * var(--font-scale, 1))', fontWeight: 700, color: C.ice, fontFamily: 'var(--font-display)' }}>
                {copy.profileTitle}
              </div>
              <div style={{ marginTop: 6, fontSize: 'calc(10px * var(--font-scale, 1))', color: C.ice50, lineHeight: 1.55 }}>
                {isZh ? '通过纬向平均观察不同纬度带的整体浓度差异。' : 'Use the zonal mean to compare field intensity across latitude bands.'}
              </div>
            </div>

            <div style={{ height: 280, borderRadius: 18, background: C.bgMuted, border: `1px solid ${C.border}`, overflow: 'hidden' }}>
              <Plot
                data={[
                  {
                    x: latProfile,
                    y: latitudes,
                    type: 'scatter',
                    mode: 'lines',
                    line: { color: C.blue, width: 3, shape: 'spline' },
                    fill: 'tozerox',
                    fillcolor: 'rgba(74,158,255,0.12)',
                    hovertemplate: 'Lat: %{y:.1f}°<br>Mean: %{x:.2f}<extra></extra>',
                  },
                ]}
                layout={{
                  ...chartTheme,
                  autosize: true,
                  xaxis: { gridcolor: isLight ? 'rgba(15,23,42,0.08)' : 'rgba(255,255,255,0.06)', zeroline: false, nticks: 4 },
                  yaxis: { gridcolor: isLight ? 'rgba(15,23,42,0.08)' : 'rgba(255,255,255,0.06)', zeroline: false, ticksuffix: '°', nticks: 5 },
                }}
                config={{ displayModeBar: false, responsive: true }}
                useResizeHandler
                style={{ width: '100%', height: '100%' }}
              />
            </div>
          </div>
        </div>
      </GlowCard>
    </div>
  );

  return createPortal(overlay, document.body);
}
