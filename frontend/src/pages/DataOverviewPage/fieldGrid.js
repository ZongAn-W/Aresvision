const DEFAULT_LAT_COUNT = 36;
const DEFAULT_LON_COUNT = 72;
const LAT_MAX = 87.5;
const LAT_STEP = 5;
const LON_MIN = -180;
const LON_STEP = 5;

function roundCellIndex(value, min, step, maxIndex) {
  const index = Math.round((value - min) / step);
  if (!Number.isFinite(index) || index < 0 || index > maxIndex) return -1;
  return index;
}

export function pointsToFieldData(layer, options = {}) {
  if (!layer?.points?.length) return null;

  const latCount = options.latCount || DEFAULT_LAT_COUNT;
  const lonCount = options.lonCount || DEFAULT_LON_COUNT;
  const field = Array(latCount).fill(0).map(() => Array(lonCount).fill(NaN));

  layer.points.forEach((point) => {
    if (!Number.isFinite(point?.lat) || !Number.isFinite(point?.lng) || !Number.isFinite(point?.val)) {
      return;
    }
    const latIndex = roundCellIndex(LAT_MAX - point.lat, 0, LAT_STEP, latCount - 1);
    const lng = point.lng > 180 ? point.lng - 360 : point.lng;
    const lonIndex = roundCellIndex(lng, LON_MIN, LON_STEP, lonCount - 1);
    if (latIndex >= 0 && lonIndex >= 0) {
      field[latIndex][lonIndex] = point.val;
    }
  });

  return {
    field,
    latCenters: Array.from({ length: latCount }, (_, index) => LAT_MAX - index * LAT_STEP),
    lonCenters: Array.from({ length: lonCount }, (_, index) => LON_MIN + index * LON_STEP),
    minVal: layer.minVal,
    maxVal: layer.maxVal,
  };
}
