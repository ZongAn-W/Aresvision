import GlowCard from '../../components/GlowCard';
import './predictionCharts.css';

export default function PredictionChartCard({ title, subtitle, scope, action, children, note }) {
  return <GlowCard style={{ padding: 16, minWidth: 0 }}>
    <section className="prediction-chart-card" data-evaluation-scope={scope}>
      <header className="prediction-chart-header"><div>
        <h3 className="prediction-chart-title">{title}</h3>
        {subtitle ? <p className="prediction-chart-subtitle">{subtitle}</p> : null}
      </div>{action}</header>
      {children}
      {note ? <p className="prediction-chart-subtitle">{note}</p> : null}
    </section>
  </GlowCard>;
}
