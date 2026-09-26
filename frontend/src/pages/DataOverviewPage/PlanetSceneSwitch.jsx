import React from 'react';
import { useT } from '../../i18n/index.js';

/**
 * 火星/地球场景切换：两个原生可访问按钮。
 *
 * `variant="toolbar"` 用于观测台顶部条件栏（更紧凑的独立样式），
 * 默认变体保留 `.planet-switch` 类名，供其它位置继续使用。
 */
export default function PlanetSceneSwitch({ value, onChange, className = '', variant = 'default', style = null }) {
  const t = useT();
  const options = [
    { id: 'earth', label: t('overviewPlanet.earth') },
    { id: 'mars', label: t('overviewPlanet.mars') },
  ];
  const isToolbar = variant === 'toolbar';

  return (
    <div
      className={`planet-switch${isToolbar ? ' planet-switch--toolbar' : ''} ${className}`.trim()}
      role="group"
      aria-label={t('overviewPlanet.label')}
      style={isToolbar ? {
        display: 'inline-flex',
        gap: 4,
        padding: 3,
        borderRadius: 'var(--overview-control-radius)',
        border: '1px solid var(--border)',
        background: 'var(--overview-elevated)',
        flexShrink: 0,
        ...style,
      } : style}
    >
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          className={`planet-switch__option${value === option.id ? ' is-active' : ''}`}
          aria-pressed={value === option.id}
          style={isToolbar ? {
            minHeight: 32,
            minWidth: 56,
            padding: '6px 12px',
            borderRadius: 6,
            border: 'none',
            background: value === option.id ? 'var(--overview-accent-soft)' : 'transparent',
            color: value === option.id ? 'var(--overview-accent)' : 'var(--text-60)',
            fontFamily: 'var(--font-body)',
            fontSize: 'calc(12px * var(--font-scale, 1))',
            fontWeight: value === option.id ? 800 : 600,
            cursor: 'pointer',
          } : undefined}
          onClick={() => {
            if (value !== option.id) onChange(option.id);
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
