import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useT } from '../../../i18n/index.js';
import { useSettings } from '../../../contexts/SettingsContext';
import { drawEarthRaster } from './earthMapRaster.js';
import {
  VIEWBOX_HEIGHT,
  VIEWBOX_WIDTH,
  coastlinePaths,
  coverageRect,
  nearestIndex,
  pointInsideCoverage,
  unproject,
} from './earthMapGeometry.js';

const COASTLINE_URL = '/earth/ne_110m_coastline.geojson';

/** 只从本地静态资源加载底图；失败可重试，绝不回退到在线 CDN。 */
function useCoastline() {
  const [paths, setPaths] = useState([]);
  const [status, setStatus] = useState('loading');
  const [attempt, setAttempt] = useState(0);
  const abortRef = useRef(null);

  useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus('loading');
    fetch(COASTLINE_URL, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((geojson) => {
        if (controller.signal.aborted) return;
        setPaths(coastlinePaths(geojson));
        setStatus('ready');
      })
      .catch((error) => {
        if (error?.name === 'AbortError') return;
        setPaths([]);
        setStatus('failed');
      });
    return () => controller.abort();
  }, [attempt]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  return { paths, status, retry };
}

/**
 * 二维等经纬度区域热力图。
 *
 * 只接收已校验的 field payload 与选择状态，不自行请求数据，也不读取火星 context。
 */
