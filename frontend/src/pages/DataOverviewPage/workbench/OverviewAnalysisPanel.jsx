/**
 * 共用分析模式选择器与卡片面板。
 *
 * 模式顺序、标题与卡片目录全部来自 adapter；Mars 与 Earth 渲染同一份组件，
 * 只有文案、可用状态与卡片内容不同。
 */

import React from 'react';
import GlowCard from '../../../components/GlowCard';
import C from '../../../constants/colors';
import OverviewCard from './OverviewCard.jsx';
import AnalysisModePicker, { modeDefinition } from './OverviewSidebarParts.jsx';


/**
 * 卡片面板：模式头 + 卡片列表。
 * `renderCard(card)` 返回卡片正文；不可用卡片不会调用它。
 */
export default function OverviewAnalysisPanel({
  mode,
  onModeChange = null,
  // 模式选择属于左栏（与 Mars 一致）。这里默认不重复渲染选择器，
  // 只在调用方明确要求时才在右栏内联显示。
  showModePicker = false,
  cards = [],
  expandedCard = '',
  onExpandedCardChange = null,
  renderCard = null,
  isZh = true,
  isLight = true,
  headerExtra = null,
  onRetryCard = null,
  headerOverride = null,
  listScroll = true,
}) {
  const def = modeDefinition(mode, isZh);
  const header = headerOverride
    ? {
      icon: headerOverride.icon ?? def.icon,
      color: headerOverride.color ?? def.color,
      title: headerOverride.title ?? def.title,
      desc: headerOverride.desc ?? def.desc,
    }
    : def;

  return (
    <>
      <GlowCard style={{ padding: '18px 20px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <span
              style={{
                width: 30, height: 30, marginRight: 14,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                borderRadius: 999, background: `${header.color}18`, color: header.color,
                fontSize: 'calc(13px * var(--font-scale, 1))', fontWeight: 800,
                fontFamily: 'var(--font-display)', flexShrink: 0,
              }}
            >
              {header.icon}
            </span>
            <h3
              style={{
                color: header.color, fontFamily: 'var(--font-display)',
                fontSize: 'calc(16px * var(--font-scale, 1))', fontWeight: 800,
                margin: 0, letterSpacing: '-0.01em',
              }}
            >
              {header.title}
            </h3>
          </div>
          {headerExtra}
        </div>
        <p style={{ color: C.ice60, fontFamily: 'var(--font-body)', fontSize: 'calc(12px * var(--font-scale, 1))', margin: 0, lineHeight: 1.65 }}>
          {header.desc}
        </p>
        {onModeChange && showModePicker ? (
          <div style={{ marginTop: 12 }}>
            <AnalysisModePicker mode={mode} onSelect={onModeChange} isZh={isZh} />
          </div>
        ) : null}
      </GlowCard>

      <div
        style={{
          // 默认由面板自身滚动。父级若已经是滚动容器（Earth 工作台把序列面板与
          // AI 解读一起放在同一个滚动列里），传入 listScroll=false，避免嵌套滚动
          // 与百分比高度让 Plotly 量到 NaN 尺寸。
          flex: listScroll ? '1 1 auto' : '0 0 auto',
          minHeight: 0,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          overflowX: 'hidden',
          overflowY: listScroll ? 'auto' : 'visible',
          scrollbarGutter: listScroll ? 'stable' : undefined,
          paddingRight: 4,
        }}
      >
        {cards.map((card) => {
          const expanded = expandedCard === card.key;
          return (
            <OverviewCard
              key={card.key}
              title={isZh ? card.title.zh : card.title.en}
              color={card.color || C.blue}
              state={card.state}
              expanded={expanded}
              onToggle={() => onExpandedCardChange?.(expanded ? '' : card.key)}
              isLight={isLight}
              isZh={isZh}
              onRetry={onRetryCard ? () => onRetryCard(card.key) : null}
            >
              {typeof renderCard === 'function' ? renderCard(card) : null}
            </OverviewCard>
          );
        })}
      </div>
    </>
  );
}
