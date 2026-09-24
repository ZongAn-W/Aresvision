/**
 * 地球底图（球面）常量与纯函数。
 *
 * 当前三维底球半径为 0.86，数据粒子基础半径为 0.872。
 * 三维渲染层使用 0.878 的独立海岸线，以下 0.868 工具默认值为兼容保留。
 *
 * 本模块不 import three：材质只返回普通 options 对象，由调用方构造；连续
 * equirectangular 纹理由 SphericalFieldCanvas 用本地 NASA 影像 CanvasTexture 提供，
 * 加载失败时回退到海洋渐变。
 */

import { buildCoastlineSphereLines } from './sphericalRegionalGrid.js';

export const EARTH_GLOBE_RADIUS = 0.86;
export const EARTH_COASTLINE_RADIUS = 0.868;
export const EARTH_COASTLINE_URL = '/earth/ne_110m_coastline.geojson';

/**
 * 地球球体材质 options（深蓝→浅蓝）。
 * 只描述颜色/粗糙度等参数，不引用火星纹理；实际连续纹理由渲染层挂载。
 */
export function createEarthGlobeMaterial({ isLight = false } = {}) {
  return isLight
    ? {
      color: '#dceefb',
      emissive: '#2a5c86',
      emissiveIntensity: 0.04,
      roughness: 0.88,
      metalness: 0,
      shininess: 12,
      specular: '#7fb3d5',
    }
    : {
      color: '#123a63',
      emissive: '#061c33',
      emissiveIntensity: 0.08,
      roughness: 0.72,
      metalness: 0.05,
      shininess: 18,
      specular: '#2f6f9e',
    };
}

/**
 * 拉取并校验海岸线 GeoJSON。
 * 非 FeatureCollection 抛描述性 Error；AbortError 原样透出（调用方据此忽略）。
 */
export async function fetchCoastlineGeoJson({
  signal,
  url = EARTH_COASTLINE_URL,
  fetchImpl,
} = {}) {
  const request = typeof fetchImpl === 'function'
    ? fetchImpl
    : (typeof fetch === 'function' ? fetch : null);
  if (!request) {
    throw new Error('fetchCoastlineGeoJson requires a fetch implementation');
  }
  const response = await request(url, { signal });
  if (!response || response.ok === false) {
    const status = response?.status;
    throw new Error(
      `Failed to load earth coastline GeoJSON from ${url}${Number.isFinite(status) ? ` (HTTP ${status})` : ''}`,
    );
  }
  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new Error(`Earth coastline GeoJSON at ${url} is not valid JSON`);
  }
  if (!payload || payload.type !== 'FeatureCollection' || !Array.isArray(payload.features)) {
    throw new Error(
      `Earth coastline GeoJSON at ${url} must be a GeoJSON FeatureCollection`,
    );
  }
  return payload;
}

/** 海岸线 FeatureCollection → 球面线段数组（buildCoastlineSphereLines 的薄封装）。 */
export function buildEarthBaseMapLines(geojson, { radius = EARTH_COASTLINE_RADIUS } = {}) {
  return buildCoastlineSphereLines(geojson, { radius, maxLonGap: 180 });
}
