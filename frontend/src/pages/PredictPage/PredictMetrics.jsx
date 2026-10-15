import C from '../../constants/colors';
import { Panel } from '../../components/ui/Controls';
import { fmtNum } from '../../utils/fmt';
import { useSettings } from '../../contexts/SettingsContext';
import { createMarsPredictionPresentation, predictionMetricCards } from './predictionPresentation.js';
import './predictionCharts.css';

export default function PredictMetrics({ loading, metrics, precision, ozoneUnit, presentation, flattened = false }) {
  const { settings } = useSettings();
  const config = presentation || createMarsPredictionPresentation({ settings, ozoneUnit }).metrics;
  const description = config.describe(metrics);
  const cards = predictionMetricCards(metrics, config);
  const missingLabel = metrics == null ? '--' : config.missingLabel;
  const body = <section data-predict-metrics="true" data-evaluation-scope={description.scope}>
    <h3 className="prediction-chart-title">{config.title}</h3>
    <p className="prediction-chart-subtitle">{description.subtitle}</p>
    {description.splitLabel && <p className="prediction-chart-subtitle">{description.splitLabel}</p>}
    <div className="prediction-metric-grid">
      {cards.map((metric) => <div className="prediction-metric-card" key={metric.key}
        data-predict-metric={metric.key} data-metric-unit={metric.unit} title={metric.label || metric.name}>
        <span className="prediction-metric-name">{metric.name}</span>
        <strong className="prediction-metric-value">{loading ? '--' : metric.value == null
          ? missingLabel : fmtNum(metric.value, precision ?? settings.precision)}</strong>
        <small style={{ color: metric.color || C.blue }}>{metric.better} {metric.unit}</small>
      </div>)}
    </div>
  </section>;
  // Nested inside another card (Earth diagnostics) the panel shell would double-frame it.
  return flattened ? body : <Panel className="prediction-panel">{body}</Panel>;
}
