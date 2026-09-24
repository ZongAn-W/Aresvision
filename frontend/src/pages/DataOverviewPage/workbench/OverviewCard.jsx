/**
 * 统一分析卡片：Mars 与 Earth 共用同一套卡片外壳与状态渲染。
 *
 * 状态语义固定为 loading / ready / unsupported / error / idle。
 * 不可用卡片只解释限制，不挂载数据请求；错误卡片给出原因码与重试入口。
 */

import React from 'react';
import GlowCard from '../../../components/GlowCard';
import C from '../../../constants/colors';
import { CARD_STATUS } from './OverviewAdapter.js';

export const REASON_COPY = {
  daily_data_has_no_diurnal_samples: {
    zh: '当前数据集是 UTC 日平均，不包含逐小时或地方时采样，因此无法推导日内昼夜变化。本卡片不会回退到其他星球的数据源。',
    en: 'This dataset contains UTC daily means with no hourly or local-time sampling, so an intra-day diurnal cycle cannot be derived. This card never falls back to another planet.',
  },
  polar_region_not_covered: {
    zh: '当前数据网格不包含极区，无法给出极区统计。',
    en: 'The current grid does not cover the polar region, so polar statistics are unavailable.',
  },
  capability_not_implemented: {
    zh: '该分析能力尚未接入。',
    en: 'This analysis capability is not connected yet.',
  },
};

export function reasonText(reason, isZh) {
  const copy = REASON_COPY[reason];
  if (copy) return isZh ? copy.zh : copy.en;
  return isZh
    ? `该卡片当前不可用（原因码：${reason || 'unknown'}）。`
    : `This card is unavailable (reason code: ${reason || 'unknown'}).`;
}

export default function OverviewCard({
  title,
  color = C.blue,
  state,
  expanded = false,
  onToggle = null,
  isLight = true,
  isZh = true,
  onRetry = null,
  badge = null,
  children = null,
}) {
  const status = state?.status || CARD_STATUS.IDLE;
  const accent = status === CARD_STATUS.ERROR ? C.mars : color;

  return (
    <GlowCard
      style={{
        padding: 0,
        overflow: 'hidden',
        flexShrink: 0,
        transition: 'box-shadow 0.3s ease, border-color 0.3s ease, background 0.3s ease',
      }}
    >
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={() => onToggle?.()}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onToggle?.();
          }
        }}
        style={{
          padding: '14px 20px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          background: expanded ? `linear-gradient(90deg, ${accent}15, transparent)` : 'transparent',
          borderBottom: expanded ? `1px solid ${C.border}` : 'none',
        }}
      >
        <span
          style={{
            color: expanded ? accent : C.ice60,
            fontFamily: 'var(--font-display)',
            fontSize: 'calc(13px * var(--font-scale, 1))',
            fontWeight: expanded ? 700 : 600,
            letterSpacing: '-0.01em',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          {title}
          {badge}
          {status === CARD_STATUS.LOADING ? <CardBadge label={isZh ? '加载中' : 'Loading'} tone="muted" /> : null}
        </span>
        <span
          style={{
            color: expanded ? accent : C.ice30,
            fontSize: 'calc(16px * var(--font-scale, 1))',
            transition: 'transform 0.3s',
            transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
          }}
        >
          ▾
        </span>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateRows: expanded ? '1fr' : '0fr',
          opacity: expanded ? 1 : 0,
          transition: 'grid-template-rows 0.35s ease, opacity 0.25s ease',
        }}
      >
        <div style={{ overflow: 'hidden' }}>
          <div style={{ padding: 20, boxSizing: 'border-box' }} data-card-status={status}>
            {renderBody({ status, state, isZh, isLight, onRetry, children })}
          </div>
        </div>
      </div>
    </GlowCard>
  );
}

function CardBadge({ label, tone = 'muted' }) {
  const palette = tone === 'muted'
    ? { color: C.ice60, border: C.border }
    : { color: C.mars, border: `${C.mars}55` };
  return (
    <span
      style={{
        fontSize: 'calc(10px * var(--font-scale, 1))',
        fontFamily: 'var(--font-body)',
        fontWeight: 600,
        padding: '1px 7px',
        borderRadius: 999,
        border: `1px solid ${palette.border}`,
        color: palette.color,
      }}
    >
      {label}
    </span>
  );
}

function renderBody({ status, state, isZh, onRetry, children }) {
  if (status === CARD_STATUS.UNSUPPORTED) {
    return (
      <div
        role="status"
        style={{
          display: 'grid',
          gap: 8,
          padding: '14px 16px',
          borderRadius: 12,
          border: `1px dashed ${C.border}`,
          background: 'rgba(255,255,255,0.03)',
          color: C.ice70,
          fontFamily: 'var(--font-body)',
          fontSize: 'calc(12px * var(--font-scale, 1))',
          lineHeight: 1.75,
        }}
      >
        <strong style={{ color: C.mars }}>
          {isZh ? '该分析当前不可用' : 'This analysis is currently unavailable'}
        </strong>
        <span>{reasonText(state?.reason, isZh)}</span>
        <code style={{ color: C.ice45, fontSize: 'calc(11px * var(--font-scale, 1))' }}>
          {isZh ? '原因码' : 'reason'}: {state?.reason || 'unknown'}
        </code>
      </div>
    );
  }

  if (status === CARD_STATUS.ERROR) {
    return (
      <div
        role="alert"
        style={{
          display: 'grid',
          gap: 8,
          padding: '14px 16px',
          borderRadius: 12,
          border: `1px solid ${C.mars}55`,
          background: 'rgba(255,143,104,0.06)',
          color: C.ice70,
          fontFamily: 'var(--font-body)',
          fontSize: 'calc(12px * var(--font-scale, 1))',
          lineHeight: 1.75,
        }}
      >
        <strong style={{ color: C.mars }}>
          {isZh ? '该分析加载失败' : 'This analysis failed to load'}
        </strong>
        <code style={{ color: C.ice45, fontSize: 'calc(11px * var(--font-scale, 1))' }}>
          {state?.errorCode || 'invalid_request'}
        </code>
        {state?.message ? <span>{state.message}</span> : null}
        {typeof onRetry === 'function' ? (
          <button
            type="button"
            onClick={onRetry}
            style={{
              justifySelf: 'start',
              padding: '5px 12px',
              borderRadius: 999,
              border: `1px solid ${C.border}`,
              background: 'transparent',
              color: C.ice,
              cursor: 'pointer',
              fontFamily: 'var(--font-body)',
              fontSize: 'calc(11px * var(--font-scale, 1))',
            }}
          >
            {isZh ? '重试' : 'Retry'}
          </button>
        ) : null}
      </div>
    );
  }

  if (status === CARD_STATUS.LOADING) {
    return (
      <div
        role="status"
        style={{
          color: C.ice60,
          fontFamily: 'var(--font-body)',
          fontSize: 'calc(12px * var(--font-scale, 1))',
        }}
      >
        {isZh ? '正在加载该分析…' : 'Loading this analysis…'}
      </div>
    );
  }

  if (status === CARD_STATUS.IDLE) {
    return (
      <div
        style={{
          color: C.ice40,
          fontFamily: 'var(--font-body)',
          fontSize: 'calc(11px * var(--font-scale, 1))',
        }}
      >
        {isZh ? '展开后加载该分析模块。' : 'Expand to load this analysis module.'}
      </div>
    );
  }

  return children;
}
