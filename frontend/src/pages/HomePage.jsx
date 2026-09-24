import { useState, useEffect } from 'react';
import C from '../constants/colors';
import { useT } from '../i18n';
import { useSettings } from '../contexts/SettingsContext';
import Mars3DPlaceholder from '../components/Mars3DPlaceholder';
import GlowCard from '../components/GlowCard';
import {
  IconGlobe,
  IconCpu,
  IconChart,
  IconMessage,
  IconWrapper,
} from './HomePage/HomeComponents';

// ─── 主页面 ───

export default function HomePage({ onNavigate }) {
  const t = useT();
  const { settings } = useSettings();
  const isLight = settings.theme === 'light';
  const isZh = settings?.language !== 'en';

  const [showTitle, setShowTitle] = useState(false);
  const [showSub, setShowSub] = useState(false);
  const [showButtons, setShowButtons] = useState(false);
  const [marsReady, setMarsReady] = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => setMarsReady(true), 300);
    const t2 = setTimeout(() => setShowTitle(true), 1000);
    const t3 = setTimeout(() => setShowSub(true), 1800);
    const t4 = setTimeout(() => setShowButtons(true), 2400);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearTimeout(t4); };
  }, []);

  const features = [
    {
      icon: <IconWrapper accent={C.mars}><IconGlobe color={C.mars} size={30} /></IconWrapper>,
      title: t('home.features.viz3d.title'),
      desc:  t('home.features.viz3d.desc'),
    },
    {
      icon: <IconWrapper accent={C.blue}><IconCpu color={C.blue} size={30} /></IconWrapper>,
      title: t('home.features.ai.title'),
      desc:  t('home.features.ai.desc'),
    },
    {
      icon: <IconWrapper accent={C.mars}><IconChart color={C.mars} size={30} /></IconWrapper>,
      title: t('home.features.chart.title'),
      desc:  t('home.features.chart.desc'),
    },
    {
      icon: <IconWrapper accent={C.blue}><IconMessage color={C.blue} size={30} /></IconWrapper>,
      title: t('home.features.insight.title'),
      desc:  t('home.features.insight.desc'),
    },
  ];

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex', flexDirection: 'column',
      justifyContent: 'center', alignItems: 'center',
      position: 'relative',
      padding: '104px 40px 56px',
    }}>
      {/* 轨道装饰线 */}
      <svg style={{ position: 'absolute', width: 720, height: 720, opacity: 0.055 }} viewBox="0 0 720 720">
        <circle cx="360" cy="360" r="200" fill="none" stroke={C.blue} strokeWidth="0.5" strokeDasharray="4 9" />
        <circle cx="360" cy="360" r="290" fill="none" stroke={C.mars} strokeWidth="0.5" strokeDasharray="6 11" />
        <circle cx="360" cy="360" r="355" fill="none" stroke={C.ice} strokeWidth="0.3" strokeDasharray="3 14" />
      </svg>

      {/* 球体背后大气散射光晕（浅色主题下增强氛围） */}
      {isLight && (
        <div style={{
          position: 'absolute',
          top: 'calc(50% - 220px)',
          width: 560, height: 440,
          background: 'radial-gradient(ellipse at center, rgba(200,140,100,0.08) 0%, rgba(200,140,100,0) 60%)',
          pointerEvents: 'none',
        }} />
      )}

      {/* 火星球体 */}
      <div style={{
        animation: marsReady ? 'marsApproach 1.5s cubic-bezier(0.22,1,0.36,1) forwards' : 'none',
        opacity: marsReady ? undefined : 0,
        marginBottom: 40,
      }}>
        <Mars3DPlaceholder size={280} />
      </div>

      {/* 脉冲光环 */}
      <div style={{
        position: 'absolute', top: 'calc(50% - 100px)',
        width: 310, height: 310, borderRadius: '50%',
        border: isLight ? '1.5px solid rgba(199,91,57,0.12)' : '1.5px solid rgba(199,91,57,0.18)',
        boxShadow: isLight ? '0 0 40px rgba(180,140,120,0.15)' : 'none',
        animation: 'pulse-ring 3s ease-out infinite',
      }} />

      {/* 标题区 */}
      <div style={{ textAlign: 'center', zIndex: 1, maxWidth: 760 }}>
        <h1 style={{
          fontFamily: 'var(--font-display)',
          fontSize: 'calc(56px * var(--font-scale, 1))',
          fontWeight: 800,
          letterSpacing: '-0.04em',
          color: isLight ? '#17212f' : C.ice,
          margin: 0,
          opacity: showTitle ? 1 : 0,
          transform: showTitle ? 'translateY(0)' : 'translateY(30px)',
          transition: 'all 1s cubic-bezier(0.22,1,0.36,1)',
        }}>
          ASTRAATMOS
        </h1>

        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginTop: 16,
          padding: '8px 14px',
          borderRadius: 999,
          border: `1px solid ${isLight ? 'rgba(199,91,57,0.14)' : 'rgba(199,91,57,0.22)'}`,
          background: isLight ? 'rgba(199,91,57,0.08)' : 'rgba(199,91,57,0.10)',
          fontFamily: 'var(--font-body)',
          fontSize: 'calc(13px * var(--font-scale, 1))',
          fontWeight: 700,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: C.mars,
          opacity: showTitle ? 1 : 0,
          transform: showTitle ? 'translateY(0)' : 'translateY(20px)',
          transition: 'all 1s cubic-bezier(0.22,1,0.36,1) 0.2s',
        }}>
          {t('home.subtitle')}
        </div>

        <p style={{
          margin: '28px auto 0',
          fontSize: 'calc(17px * var(--font-scale, 1))',
          color: isLight ? 'rgba(23,33,47,0.74)' : C.ice60,
          lineHeight: 1.75,
          maxWidth: 620,
          opacity: showSub ? 1 : 0,
          transform: showSub ? 'translateY(0)' : 'translateY(20px)',
          transition: 'all 0.8s cubic-bezier(0.22,1,0.36,1)',
        }}>
          {t('home.desc')}
        </p>

        {/* CTA 按钮 */}
        <div style={{
          marginTop: 40, display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap',
          opacity: showButtons ? 1 : 0,
          transform: showButtons ? 'translateY(0)' : 'translateY(20px)',
          transition: 'all 0.8s cubic-bezier(0.22,1,0.36,1)',
        }}>
          <button onClick={() => onNavigate('overview')} style={{
            background: `linear-gradient(135deg, ${C.mars}, ${C.marsLight})`,
            border: 'none', borderRadius: 14,
            padding: '14px 26px', color: '#fff',
            fontSize: 'calc(14px * var(--font-scale, 1))', fontWeight: 700,
            fontFamily: 'var(--font-body)',
            cursor: 'pointer',
            boxShadow: '0 10px 28px rgba(199,91,57,0.24)',
          }}>
            {t('home.exploreBtn')}
          </button>
          <button onClick={() => onNavigate('predict')} style={{
            background: isLight ? 'rgba(255,255,255,0.78)' : C.bgCard,
            border: `1px solid ${C.borderStrong}`,
            borderRadius: 14, padding: '14px 26px',
            color: C.ice, fontSize: 'calc(14px * var(--font-scale, 1))', fontWeight: 600,
            fontFamily: 'var(--font-body)',
            cursor: 'pointer',
          }}>
            {t('home.predictBtn')}
          </button>
        </div>
      </div>

      {/* Scroll 指示器 */}
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
        marginTop: 48,
        opacity: showButtons ? 0.55 : 0,
        transition: 'opacity 1s',
        animation: 'float 3s ease-in-out infinite',
      }}>
        <div style={{ fontSize: 'calc(11px * var(--font-scale, 1))', letterSpacing: '0.08em', color: C.ice60, fontFamily: 'var(--font-body)' }}>
          {isZh ? '下滑' : 'Scroll'}
        </div>
        <div style={{ width: 1, height: 30, background: `linear-gradient(180deg, ${C.ice30}, transparent)` }} />
      </div>

      {/* 功能卡片 */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
        gap: 16, marginTop: 72, width: '100%', maxWidth: 1040,
        opacity: showButtons ? 1 : 0,
        transition: 'opacity 1s 0.5s',
      }}>
        {features.map((f, i) => (
          <GlowCard key={i} style={{ padding: '24px 20px', textAlign: 'center' }}>
            {f.icon}
            <div style={{
              fontSize: 'calc(15px * var(--font-scale, 1))', fontWeight: 700, color: C.ice,
              marginBottom: 8, fontFamily: 'var(--font-display)',
            }}>
              {f.title}
            </div>
            <div style={{ fontSize: 'calc(13px * var(--font-scale, 1))', color: C.ice60, lineHeight: 1.65 }}>
              {f.desc}
            </div>
          </GlowCard>
        ))}
      </div>
    </div>
  );
}
