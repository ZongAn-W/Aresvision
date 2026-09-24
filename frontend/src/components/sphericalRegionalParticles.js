import {
  clippedCellEdges,
  normalizeColorValue,
} from '../pages/DataOverviewPage/EarthOverview/earthMapGeometry.js';
import { geographicToCartesian } from './sphericalRegionalGrid.js';

// These weights affect drawing only. Queries and statistics keep the original cells.
function interpolationBracket(axis, coordinate, periodic = false) {
  const last = axis.length - 1;
  if (last === 0) return [0, 0, 0];
  if (periodic && (coordinate < axis[0] || coordinate > axis[last])) {
    const wrapped = coordinate < axis[0] ? coordinate + 360 : coordinate;
    return [last, 0, (wrapped - axis[last]) / (axis[0] + 360 - axis[last])];
  }
  if (coordinate <= axis[0]) return [0, 0, 0];
  if (coordinate >= axis[last]) return [last, last, 0];
  let low = 0;
  let high = last;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (axis[middle] <= coordinate) low = middle;
    else high = middle;
  }
  return [low, high, (coordinate - axis[low]) / (axis[high] - axis[low])];
}

/** Stable particles inside actual cells; values are applied later to color and radius. */
export function buildRegionalParticleGeometry({
  latCenters, lonCenters, latBounds, lonBounds, particleDensity = 120, radius = 0.9,
}) {
  const latEdges = clippedCellEdges(latCenters, latBounds);
  const lonEdges = clippedCellEdges(lonCenters, lonBounds);
  const density = Math.max(1, Math.round(particleDensity));
  const cellCount = latCenters.length * lonCenters.length;
  const vertexCount = cellCount * density;
  const positions = new Float32Array(vertexCount * 3);
  const directions = new Float32Array(vertexCount * 3);
  const cellIndexByVertex = new Uint32Array(vertexCount);
  const sampleIndexes = new Uint32Array(vertexCount * 4);
  const sampleWeights = new Float32Array(vertexCount * 4);
  const polarBlend = new Float32Array(vertexCount);
  const polarRow = new Uint8Array(vertexCount);
  const columns = lonCenters.length;
  const lastRow = latCenters.length - 1;
  const periodic = Math.abs(lonBounds[1] - lonBounds[0] - 360) < 1e-6;
  let seed = 123456789;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return (seed + 0.5) / 4294967296;
  };
  for (let row = 0; row < latCenters.length; row += 1) {
    // Sample uniformly in area within each cell, including polar caps.
    const sinMin = Math.sin(latEdges[row] * Math.PI / 180);
    const sinMax = Math.sin(latEdges[row + 1] * Math.PI / 180);
    for (let col = 0; col < lonCenters.length; col += 1) {
      const cell = row * lonCenters.length + col;
      for (let sample = 0; sample < density; sample += 1) {
        const vertex = cell * density + sample;
        const lat = Math.asin(sinMin + random() * (sinMax - sinMin)) * 180 / Math.PI;
        const lon = lonEdges[col] + random() * (lonEdges[col + 1] - lonEdges[col]);
        const direction = geographicToCartesian(lat, lon, 1);
        const offset = vertex * 3;
        directions.set([direction.x, direction.y, direction.z], offset);
        positions.set([direction.x * radius, direction.y * radius, direction.z * radius], offset);
        cellIndexByVertex[vertex] = cell;
        const [south, north, fy] = interpolationBracket(latCenters, lat);
        const [west, east, fx] = interpolationBracket(lonCenters, lon, periodic);
        sampleIndexes.set([south * columns + west, south * columns + east, north * columns + west, north * columns + east], vertex * 4);
        sampleWeights.set([(1 - fy) * (1 - fx), (1 - fy) * fx, fy * (1 - fx), fy * fx], vertex * 4);
        // All longitudes meet at a pole: blend the last half-cell into its row mean.
        if (periodic && latBounds[0] === -90 && lat < latCenters[0]) {
          polarRow[vertex] = 1;
          polarBlend[vertex] = (latCenters[0] - lat) / (latCenters[0] + 90);
        } else if (periodic && latBounds[1] === 90 && lat > latCenters[lastRow]) {
          polarRow[vertex] = 2;
          polarBlend[vertex] = (lat - latCenters[lastRow]) / (90 - latCenters[lastRow]);
        }
      }
    }
  }
  return { positions, directions, cellIndexByVertex, cellCount, vertexCount, radius, sampleIndexes, sampleWeights, polarBlend, polarRow, columns };
}

/**
 * Move every particle along its true cell normal using the same normalized
 * value-to-height mapping as the Mars particle field.
 *
 * Sequential variables use [0, heightScale]. Signed wind variables use a
 * zero-centred range so positive and negative values sit on opposite sides of
 * the base shell.
 */
export function updateRegionalParticlePositions({
  geometry,
  values,
  colorRange,
  positions,
  colors = null,
  colorMapper = null,
  baseRadius = Number(geometry?.radius) || 0.9,
  heightScale = 0.225,
  signed = false,
} = {}) {
  const vertexCount = Number(geometry?.vertexCount) || 0;
  const cellCount = Number(geometry?.cellCount) || 0;
  const directions = geometry?.directions;
  const cellIndexByVertex = geometry?.cellIndexByVertex;
  const flatValues = Array.isArray(values) || ArrayBuffer.isView(values) ? values : null;
  if (vertexCount <= 0 || cellCount <= 0 || !directions || !cellIndexByVertex || !positions) {
    throw new Error('geometry and positions must be valid regional particle buffers');
  }
  if (!flatValues || flatValues.length !== cellCount) {
    throw new Error(`values must have length ${cellCount} to match the regional particle geometry`);
  }

  const min = Number(colorRange?.min);
  const max = Number(colorRange?.max);
  const { sampleIndexes, sampleWeights, polarBlend, polarRow, columns } = geometry;
  const poleMeans = [0, 0, 0];
  for (let column = 0; column < columns; column += 1) {
    poleMeans[1] += Number(flatValues[column]) / columns;
    poleMeans[2] += Number(flatValues[cellCount - columns + column]) / columns;
  }

  const safeBaseRadius = Number.isFinite(baseRadius) ? baseRadius : 0.9;
  const safeHeightScale = Number.isFinite(heightScale) ? heightScale : 0.225;
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    let value = 0;
    for (let corner = 0; corner < 4; corner += 1) {
      const sample = vertex * 4 + corner;
      value += Number(flatValues[sampleIndexes[sample]]) * sampleWeights[sample];
    }
    if (polarRow[vertex]) {
      value += (poleMeans[polarRow[vertex]] - value) * polarBlend[vertex];
    }
    const normalized = normalizeColorValue(value, min, max);
    const t = Number.isFinite(normalized) ? normalized : 0.5;
    const heightOffset = signed ? (t - 0.5) * 0.3 : t * safeHeightScale;
    const radius = safeBaseRadius + heightOffset;
    const offset = vertex * 3;
    positions[offset] = radius * directions[offset];
    positions[offset + 1] = radius * directions[offset + 1];
    positions[offset + 2] = radius * directions[offset + 2];
    if (colors && colorMapper) {
      const rgb = colorMapper(t);
      for (let channel = 0; channel < 3; channel += 1) {
        const component = Number(rgb?.[channel]) / 255;
        colors[offset + channel] = Number.isFinite(component) ? Math.max(0, Math.min(1, component)) : 0.5;
      }
    }
  }
  return { count: vertexCount, min, max };
}
