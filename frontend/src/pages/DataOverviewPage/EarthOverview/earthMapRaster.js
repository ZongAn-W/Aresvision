import { getRgb } from '../../../utils/colormaps.js';
import { clippedCellEdges, gridCellRect, normalizeColorValue } from './earthMapGeometry.js';

/** One canvas draw per valid cell; field size never creates per-cell DOM nodes. */
export function drawEarthRaster(context, field, colormap = 'inferno', width = 1440, height = 720) {
  context.clearRect(0, 0, width, height);
  if (!field?.field || !field.lat || !field.lon || !field.coverage) return 0;
  const latEdges = clippedCellEdges(field.lat, field.coverage.latitude_range);
  const lonEdges = clippedCellEdges(field.lon, field.coverage.longitude_range);
  let drawn = 0;
  for (let row = 0; row < field.lat.length; row += 1) {
    for (let col = 0; col < field.lon.length; col += 1) {
      const value = field.field[row]?.[col];
      const position = normalizeColorValue(value, field.color_range?.min, field.color_range?.max);
      if (position === null) continue; // Missing cells stay transparent over the no-data pattern.
      const rectangle = gridCellRect(latEdges, lonEdges, row, col);
      const [r, g, b] = getRgb(colormap, position);
      context.fillStyle = `rgb(${r},${g},${b})`;
      // Pixel boundaries meet exactly, including the periodic longitude seam.
      const x = Math.round(rectangle.x * width / 360);
      const y = Math.round(rectangle.y * height / 180);
      const right = Math.round((rectangle.x + rectangle.width) * width / 360);
      const bottom = Math.round((rectangle.y + rectangle.height) * height / 180);
      context.fillRect(x, y, right - x, bottom - y);
      drawn += 1;
    }
  }
  return drawn;
}
