/**
 * 球面区域网格几何纯函数（v2 全球等经纬度 cell 网格）。
 *
 * 约定与 sphericalPicking.localPointToLatLng() 完全一致：
 *   phi   = lat * PI / 180
 *   theta = lon * PI / 180
 *   x = r * cos(phi) * cos(theta)
 *   y = r * sin(phi)
 *   z = r * cos(phi) * sin(theta)
 * 即 y 轴指向北极，经度 0 在 +x，经度 90 在 +z。
 *
 * 模块 scope 不 import three：只返回普通 TypedArray 与数字，便于在 Node 里单测。
 */

import {
  clippedCellEdges,
  nearestIndex,
  normalizeColorValue,
} from '../pages/DataOverviewPage/EarthOverview/earthMapGeometry.js';
import { getRgb, rdbuRgb } from '../utils/colormaps.js';

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
/** key 中坐标的取整精度：保证“形状相同但坐标不同”也能区分。 */
const KEY_PRECISION = 6;
/** 色带重映射 0..1 → rgb 0..255 的中点；非有限输入的统一兜底（128/255）。 */
const FALLBACK_COLOR_CHANNEL = 128 / 255;

/**
 * 单元颜色映射器：返回 **0..255** 的 rgb 三元组，供 `updateRegionalCellColors` 使用。
 *
 * 注意单位：色带函数本身返回 0..255，因此这里不再除以 255。把 0..1 的
 * 三元组交给 `updateRegionalCellColors`（它会再除一次）会得到近黑颜色，
 * 这正是 `mapRegionalRgb` 与 `SphericalFieldCanvas.mapParticleColor`
 * （后者返回 0..1，用于 `Points` 顶点色）必须分开的原因。
 */
export function mapRegionalRgb(colorMode, colormap, t) {
  return colorMode === 'rdbu' ? rdbuRgb(t) : getRgb(colormap, t);
}

function roundKey(value, precision = KEY_PRECISION) {
  if (!Number.isFinite(value)) return 'nan';
  const rounded = Number(value.toFixed(precision));
  return (Object.is(rounded, -0) ? 0 : rounded).toFixed(precision);
}

function toNumberArray(value, label) {
  if (value == null) throw new Error(`${label} is required`);
  const source = typeof value.length === 'number' ? Array.from(value) : null;
  if (!source || source.length === 0) {
    throw new Error(`${label} must be a non-empty array of numbers`);
  }
  return source.map((entry) => Number(entry));
}

function readFiniteNumber(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  return Number.NaN;
}

function resolveBounds(bounds, axis, label) {
  if (bounds == null) return [axis[0], axis[axis.length - 1]];
  const source = Array.isArray(bounds) || typeof bounds?.length === 'number'
    ? Array.from(bounds)
    : null;
  if (!source || source.length !== 2) {
    throw new Error(`${label} must be a [lower, upper] pair`);
  }
  const lower = readFiniteNumber(source[0]);
  const upper = readFiniteNumber(source[1]);
  if (!Number.isFinite(lower) || !Number.isFinite(upper)) {
    throw new Error(`${label} must contain finite numbers`);
  }
  return [lower, upper];
}

function resolveSubdivisions(subdivisions, label) {
  const source = Array.isArray(subdivisions) || typeof subdivisions?.length === 'number'
    ? Array.from(subdivisions)
    : null;
  if (!source || source.length !== 2) {
    throw new Error(`${label} must be a [latSubdivisions, lonSubdivisions] pair`);
  }
  return source.map((entry, index) => {
    const count = Number(entry);
    if (!Number.isInteger(count) || count < 1) {
      throw new Error(`${label}[${index}] must be a positive integer`);
    }
    return count;
  });
}

/** 经纬度（度）→ 球面直角坐标，与 localPointToLatLng() 同约定。 */
export function geographicToCartesian(lat, lon, radius = 1) {
  const phi = lat * DEG_TO_RAD;
  const theta = lon * DEG_TO_RAD;
  const r = Number.isFinite(radius) ? radius : 0;
  return {
    x: r * Math.cos(phi) * Math.cos(theta),
    y: r * Math.sin(phi),
    z: r * Math.cos(phi) * Math.sin(theta),
  };
}

