import { useMemo, useState } from 'react';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import { buildTrainingHistoryParameters, getTrainingParameterLabel } from './trainingHyperparameterFormatting';
import './trainingTaskParameters.css';

export default function TrainingTaskParameters({ hyperparameters, modelName, t, formatValue }) {
  const { summary, groups, count } = useMemo(() => buildTrainingHistoryParameters(hyperparameters), [hyperparameters]);
  const [open, setOpen] = useState(false);
  if (!count) return null;
  return <details className="training-task-parameters" onClick={event => event.stopPropagation()} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary aria-label={`${t('modelTraining.historyParameters')} · ${modelName}`}>
      <span className="training-task-summary">
        {summary.map(([key, value]) => <span className="training-task-summary-item" key={key}>
          <span>{getTrainingParameterLabel(key, t)}</span>
          <strong>{formatValue(key, value)}</strong>
        </span>)}
      </span>
      <span className="training-task-disclosure">
        {t(open ? 'modelTraining.hideParameters' : 'modelTraining.showParameters')} ({count})
        <ExpandMoreRoundedIcon aria-hidden="true" className="training-task-chevron" sx={{ fontSize: 18 }} />
      </span>
    </summary>
    <div className="training-task-parameter-content">
      {groups.map(group => <section key={group.key}>
        <h4>{group.key === 'common' ? t('modelTraining.historyParameters') : getTrainingParameterLabel(group.key, t)}</h4>
        <dl className="training-task-parameter-grid">
          {group.entries.map(([key, value]) => <div className="training-task-parameter-row" key={key}>
            <dt title={key}>{getTrainingParameterLabel(key, t)}</dt>
            <dd>{value && typeof value === 'object' && !Array.isArray(value)
              ? <pre>{JSON.stringify(value, null, 2)}</pre>
              : formatValue(key, value)}</dd>
          </div>)}
        </dl>
      </section>)}
    </div>
  </details>;
}
