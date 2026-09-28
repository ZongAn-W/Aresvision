const DEG_TO_RAD = Math.PI / 180;
const MARS_OBLIQUITY_DEG = 25.19;

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeLongitude(value) {
  let result = value % 360;
  if (result > 180) result -= 360;
  if (result < -180) result += 360;
  return result;
}

function dayOfYear(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return null;
  return Math.floor((parsed.getTime() - Date.UTC(parsed.getUTCFullYear(), 0, 0)) / 86_400_000);
}

function parseEarthSunArgs(dateOrOptions, referenceHour = 12) {
  if (dateOrOptions && typeof dateOrOptions === 'object') {
    return {
      date: dateOrOptions.date,
      referenceHour: dateOrOptions.referenceHour ?? dateOrOptions.hour ?? 12,
    };
  }
  return { date: dateOrOptions, referenceHour };
}

function parseMarsSunArgs(lsOrOptions, referenceHour = 12) {
  if (lsOrOptions && typeof lsOrOptions === 'object') {
    return {
      solarLongitudeLs: lsOrOptions.Ls ?? lsOrOptions.ls ?? lsOrOptions.solarLongitudeLs,
      referenceHour: lsOrOptions.referenceHour ?? lsOrOptions.hour ?? 12,
    };
  }
  return { solarLongitudeLs: lsOrOptions, referenceHour };
}

function latitudeWeight(latitude) {
  if (!finite(latitude)) return 0;
  return Math.max(0, Math.cos(latitude * DEG_TO_RAD));
}

function defaultLatitudeCenter(row, rowCount) {
  return 90 - 90 / rowCount - row * (180 / rowCount);
}

export function fieldSpatialMean(fieldData, geometry = {}) {
  const field = Array.isArray(fieldData) ? fieldData : fieldData?.field;
  if (!Array.isArray(field) || !field.length) return null;
  const rowWeights = field.map((_, row) => latitudeWeight(
    geometry.latCenters?.[row] ?? defaultLatitudeCenter(row, field.length),
  ));
  if (!rowWeights.some(Boolean)) return null;
  let weighted = 0;
  let weights = 0;
  for (let row = 0; row < field.length; row += 1) {
    const weight = rowWeights[row];
    if (!weight) continue;
    for (const value of field[row] || []) {
      if (!finite(value)) continue;
      weighted += value * weight;
      weights += weight;
    }
  }
  return weights ? weighted / weights : null;
}

export function buildAnomalyField(fieldData, geometry = {}) {
  const mean = fieldSpatialMean(fieldData, geometry);
  const source = Array.isArray(fieldData) ? fieldData : fieldData?.field;
  const field = (source || []).map((row) => (row || []).map((value) => (
    finite(value) && finite(mean) ? value - mean : NaN
  )));
  const values = field.flat().filter(finite);
  const abs = Math.max(0, ...values.map((value) => Math.abs(value)));
  return {
    field,
    mean,
    minVal: values.length ? Math.min(...values) : 0,
    maxVal: values.length ? Math.max(...values) : 0,
    colorRange: { min: -abs, max: abs, centeredOnZero: true, scope: 'spatial-mean' },
  };
}

function crossing(a, b, level, aCoord, bCoord) {
  if (!finite(a) || !finite(b) || !finite(aCoord?.[0]) || !finite(aCoord?.[1]) || !finite(bCoord?.[0]) || !finite(bCoord?.[1])) return null;
  if (a === b) return null;
  const low = Math.min(a, b);
  const high = Math.max(a, b);
  if (level < low || level > high) return null;
  const ratio = clamp((level - a) / (b - a), 0, 1);
  return [
    aCoord[0] + (bCoord[0] - aCoord[0]) * ratio,
    aCoord[1] + (bCoord[1] - aCoord[1]) * ratio,
  ];
}

function globalLongitudeAxis(lonCenters) {
  if (!Array.isArray(lonCenters) || lonCenters.length < 3) return false;
  const span = Math.abs(lonCenters[lonCenters.length - 1] - lonCenters[0]);
  const step = Math.abs(lonCenters[1] - lonCenters[0]);
  return Number.isFinite(span) && Number.isFinite(step) && span + step >= 300;
}

function pointKey(point) {
  return `${point[0].toFixed(9)}:${point[1].toFixed(9)}`;
}

