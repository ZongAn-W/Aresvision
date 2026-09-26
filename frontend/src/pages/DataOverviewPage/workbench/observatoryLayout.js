/**
 * 行星观测台布局契约（纯函数，不依赖 React / DOM / CSS）。
 *
 * 观测台把数据总览从左右固定栏改成「顶部观测条件 + 全幅行星画布 + 时间轨道 +
 * 底部分析区」。尺寸只在这里计算一次，Shell、CSS 与测试都读同一份结果，
 * 避免三处各维护一套数字而在改版后再次漂移。
 *
 * 约定：
 * - 所有输入都是真实 DOM 测得的非负 CSS 像素；
 * - `view` 只允许 `observe` / `analyze`；
 * - `sceneHeight` / `dockHeight` 始终是有限的非负数，`dockHeight: null`
 *   表示分析区使用自然内容高度（窄屏 / 矮屏的文档流布局）。
 */

export const OBSERVATORY_VIEWS = Object.freeze(['observe', 'analyze']);

/**
 * 把 adapter 的模式目录映射成 AnalysisDock 需要的分组列表。
 *
 * 分组标题不在这一层改写：`overviewChartLayout.MODE_DEFS` 是标题的唯一来源，
 * 面向用户的名称已经按观测台的说法写在那边。这里再存一份副本只会让两处漂移，
 * 正是这次清理掉的那种重复。
 */
export function buildObservatoryGroups(modeDefs) {
  const rows = Array.isArray(modeDefs) ? modeDefs : [];
  return rows.map((def) => ({
    id: def.id,
    color: def.color,
    title: def.title,
    desc: def.desc,
  }));
}

/** 观测台尺寸常量：CSS 自定义属性与纯函数共用同一组基准值。 */
export const OBSERVATORY_LAYOUT = Object.freeze({
  /** 顶部观测条件栏基准高度；文字放大或换行后可增高。 */
  toolbarHeight: 64,
  /** 时间轨道基准高度。 */
  timelineHeight: 64,
  /**
   * 观测模式不显示底部分析区：观测档只留星球、数据、变量、时间与画布，
   * 画布直接吃掉全部剩余高度，分析入口在时间轨道右侧。因此这里的基准是 0，
   * 而不是一个「只放紧凑预览」的固定高度。
   */
  compactDockHeight: 0,
  /** 分析模式下球体空间参照的上下限。 */
  analyzeSceneMin: 160,
  analyzeSceneMax: 240,
  /** 分析模式球体高度占主体的比例。 */
  analyzeSceneRatio: 0.28,
  /** 文档流布局下的球体高度：观测更大、分析更小，两者都不低于 280px。 */
  flowSceneHeight: 420,
  flowAnalyzeSceneHeight: 280,
  /** 分析区最小可用高度。 */
  minDockHeight: 288,
  /** 画布最小可用高度。 */
  minSceneHeight: 320,
  /** 完整两档桌面布局的最小工作区高度。 */
  minDesktopContentHeight: 576,
  /** 桌面完整布局所需的最小工作区宽度。 */
  desktopBreakpoint: 1024,
  /** 小于该宽度使用两行以上的控件排布与模态抽屉。 */
  narrowBreakpoint: 720,
  /** 场景容器最小宽度（原契约保留，供三维场景判断）。 */
  minSceneWidth: 320,
  /** 工作区默认外边距。 */
  gutter: 16,
  /** 临时设置面板宽度。 */
  panelWidth: 320,
});

function toFinitePx(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return 0;
  return number;
}

function normalizeView(view) {
  return OBSERVATORY_VIEWS.includes(view) ? view : 'observe';
}

/**
 * 计算观测台两档尺寸预算。
 *
 * 输入必须是「与内容无关」的测量值：工作区高度由窗口高度减去外壳顶部位置得到，
 * `toolbarHeight` 使用基准常量而不是实测高度。因为本函数的结果会回写到 Grid 行高，
 * 若输入依赖外壳自身高度或行高，就会形成越排越高的正反馈。
 *
 * 桌面（宽 ≥ 1024 且工作区高度足够）返回有限的两档高度；否则返回文档流布局，
 * 由 CSS 决定自然高度，只给出球体高度建议值，避免把图表和球体压扁。
 */
