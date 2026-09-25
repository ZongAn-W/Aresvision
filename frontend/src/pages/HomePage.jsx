import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import PlanetPreview from './HomePage/PlanetPreview';
import {
  HOME_PARALLAX_CENTER,
  clearParallax,
  normalizePointer,
  observeMediaPreferences,
  parallaxLayers,
  readMediaPreferences,
  resolveInteractionCapabilities,
  shouldTrackParallax,
  writeParallax,
} from './HomePage/homePointerInteraction';
import './HomePage/homePage.css';

function Arrow() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6" /></svg>;
}

export default function HomePage({ onNavigate }) {
  const t = useT();
  const rootRef = useRef(null);
  // 能力只随媒体查询变化，指针移动不会写入 React 状态。
  const [capabilities, setCapabilities] = useState(() => resolveInteractionCapabilities(readMediaPreferences()));
  const experiments = [
    { id: 'observe', number: '01', target: 'overview' },
    { id: 'training', number: '02', target: 'training' },
    { id: 'evaluate', number: '03', target: 'predict' },
  ];

  useEffect(() => observeMediaPreferences(window, (preferences) => {
    setCapabilities(resolveInteractionCapabilities(preferences));
  }), []);

  // 分层视差：位移只写入 CSS 自定义属性，标题、按钮与说明文字保持原位。
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !capabilities.parallax) {
      if (root) clearParallax(root.style);
      return undefined;
    }

    let frame = 0;
    let pending = HOME_PARALLAX_CENTER;

    const apply = () => {
      frame = 0;
      writeParallax(root.style, parallaxLayers(pending));
    };
    const schedule = (normalized) => {
      pending = normalized;
      if (!frame) frame = requestAnimationFrame(apply);
    };
    const handlePointerMove = (event) => {
      if (!shouldTrackParallax(event, capabilities)) return;
      schedule(normalizePointer(event.clientX, event.clientY, root.getBoundingClientRect()));
    };
    const handlePointerLeave = () => schedule(HOME_PARALLAX_CENTER);

    root.addEventListener('pointermove', handlePointerMove);
    root.addEventListener('pointerleave', handlePointerLeave);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      root.removeEventListener('pointermove', handlePointerMove);
      root.removeEventListener('pointerleave', handlePointerLeave);
      clearParallax(root.style);
    };
  }, [capabilities]);

  return (
    <main className="atmos-home" ref={rootRef}>
      <div className="home-stars" aria-hidden="true" />

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
            <PlanetPreview rotating label={t('home.lab.previewLabel')} capabilities={capabilities} />
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
