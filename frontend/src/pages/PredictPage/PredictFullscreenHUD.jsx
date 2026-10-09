import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import Plot from 'react-plotly.js';
import SphericalFieldCanvas from '../../components/SphericalFieldCanvas';
import GlowCard from '../../components/GlowCard';
import C from '../../constants/colors';
import { useT } from '../../i18n';
import { fmtNum } from '../../utils/fmt';
import { convertOzone, ozoneDeltaLabel, ozoneLabel } from '../../utils/units';
import { useSettings } from '../../contexts/SettingsContext';
import { getRgbStr } from '../../utils/colormaps';
import { marsPredictionGrid } from './marsPredictionGrid';
import { activatePredictionDialog, fullscreenFieldModel } from './predictionDisplayModel';
import './predictionDisplay.css';

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
  adapter,
  results,
  activeHorizon = 0,
}) {
  const t = useT();
  const { settings } = useSettings();
  const colormapName = settings.colormap;
  const isLight = settings.theme === 'light';
  const isZh = settings?.language !== 'en';
  const dialogRef = useRef(null);
  const closeRef = useRef(() => setFullscreen3D(null));
  closeRef.current = () => setFullscreen3D(null);
  const grid = fullscreen3D ? (adapter?.grid?.(fullscreen3D.fieldData) || (!adapter && marsPredictionGrid(fullscreen3D.fieldData))) : null;
  useEffect(() => {
    if (!fullscreen3D || !grid || !dialogRef.current) return;
    return activatePredictionDialog(document, dialogRef.current, () => closeRef.current());
  }, [!!fullscreen3D, !!grid]);

  if (!fullscreen3D) return null;
  if (!grid) return null;

  const kind = fullscreen3D.kind || (fullscreen3D.colorMode === 'rdbu' ? 'residual'
    : fullscreen3D.fieldData === truthField ? 'truth' : 'prediction');
  const titleText = adapter?.fieldTitle?.(kind, isZh) || t(`predict.fullscreen3D.${kind}`);
  const currentStep = adapter?.stepLabel?.(results, activeHorizon) || (stepLs != null ? `Ls=${stepLs.toFixed(3)}°` : '');
  const convertValue = adapter?.convertValue || ((value) => convertOzone(value, ozoneUnit || settings.units.ozone));
  const isResidual = fullscreen3D.colorMode === 'rdbu';
  const model = fullscreenFieldModel(fullscreen3D.fieldData, grid, convertValue, isResidual);
  if (!model) return null;
  const displayPrecision = precision ?? settings.precision;
  const { nLat, nLon, heatmap: heatmapZ, profile: latProfile } = model;
  const minValStr = fmtNum(model.minimum, displayPrecision);
  const maxValStr = fmtNum(model.maximum, displayPrecision);
  const rangeStr = fmtNum(model.range, displayPrecision);
  const colorTitle = isResidual ? (adapter?.deltaUnit || ozoneDeltaLabel(ozoneUnit || settings.units.ozone))
    : (adapter?.unit || ozoneLabel(ozoneUnit || settings.units.ozone));
  const latitudes = grid.latitude;
  const longitudes = grid.longitude;
  const zmin = !isResidual && fullscreen3D.colorRange ? convertValue(fullscreen3D.colorRange.min) : model.colorMinimum;
  const zmax = !isResidual && fullscreen3D.colorRange ? convertValue(fullscreen3D.colorRange.max) : model.colorMaximum;
  const colorscale = Array.from({ length: 11 }, (_, index) => [index / 10,
    getRgbStr(isResidual ? 'rdbu' : colormapName, index / 10)]);
  const hoverPrecision = displayPrecision === 'full' ? '' : `.${displayPrecision}f`;

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
    title: adapter?.fullscreenLabel || (isZh ? '场分布全屏查看' : 'Expanded field view'),
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
      className="prediction-fullscreen"
      style={{ background: isLight ? 'rgba(15,23,42,0.18)' : 'rgba(2,6,23,0.62)', backdropFilter: 'blur(10px)' }}
      onDoubleClick={() => setFullscreen3D(null)}
    >
      <GlowCard
        className="prediction-fullscreen__dialog"
        style={{
          padding: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
          borderRadius: 28,
          background: isLight ? 'rgba(255,255,255,0.96)' : 'rgba(7,10,18,0.96)',
          border: `1px solid ${isLight ? 'rgba(15,23,42,0.08)' : 'rgba(255,255,255,0.08)'}`,
          boxShadow: isLight ? '0 24px 80px rgba(15,23,42,0.12)' : '0 30px 90px rgba(0,0,0,0.4)',
        }}
      >
        <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={copy.title} tabIndex={-1} data-testid="prediction-fullscreen"
          style={{ minHeight: '100%' }} onDoubleClick={(event) => event.stopPropagation()}>
          <div className="prediction-fullscreen__toolbar" style={{ display: 'flex', justifyContent: 'flex-end', padding: '8px 16px', position: 'sticky', top: 0, zIndex: 4, background: isLight ? '#fff' : '#070a12', borderBottom: `1px solid ${C.border}` }}>
            <button type="button" className="prediction-fullscreen__close" onClick={() => setFullscreen3D(null)}
              style={{ padding: '10px 14px', borderRadius: 10, border: `1px solid ${C.borderStrong}`, background: C.bgMuted, color: C.ice, cursor: 'pointer' }}>
              {copy.close} ×
            </button>
          </div>
        <div className="prediction-fullscreen__layout">
          <div className="prediction-fullscreen__info" style={{ background: isLight ? 'rgba(248,250,252,0.92)' : 'rgba(255,255,255,0.02)' }}>
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
                {currentStep}
              </div>
            </div>

            <div className="prediction-fullscreen__stats">
            <InfoCard label={t('predict.hud.maxValue')} value={maxValStr} hint={colorTitle} accent={C.mars} />
            <InfoCard label={t('predict.hud.minValue')} value={minValStr} hint={colorTitle} accent={C.green} />
            <InfoCard label={copy.range} value={rangeStr} hint={colorTitle} accent={C.blue} />
            <InfoCard label={copy.average} value={fmtNum(model.average, displayPrecision)} hint={colorTitle} accent={C.purple} />
            <InfoCard label={copy.resolution} value={`${nLon} × ${nLat}`} hint={isZh ? '服务端经纬度网格' : 'Server latitude / longitude grid'} accent={C.ice} />
            </div>
          </div>

          <div className="prediction-fullscreen__scene" style={{ background: isLight ? '#f8fafc' : '#030712' }}>
            <div style={{ position: 'absolute', top: 20, left: 20, zIndex: 2, padding: '8px 12px', borderRadius: 999, background: isLight ? 'rgba(255,255,255,0.82)' : 'rgba(7,10,18,0.72)', border: `1px solid ${C.border}`, color: C.ice, fontSize: 'calc(11px * var(--font-scale, 1))', fontWeight: 600 }}>
              {titleText}
            </div>
            {adapter?.renderField ? adapter.renderField({
              fieldData: fullscreen3D.fieldData, colorMode: fullscreen3D.colorMode,
              height: '100%', fullscreen: true, colorRange: fullscreen3D.colorRange, precision: displayPrecision,
            }) : <SphericalFieldCanvas
              fieldData={grid.sphericalFieldData}
              geometry={{ latCenters: grid.latitude, lonCenters: grid.longitude }}
              colorMode={fullscreen3D.colorMode}
              h="100%"
              zoom={3.25}
              showMars={false}
            />}
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

          <div className="prediction-fullscreen__charts" style={{ background: isLight ? 'rgba(248,250,252,0.88)' : 'rgba(255,255,255,0.02)' }}>
            <div className="prediction-fullscreen__chart-heading">
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
                    zsmooth: false,
                    colorscale,
                    zmin,
                    zmax,
                    showscale: false,
                    hovertemplate: `Lat: %{y:.1f}°<br>Lon: %{x:.1f}°<br>Val: %{z${hoverPrecision ? ':' + hoverPrecision : ''}} ${colorTitle}<extra></extra>`,
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

            <div className="prediction-fullscreen__chart-heading">
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
                    hovertemplate: `Lat: %{y:.1f}°<br>Mean: %{x${hoverPrecision ? ':' + hoverPrecision : ''}} ${colorTitle}<extra></extra>`,
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
        </div>
      </GlowCard>
    </div>
  );

  return createPortal(overlay, document.body);
}
