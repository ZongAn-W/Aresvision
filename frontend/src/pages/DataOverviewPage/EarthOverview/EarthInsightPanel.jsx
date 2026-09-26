/**
 * Earth 图表 AI 解读。
 *
 * 只在用户显式点击时调用一次 `/analysis/earth/overview/insight`，
 * 发送统计摘要（星球、数据集、年份、变量、区域、少量标量），
 * 绝不发送整幅原始场；回答中必须标明数据源、星球、时间范围与单位。
 *
 * 请求结果绑定上下文身份（星球 / 数据集 / 发布指纹 / 图形 ID / 年份 / 日期 /
 * 变量 / 区域）：身份变化时取消在途请求并清空旧回答，旧回答不会显示在新图下。
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import GlowCard from '../../../components/GlowCard';
import C from '../../../constants/colors';
import { postEarthOverviewInsight } from '../../../services/datasets.js';
import { buildEarthInsightSnapshot } from './earthResearchModel.js';

const MAX_CARDS = 12;

export default function EarthInsightPanel({
  datasetId,
  fingerprint,
  year,
  date,
  variable,
  units,
  scope = 'global',
  scopeLabel = null,
  cards = [],
  ready = true,
  isZh = true,
  chartId = null,
}) {
  const [state, setState] = useState({ status: 'idle', answer: null, meta: null, error: null });
  const abortRef = useRef(null);

  // 上下文身份：任何一项变化都让旧回答失效。
  const contextKey = [
    'earth', datasetId ?? '-', fingerprint ?? '-', chartId ?? '-',
    year ?? '-', date ?? '-', variable ?? '-', units ?? '-', scope ?? '-',
  ].join('|');
  const contextKeyRef = useRef(contextKey);
  contextKeyRef.current = contextKey;

  useEffect(() => {
    // 身份变化：取消在途请求并清空旧回答；这里不发起任何新请求。
    abortRef.current?.abort();
    setState((previous) => (
      previous.status === 'idle' && !previous.answer && !previous.error
        ? previous
        : { status: 'idle', answer: null, meta: null, error: null }
    ));
  }, [contextKey]);

  const run = useCallback(async () => {
    if (!ready) {
      setState({
        status: 'error',
        answer: null,
        meta: null,
        error: isZh ? '当前图表数据尚未就绪，暂不发送解读请求。' : 'Chart data is not ready yet; no request was sent.',
      });
      return;
    }
    const requestKey = contextKey;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ status: 'loading', answer: null, meta: null, error: null });

    const payload = buildEarthInsightSnapshot({
      datasetId,
      fingerprint,
      year,
      date,
      variable,
      units,
      scope,
      cards: cards.slice(0, MAX_CARDS),
      locale: isZh ? 'zh' : 'en',
    });

    try {
      const response = await postEarthOverviewInsight(payload, { signal: controller.signal });
      if (controller.signal.aborted || contextKeyRef.current !== requestKey) return;
      setState({ status: 'ready', answer: response?.answer || '', meta: response, error: null });
    } catch (error) {
      if (error?.name === 'AbortError') return;
      if (contextKeyRef.current !== requestKey) return;
      setState({
        status: 'error',
        answer: null,
        meta: null,
        error: error?.message || (isZh ? '解读请求失败。' : 'Insight request failed.'),
      });
    }
  }, [cards, contextKey, datasetId, date, fingerprint, isZh, ready, scope, scopeLabel, units, variable, year]);

  return (
    <GlowCard style={{ padding: '16px 18px', display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <span style={{ color: C.ice, fontFamily: 'var(--font-display)', fontSize: 'calc(13px * var(--font-scale, 1))', fontWeight: 700 }}>
          {isZh ? 'AI 解读当前图表' : 'AI insight for the current chart'}
        </span>
        <button
          type="button"
          onClick={run}
          disabled={state.status === 'loading'}
          style={{
            padding: '6px 14px', borderRadius: 999, border: `1px solid ${C.border}`,
            background: state.status === 'loading' ? 'transparent' : `${C.blue}18`,
            color: C.ice, cursor: state.status === 'loading' ? 'wait' : 'pointer',
            fontFamily: 'var(--font-body)', fontSize: 'calc(11px * var(--font-scale, 1))',
          }}
        >
          {state.status === 'loading'
            ? (isZh ? '解读中…' : 'Interpreting…')
            : (isZh ? '生成解读' : 'Generate insight')}
        </button>
      </div>

      <p style={{ margin: 0, color: C.ice50, fontSize: 'calc(10px * var(--font-scale, 1))', lineHeight: 1.6 }}>
        {isZh
          ? '只发送统计摘要（星球、数据集、年份、变量、区域与少量标量），不发送原始场数据；仅在你点击时调用。'
          : 'Only a statistical digest (planet, dataset, year, variable, scope and a few scalars) is sent — never the raw field — and only when you click.'}
      </p>

      {state.error ? (
        <p role="alert" style={{ margin: 0, color: C.mars, fontSize: 'calc(11px * var(--font-scale, 1))', lineHeight: 1.7 }}>
          {state.error}
        </p>
      ) : null}

      {state.answer ? (
        <div style={{ display: 'grid', gap: 8 }}>
          <p style={{ margin: 0, color: C.ice80, fontSize: 'calc(12px * var(--font-scale, 1))', lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>
            {state.answer}
          </p>
          <div style={{ color: C.ice45, fontSize: 'calc(10px * var(--font-scale, 1))', lineHeight: 1.7 }}>
            {[
              state.meta?.source,
              state.meta?.planet,
              state.meta?.variable && `${state.meta.variable}${state.meta.units ? ` (${state.meta.units})` : ''}`,
              state.meta?.date_range?.start && state.meta?.date_range?.end
                ? `${state.meta.date_range.start} ~ ${state.meta.date_range.end}`
                : null,
              state.meta?.scope_label || state.meta?.scope,
              state.meta?.model,
            ].filter(Boolean).join(' · ')}
          </div>
          {Array.isArray(state.meta?.limitations) && state.meta.limitations.length ? (
            <ul style={{ margin: 0, paddingLeft: 18, color: C.ice45, fontSize: 'calc(10px * var(--font-scale, 1))', lineHeight: 1.7 }}>
              {state.meta.limitations.map((item) => <li key={item}>{item}</li>)}
            </ul>
          ) : null}
        </div>
      ) : null}
    </GlowCard>
  );
}
