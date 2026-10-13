import { Panel } from '../../components/ui/Controls';
import './predictionCharts.css';

export default function PredictionChartCard({ title, subtitle, scope, action, children, note }) {
  return <Panel className="prediction-panel prediction-panel--chart">
    <section className="prediction-chart-card" data-evaluation-scope={scope}>
      <header className="prediction-chart-header"><div>
        <h3 className="prediction-chart-title">{title}</h3>
        {subtitle ? <p className="prediction-chart-subtitle">{subtitle}</p> : null}
      </div>{action}</header>
      {children}
      {note ? <p className="prediction-chart-subtitle">{note}</p> : null}
    </section>
  </Panel>;
}