/** 球面直角坐标 → 经纬度（度）；经度落在 [-180, 180]，原点返回 (0, 0)。 */
export function cartesianToGeographic(x, y, z) {
  const px = Number(x);
  const py = Number(y);
  const pz = Number(z);
  const safeX = Number.isFinite(px) ? px : 0;
  const safeY = Number.isFinite(py) ? py : 0;
  const safeZ = Number.isFinite(pz) ? pz : 0;
  const length = Math.hypot(safeX, safeY, safeZ);
  if (length === 0) return { lat: 0, lon: 0 };
  const lat = Math.asin(Math.max(-1, Math.min(1, safeY / length))) * RAD_TO_DEG;
  const rawLon = Math.atan2(safeZ, safeX) * RAD_TO_DEG;
  const lon = ((((rawLon + 180) % 360) + 360) % 360) - 180;
  return {
    lat: Object.is(lat, -0) ? 0 : lat,
    lon: Object.is(lon, -0) ? 0 : lon,
  };
}

function buildGeometryKey({
  latCenters,
  lonCenters,
  latBounds,
  lonBounds,
  wrapLongitude,
  radius,
  subdivisions,
}) {
  const latPart = latCenters.map((value) => roundKey(value)).join(',');
  const lonPart = lonCenters.map((value) => roundKey(value)).join(',');
  return [
    'regional-cells',
    `lat=${latPart}`,
    `lon=${lonPart}`,
    `latBounds=${roundKey(latBounds[0])},${roundKey(latBounds[1])}`,
    `lonBounds=${roundKey(lonBounds[0])},${roundKey(lonBounds[1])}`,
    `wrap=${wrapLongitude === true ? 1 : 0}`,
    `radius=${roundKey(radius)}`,
    `sub=${subdivisions[0]}x${subdivisions[1]}`,
  ].join('|');
}

/**
 * 规则经纬度中心网格 → 球面 cell 几何。
 *
 * 每个 cell 独立拥有 (nu+1)*(nv+1) 个顶点（顶点不跨 cell 共享），
 * 因此 -180 与 +180 是两个不同顶点，不会产生跨接缝的三角形。
 * 每个顶点都用自己的插值经纬度（度插值）单独调用 geographicToCartesian。
 */
