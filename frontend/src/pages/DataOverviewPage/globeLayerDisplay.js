import { buildAnomalyField } from '../../components/sphericalFieldLayers.js';
import { pointsToFieldData } from './fieldGrid.js';

export function convertAnomalyValue(value, variable, units = {}) {
  // Anomalies are deltas. Temperature deltas have the same magnitude in K and
  // °C, so never apply the absolute 273.15 offset to an already centred field.
  if (!Number.isFinite(value)) return value;
  if (variable === 'Temperature') return value;
  if (variable === 'o3col' && units.ozone === 'DU') return value * 0.1;
  if ((variable === 'U_Wind' || variable === 'V_Wind') && units.wind === 'km/h') return value * 3.6;
  return value;
}

export function canEnableAnomaly(sceneModel) {
  if (sceneModel?.renderMode !== 'single' || sceneModel?.layers?.length !== 1) return false;
  const source = String(sceneModel.layers[0]?.source || '');
  return Boolean(source) && source !== 'nomad-validation' && !source.startsWith('MCD-');
}

export function transformSceneModelAnomaly(sceneModel) {
  if (!canEnableAnomaly(sceneModel)) return sceneModel;
  const layer = sceneModel.layers[0];
  const fieldData = pointsToFieldData(layer);
  if (!fieldData) return sceneModel;
  const anomaly = buildAnomalyField(fieldData, {});
  const points = layer.points.map((point) => ({
    ...point,
    val: Number.isFinite(point.val) && Number.isFinite(anomaly.mean)
      ? point.val - anomaly.mean
      : point.val,
  }));
  return {
    ...sceneModel,
    colorMode: 'rdbu',
    legendMode: 'continuous',
    layers: [{
      ...layer,
      points,
      minVal: anomaly.minVal,
      maxVal: anomaly.maxVal,
      colorMode: 'rdbu',
      anomalyMean: anomaly.mean,
      anomalyScope: 'spatial-mean',
    }],
  };
}

export default transformSceneModelAnomaly;
