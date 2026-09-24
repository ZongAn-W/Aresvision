import C from '../constants/colors';
import { useT } from '../i18n';
import SectionTitle from '../components/SectionTitle';
import BrandMark from '../components/BrandMark';
import {
  TechStackBlock,
  DataSourcesBlock,
} from './AboutPage/AboutComponents';

export default function AboutPage() {
  const t = useT();

  return (
    <div className="page-enter" style={{ padding: '100px 40px 60px', maxWidth: 1000, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
        <BrandMark size={72} label="AstraAtmos" />
      </div>

      <SectionTitle title={t('about.title')} subtitle={t('about.subtitle')} align="center" />

      <div style={{ textAlign: 'center', maxWidth: 700, margin: '0 auto 48px', fontSize: 'calc(15px * var(--font-scale, 1))', color: C.ice60, lineHeight: 1.8 }}>
        {t('about.description')}
      </div>

      <TechStackBlock t={t} />
      <DataSourcesBlock t={t} />
    </div>
  );
}
