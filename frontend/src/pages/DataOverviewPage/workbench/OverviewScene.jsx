/**
 * 共用三维场景壳层。
 *
 * 只做适配：把 adapter 提供的真实坐标几何、当前场、选中点和光照模式交给
 * 同一个 SphericalFieldCanvas。Mars 继续走原有纹理、太阳光照与 Ls 逻辑；
 * Earth 使用 v2 全球 5°×5° 单元边界、固定展示光照，并显式声明不使用 Ls。
 *
 * WebGL 不可用时显示由调用方提供的二维降级视图，并说明降级原因。
 */

import React, { useEffect, useMemo, useState } from 'react';
import C from '../../../constants/colors';
import SphericalFieldCanvas from '../../../components/SphericalFieldCanvas';
import { useOverviewLayout } from './OverviewShell.jsx';
import { OVERVIEW_GLOBE } from './overviewVisualContract.js';

export function detectWebglSupport() {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgl2') || canvas.getContext('webgl');
    const supported = Boolean(context);
    context?.getExtension('WEBGL_lose_context')?.loseContext();
    return supported;
  } catch {
    return false;
  }
}

/**
 * 三维场身份：星球 + 几何 + 变量 + 日期。相同身份不重建几何，只更新颜色。
 */
export function sceneFieldIdentity({ planet, geometry, variable, date }) {
  const lat = geometry?.latCenters?.length ?? 0;
  const lon = geometry?.lonCenters?.length ?? 0;
  const lat0 = geometry?.latCenters?.[0] ?? 'x';
  const lon0 = geometry?.lonCenters?.[0] ?? 'x';
  return [planet, lat, lon, lat0, lon0, variable, date].join('|');
}

export default function OverviewScene({
  planet = 'mars',
  field = null,
  geometry = null,
  selection = null,
  lighting = 'fixed',
  colormap = 'inferno',
  showField = true,
  showGeoAnnotations = true,
  showBaseMap = true,
  autoRotate = false,
  sceneKey = '',
  poseKey = null,
  restoreCameraPose = true,
  onGlobeClick = null,
  fallback = null,
  children = null,
  legacyProps = null,
  isLight = false,
  isZh = true,
}) {
  const { offsetX } = useOverviewLayout();
  const [webglOk, setWebglOk] = useState(true);

  useEffect(() => {
    setWebglOk(detectWebglSupport());
  }, []);

  const identity = useMemo(
    () => sceneFieldIdentity({
      planet,
      geometry,
      variable: field?.variable ?? null,
      date: field?.date ?? null,
    }),
    [planet, geometry, field?.variable, field?.date],
  );

  if (!webglOk) {
    return (
      <div style={{ position: 'absolute', inset: 0, display: 'grid', gridTemplateRows: 'auto 1fr' }}>
        <p
          role="status"
          style={{
            margin: 0,
            padding: '6px 12px',
            color: C.mars,
            fontFamily: 'var(--font-body)',
            fontSize: 'calc(11px * var(--font-scale, 1))',
            background: isLight ? 'rgba(255,255,255,0.86)' : 'rgba(10,12,18,0.72)',
          }}
        >
          {isZh
            ? '当前浏览器不支持 WebGL，已切换到二维地图显示；日期、变量与点位选择保持不变。'
            : 'WebGL is unavailable in this browser, so the 2D map is shown instead. Date, variable and point selection are preserved.'}
        </p>
        <div style={{ position: 'relative', overflow: 'auto' }}>{fallback}</div>
      </div>
    );
  }

  if (planet === 'earth') {
    return (
      <div style={{ position: 'absolute', inset: 0 }} data-scene-identity={identity} data-scene-key={sceneKey}>
        <SphericalFieldCanvas
          key={sceneKey || identity}
          planet="earth"
          field={showField ? field : null}
          geometry={geometry}
          selection={selection}
          lighting={lighting}
          colorMode={colormap}
          offsetX={offsetX}
          showGeoAnnotations={showGeoAnnotations}
          showBaseMap={showBaseMap}
          autoRotate={autoRotate}
          zoom={OVERVIEW_GLOBE.zoom}
          forceFullscreen
          poseKey={poseKey}
          restoreCameraPose={restoreCameraPose}
          showConcentration={showField}
          showMars={false}
          particleDensity={OVERVIEW_GLOBE.particleDensity}
          particleSize={OVERVIEW_GLOBE.particleSize}
          pointParticleSize={OVERVIEW_GLOBE.pointParticleSize}
          particlePalette={OVERVIEW_GLOBE.palette}
          globeMaterial="shared"
          lightingMode="fixed"
          onGlobeClick={onGlobeClick}
        />
        {children}
      </div>
    );
  }

  // Mars 兼容路径：原有调用方继续传旧 props。
  return (
    <div style={{ position: 'absolute', inset: 0 }} data-scene-identity={identity} data-scene-key={sceneKey}>
      <SphericalFieldCanvas
        ref={legacyProps?.canvasRef}
        forceFullscreen
        {...legacyProps}
        onGlobeClick={onGlobeClick}
      />
      {children}
    </div>
  );
}
