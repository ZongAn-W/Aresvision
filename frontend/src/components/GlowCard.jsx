import { useState, useRef, useCallback } from 'react';

/**
 * 毛玻璃卡片 + 鼠标位置追踪光晕效果
 * 
 * Props:
 *   breathe  — 是否启用呼吸灯边框动画
 *   children — 卡片内容
 *   className / style — 额外样式
 *   onClick  — 可选点击事件
 */
export default function GlowCard({ children, className = '', style = {}, breathe = false, onClick }) {
  const cardRef = useRef(null);
  const [glow, setGlow] = useState({ x: 0, y: 0, visible: false });

  const handleMouse = useCallback((e) => {
    const rect = cardRef.current?.getBoundingClientRect();
    if (!rect) return;
    setGlow({ x: e.clientX - rect.left, y: e.clientY - rect.top, visible: true });
  }, []);

  return (
    <div
      ref={cardRef}
      className={`glass-card ${breathe ? 'breathe-border' : ''} ${className}`}
      style={{
        position: 'relative',
        overflow: 'hidden',
        cursor: onClick ? 'pointer' : 'default',
        ...style,
      }}
      onMouseMove={handleMouse}
      onMouseLeave={() => setGlow((g) => ({ ...g, visible: false }))}
      onClick={onClick}
    >
      {glow.visible && (
        <div
          style={{
            position: 'absolute',
            left: glow.x - 120,
            top: glow.y - 120,
            width: 240,
            height: 240,
            borderRadius: '50%',
            background:
              'radial-gradient(circle, rgba(74,158,255,0.08) 0%, transparent 70%)',
            pointerEvents: 'none',
            zIndex: 0,
            transition: 'left 0.05s, top 0.05s',
          }}
        />
      )}
      {/*
        内层是列的 flex 容器；`gap: inherit` 让调用方写在 style 上的 gap 真正作用到
        卡片内部的元素上（否则 gap 只作用在内层容器这一个子元素上，等于没生效）。
      */}
      <div style={{ position: 'relative', zIndex: 1, height: '100%', display: 'flex', flexDirection: 'column', gap: 'inherit' }}>
        {children}
      </div>
    </div>
  );
}
