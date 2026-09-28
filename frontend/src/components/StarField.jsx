import { useMemo } from 'react';
import { useSettings } from '../contexts/SettingsContext';

/**
 * 全屏星空粒子背景
 * 三档亮度：普通星、亮星、超亮星，带星云装饰
 */
export default function StarField() {
  const { settings } = useSettings();
  const isLight = settings.theme === 'light';

  const { dimStars, medStars, brightStars } = useMemo(() => {
    const rng = () => Math.random();

    // 普通暗星（多数）
    const dim = [];
    for (let i = 0; i < 248; i++) {
      dim.push({
        x: rng() * 100,
        y: rng() * 100,
        size: rng() * 1.0 + 0.4,
        delay: rng() * 6,
        dur: rng() * 4 + 3,
        // 微妙的颜色变化：白/冷白/暖白
        color: rng() > 0.85
          ? 'rgba(180,205,255,0.75)'
          : rng() > 0.9
          ? 'rgba(255,230,200,0.7)'
          : 'rgba(255,255,255,0.65)',
      });
    }

    // 中等亮星
    const med = [];
    for (let i = 0; i < 42; i++) {
      med.push({
        x: rng() * 100,
        y: rng() * 100,
        size: rng() * 1.2 + 1.5,
        delay: rng() * 5,
        dur: rng() * 3 + 2.5,
        color: rng() > 0.5 ? 'rgba(210,225,255,0.85)' : 'rgba(255,255,255,0.8)',
      });
    }

    // 超亮星（少量，加辉光）
    const bright = [];
    for (let i = 0; i < 10; i++) {
      bright.push({
        x: rng() * 100,
        y: rng() * 100,
        size: rng() * 1.5 + 2.8,
        delay: rng() * 4,
        dur: rng() * 2 + 2,
        color: rng() > 0.4 ? 'rgba(200,220,255,0.95)' : 'rgba(255,248,230,0.95)',
        glowColor: rng() > 0.4 ? 'rgba(160,200,255,0.4)' : 'rgba(255,220,150,0.35)',
      });
    }

    return { dimStars: dim, medStars: med, brightStars: bright };
  }, []);

  return (
    <div className="star-field" style={{ 
      position: 'fixed', 
      inset: 0, 
      zIndex: 0, 
      pointerEvents: 'none',
      opacity: isLight ? 0 : 1,
      transition: 'opacity 0.3s ease',
    }}>

      {/* 星云：左上角极淡紫蓝晕 */}
      <div style={{
        position: 'absolute',
        left: '-8%', top: '-6%',
        width: '45%', height: '40%',
        borderRadius: '50%',
        background: 'radial-gradient(ellipse at 35% 40%, rgba(80,100,200,0.04) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />

      {/* 星云：右下角极淡暖橙晕 */}
      <div style={{
        position: 'absolute',
        right: '-5%', bottom: '-4%',
        width: '38%', height: '35%',
        borderRadius: '50%',
        background: 'radial-gradient(ellipse at 60% 55%, rgba(180,80,30,0.03) 0%, transparent 65%)',
        pointerEvents: 'none',
      }} />

      {/* 普通暗星 */}
      {dimStars.map((s, i) => (
        <div key={`d${i}`} style={{
          position: 'absolute',
          left: `${s.x}%`, top: `${s.y}%`,
          width: s.size, height: s.size,
          borderRadius: '50%',
          background: s.color,
          animation: `twinkle ${s.dur}s ease-in-out ${s.delay}s infinite`,
        }} />
      ))}

      {/* 中等亮星 */}
      {medStars.map((s, i) => (
        <div key={`m${i}`} style={{
          position: 'absolute',
          left: `${s.x}%`, top: `${s.y}%`,
          width: s.size, height: s.size,
          borderRadius: '50%',
          background: s.color,
          animation: `twinkle ${s.dur}s ease-in-out ${s.delay}s infinite`,
        }} />
      ))}

      {/* 超亮星（带辉光） */}
      {brightStars.map((s, i) => (
        <div key={`b${i}`} style={{
          position: 'absolute',
          left: `${s.x}%`, top: `${s.y}%`,
          width: s.size, height: s.size,
          borderRadius: '50%',
          background: s.color,
          boxShadow: `0 0 ${s.size * 3}px ${s.glowColor}`,
          animation: `twinkle ${s.dur}s ease-in-out ${s.delay}s infinite`,
        }} />
      ))}

      {/* 噪点纹理叠加 */}
      <div style={{
        position: 'absolute', inset: 0,
        background: "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.03'/%3E%3C/svg%3E\")",
        opacity: 0.35,
      }} />
    </div>
  );
}
