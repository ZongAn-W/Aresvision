import React from 'react';
import { useT } from '../../i18n/index.js';

/**
 * 火星/地球场景切换：两个原生可访问按钮。
 */
export default function PlanetSceneSwitch({ value, onChange, className = '' }) {
  const t = useT();
  const options = [
    { id: 'earth', label: t('overviewPlanet.earth') },
    { id: 'mars', label: t('overviewPlanet.mars') },
  ];

  return (
    <div className={`planet-switch ${className}`.trim()} role="group" aria-label={t('overviewPlanet.label')}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          className={`planet-switch__option${value === option.id ? ' is-active' : ''}`}
          aria-pressed={value === option.id}
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
