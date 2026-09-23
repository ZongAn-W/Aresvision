/**
 * 二维地球等经纬度投影与网格几何纯函数。
 *
 * 使用 viewBox="0 0 360 180"（2:1），经度 -180..180 → x 0..360，
 * 纬度 90..-90 → y 0..180。全部经度运算都不环绕。
 */

export const VIEWBOX_WIDTH = 360;
export const VIEWBOX_HEIGHT = 180;

export function project(lon, lat) {
  return { x: lon + 180, y: 90 - lat };
}

export function unproject(x, y) {
  return { lon: x - 180, lat: 90 - y };
}

/**
 * 规则网格中心 → 格子边界；最外侧边界裁到声明覆盖端点。
 * 不补首尾重复列，也不做环绕；v2 的声明端点来自真实 cell bounds。
 */
export function clippedCellEdges(values, coverageRange = null) {
  if (
    !Array.isArray(values)
    || values.length < 2
    || values.some((v, i) => !Number.isFinite(v) || (i > 0 && v <= values[i - 1]))
  ) {
    throw new Error('Invalid ascending coordinate axis');
  }
  const lower = Array.isArray(coverageRange) && coverageRange.length === 2
    && Number.isFinite(coverageRange[0]) ? coverageRange[0] : values[0];
  const upper = Array.isArray(coverageRange) && coverageRange.length === 2
    && Number.isFinite(coverageRange[1]) ? coverageRange[1] : values[values.length - 1];
  if (upper <= lower || lower > values[0] || upper < values[values.length - 1]) {
    throw new Error('Invalid coverage bounds');
  }
  return [
    lower,
    ...values.slice(1).map((v, i) => (values[i] + v) / 2),
    upper,
  ];
}

export function gridCellRect(latEdges, lonEdges, row, col) {
  const south = latEdges[row];
  const north = latEdges[row + 1];
  const west = lonEdges[col];
  const east = lonEdges[col + 1];
  return { x: west + 180, y: 90 - north, width: east - west, height: north - south };
}

/** 最近采样点；同距离取较小下标，越界不夹取。 */
export function nearestIndex(axis, value, coverageRange = null) {
  if (!Array.isArray(axis) || axis.length === 0) return null;
  const lower = Array.isArray(coverageRange) ? coverageRange[0] : axis[0];
  const upper = Array.isArray(coverageRange) ? coverageRange[1] : axis[axis.length - 1];
  if (!Number.isFinite(value) || value < lower || value > upper) return null;
  let best = 0;
  let bestDistance = Math.abs(axis[0] - value);
  for (let i = 1; i < axis.length; i += 1) {
    const distance = Math.abs(axis[i] - value);
    if (distance < bestDistance) {
      best = i;
      bestDistance = distance;
    }
  }
  return best;
}

/** 网格坐标 → 归一化颜色位置；常数场使用色带中点，不除以零。 */
export function normalizeColorValue(value, min, max) {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max)) return null;
  if (max === min) return 0.5;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

/**
 * GeoJSON LineString → SVG path 段数组。
 * 相邻经度差大于 180° 时断开为新的子路径（跨 ±180° 不连线），末点不自动闭合。
 */
export function splitCoastline(lineString) {
  if (!Array.isArray(lineString) || lineString.length < 2) return [];
  const segments = [];
  let current = [];
  let previousLon = null;

  for (const point of lineString) {
    if (!Array.isArray(point) || point.length < 2) continue;
    const [lon, lat] = point;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    if (previousLon !== null && Math.abs(lon - previousLon) > 180) {
      if (current.length >= 2) segments.push(current);
      current = [];
    }
    const { x, y } = project(lon, lat);
    current.push([x, y]);
    previousLon = lon;
  }
  if (current.length >= 2) segments.push(current);
  return segments;
}

export function segmentsToPath(segments) {
  return segments
    .map((segment) => segment
      .map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(3)} ${y.toFixed(3)}`)
      .join(' '))
    .join(' ');
}

/** GeoJSON FeatureCollection → 可直接渲染的 path 字符串数组。 */
export function coastlinePaths(geojson) {
  const features = Array.isArray(geojson?.features) ? geojson.features : [];
  const paths = [];
  for (const feature of features) {
    const geometry = feature?.geometry;
    if (!geometry) continue;
    const lines = geometry.type === 'MultiLineString' ? geometry.coordinates : [geometry.coordinates];
    if (geometry.type !== 'LineString' && geometry.type !== 'MultiLineString') continue;
    for (const line of lines) {
      const path = segmentsToPath(splitCoastline(line));
      if (path) paths.push(path);
    }
  }
  return paths;
}

/** 覆盖范围矩形（用于保障性 clip 图层）。 */
export function coverageRect(coverage) {
  const [south, north] = coverage.latitude_range;
  const [west, east] = coverage.longitude_range;
  const topLeft = project(west, north);
  return {
    x: topLeft.x,
    y: topLeft.y,
    width: east - west,
    height: north - south,
  };
}

export function pointInsideCoverage(coverage, lat, lon) {
  const [south, north] = coverage.latitude_range;
  const [west, east] = coverage.longitude_range;
  return Number.isFinite(lat) && Number.isFinite(lon)
    && lat >= south && lat <= north
    && lon >= west && lon <= east;
}
