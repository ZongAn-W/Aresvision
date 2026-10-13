// Presentation state shared by the two single-model workbenches.
export const DISPLAY_FIELD_KINDS = ['truth', 'prediction', 'residual'];

export function predictionPhysicalRange(truthField, predField) {
  if (!truthField || !predField) return null;
  const min = Math.min(truthField.minVal, predField.minVal);
  const max = Math.max(truthField.maxVal, predField.maxVal);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  if (min !== max) return { min, max };
  const padding = Math.max(Math.abs(min) * 0.01, 1e-6);
  return { min: min - padding, max: max + padding };
}

export function predictionStepItems(results, adapter, fallbackLabel) {
  return Array.from({ length: results?.horizon || 0 }, (_, index) => ({
    id: String(index),
    label: adapter?.stepLabel?.(results, index) || fallbackLabel(index),
  }));
}

export function fullscreenFieldModel(fieldData, grid, convertValue, isResidual) {
  if (!fieldData || !grid) return null;
  const field = fieldData.field;
  if (!Array.isArray(field) || !field.length || !Array.isArray(field[0]) || !field[0].length) return null;
  const nLat = field.length;
  const nLon = field[0].length;
  if (grid.latitude.length !== nLat || grid.longitude.length !== nLon
    || field.some((row) => row.length !== nLon || !row.every(Number.isFinite))) return null;
  const heatmap = field.map((row) => row.map(convertValue));
  const profile = heatmap.map((row) => row.reduce((sum, value) => sum + value, 0) / nLon);
  let minimum = Infinity;
  let maximum = -Infinity;
  let sum = 0;
  for (const row of heatmap) for (const value of row) {
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
    sum += value;
  }
  const absoluteMaximum = Math.max(Math.abs(minimum), Math.abs(maximum)) || 1;
  return {
    nLat, nLon, heatmap, profile, minimum, maximum,
    range: maximum - minimum,
    average: sum / (nLat * nLon),
    colorMinimum: isResidual ? -absoluteMaximum : minimum,
    colorMaximum: isResidual ? absoluteMaximum : maximum,
  };
}

// The overlay owns page scrolling and restores keyboard focus on every close,
// including unmounts caused by task, planet, or account changes.
export function activatePredictionDialog(document, dialog, onClose) {
  const previousOverflow = document.body.style.overflow;
  const previousFocus = document.activeElement;
  document.body.style.overflow = 'hidden';
  const controls = () => [...dialog.querySelectorAll('button, input, select, [tabindex]')]
    .filter((element) => element.tabIndex >= 0 && !element.disabled && element.getClientRects().length > 0);
  const keydown = (event) => {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); }
    if (event.key !== 'Tab') return;
    const items = controls();
    const first = items[0];
    const last = items.at(-1);
    if (!first) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first.focus();
    }
  };
  document.addEventListener('keydown', keydown);
  (controls()[0] || dialog).focus();
  return () => {
    document.removeEventListener('keydown', keydown);
    document.body.style.overflow = previousOverflow;
    if (previousFocus?.isConnected) previousFocus.focus();
  };
}
