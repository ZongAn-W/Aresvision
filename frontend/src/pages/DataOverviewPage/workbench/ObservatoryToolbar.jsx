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
import { SegmentedControl } from '../../../components/ui/Controls';
import { useOverviewLayout } from './OverviewShell.jsx';

export function ToolbarSection({ label, children }) {
  return (
    <div className="observatory-toolbar__section" data-toolbar-section={label}>
      <span className="observatory-toolbar__label">
        {label}
      </span>
      {children}
    </div>
  );
}

/** 工具栏内的原生下拉；与左栏旧控件保持同样的可访问语义。 */
export function ToolbarSelect({ label, value, onChange, options, disabled = false, isLight = false, title = null }) {
  const selectedOption = options.find((option) => String(option.value) === String(value));
  const selectedTitle = selectedOption?.detail || selectedOption?.label || title || label;
  return (
    <label
      className={`observatory-toolbar__select${disabled ? ' is-disabled' : ''}`}
      title={selectedTitle || undefined}
    >
      {label ? (
        <span className="observatory-toolbar__label">
          {label}
        </span>
      ) : null}
      <select
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        aria-label={title || label}
        title={selectedTitle || undefined}
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

/** 画布工具入口：点击打开对应设置面板；面板打开时给按钮 aria-expanded。 */
export function ToolbarToolButton({ label, hint = null, active = false, primary = false, onClick, buttonRef = null }) {
  return (
    <button
      type="button"
      className={`observatory-toolbar__tool${primary ? ' observatory-toolbar__tool--primary' : ''}${active ? ' is-active' : ''}`}
      ref={buttonRef}
      onClick={onClick}
      aria-expanded={active}
      title={hint || label}
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
    { value: 'observe', label: isZh ? '观测' : 'Observe' },
    { value: 'analyze', label: isZh ? '分析' : 'Analyze' },
  ];
  return (
    <SegmentedControl label={isZh ? '观测台档位' : 'Observatory view'} value={view}
      options={options} onChange={next => onChange?.(next)} />
  );
}

/** 工具栏右侧的状态摘要：当前对象、实际展示时间与单位。 */
export function ToolbarStatus({ items = [] }) {
  const rows = items.filter((item) => item && item.value);
  if (!rows.length) return null;
  return (
    <div className="observatory-toolbar__status">
      {rows.slice(0, 3).map((item) => (
        <span
          key={item.label}
          className="observatory-toolbar__status-item"
          title={`${item.label}: ${item.value}`}
          style={item.color ? { color: item.color } : undefined}
        >
          <span className="observatory-toolbar__label">
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
      className="observatory-analysis-entry"
      aria-label={label}
      title={label}
      onClick={onClick}
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
        className="observatory-toolbar__conditions"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: flow ? 'wrap' : 'nowrap',
          flex: '1 1 auto',
          minWidth: 0,
        }}
      >
        {sourceSlot}
        {variableSlot}
        {timeSlot}
      </div>

      {statusSlot}

      <div className="observatory-toolbar__tools">
        {toolsSlot}
      </div>

      <div style={{ flexShrink: 0 }}>
        <ObservatoryViewSwitch view={view} onChange={onViewChange} isZh={isZh} />
      </div>
    </div>
  );
}
