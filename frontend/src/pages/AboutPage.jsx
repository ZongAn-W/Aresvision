import C from '../constants/colors';
import { useT } from '../i18n';
import SectionTitle from '../components/SectionTitle';
import BrandMark from '../components/BrandMark';
import {
  MissionBlock,
  PlanetCoverageBlock,
  CapabilityBlock,
  WorkflowBlock,
  DataSourcesBlock,
  ModelsBlock,
  TechStackBlock,
  BoundaryBlock,
} from './AboutPage/AboutComponents';
import './AboutPage/aboutPage.css';

export default function AboutPage() {
  const t = useT();

  return (
    <div className="about-page page-enter">
      <div className="about-page__mark">
        <BrandMark size={72} label="AstraAtmos" />
      </div>

      <SectionTitle title={t('about.title')} subtitle={t('about.subtitle')} align="center" />

      <p className="about-page__intro" style={{ color: C.ice60 }}>
        {t('about.description')}
      </p>

      <MissionBlock t={t} />
      <PlanetCoverageBlock t={t} />
      <CapabilityBlock t={t} />
      <WorkflowBlock t={t} />
      <DataSourcesBlock t={t} />
      <ModelsBlock t={t} />
      <TechStackBlock t={t} />
      <BoundaryBlock t={t} />

      <p className="about-page__note" style={{ color: C.ice60 }}>
        {t('about.footerNote')}
      </p>
    </div>
  );
}