function pairContourPoints(points, corners, level) {
  const uniquePoints = [];
  const seen = new Set();
  points.forEach((point, edge) => {
    const key = pointKey(point);
    if (seen.has(key)) return;
    seen.add(key);
    uniquePoints.push({ point, edge });
  });
  if (uniquePoints.length < 2) return [];
  if (uniquePoints.length !== 4) {
    return uniquePoints.length === 2
      ? [[uniquePoints[0].point, uniquePoints[1].point]]
      : [];
  }
  // The bilinear asymptotic decider preserves topology even when the two
  // diagonal amplitudes are asymmetric; negating the field keeps the pairing.
  const offsets = corners.map(value => value - level);
  const magnitude = Math.max(...offsets.map(Math.abs));
  const scaled = offsets.map(value => value / magnitude);
  const diagonal = scaled[0] * scaled[2] - scaled[1] * scaled[3];
  const byEdge = new Map(uniquePoints.map((entry) => [entry.edge, entry.point]));
  const pairs = diagonal >= 0
    ? [[0, 1], [2, 3]]
    : [[0, 3], [1, 2]];
  return pairs.map(([first, second]) => [byEdge.get(first), byEdge.get(second)])
    .filter(([first, second]) => first && second);
}

/** Return short geographic contour segments; the renderer handles wrapping. */
export function buildContourSegments(fieldData, {
  levels = 6, latCenters = [], lonCenters = [], wrapLongitude = null,
} = {}) {
  const field = Array.isArray(fieldData) ? fieldData : fieldData?.field;
  if (!Array.isArray(field) || field.length < 2 || !Array.isArray(latCenters)
    || !Array.isArray(lonCenters) || latCenters.length !== field.length || lonCenters.length < 2
    || !latCenters.every(finite) || !lonCenters.every(finite)
    || field.some((row) => !Array.isArray(row) || row.length !== lonCenters.length)) return [];
  const finiteValues = field.flat().filter(finite);
  if (!finiteValues.length) return [];
  const fieldMin = finiteValues.length ? Math.min(...finiteValues) : 0;
  const fieldMax = finiteValues.length ? Math.max(...finiteValues) : 1;
  const requested = Array.isArray(levels)
    ? levels.filter(finite)
    : Array.from({ length: Math.max(2, Math.round(levels)) }, (_, index) => {
      const min = finite(fieldData?.minVal) ? fieldData.minVal : fieldMin;
      const max = finite(fieldData?.maxVal) ? fieldData.maxVal : fieldMax;
      return min + ((index + 1) / (Math.max(2, Math.round(levels)) + 1)) * (max - min);
    });
  const result = [];
  const wrap = wrapLongitude === null ? globalLongitudeAxis(lonCenters) : Boolean(wrapLongitude);
  for (const level of requested) {
    const columns = field[0]?.length || 0;
    for (let row = 0; row < field.length - 1; row += 1) {
      for (let col = 0; col < columns - (wrap ? 0 : 1); col += 1) {
        const nextCol = (col + 1) % columns;
        const corners = [
          field[row]?.[col], field[row]?.[nextCol],
          field[row + 1]?.[nextCol], field[row + 1]?.[col],
        ];
        if (!corners.every(finite)) continue;
        const topLeft = [latCenters[row], lonCenters[col]];
        const nextLongitude = nextCol === 0 ? lonCenters[nextCol] + 360 : lonCenters[nextCol];
        const topRight = [latCenters[row], nextLongitude];
        const bottomRight = [latCenters[row + 1], nextLongitude];
        const bottomLeft = [latCenters[row + 1], lonCenters[col]];
        const points = [
          crossing(corners[0], corners[1], level, topLeft, topRight),
          crossing(corners[1], corners[2], level, topRight, bottomRight),
          crossing(corners[2], corners[3], level, bottomRight, bottomLeft),
          crossing(corners[3], corners[0], level, bottomLeft, topLeft),
        ].filter(Boolean);
        pairContourPoints(points, corners, level)
          .forEach((segment) => result.push({ level, points: segment }));
      }
    }
  }
  return result;
}