export function buildRegionalCellGeometry({
  latCenters,
  lonCenters,
  latBounds,
  lonBounds,
  wrapLongitude = false,
  radius = 1,
  subdivisions = [2, 3],
} = {}) {
  const latAxis = toNumberArray(latCenters, 'latCenters');
  const lonAxis = toNumberArray(lonCenters, 'lonCenters');
  const resolvedLatBounds = resolveBounds(latBounds, latAxis, 'latBounds');
  const resolvedLonBounds = resolveBounds(lonBounds, lonAxis, 'lonBounds');
  const [latSubdivisions, lonSubdivisions] = resolveSubdivisions(subdivisions, 'subdivisions');
  const resolvedRadius = Number(radius);
  if (!Number.isFinite(resolvedRadius)) {
    throw new Error('radius must be a finite number');
  }

  const latEdges = clippedCellEdges(latAxis, resolvedLatBounds);
  const lonEdges = clippedCellEdges(lonAxis, resolvedLonBounds);
  const rowCount = latAxis.length;
  const colCount = lonAxis.length;
  const cellCount = rowCount * colCount;

  const verticesPerCell = (latSubdivisions + 1) * (lonSubdivisions + 1);
  const vertexCount = cellCount * verticesPerCell;
  const trianglesPerCell = latSubdivisions * lonSubdivisions * 2;
  const triangleCount = cellCount * trianglesPerCell;

  const positions = new Float32Array(vertexCount * 3);
  const indices = new Uint32Array(triangleCount * 3);
  const cellIndexByVertex = new Uint32Array(vertexCount);
  const cellCenters = new Array(cellCount);

  let vertexCursor = 0;
  let indexCursor = 0;

  for (let row = 0; row < rowCount; row += 1) {
    const south = latEdges[row];
    const north = latEdges[row + 1];
    const latStep = (north - south) / latSubdivisions;

    for (let col = 0; col < colCount; col += 1) {
      const west = lonEdges[col];
      const east = lonEdges[col + 1];
      const lonStep = (east - west) / lonSubdivisions;

      const cellIndex = row * colCount + col;
      const baseVertex = vertexCursor;

      for (let iu = 0; iu <= latSubdivisions; iu += 1) {
        // 最后一行直接取 north，避免浮点累加误差让极点差一点点。
        const lat = iu === latSubdivisions ? north : south + latStep * iu;
        for (let iv = 0; iv <= lonSubdivisions; iv += 1) {
          const lon = iv === lonSubdivisions ? east : west + lonStep * iv;
          const { x, y, z } = geographicToCartesian(lat, lon, resolvedRadius);
          const offset = vertexCursor * 3;
          positions[offset] = x;
          positions[offset + 1] = y;
          positions[offset + 2] = z;
          cellIndexByVertex[vertexCursor] = cellIndex;
          vertexCursor += 1;
        }
      }

      for (let iu = 0; iu < latSubdivisions; iu += 1) {
        for (let iv = 0; iv < lonSubdivisions; iv += 1) {
          const southWest = baseVertex + iu * (lonSubdivisions + 1) + iv;
          const southEast = southWest + 1;
          const northWest = southWest + (lonSubdivisions + 1);
          const northEast = northWest + 1;
          // 逆时针（从球外看）绕序：法线朝外，正面可见。
          indices[indexCursor] = southWest;
          indices[indexCursor + 1] = northWest;
          indices[indexCursor + 2] = northEast;
          indices[indexCursor + 3] = southWest;
          indices[indexCursor + 4] = northEast;
          indices[indexCursor + 5] = southEast;
          indexCursor += 6;
        }
      }

      cellCenters[cellIndex] = {
        lat: (south + north) / 2,
        lon: (west + east) / 2,
        row,
        col,
      };
    }
  }

  return {
    positions,
    indices,
    cellIndexByVertex,
    cellCount,
    cellCenters,
    vertexCount,
    triangleCount,
    key: buildGeometryKey({
      latCenters: latAxis,
      lonCenters: lonAxis,
      latBounds: resolvedLatBounds,
      lonBounds: resolvedLonBounds,
      wrapLongitude,
      radius: resolvedRadius,
      subdivisions: [latSubdivisions, lonSubdivisions],
    }),
  };
}

/**
 * cell 值 → 顶点 rgb（0..1）。值域用 normalizeColorValue 归一化，
 * 非常值 / 非有限输入落在色带中点 0.5，绝不产生 NaN。
 */
export function updateRegionalCellColors({ geometry, values, colorRange, colorMapper }) {
  const vertexCount = Number(geometry?.vertexCount) || 0;
  const cellIndexByVertex = geometry?.cellIndexByVertex;
  if (vertexCount <= 0 || !cellIndexByVertex || typeof cellIndexByVertex.length !== 'number') {
    throw new Error('geometry must be a valid regional cell geometry');
  }
  if (typeof colorMapper !== 'function') {
    throw new Error('colorMapper must be a function returning [r, g, b] in 0..255');
  }
  const min = Number(colorRange?.min);
  const max = Number(colorRange?.max);
  const flatValues = Array.isArray(values) || ArrayBuffer.isView(values) ? values : null;
  if (!flatValues || flatValues.length !== geometry.cellCount) {
    throw new Error(
      `values must have length ${geometry.cellCount} to match the regional grid`,
    );
  }

  const colors = new Float32Array(vertexCount * 3);
  const normalized = new Float32Array(geometry.cellCount);
  for (let cell = 0; cell < geometry.cellCount; cell += 1) {
    const value = Number(flatValues[cell]);
    const t = normalizeColorValue(value, min, max);
    // 值或值域非有限时 normalizeColorValue 返回 null：统一退回色带中点。
    normalized[cell] = Number.isFinite(t) ? t : 0.5;
  }

  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const cell = cellIndexByVertex[vertex];
    const t = cell < normalized.length ? normalized[cell] : 0.5;
    const rgb = colorMapper(t);
    const hasRgb = Array.isArray(rgb) || ArrayBuffer.isView(rgb);
    const offset = vertex * 3;
    for (let channel = 0; channel < 3; channel += 1) {
      const raw = Number(hasRgb ? rgb[channel] : Number.NaN) / 255;
      // 坏掉的 colorMapper 输出退回色带中点，绝不把 NaN 写进 buffer。
      colors[offset + channel] = Number.isFinite(raw)
        ? Math.max(0, Math.min(1, raw))
        : FALLBACK_COLOR_CHANNEL;
    }
  }

  return colors;
}

