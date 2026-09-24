import { useT } from '../i18n';
import PlanetPreview from './HomePage/PlanetPreview';
import './HomePage/homePage.css';

function Arrow() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6" /></svg>;
}

export default function HomePage({ onNavigate }) {
  const t = useT();
  const experiments = [
    { id: 'observe', number: '01', target: 'overview' },
    { id: 'training', number: '02', target: 'training' },
    { id: 'evaluate', number: '03', target: 'predict' },
  ];

  return (
    <main className="atmos-home">
      <section className="home-hero" aria-labelledby="home-title">
        <div className="home-hero__copy">
          <h1 id="home-title"><span>{t('home.lab.titleFirst')}</span><span className="home-hero__name-en">{t('home.lab.titleSecond')}</span></h1>
          <p className="home-hero__description">{t('home.lab.description')}</p>
          <div className="home-actions">
            <button type="button" className="home-button home-button--primary" onClick={() => onNavigate('overview')}>{t('home.lab.enter')}<Arrow /></button>
            <button type="button" className="home-text-button" onClick={() => onNavigate('training')}>{t('home.lab.train')}<Arrow /></button>
          </div>
        </div>

        <div className="home-observatory">
          <div className="home-orbital-stage">
            <PlanetPreview rotating label={t('home.lab.previewLabel')} />
          </div>
        </div>
      </section>

      <nav className="home-workflow" aria-label={t('home.lab.workflow')}>
        <span className="home-micro">{t('home.lab.workflow')}</span>
        <div className="home-experiments">
          {experiments.map(({ id, number, target }) => (
            <button type="button" className="home-experiment" key={id} onClick={() => onNavigate(target)}>
              <span className="home-experiment__number">{number}</span>
              <span className="home-experiment__title">{t(`home.lab.${id}.title`)}</span>
              <Arrow />
            </button>
          ))}
        </div>
      </nav>
    </main>
  );
}