export default function EarthMap2D({
  field,
  selectedPoint,
  colormap,
  onPointSelect,
  onOutOfCoverage,
}) {
  const t = useT();
  const { settings } = useSettings();
  const isLight = settings?.theme === 'light';
  const svgRef = useRef(null);
  const canvasRef = useRef(null);
  const clipId = `${useId()}-coverage`;
  const patternId = `${useId()}-nodata`;
  const { paths: coastline, status: coastlineStatus, retry } = useCoastline();

  const coverage = field?.coverage ?? null;
  const colorMin = field?.color_range?.min;
  const colorMax = field?.color_range?.max;

  useEffect(() => {
    const context = canvasRef.current?.getContext('2d');
    if (context) drawEarthRaster(context, field, colormap);
  }, [field, colorMin, colorMax, colormap]);

  const marker = useMemo(() => {
    if (!selectedPoint || !Number.isFinite(selectedPoint.lat) || !Number.isFinite(selectedPoint.lon)) {
      return null;
    }
    return { x: selectedPoint.lon + 180, y: 90 - selectedPoint.lat };
  }, [selectedPoint]);

  const handleClick = useCallback((event) => {
    const svg = svgRef.current;
    if (!svg || !coverage) return;
    const matrix = svg.getScreenCTM();
    if (!matrix) return;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    const { lon, lat } = unproject(point.x, point.y);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

    if (!pointInsideCoverage(coverage, lat, lon)) {
      // 区域外不请求点位接口，也不移动已选点。
      onOutOfCoverage?.({ lat, lon });
      return;
    }
    const latIndex = nearestIndex(field.lat, lat, coverage.latitude_range);
    const lonIndex = nearestIndex(field.lon, lon, coverage.longitude_range);
    if (latIndex === null || lonIndex === null) {
      onOutOfCoverage?.({ lat, lon });
      return;
    }
    // 先前端快速吸附到最近采样点，最终位置以接口返回的 grid_point 为准。
    onPointSelect?.({
      requested: { lat, lon },
      preview: field.source_grid_shape
        ? { lat, lon } // The display's block centres must not select a different source cell.
        : { lat: field.lat[latIndex], lon: field.lon[lonIndex], latIndex, lonIndex },
    });
  }, [coverage, field?.lat, field?.lon, onOutOfCoverage, onPointSelect]);

  const noDataStroke = isLight ? 'rgba(15,23,42,0.14)' : 'rgba(148,163,184,0.22)';
  const gridStroke = isLight ? 'rgba(15,23,42,0.16)' : 'rgba(148,163,184,0.18)';
  const coastlineStroke = isLight ? 'rgba(15,23,42,0.62)' : 'rgba(226,232,240,0.72)';

  return (
    <div className="earth-map2d">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
        className="earth-map2d__svg"
        role="img"
        aria-label={t('earthOverview.map.label')}
        data-testid="earth-map-svg"
        onClick={handleClick}
      >
        <defs>
          <clipPath id={clipId}>
            {coverage ? (() => {
              const rect = coverageRect(coverage);
              return <rect x={rect.x} y={rect.y} width={rect.width} height={rect.height} />;
            })() : null}
          </clipPath>
          <pattern
            id={patternId}
            width="6"
            height="6"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width="6" height="6" fill={isLight ? '#eef2f7' : '#0d1420'} />
            <line x1="0" y1="0" x2="0" y2="6" stroke={noDataStroke} strokeWidth="1.2" />
          </pattern>
        </defs>

        {/* 1. 无数据底层：全球范围都先画斜纹，表示"区域外无数据" */}
        <rect
          x="0"
          y="0"
          width={VIEWBOX_WIDTH}
          height={VIEWBOX_HEIGHT}
          fill={`url(#${patternId})`}
        />

        {/* The field uses one raster node at every resolution; SVG keeps the overlays and hit testing. */}
        <foreignObject x="0" y="0" width={VIEWBOX_WIDTH} height={VIEWBOX_HEIGHT} pointerEvents="none">
          <canvas ref={canvasRef} width="1440" height="720" data-testid="earth-map-canvas"
            style={{ width: '100%', height: '100%', display: 'block' }} />
        </foreignObject>

        {/* 3. 经纬网 + 海岸线（不遮挡点击） */}
        <g className="earth-map2d__graticule" pointerEvents="none">
          {[-120, -60, 0, 60, 120].map((lat) => (
            <line key={`lat-${lat}`} x1="0" y1={90 - lat} x2={VIEWBOX_WIDTH} y2={90 - lat} stroke={gridStroke} strokeWidth="0.4" />
          ))}
          {[-120, -60, 0, 60, 120, 180].map((lon) => (
            <line key={`lon-${lon}`} x1={lon + 180} y1="0" x2={lon + 180} y2={VIEWBOX_HEIGHT} stroke={gridStroke} strokeWidth="0.4" />
          ))}
          <line x1="0" y1="90" x2={VIEWBOX_WIDTH} y2="90" stroke={gridStroke} strokeWidth="0.7" />
        </g>

        <g className="earth-map2d__coastline" pointerEvents="none">
          {coastline.map((path, index) => (
            <path
              key={`coast-${index}`}
              d={path}
              fill="none"
              stroke={coastlineStroke}
              strokeWidth="0.5"
            />
          ))}
        </g>

        {/* 4. 区域边界与选中点 */}
        <g pointerEvents="none">
          {coverage ? (() => {
            const rect = coverageRect(coverage);
            return (
              <rect
                x={rect.x}
                y={rect.y}
                width={rect.width}
                height={rect.height}
                fill="none"
                stroke={isLight ? '#0f766e' : '#5eead4'}
                strokeWidth="0.8"
                strokeDasharray="3 2"
                data-testid="earth-map-coverage-outline"
              />
            );
          })() : null}
          {marker ? (
            <g data-testid="earth-map-marker">
              <circle cx={marker.x} cy={marker.y} r="3.4" fill="none" stroke="#f97316" strokeWidth="1.1" />
              <circle cx={marker.x} cy={marker.y} r="1.3" fill="#f97316" />
            </g>
          ) : null}
        </g>
      </svg>

      {coastlineStatus !== 'ready' ? (
        <div className="earth-map2d__basemap-note" role="status">
          <span>
            {coastlineStatus === 'failed'
              ? t('earthOverview.map.basemapFailed')
              : t('earthOverview.map.basemapLoading')}
          </span>
          {coastlineStatus === 'failed' ? (
            <button type="button" onClick={retry}>{t('earthOverview.actions.retry')}</button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export { COASTLINE_URL };
