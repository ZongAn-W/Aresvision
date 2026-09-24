/**
 * 共用工作台左栏部件。
 *
 * `SectionLabel` 与 `OverviewModeCard` 是从火星左栏原样提取的共用实现：
 * Mars 与 Earth 现在渲染同一份模式选择控件（含单选语义、图标、标题与说明），
 * 不再各自维护一套外观相近但行为不同的副本。
 */

import React from 'react';
import C from '../../../constants/colors';
import { MODE_DEFS } from '../overviewChartLayout.js';

/** 模式标题与说明的唯一来源：`overviewChartLayout.MODE_DEFS`。 */
export function modeDefinition(modeId, isZh) {
  const def = MODE_DEFS.find((item) => item.id === modeId) || MODE_DEFS[0];
  return {
    id: def.id,
    icon: def.icon,
    color: def.color,
    title: isZh ? def.title.zh : def.title.en,
    desc: isZh ? def.desc.zh : def.desc.en,
  };
}

export function SectionLabel({ children }) {
  return (
    <div
      style={{
        color: C.ice50,
        fontSize: 'calc(10px * var(--font-scale, 1))',
        fontWeight: 700,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        marginBottom: 10,
      }}
    >
      {children}
    </div>
  );
}

/**
 * 单个分析模式卡片（单选）。`name` 必须按场景区分，避免两个场景共享同一组 radio。
 */
export function OverviewModeCard({ mode, selected, onSelect, isZh, isLight, name = 'overview-mode' }) {
  return (
    <label
      style={{
        display: 'grid',
        gridTemplateColumns: '20px minmax(0, 1fr)',
        gap: 10,
        alignItems: 'start',
        padding: '13px 12px',
        borderRadius: 14,
        border: `1px solid ${selected ? `${mode.color}55` : isLight ? 'rgba(15,23,42,0.10)' : 'rgba(255,255,255,0.08)'}`,
        background: selected
          ? (isLight ? `${mode.color}10` : 'rgba(255,255,255,0.05)')
          : (isLight ? 'rgba(255,255,255,0.82)' : 'rgba(255,255,255,0.02)'),
        cursor: 'pointer',
        transition: 'all 0.2s ease',
      }}
    >
      <input
        type="radio"
        name={name}
        checked={selected}
        onChange={() => onSelect(mode.id)}
        style={{ marginTop: 3, accentColor: mode.color }}
      />
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span
            style={{
              width: 22,
              height: 22,
              borderRadius: 999,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: selected ? `${mode.color}1a` : C.bgMuted,
              color: selected ? mode.color : C.ice40,
              fontSize: 'calc(11px * var(--font-scale, 1))',
              fontWeight: 800,
              flexShrink: 0,
            }}
          >
            {mode.icon}
          </span>
          <div
            style={{
              color: selected ? mode.color : C.ice,
              fontSize: 'calc(13px * var(--font-scale, 1))',
              fontWeight: 700,
              fontFamily: 'var(--font-display)',
              lineHeight: 1.35,
              letterSpacing: '-0.01em',
            }}
          >
            {isZh ? mode.title.zh : mode.title.en}
          </div>
        </div>
        <div style={{ color: selected ? C.ice70 : C.ice40, fontSize: 'calc(11px * var(--font-scale, 1))', lineHeight: 1.55 }}>
          {isZh ? mode.desc.zh : mode.desc.en}
        </div>
      </div>
    </label>
  );
}

/** 三种分析模式的完整选择器；Mars 与 Earth 共用。 */
export default function AnalysisModePicker({
  mode,
  onSelect,
  isZh = true,
  isLight = true,
  name = 'overview-mode',
}) {
  return (
    <div style={{ display: 'grid', gap: 8 }} data-testid="analysis-mode-picker">
      {MODE_DEFS.map((item) => (
        <OverviewModeCard
          key={item.id}
          mode={item}
          selected={mode === item.id}
          onSelect={onSelect}
          isZh={isZh}
          isLight={isLight}
          name={name}
        />
      ))}
    </div>
  );
}
