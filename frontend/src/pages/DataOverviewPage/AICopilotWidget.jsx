import React, { useEffect, useMemo, useState } from 'react';
import C from '../../constants/colors';
import { useSettings } from '../../contexts/SettingsContext';
import { useDataOverview } from '../../contexts/DataOverviewContext';
import { copilotChat } from '../../services/api';
import { buildExpandedCardSnapshot } from './aiCopilotSnapshot';
import { CARD_TITLES as SHARED_CARD_TITLES } from './overviewChartLayout';

const CARD_TITLES = {
  realtime: { zh: '昼夜变化', en: 'Diurnal' },
  seasonal: { zh: '季节交替', en: 'Seasonal' },
  seasonalExtremes: { zh: '季节极值', en: 'Seasonal Extremes' },
  globalTrend: { zh: '全局趋势', en: 'Global Trends' },
  correlation: { zh: '点位相关性', en: 'Correlation' },
  environment: { zh: '多因子环境', en: 'Environment' },
  solarsens: { zh: '光化学辐射', en: 'Solar Sensitivity' },
  coupling: { zh: '温度耦合', en: 'Temperature Coupling' },
  polar: { zh: '极点聚集', en: 'Polar Dynamics' },
  wave: { zh: '行星波异常', en: 'Wave Explorer' },
  distribution: { zh: '点位分布', en: 'Distribution' },
};

function briefValue(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NaN';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const preview = value.slice(0, 3).map((item) => {
      if (item && typeof item === 'object') return JSON.stringify(item);
      return briefValue(item);
    }).join('; ');
    return `[${preview}${value.length > 3 ? '; ...' : ''}] (n=${value.length})`;
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function flattenSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return '';
  const lines = [];
  const maxLines = 100;
  const walk = (node, path = '') => {
    if (lines.length >= maxLines) return;
    if (node === null || node === undefined || typeof node !== 'object' || Array.isArray(node)) {
      lines.push(`${path}: ${briefValue(node)}`);
      return;
    }
    const entries = Object.entries(node);
    if (!entries.length) {
      lines.push(`${path}: {}`);
      return;
    }
    entries.forEach(([key, value]) => {
      if (lines.length >= maxLines) return;
      walk(value, path ? `${path}.${key}` : key);
    });
  };
  walk(snapshot);
  return lines.join('\n');
}