export function buildWindVectors(uFieldData, vFieldData, {
  latCenters = [], lonCenters = [], scale = 0.24, stride = 1,
} = {}) {
  const uField = uFieldData?.field || uFieldData?.values;
  const vField = vFieldData?.field || vFieldData?.values;
  if (!Array.isArray(uField) || !Array.isArray(vField) || !latCenters.length || !lonCenters.length) return [];
  const vectors = [];
  const step = Math.max(1, Math.round(stride));
  for (let row = 0; row < Math.min(uField.length, vField.length, latCenters.length); row += step) {
    for (let col = 0; col < Math.min(uField[row]?.length || 0, vField[row]?.length || 0, lonCenters.length); col += step) {
      const u = uField[row]?.[col];
      const v = vField[row]?.[col];
      const latitude = latCenters[row];
      const longitude = lonCenters[col];
      if (!finite(u) || !finite(v) || !finite(latitude) || !finite(longitude)) continue;
      const start = [latCenters[row], lonCenters[col]];
      const speed = Math.hypot(u, v);
      if (!finite(speed) || speed <= Number.EPSILON) continue;
      const angularDistanceDegrees = Math.min(6, speed * (finite(scale) ? Math.abs(scale) : 0.24));
      const distance = angularDistanceDegrees * DEG_TO_RAD;
      const latitudeRad = latitude * DEG_TO_RAD;
      const longitudeRad = longitude * DEG_TO_RAD;
      const bearing = Math.atan2(u, v);
      const sinLat = Math.sin(latitudeRad);
      const cosLat = Math.cos(latitudeRad);
      const sinDistance = Math.sin(distance);
      const cosDistance = Math.cos(distance);
      const endLatitude = Math.asin(clamp(
        sinLat * cosDistance + cosLat * sinDistance * Math.cos(bearing),
        -1,
        1,
      ));
      const endLongitude = longitudeRad + Math.atan2(
        Math.sin(bearing) * sinDistance * cosLat,
        cosDistance - sinLat * Math.sin(endLatitude),
      );
      const end = [endLatitude / DEG_TO_RAD, normalizeLongitude(endLongitude / DEG_TO_RAD)];
      vectors.push({ start, end, speed, u, v, angularDistanceDegrees });
    }
  }
  return vectors;
}

export function earthSunDirection(dateOrOptions, referenceHour = 12) {
  const args = parseEarthSunArgs(dateOrOptions, referenceHour);
  const day = dayOfYear(args.date);
  if (day === null || !finite(args.referenceHour)) return null;
  const hour = args.referenceHour;
  const gamma = (2 * Math.PI / 365) * (day - 1 + (hour - 12) / 24);
  const declination = 0.006918
    - 0.399912 * Math.cos(gamma)
    + 0.070257 * Math.sin(gamma)
    - 0.006758 * Math.cos(2 * gamma)
    + 0.000907 * Math.sin(2 * gamma)
    - 0.002697 * Math.cos(3 * gamma)
    + 0.00148 * Math.sin(3 * gamma);
  const equationOfTimeMinutes = 229.18 * (
    0.000075 + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma)
    - 0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma)
  );
  const solarHour = hour + equationOfTimeMinutes / 60;
  const hourAngle = (12 - solarHour) * 15 * DEG_TO_RAD;
  return {
    x: Math.cos(declination) * Math.cos(hourAngle),
    y: Math.sin(declination),
    z: Math.cos(declination) * Math.sin(hourAngle),
  };
}

export function marsSunDirection(lsOrOptions = 0, referenceHour = 12) {
  const args = parseMarsSunArgs(lsOrOptions, referenceHour);
  const ls = Number(args.solarLongitudeLs);
  if (!finite(ls) || !finite(args.referenceHour)) return null;
  const declination = Math.asin(
    Math.sin(MARS_OBLIQUITY_DEG * DEG_TO_RAD) * Math.sin(ls * DEG_TO_RAD),
  );
  const hourAngle = (12 - args.referenceHour) * 15 * DEG_TO_RAD;
  return {
    x: Math.cos(declination) * Math.cos(hourAngle),
    y: Math.sin(declination),
    z: Math.cos(declination) * Math.sin(hourAngle),
  };
}

export function buildTerminatorDirection(options = {}) {
  if (typeof options === 'string') return earthSunDirection(options, 12);
  if (typeof options === 'number') return marsSunDirection(options, 12);
  if (options?.planet === 'earth' || options?.date) {
    return earthSunDirection({
      date: options.date,
      referenceHour: options.referenceHour ?? options.hour ?? 12,
    });
  }
  return marsSunDirection({
    solarLongitudeLs: options?.Ls ?? options?.ls ?? options?.solarLongitudeLs ?? 0,
    referenceHour: options?.referenceHour ?? options?.hour ?? 12,
  });
}

