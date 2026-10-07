// Coordinates stay paired with their source rows/columns; no synthetic axes.
function validAxis(axis, size) {
  if (!Array.isArray(axis) || !size || axis.length !== size || !axis.every(Number.isFinite)) return false;
  return size === 1 || axis.slice(1).every((value, index) => (
    axis[1] > axis[0] ? value > axis[index] : value < axis[index]
  ));
}

function axisLayout(axis, vertical = false) {
  const edges = axis.length === 1
    ? [axis[0] - 0.5, axis[0] + 0.5]
    : [axis[0] - (axis[1] - axis[0]) / 2,
      ...axis.slice(1).map((value, index) => (axis[index] + value) / 2),
      axis.at(-1) + (axis.at(-1) - axis.at(-2)) / 2];
  const min = Math.min(...edges);
  const max = Math.max(...edges);
  const position = (value) => vertical ? (max - value) / (max - min) : (value - min) / (max - min);
  const cells = axis.map((_, index) => {
    const pair = [position(edges[index]), position(edges[index + 1])];
    return { start: Math.min(...pair), end: Math.max(...pair) };
  });
  const tickCount = Math.min(7, axis.length);
  const indexes = [...new Set(Array.from({ length: tickCount }, (_, index) => (
    Math.round(index * (axis.length - 1) / Math.max(1, tickCount - 1))
  )))];
  return { cells, ticks: indexes.map((index) => ({ value: axis[index], position: position(axis[index]) })) };
}

export function marsPredictionGrid(fieldData) {
  const field = fieldData?.field;
  const latitude = fieldData?.lat;
  const longitude = fieldData?.lon;
  if (!Array.isArray(field) || !field.length || !Array.isArray(field[0])
    || !validAxis(latitude, field.length) || !validAxis(longitude, field[0].length)
    || field.some((row) => !Array.isArray(row) || row.length !== longitude.length)) return null;
  const latLayout = axisLayout(latitude, true);
  const lonLayout = axisLayout(longitude);
  return {
    field, latitude, longitude, latCells: latLayout.cells, lonCells: lonLayout.cells,
    latTicks: latLayout.ticks, lonTicks: lonLayout.ticks,
    sphericalFieldData: { ...fieldData, latCenters: latitude, lonCenters: longitude },
  };
}