function normalizeAiText(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/\r\n/g, '\n')
    .replace(/^\s*最终回答正文[:：]\s*/gm, '')
    .replace(/^\s*final answer[:：]\s*/gim, '')
    .replace(/^\s*#{1,6}\s*/gm, '')
    .replace(/^\s*---+\s*$/gm, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/`{1,3}/g, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*]\s+/gm, '- ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function compactAnswer(text, maxChars = 220) {
  const input = (text || '').trim();
  if (!input) return input;
  if (input.length <= maxChars) return input;

  const sentences = input
    .split(/(?<=[。！？.!?])/)
    .map((item) => item.trim())
    .filter(Boolean);

  if (!sentences.length) return `${input.slice(0, maxChars)}...`;

  let merged = '';
  for (const sentence of sentences) {
    const next = merged ? `${merged}${sentence}` : sentence;
    if (next.length > maxChars) break;
    merged = next;
    if (merged.length >= Math.floor(maxChars * 0.7)) break;
  }

  if (!merged) merged = input.slice(0, maxChars);
  return `${merged}${merged.length < input.length ? '...' : ''}`;
}

export default function AICopilotWidget() {
  const { settings } = useSettings();
  const isLight = settings?.theme === 'light';
  const isZh = settings?.language !== 'en';
  const copy = isZh ? {
    title: 'Ares Copilot',
    done: '已完成解读',
    target: '当前目标图表：',
    intro: '我会读取这张图表当前控件状态与数据快照，再给出简明解读。',
    analyzing: '正在基于当前图表数据进行推理...',
    askBtn: 'AI 解读当前图表',
    unnamed: '未命名图表',
    noSnapshot: '当前图表尚未返回可解读数据，可能仍在加载。',
    invalidReply: '本次解读未返回有效文本，请重试一次。',
    reqFailed: 'AI 解读请求失败：',
    question: (name, card) => `请基于“当前右侧展开图表”的实时数据快照进行解读。
图表名称：${name}（card=${card || 'none'}）
要求：
1. 目标是帮助用户快速看懂图表，不写长报告。
2. 只输出 2-3 句中文，总长度 80-160 字。
3. 至少包含图表用途和一个关键变量关系（有数值就带数值）。
4. 若数据未就绪，仅提示“数据未就绪”并给一条操作建议。
5. 不要使用 Markdown 标记。`,
    retry: '请按短摘要模式重写：2-3句，80-160字。',
  } : {
    title: 'Ares Copilot',
    done: 'Insight Ready',
    target: 'Current target chart:',
    intro: 'I will read the current chart state and snapshot, then provide a concise interpretation.',
    analyzing: 'Reasoning over current chart snapshot...',
    askBtn: 'Interpret Current Chart',
    unnamed: 'Unnamed Chart',
    noSnapshot: 'No readable snapshot from the current chart yet. It may still be loading.',
    invalidReply: 'No valid response returned this time. Please retry.',
    reqFailed: 'AI request failed: ',
    question: (name, card) => `Interpret the real-time snapshot of the expanded chart on the right.
Chart name: ${name} (card=${card || 'none'})
Requirements:
1. Help users quickly understand the chart, do not write a long report.
2. Output only 2-3 sentences, 60-140 words in English.
3. Include chart purpose and at least one key variable relationship (with numbers if available).
4. If data is not ready, explicitly say so and provide one actionable suggestion.
5. Do not use Markdown markers.`,
    retry: 'Rewrite in short-summary mode: 2-3 sentences, concise and specific.',
  };

  const {
    globalTimeLs,
    activeAnalysisMode,
    marsYear,
    selectedCoordinate,
    expandedCard,
    selectedVariables,
    globeVariable,
    getAiInsight,
  } = useDataOverview();

  const bubbleWidth = 'clamp(300px, calc(100vw - var(--overview-scene-left) - var(--overview-scene-right) - 220px), 420px)';
  const bubbleBg = 'var(--overview-panel-bg-strong)';
  const bubbleShadow = isLight
    ? '0 12px 28px rgba(15,23,42,0.16), inset 0 0 10px rgba(74, 158, 255, 0.08)'
    : '0 8px 32px rgba(74, 158, 255, 0.2), inset 0 0 10px rgba(74, 158, 255, 0.1)';

  const [showBubble, setShowBubble] = useState(false);
  const [hasTriggered, setHasTriggered] = useState(false);
  const [pulse, setPulse] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [aiResponse, setAiResponse] = useState('');
  const [hasResult, setHasResult] = useState(false);

  useEffect(() => {
    if (globalTimeLs >= 240 && globalTimeLs <= 270 && !hasTriggered) {
      setShowBubble(true);
      setPulse(true);
      setHasTriggered(true);
    }
  }, [globalTimeLs, hasTriggered]);

  const selectedCardTitle = useMemo(() => {
    const card = SHARED_CARD_TITLES[expandedCard] || CARD_TITLES[expandedCard];
    if (!card) return expandedCard || copy.unnamed;
    return isZh ? card.zh : card.en;
  }, [copy.unnamed, expandedCard, isZh]);

  const handleAIChat = async () => {
    setIsAnalyzing(true);
    setAiResponse('');
    setHasResult(false);
    try {
      const snapshot = buildExpandedCardSnapshot(getAiInsight, expandedCard);
      const snapshotText = flattenSnapshot(snapshot);
      const dynamicMetrics = snapshotText || copy.noSnapshot;

      const context = {
        mars_year: marsYear,
        ls_range: [globalTimeLs, globalTimeLs],
        selected_variables: Array.from(new Set([globeVariable, ...(selectedVariables || [])])),
        active_mode: activeAnalysisMode,
        expanded_card: expandedCard,
        expanded_card_title: selectedCardTitle,
        coordinate: selectedCoordinate,
        card_snapshot: snapshot || null,
        dynamic_metrics: dynamicMetrics,
      };

      const question = copy.question(selectedCardTitle, expandedCard);
      const res = await copilotChat(question, context);
      const rawAnswer = typeof res?.answer === 'string' ? res.answer : String(res?.answer ?? '');
      let normalizedAnswer = normalizeAiText(rawAnswer);
      if (!normalizedAnswer && rawAnswer.trim()) {
        normalizedAnswer = rawAnswer.trim();
      }

      if (normalizedAnswer.length > 0 && normalizedAnswer.length < 40) {
        const retryRes = await copilotChat(`${question}\n${copy.retry}`, context);
        const retryNormalized = normalizeAiText(retryRes?.answer);
        if (retryNormalized.length > normalizedAnswer.length) {
          normalizedAnswer = retryNormalized;
        }
      }

      setAiResponse(compactAnswer(normalizedAnswer || copy.invalidReply));
      setHasResult(true);
    } catch (error) {
      setAiResponse(`${copy.reqFailed}${error?.message || ''}`);
      setHasResult(true);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleClose = (event) => {
    event.stopPropagation();
    setShowBubble(false);
    setPulse(false);
    setTimeout(() => {
      setAiResponse('');
      setHasResult(false);
    }, 500);
  };

  return (
    <div
      className="overview-copilot-anchor overview-overlay-anchor"
      style={{
        position: 'fixed',
        bottom: 'calc(var(--overview-timeline-bottom) + 82px)',
        right: 'calc(var(--overview-scene-right) + var(--overview-overlay-gap))',
        zIndex: 2500,
        display: 'flex',
        alignItems: 'flex-end',
        gap: '16px',
        transition: 'none',
      }}
    >
      {showBubble && (
        <div
          style={{
            width: bubbleWidth,
            background: bubbleBg,
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            border: `1px solid ${C.blue}`,
            borderRadius: 12,
            padding: 20,
            boxShadow: bubbleShadow,
            position: 'relative',
            animation: 'fadeInUp 0.6s cubic-bezier(0.4, 0, 0.2, 1)',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            onClick={handleClose}
            style={{ position: 'absolute', top: 10, right: 14, color: C.ice30, cursor: 'pointer', fontSize: 'calc(14px * var(--font-scale, 1))', padding: 4 }}
          >
            ✕
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <span style={{ fontSize: 'calc(20px * var(--font-scale, 1))' }}>🧠</span>
            <span style={{ color: C.blue, fontFamily: 'var(--font-display)', fontSize: 'calc(14px * var(--font-scale, 1))', fontWeight: 700 }}>
              {copy.title}
            </span>
            {hasResult && !isAnalyzing && (
              <span style={{ color: C.ice, fontSize: 'calc(10px * var(--font-scale, 1))', background: isLight ? 'rgba(15,23,42,0.08)' : 'rgba(255,255,255,0.1)', padding: '2px 6px', borderRadius: 4 }}>
                {copy.done}
              </span>
            )}
          </div>

          <div
            style={{
              color: C.ice80,
              fontSize: 'calc(12px * var(--font-scale, 1))',
              fontFamily: 'var(--font-body)',
              lineHeight: 1.6,
              marginBottom: 16,
              maxHeight: 300,
              overflowY: 'auto',
              paddingRight: 8,
            }}
          >
            {!hasResult && !isAnalyzing && (
              <div style={{ marginBottom: 12 }}>
                {copy.target}
                <span style={{ color: C.blue }}> {selectedCardTitle}</span>
                <br />
                {copy.intro}
              </div>
            )}

            {isAnalyzing && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.blue, height: 40 }}>
                <span className="copilot-dot-pulse">{copy.analyzing}</span>
              </div>
            )}

            {hasResult && !isAnalyzing && (
              <div style={{ color: C.ice, background: isLight ? 'rgba(15,23,42,0.04)' : 'rgba(255,255,255,0.02)', padding: 12, borderRadius: 8, borderLeft: `3px solid ${C.blue}` }}>
                <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {aiResponse}
                </div>
              </div>
            )}
          </div>

          {!hasResult && !isAnalyzing && (
            <div style={{ display: 'flex', gap: 10, flexDirection: 'column' }}>
              <button
                onClick={handleAIChat}
                style={{
                  padding: 10,
                  background: 'transparent',
                  border: `1px solid ${C.blue}`,
                  borderRadius: 6,
                  color: C.blue,
                  fontFamily: 'var(--font-body)',
                  fontSize: 'calc(12px * var(--font-scale, 1))',
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: '0.3s',
                }}
                onMouseEnter={(event) => { event.currentTarget.style.background = 'rgba(74, 158, 255, 0.1)'; }}
                onMouseLeave={(event) => { event.currentTarget.style.background = 'transparent'; }}
              >
                {copy.askBtn}
              </button>
            </div>
          )}
        </div>
      )}

      <div
        onClick={() => { setShowBubble((value) => !value); setPulse(false); }}
        style={{
          width: 52,
          height: 52,
          borderRadius: '50%',
          background: isLight ? 'rgba(255,255,255,0.9)' : 'rgba(10, 14, 23, 0.8)',
          border: `2px solid ${C.blue}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          boxShadow: pulse ? '0 0 0 0 rgba(74, 158, 255, 0.7)' : (isLight ? '0 6px 16px rgba(15,23,42,0.18)' : '0 4px 12px rgba(0,0,0,0.5)'),
          animation: pulse ? 'pulseBlue 2s infinite' : 'none',
          backdropFilter: 'blur(10px)',
          fontSize: 'calc(24px * var(--font-scale, 1))',
        }}
      >
        <style
          dangerouslySetInnerHTML={{
            __html: `
          @keyframes pulseBlue {
            0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(74, 158, 255, 0.7); }
            70% { transform: scale(1); box-shadow: 0 0 0 15px rgba(74, 158, 255, 0); }
            100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(74, 158, 255, 0); }
          }
          @keyframes fadeInUp {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
          }
          .copilot-dot-pulse {
            animation: blink 1.5s infinite;
          }
          @keyframes blink { 0% { opacity: 0.2; } 50% { opacity: 1; } 100% { opacity: 0.2; } }
        `,
          }}
        />
        🧠
      </div>
    </div>
  );
}