export function getObservatoryLayout({
  width,
  height,
  navHeight,
  toolbarHeight = OBSERVATORY_LAYOUT.toolbarHeight,
  timelineHeight = OBSERVATORY_LAYOUT.timelineHeight,
  view = 'observe',
} = {}) {
  const contentHeight = Math.max(0, toFinitePx(height) - toFinitePx(navHeight) - toFinitePx(toolbarHeight));
  const rail = toFinitePx(timelineHeight);
  const normalized = normalizeView(view);
  // 桌面两档布局需要固定留出「时间轨道 + 一张可读主图」的高度；
  // 达不到就改用文档流，避免把 Plotly 主图压到无法阅读。
  const requiredContent = Math.max(
    OBSERVATORY_LAYOUT.minDesktopContentHeight,
    rail + OBSERVATORY_LAYOUT.minSceneHeight + OBSERVATORY_LAYOUT.compactDockHeight,
  );
  const useFlow = toFinitePx(width) < OBSERVATORY_LAYOUT.desktopBreakpoint || contentHeight < requiredContent;

  if (useFlow) {
    return {
      flow: true,
      view: normalized,
      contentHeight,
      toolbarHeight: toFinitePx(toolbarHeight),
      timelineHeight: rail,
      // 文档流下由 CSS 使用这个高度；固定像素避免 0 / NaN 高度导致图表量不到尺寸。
      sceneHeight: normalized === 'analyze'
        ? OBSERVATORY_LAYOUT.flowAnalyzeSceneHeight
        : OBSERVATORY_LAYOUT.flowSceneHeight,
      dockHeight: null,
    };
  }

  const bodyHeight = Math.max(0, contentHeight - rail);
  // 分析档把球体压成空间参照，其余高度给主图；观测档没有分析区，画布吃掉全部主体高度。
  const sceneHeight = normalized === 'analyze'
    ? Math.max(
      OBSERVATORY_LAYOUT.analyzeSceneMin,
      Math.min(OBSERVATORY_LAYOUT.analyzeSceneMax, Math.round(bodyHeight * OBSERVATORY_LAYOUT.analyzeSceneRatio)),
    )
    : bodyHeight;

  return {
    flow: false,
    view: normalized,
    contentHeight,
    toolbarHeight: toFinitePx(toolbarHeight),
    timelineHeight: rail,
    sceneHeight,
    dockHeight: normalized === 'analyze' ? Math.max(0, bodyHeight - sceneHeight) : 0,
  };
}

function cardStatus(card) {
  return card?.state?.status ?? card?.status ?? null;
}

/**
 * 选择当前主图。
 *
 * 规则（与计划第 5 节一致）：
 * 1. 原来的选择仍然有效就保留，避免切模式 / 切组时图表无故跳走；
 * 2. 否则优先 `preferred`（默认年内全球变化）；
 * 3. 再否则取第一张有数据依据的卡片（不是 unsupported）；
 * 4. 全部不可用时退化为第一张，让用户看到真实的不可用原因而不是空白。
 */
export function pickActiveCard(cards, previous, preferred = 'globalTrend') {
  const rows = Array.isArray(cards) ? cards : [];
  if (previous && rows.some((card) => card?.key === previous)) return previous;
  const supported = rows.filter((card) => cardStatus(card) !== 'unsupported');
  return supported.find((card) => card?.key === preferred)?.key
    ?? supported[0]?.key
    ?? rows[0]?.key
    ?? null;
}

/** 分析分组切换后要落到哪张图：该组上次看图仍有效则保留，否则取合法项。 */
export function pickCardForGroup({ cards, previous, preferred = 'globalTrend' } = {}) {
  return pickActiveCard(cards, previous, preferred);
}

/** 观模式紧凑预览是否可用：只有 ready 的全局趋势才画真实曲线。 */
export function isTrendPreviewReady(card) {
  return cardStatus(card) === 'ready' && Boolean(card?.state?.data);
}

/** 场景容器是否需要按计算高度显式设高（文档流交给 CSS）。 */
export function sceneStyle(layout) {
  if (!layout || layout.flow) return null;
  return { height: `${layout.sceneHeight}px` };
}

/** 底部分析区高度；`dockHeight` 为 null 时不写 height，交给自然内容。 */
export function dockStyle(layout) {
  if (!layout || layout.flow || !Number.isFinite(layout.dockHeight)) return null;
  return { height: `${layout.dockHeight}px` };
}

/**
 * 分析档主图的像素高度。
 *
 * 分析区里除主图外还有：固定的头部（分组行 + 图表选择行 + 分隔线）、主图卡片
 * 自己的说明行与图下一行注脚、以及下方一行「点位/序列 + AI」面板。主图不能靠
 * `flex: 1` 去抢高度：下方的面板会把它挤到最小高度，主图反而变小。这里直接算出
 * 确定高度交给图表，`reserve` 是被下方那一行占掉的像素。
 *
 * 数值来源（1440×900、分析区 702px 实测）：头部 81 + 分析区内边距 10 + 主图卡片
 * 自有的说明行 24 + 注脚 36 + 行间距 30 = 181；主图 = 分析区高 − 181 − reserve。
 */
export const DOCK_MAIN_CHART_CHROME = 181;

/** 下方同时有点位/序列面板与 AI 面板时预留的高度（两者并排 + 摘要行 + 两条曲线）。 */
export const DOCK_BOTTOM_PAIR_HEIGHT = 256;

/** 下方只有一条面板时预留的高度（整幅宽，单行）。 */
export const DOCK_BOTTOM_SINGLE_HEIGHT = 140;

/** 依下方实际面板算预留高度；两者都没有时不预留。 */
export function dockBottomReserve(hasPoint, hasAi) {
  if (!hasPoint && !hasAi) return 0;
  return hasPoint && hasAi ? DOCK_BOTTOM_PAIR_HEIGHT : DOCK_BOTTOM_SINGLE_HEIGHT;
}

export function dockMainChartHeight(dockHeight, { min = 220, reserve = 0 } = {}) {
  const total = Number(dockHeight);
  if (!Number.isFinite(total) || total <= 0) return min;
  const extra = Number.isFinite(Number(reserve)) && Number(reserve) > 0 ? Number(reserve) : 0;
  return Math.max(min, Math.round(total - DOCK_MAIN_CHART_CHROME - extra));
}
