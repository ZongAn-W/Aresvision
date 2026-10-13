import C from '../constants/colors';
import { useSettings } from '../contexts/SettingsContext';

/**
 * 页面区块标题组件
 * Props: title, subtitle, align
 */
export default function SectionTitle({ title, subtitle, align = 'left' }) {
  const { settings } = useSettings();
  const isZh = settings?.language !== 'en';
  const subtitleStyle = {
    fontSize: 'calc(12px * var(--font-scale, 1))',
    fontWeight: 600,
    letterSpacing: isZh ? 0 : '0.08em',
    color: C.ice60,
    textTransform: isZh ? 'none' : 'uppercase',
    fontFamily: 'var(--font-body)',
    marginBottom: 8,
  };

  return (
    <div style={{ textAlign: align, marginBottom: 32 }}>
      {subtitle ? (
        <div style={subtitleStyle}>
          {subtitle}
        </div>
      ) : null}
      <h2
        style={{
          fontSize: 'calc(var(--type-page-title) * var(--font-scale, 1))',
          fontWeight: 700,
          fontFamily: 'var(--font-display)',
          color: C.ice,
          margin: 0,
          lineHeight: 1.2,
          letterSpacing: 0,
        }}
      >
        {title}
      </h2>
    </div>
  );
}
