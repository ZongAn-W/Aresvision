/**
 * 顶部观测条件栏。
 *
 * 两个星球共用同一份结构：星球切换 → 数据源 → 变量 → 时间（年度）→
 * 画布工具（图层 / 点位 / 显示）→ 观测·分析模式切换。
 *
 * 组件本身不读取任何业务状态：全部控件与文案由调用方创建，因此
 * Mars 继续使用 `DataOverviewContext`，Earth 继续使用 `useOverviewController`，
 * 不会因为布局统一而把两套数据控制器合并。
 */

import React from 'react';
import C from '../../../constants/colors';
import { useOverviewLayout } from './OverviewShell.jsx';

export function ToolbarSection({ label, children }) {
  return (
    <div className="observatory-toolbar__section" data-toolbar-section={label}>
      <span
        style={{
          color: C.ice50,
          fontSize: 'calc(10px * var(--font-scale, 1))',
          fontWeight: 700,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </span>
      {children}
    </div>
  );
}

/** 工具栏内的原生下拉；与左栏旧控件保持同样的可访问语义。 */
export function ToolbarSelect({ label, value, onChange, options, disabled = false, isLight = false, title = null }) {
  const optionBg = isLight ? '#ffffff' : '#111827';
  const optionColor = isLight ? '#17212f' : '#f5f7fb';
  return (
    <label
      title={title || label || undefined}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0, flexShrink: 0 }}
    >
      {label ? (
        <span
          style={{
            color: C.ice50,
            fontSize: 'calc(10px * var(--font-scale, 1))',
            fontWeight: 700,
            whiteSpace: 'nowrap',
          }}
        >
          {label}
        </span>
      ) : null}
      <select
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        aria-label={title || label}
        style={{
          minWidth: 0,
          maxWidth: 190,
          padding: '7px 10px',
          borderRadius: 'var(--overview-control-radius)',
          border: `1px solid ${C.borderStrong}`,
          background: isLight ? 'rgba(255,255,255,0.94)' : C.bgCardStrong,
          color: C.ice,
          fontSize: 'calc(12px * var(--font-scale, 1))',
          fontWeight: 600,
          outline: 'none',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.7 : 1,
        }}
      >
        {options.map((option) => (
          <option
            key={option.value}
            value={option.value}
            title={option.detail || option.label}
            style={{ color: optionColor, background: optionBg }}
          >
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** 画布工具入口：点击打开对应设置面板；面板打开时给按钮 aria-expanded。 */
export function ToolbarToolButton({ label, hint = null, active = false, onClick, buttonRef = null }) {
  return (
    <button
      type="button"
      ref={buttonRef}
      onClick={onClick}
      aria-expanded={active}
      title={hint || label}
      style={{
        minHeight: 36,
        minWidth: 44,
        padding: '7px 12px',
        borderRadius: 'var(--overview-control-radius)',
        border: `1px solid ${active ? 'var(--overview-accent)' : 'var(--border)'}`,
        background: active ? 'var(--overview-accent-soft)' : 'transparent',
        color: active ? 'var(--overview-accent)' : C.ice80,
        fontFamily: 'var(--font-body)',
        fontSize: 'calc(12px * var(--font-scale, 1))',
        fontWeight: active ? 700 : 600,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        transition: 'background 150ms ease, border-color 150ms ease, color 150ms ease',
      }}
    >
      {label}
    </button>
  );
}

/**
 * 观测 / 分析两档切换。
 *
 * `aria-pressed` 让键盘与读屏用户知道当前档位；“展开分析 / 返回观测”是
 * 同一个状态的第二个入口，不是第二套布局状态。
 */
export function ObservatoryViewSwitch({ view, onChange, isZh }) {
  const options = [
    { id: 'observe', label: isZh ? '观测' : 'Observe' },
    { id: 'analyze', label: isZh ? '分析' : 'Analyze' },
  ];
  return (
    <div
      role="group"
      aria-label={isZh ? '观测台档位' : 'Observatory view'}
      style={{
        display: 'inline-flex',
        gap: 4,
        padding: 3,
        borderRadius: 'var(--overview-control-radius)',
        border: '1px solid var(--border)',
        background: 'var(--overview-elevated)',
      }}
    >
      {options.map((option) => {
        const active = view === option.id;
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange?.(option.id)}
            style={{
              minHeight: 32,
              minWidth: 52,
              padding: '6px 12px',
              borderRadius: 6,
              border: 'none',
              background: active ? 'var(--overview-accent-soft)' : 'transparent',
              color: active ? 'var(--overview-accent)' : C.ice60,
              fontFamily: 'var(--font-body)',
              fontSize: 'calc(12px * var(--font-scale, 1))',
              fontWeight: active ? 800 : 600,
              cursor: 'pointer',
              transition: 'background 150ms ease, color 150ms ease',
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** 工具栏右侧的状态摘要：当前对象、实际展示时间与单位。 */
export function ToolbarStatus({ items = [] }) {
  const rows = items.filter((item) => item && item.value);
  if (!rows.length) return null;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        minWidth: 0,
        overflow: 'hidden',
        flexShrink: 0,
      }}
    >
      {rows.slice(0, 3).map((item) => (
        <span
          key={item.label}
          title={`${item.label}: ${item.value}`}
          style={{
            display: 'inline-flex',
            alignItems: 'baseline',
            gap: 5,
            padding: '4px 9px',
            borderRadius: 999,
            border: `1px solid ${C.border}`,
            color: item.color || C.ice70,
            fontSize: 'calc(11px * var(--font-scale, 1))',
            fontWeight: 700,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: 180,
          }}
        >
          <span style={{ color: C.ice40, fontSize: 'calc(10px * var(--font-scale, 1))', fontWeight: 600 }}>
            {item.label}
          </span>
          {item.value}
        </span>
      ))}
    </div>
  );
}

/**
 * 「展开分析」入口。
 *
 * 观测档没有常驻分析区，入口放在时间轨道右侧，与播放/日期同属观测操作带；
 * 分析档由分析区自己提供「返回观测」。两者读写同一个 `view` 状态。
 */
export function AnalysisEntryButton({ label, onClick }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        minHeight: 36,
        padding: '7px 14px',
        borderRadius: 'var(--overview-control-radius)',
        border: '1px solid var(--overview-accent)',
        background: 'var(--overview-accent-soft)',
        color: 'var(--overview-accent)',
        fontFamily: 'var(--font-body)',
        fontSize: 'calc(12px * var(--font-scale, 1))',
        fontWeight: 700,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        flexShrink: 0,
      }}
    >
      {label}
    </button>
  );
}

export default function ObservatoryToolbar({
  planetSlot = null,
  sourceSlot = null,
  variableSlot = null,
  timeSlot = null,
  toolsSlot = null,
  statusSlot = null,
  view = 'observe',
  onViewChange = null,
  isZh = true,
}) {
  const { flow } = useOverviewLayout();

  return (
    <div
      className="observatory-toolbar"
      data-compact={flow ? 'true' : 'false'}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: flow ? 8 : 10,
        flexWrap: flow ? 'wrap' : 'nowrap',
        width: '100%',
        minWidth: 0,
        minHeight: 0,
      }}
    >
      {planetSlot}

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: flow ? 'wrap' : 'nowrap',
          flex: '1 1 auto',
          minWidth: 0,
          overflow: 'hidden',
        }}
      >
        {sourceSlot}
        {variableSlot}
        {timeSlot}
      </div>

      {statusSlot}

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        {toolsSlot}
      </div>

      <div style={{ flexShrink: 0 }}>
        <ObservatoryViewSwitch view={view} onChange={onViewChange} isZh={isZh} />
      </div>
    </div>
  );
}