/** 二维 field → 行主序 flat 值数组；非矩形 / 长度不符 / 非有限值都会抛错。 */
export function buildRegionalCellSampleValues(field, cellCount) {
  const expected = Number(cellCount);
  if (!Number.isInteger(expected) || expected <= 0) {
    throw new Error('cellCount must be a positive integer');
  }
  const rows = field == null ? null : Array.from(field);
  if (!rows || rows.length === 0) {
    throw new Error('field must be a non-empty rectangular 2D array');
  }
  const rowLength = rows[0] == null ? 0 : rows[0].length;
  if (!rowLength) {
    throw new Error('field rows must be non-empty');
  }
  for (let row = 0; row < rows.length; row += 1) {
    if (rows[row] == null || rows[row].length !== rowLength) {
      throw new Error(`field must be rectangular: row ${row} has a different length`);
    }
  }
  if (rows.length * rowLength !== expected) {
    throw new Error(
      `field shape ${rows.length}x${rowLength} does not match cellCount ${expected}`,
    );
  }

  const values = new Float32Array(expected);
  for (let row = 0; row < rows.length; row += 1) {
    for (let col = 0; col < rowLength; col += 1) {
      const raw = Number(rows[row][col]);
      if (!Number.isFinite(raw)) {
        throw new Error(`field value at row ${row}, column ${col} is not a finite number`);
      }
      values[row * rowLength + col] = raw;
    }
  }
  return values;
}

/** 经纬度 → 最近 cell（返回 CENTRE 经纬度与行列）；越界返回 null，不做经度环绕。 */
export function nearestRegionalCell({
  latCenters,
  lonCenters,
  latBounds = null,
  lonBounds = null,
  lat,
  lon,
} = {}) {
  const latAxis = Array.isArray(latCenters) ? latCenters : null;
  const lonAxis = Array.isArray(lonCenters) ? lonCenters : null;
  if (!latAxis || !lonAxis || latAxis.length === 0 || lonAxis.length === 0) {
    return null;
  }
  const row = nearestIndex(latAxis, lat, latBounds);
  if (row === null) return null;
  const col = nearestIndex(lonAxis, lon, lonBounds);
  if (col === null) return null;
  return { row, col, lat: latAxis[row], lon: lonAxis[col] };
}

/**
 * GeoJSON 海岸线 → 球面线段 Float32Array 数组。
 * 相邻经度差超过 maxLonGap 时断开；不隐式闭合；非有限坐标跳过。
 */
export function buildCoastlineSphereLines(geojson, { radius = 1, maxLonGap = 180 } = {}) {
  const features = Array.isArray(geojson?.features) ? geojson.features : [];
  const resolvedRadius = Number.isFinite(Number(radius)) ? Number(radius) : 1;
  const gap = Number.isFinite(Number(maxLonGap)) ? Number(maxLonGap) : 180;
  const lines = [];

  for (const feature of features) {
    const geometry = feature?.geometry;
    if (!geometry) continue;
    const { type, coordinates } = geometry;
    if (type !== 'LineString' && type !== 'MultiLineString') continue;
    const parts = type === 'MultiLineString' ? coordinates : [coordinates];
    if (!Array.isArray(parts)) continue;

    for (const part of parts) {
      if (!Array.isArray(part)) continue;
      const points = [];
      let previousLon = null;

      const flush = () => {
        if (points.length === 0) return;
        lines.push(Float32Array.from(points));
        points.length = 0;
      };

      for (const coordinate of part) {
        if (!Array.isArray(coordinate) || coordinate.length < 2) continue;
        const lon = readFiniteNumber(coordinate[0]);
        const lat = readFiniteNumber(coordinate[1]);
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
        if (previousLon !== null && Math.abs(lon - previousLon) > gap) {
          flush();
        }
        const { x, y, z } = geographicToCartesian(lat, lon, resolvedRadius);
        points.push(x, y, z);
        previousLon = lon;
      }
      flush();
    }
  }

  return lines;
}
