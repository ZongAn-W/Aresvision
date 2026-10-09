import GlowCard from '../../components/GlowCard';
import { fmtNum } from '../../utils/fmt';
import { useSettings } from '../../contexts/SettingsContext';

/** Configured definitions/time labels also drive the detailed table. */
export default function ForecastMetricDetails({ result, adapter, precision }) {
  const { settings } = useSettings();
  const isZh = settings.language !== 'en';
  const items = adapter.presentation.metrics.items;
  const byLead = result?.metrics?.by_lead || result?.metrics?.per_step || [];
  if (!byLead.length) return null;
  const format = (value, key) => Number.isFinite(value)
    ? fmtNum(adapter.presentation.metrics.convertValue(value, key), precision) : adapter.presentation.metrics.missingLabel;
  return <GlowCard style={{ padding: 20 }}>
    <details className="prediction-metric-details">
      <summary>{isZh ? '逐步与累计窗口指标' : 'Lead and cumulative-window metrics'}</summary>
      <div className="prediction-table-scroll"><table>
        <thead><tr><th>{isZh ? '展示步' : 'Display step'}</th>{items.map(item => <th key={item.key}>{item.name} ({item.unit || '1'})</th>)}</tr></thead>
        <tbody>{byLead.map((row, index) => <tr key={index}>
          <td>{adapter.stepLabel(result, (row.lead_step || row.lead_day || index + 1) - 1)}</td>{items.map(item => <td key={item.key}>{format(row[item.key], item.key)}</td>)}
        </tr>)}</tbody>
      </table></div>
      {result.metrics?.by_horizon?.length ? <div className="prediction-table-scroll"><table>
        <caption>{isZh ? '当前预测窗口的累计提前范围' : 'Cumulative leads in the current forecast window'}</caption>
        <thead><tr><th>h</th>{items.map(item => <th key={item.key}>{item.name} ({item.unit || '1'})</th>)}</tr></thead>
        <tbody>{result.metrics.by_horizon.map(row => <tr key={row.horizon_hours}><td>+{row.horizon_hours}h</td>
          {items.map(item => <td key={item.key}>{format(row[item.key], item.key)}</td>)}</tr>)}</tbody>
      </table></div> : null}
    </details>
  </GlowCard>;
}
