/**
 * 地球底图（球面）常量与纯函数。
 *
 * 分层半径（与 SphericalFieldCanvas 现有约定一致，粒子层 baseRadius 为 0.9）：
 *   火星纹理球 0.86  <  地球底图球 0.86  ≤  海岸线 0.868  <  数据粒子壳 0.9
 * 海岸线半径必须严格大于地球球半径，否则会出现 z-fighting。
 *
 * 本模块不 import three：材质只返回普通 options 对象，由调用方构造。
 */

import { buildCoastlineSphereLines } from './sphericalRegionalGrid.js';

export const EARTH_GLOBE_RADIUS = 0.86;
export const EARTH_COASTLINE_RADIUS = 0.868;
export const EARTH_COASTLINE_URL = '/earth/ne_110m_coastline.geojson';

/**
 * 地球球体材质 options（深蓝→浅蓝）。
 * 只描述颜色/粗糙度等参数，不含贴图，不引用 /mars_texture.jpg。
 */
export function createEarthGlobeMaterial({ isLight = false } = {}) {
  return isLight
    ? {
      color: '#dceefb',
      emissive: '#2a5c86',
      emissiveIntensity: 0.16,
      roughness: 0.88,
      metalness: 0,
      shininess: 12,
      specular: '#7fb3d5',
    }
    : {
      color: '#123a63',
      emissive: '#061c33',
      emissiveIntensity: 0.3,
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
