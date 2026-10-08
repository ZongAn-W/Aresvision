import { composePredictMode, predictModeSelection } from './predictModelModes';
import { useT } from '../../i18n';
import './predictModeSelector.css';

export default function PredictModeSelector({ mode, onChange, disabled }) {
  const t = useT();
  const { planet, analysis } = predictModeSelection(mode);
  return <div className="predict-mode-selector" data-predict-mode-selector>
    <fieldset disabled={disabled}>
      <legend>{t('predict.planetSelection')}</legend>
      <div role="group" aria-label={t('predict.planetSelection')}>
        {['earth', 'mars'].map(value => <button type="button" key={value} aria-pressed={planet === value}
          onClick={() => onChange(composePredictMode(value, analysis))}>{t(`predict.planet.${value}`)}</button>)}
      </div>
    </fieldset>
    <fieldset disabled={disabled}>
      <legend>{t('predict.analysisSelection')}</legend>
      <div role="group" aria-label={t('predict.analysisSelection')}>
        {['single', 'compare'].map(value => <button type="button" key={value} aria-pressed={analysis === value}
          onClick={() => onChange(composePredictMode(planet, value))}>{t(`predict.analysis.${value}`)}</button>)}
      </div>
    </fieldset>
  </div>;
}
