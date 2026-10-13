import C from '../../constants/colors';
import GlowCard from '../../components/GlowCard';
import './aboutPage.css';

/**
 * 关于页区块常量与组件。
 *
 * 这里的清单与项目 README 的「技术栈」「主要功能」章节保持一致：
 * 只列出源码与依赖中确实存在的项，未安装/未引用的库不得写入。
 * 两个清单只放与语言无关的库名和版本号，说明文字一律走 i18n，
 * 避免英文界面里出现中文。
 */

export const TECH_STACKS = [
  {
    catKey: 'frontend',
    color: C.blue,
    items: ['React 19', 'Vite 6', 'Three.js', 'Plotly.js', 'react-plotly.js', 'MUI 7', 'Tailwind CSS 3', 'MediaPipe'],
    descKey: 'about.techDesc.frontend',
  },
  {
    catKey: 'backend',
    color: '#4acfac',
    items: ['FastAPI 0.115', 'Uvicorn 0.34', 'Pydantic 2', 'SQLAlchemy async', 'aiosqlite', 'python-jose', 'bcrypt', 'httpx'],
    descKey: 'about.techDesc.backend',
  },
  {
    catKey: 'model',
    color: C.mars,
    items: ['PyTorch 2.5.1', 'scikit-learn', 'scikit-image', 'matplotlib'],
    descKey: 'about.techDesc.model',
  },
  {
    catKey: 'data',
    color: '#9c7bea',
    items: ['NetCDF4', 'xarray', 'NumPy 1.26', 'SciPy 1.14', 'SQLite', 'OpenMARS · MCD · MERRA-2 · MOLA'],
    descKey: 'about.techDesc.data',
  },
];

export function MissionBlock({ t }) {
  return (
    <GlowCard style={{ padding: 28, marginBottom: 20 }}>
      <SectionLabel>{t('about.missionTitle')}</SectionLabel>
      <p className="about-lead">{t('about.missionBody')}</p>
    </GlowCard>
  );
}

export function PlanetCoverageBlock({ t }) {
  const cards = [
    { key: 'mars', title: t('about.planets.marsTitle'), body: t('about.planets.marsBody'), meta: t('about.planets.marsMeta'), color: C.mars },
    { key: 'earth', title: t('about.planets.earthTitle'), body: t('about.planets.earthBody'), meta: t('about.planets.earthMeta'), color: C.blue },
    { key: 'future', title: t('about.planets.futureTitle'), body: t('about.planets.futureBody'), meta: t('about.planets.futureMeta'), color: C.ice40 },
  ];

  return (
    <section aria-label={t('about.planets.label')} className="about-block">
      <SectionLabel>{t('about.planets.label')}</SectionLabel>
      <div className="about-planet-grid">
        {cards.map((card) => (
          <GlowCard key={card.key} style={{ padding: 22 }}>
            <div className="about-planet-head">
              <h3 style={{ color: card.color }}>{card.title}</h3>
              <span>{card.meta}</span>
            </div>
            <p className="about-body-text">{card.body}</p>
          </GlowCard>
        ))}
      </div>
    </section>
  );
}

export function CapabilityBlock({ t }) {
  const cards = [
    { key: 'data', title: t('about.caps.dataTitle'), body: t('about.caps.dataBody'), color: C.blue },
    { key: 'train', title: t('about.caps.trainTitle'), body: t('about.caps.trainBody'), color: C.mars },
    { key: 'predict', title: t('about.caps.predictTitle'), body: t('about.caps.predictBody'), color: C.green },
    { key: 'compare', title: t('about.caps.compareTitle'), body: t('about.caps.compareBody'), color: C.purple },
    { key: 'viz', title: t('about.caps.vizTitle'), body: t('about.caps.vizBody'), color: '#5fd3f3' },
    { key: 'export', title: t('about.caps.exportTitle'), body: t('about.caps.exportBody'), color: '#ffc46b' },
  ];

  return (
    <section aria-label={t('about.caps.label')} className="about-block">
      <SectionLabel>{t('about.caps.label')}</SectionLabel>
      <div className="about-cap-grid">
        {cards.map((card) => (
          <GlowCard key={card.key} style={{ padding: 20 }}>
            <h3 className="about-card-title" style={{ color: card.color }}>{card.title}</h3>
            <p className="about-body-text">{card.body}</p>
          </GlowCard>
        ))}
      </div>
    </section>
  );
}

export function WorkflowBlock({ t }) {
  const steps = t('about.workflowSteps') || [];

  return (
    <GlowCard style={{ padding: 28, marginBottom: 20 }}>
      <SectionLabel>{t('about.workflowTitle')}</SectionLabel>
      <ol className="about-workflow">
        {steps.map((step, i) => (
          <li key={step.title}>
            <span className="about-workflow__index">{t('about.step', { n: i + 1, title: step.title })}</span>
            <span className="about-workflow__body">{step.body}</span>
          </li>
        ))}
      </ol>
    </GlowCard>
  );
}

function SourceCard({ t, sourceKey, color }) {
  return (
    <GlowCard style={{ padding: 22 }}>
      <h3 className="about-card-title" style={{ color }}>{t(`about.${sourceKey}Title`)}</h3>
      <pre className="about-source-body">{t(`about.${sourceKey}Content`)}</pre>
    </GlowCard>
  );
}

export function DataSourcesBlock({ t }) {
  return (
    <section aria-label={t('about.sourcesTitle')} className="about-block">
      <SectionLabel>{t('about.sourcesTitle')}</SectionLabel>
      <div className="about-source-grid">
        <SourceCard t={t} sourceKey="openmars" color={C.blue} />
        <SourceCard t={t} sourceKey="mcd" color={C.mars} />
        <SourceCard t={t} sourceKey="earth" color={C.green} />
        <SourceCard t={t} sourceKey="others" color={C.purple} />
      </div>
    </section>
  );
}

export function ModelsBlock({ t }) {
  return (
    <GlowCard style={{ padding: 28, marginBottom: 20 }}>
      <SectionLabel>{t('about.modelsTitle')}</SectionLabel>
      <p className="about-lead">{t('about.modelsLead')}</p>
      <div className="about-model-grid">
        <div>
          <h3 className="about-card-title" style={{ color: C.mars }}>{t('about.modelsOfficialTitle')}</h3>
          <p className="about-body-text">{t('about.modelsOfficial')}</p>
        </div>
        <div>
          <h3 className="about-card-title" style={{ color: C.blue }}>{t('about.modelsUploadedTitle')}</h3>
          <p className="about-body-text">{t('about.modelsUploaded')}</p>
        </div>
      </div>
    </GlowCard>
  );
}

export function TechStackBlock({ t }) {
  return (
    <GlowCard style={{ padding: 28, marginBottom: 20 }}>
      <SectionLabel>{t('about.techLabel')}</SectionLabel>
      <div className="about-tech-grid">
        {TECH_STACKS.map((stack) => (
          <div key={stack.catKey}>
            <h3 className="about-card-title" style={{ color: stack.color }}>
              {t(`about.techCats.${stack.catKey}`)}
            </h3>
            <p className="about-tech-desc">{t(stack.descKey)}</p>
            <ul className="about-tech-list">
              {stack.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </GlowCard>
  );
}

export function BoundaryBlock({ t }) {
  const items = t('about.boundaryItems') || [];

  return (
    <GlowCard style={{ padding: 28 }}>
      <SectionLabel>{t('about.boundariesTitle')}</SectionLabel>
      <ul className="about-boundary-list">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </GlowCard>
  );
}

export function SectionLabel({ children }) {
  return <div className="about-section-label">{children}</div>;
}
