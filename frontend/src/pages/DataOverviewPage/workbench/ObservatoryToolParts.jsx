/**
 * 观测台设置面板的共用原子控件。
 *
 * 这些控件从旧左栏（SidebarMenu / EarthWorkbenchSidebar）原样提取：外观与交互
 * 语义一致，但不再假设自己位于某个固定宽度的栏里，因此桌面浮层面板与窄屏
 * 模态抽屉可以共用同一份实现，避免两份外观相近、行为不同的副本再次漂移。
 */

import React from 'react';
import C from '../../../constants/colors';

export function PanelSectionLabel({ children }) {
  return (
    <div className="observatory-section-label">
      {children}
    </div>
  );
}

export function FieldRow({ label, value }) {
  return (
    <div className="observatory-field-row">
      <span className="observatory-field-row__label">{label}</span>
      <span
        data-field-label={label}
        className="observatory-field-row__value"
        title={typeof value === 'string' ? value : undefined}
      >
        {value || '--'}
      </span>
    </div>
  );
}

export function PanelCard({ children, testId = null }) {
  return (
    <div
      data-panel-card={testId || undefined}
      className="observatory-panel-section"
    >
      {children}
    </div>
  );
}

export function PanelSelect({ label, value, onChange, options, disabled = false, isLight = false }) {
  const selectedOption = options.find((option) => String(option.value) === String(value));
  return (
    <label className="observatory-panel-select">
      <span>{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        title={selectedOption?.detail || selectedOption?.label || label}
      >
        {options.map((option) => (
          <option
            key={option.value}
            value={option.value}
            title={option.detail || option.label}
          >
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function SegmentedToggle({ value, onChange, options, disabled = false, isLight = false }) {
  return (
    <div
      className="observatory-segmented-toggle"
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))`,
        gap: 6,
        padding: 4,
        borderRadius: 'var(--overview-control-radius)',
        background: 'var(--surface-2)',
        border: '1px solid var(--line-subtle)',
      }}
    >
      {options.map((option) => {
        const active = value === option.value;
        const optionDisabled = disabled || option.disabled;
        const optionTitle = optionDisabled ? option.disabledTitle : option.title;
        return (
          <span key={option.value} title={optionTitle} style={{ display: 'block', minWidth: 0 }}>
            <button
              type="button"
              onClick={() => !optionDisabled && onChange(option.value)}
              disabled={optionDisabled}
              title={optionTitle}
              aria-pressed={active}
              style={{
                width: '100%',
                minHeight: 34,
                border: 'none',
                borderRadius: 6,
                padding: '8px 10px',
                background: active ? option.activeBg : 'transparent',
                color: active ? option.activeColor : C.ice60,
                fontSize: 'calc(12px * var(--font-scale, 1))',
                lineHeight: 1.5,
                letterSpacing: 0,
                fontWeight: active ? 700 : 600,
                cursor: optionDisabled ? 'not-allowed' : 'pointer',
                opacity: optionDisabled ? 0.5 : 1,
                transition: 'all 0.2s ease',
              }}
            >
              {option.label}
            </button>
          </span>
        );
      })}
    </div>
  );
}

export function InlineSwitch({ label, checked, onChange, accent = C.blue, isLight = false }) {
  return (
    <label className="observatory-inline-switch">
      <span>{label}</span>
      <span style={{ position: 'relative', width: 36, height: 20, flexShrink: 0 }}>
        <input
          type="checkbox"
          checked={checked}
          onChange={onChange}
          style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', margin: 0, cursor: 'pointer', zIndex: 1 }}
        />
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: 999,
            background: checked ? `color-mix(in srgb, ${accent} 20%, var(--surface-2))` : 'var(--surface-2)',
            border: `1px solid ${checked ? accent : 'var(--line-strong)'}`,
            transition: 'all 0.2s ease',
          }}
        />
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            width: 14,
            height: 14,
            left: checked ? 18 : 3,
            top: 3,
            borderRadius: '50%',
            background: checked ? accent : 'var(--text-muted)',
            transition: 'all 0.2s ease',
          }}
        />
      </span>
    </label>
  );
}

export function PanelButton({ children, onClick, primary = false, disabled = false, type = 'button' }) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{
        minHeight: 36,
        padding: '8px 14px',
        borderRadius: 'var(--overview-control-radius)',
        border: `1px solid ${primary ? 'var(--overview-accent)' : C.border}`,
        background: primary ? 'var(--overview-accent-soft)' : 'transparent',
        color: primary ? 'var(--overview-accent)' : C.ice,
        fontFamily: 'var(--font-body)',
        fontSize: 'calc(12px * var(--font-scale, 1))',
        fontWeight: primary ? 700 : 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
      }}
    >
      {children}
    </button>
  );
}

export function AdvancedToggleGroup({ title, open, onToggle, children }) {
  return (
    <div
      style={{
        borderRadius: 'var(--overview-card-radius)',
        border: '1px solid var(--overview-hairline)',
        background: 'var(--overview-elevated)',
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        style={{
          width: '100%',
          minHeight: 44,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          padding: '12px 14px',
          border: 'none',
          background: 'transparent',
          color: C.ice,
          cursor: 'pointer',
          fontSize: 'calc(12px * var(--font-scale, 1))',
          fontWeight: 700,
          textAlign: 'left',
        }}
      >
        <span>{title}</span>
        <span aria-hidden="true" style={{ color: C.ice40, fontSize: 'calc(11px * var(--font-scale, 1))' }}>
          {open ? '−' : '+'}
        </span>
      </button>
      {open ? <div style={{ display: 'grid', gap: 8, padding: '0 12px 12px' }}>{children}</div> : null}
    </div>
  );
}
