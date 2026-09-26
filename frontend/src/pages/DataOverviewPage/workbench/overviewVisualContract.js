/**
 * 数据总览的可见性契约。
 *
 * 观测台改版后页面不再有左右固定栏：常量只描述「导航高度」「画布最小宽度」
 * 与设置面板宽度；两档尺寸预算统一由 observatoryLayout.js 计算。
 * `OVERVIEW_GLOBE` 继续独立描述两个星球共用的科学场景参数（缩放、粒子、
 * 光照模式），不随布局改动。
 */

import { OBSERVATORY_LAYOUT } from './observatoryLayout.js';

export const OVERVIEW_LAYOUT = Object.freeze({
  navbarHeight: 70,
  /** 临时设置面板宽度（贴画布左边，覆盖场景）。 */
  panelWidth: OBSERVATORY_LAYOUT.panelWidth,
  minSceneWidth: OBSERVATORY_LAYOUT.minSceneWidth,
  /** 观测台完整两档布局的最小宽度与最小工作区高度。 */
  desktopBreakpoint: OBSERVATORY_LAYOUT.desktopBreakpoint,
  minDesktopContentHeight: OBSERVATORY_LAYOUT.minDesktopContentHeight,
  gutter: OBSERVATORY_LAYOUT.gutter,
  timelineHeight: OBSERVATORY_LAYOUT.timelineHeight,
  toolbarHeight: OBSERVATORY_LAYOUT.toolbarHeight,
  compactDockHeight: OBSERVATORY_LAYOUT.compactDockHeight,
  analyzeSceneMin: OBSERVATORY_LAYOUT.analyzeSceneMin,
  analyzeSceneMax: OBSERVATORY_LAYOUT.analyzeSceneMax,
  /** 文档流布局下的球体高度建议值。 */
  flowSceneHeight: 360,
  flowAnalyzeSceneHeight: 280,
  /** 窄屏阈值：以下使用多行控件与模态抽屉。 */
  narrowBreakpoint: OBSERVATORY_LAYOUT.narrowBreakpoint,
  overlayGap: 14,
});

export const OVERVIEW_SURFACE = Object.freeze({
  darkPanel: 'rgba(10,12,18,0.62)',
  darkPanelStrong: 'rgba(10,12,18,0.82)',
  darkBorder: 'rgba(255,255,255,0.08)',
  lightPanel: 'rgba(255,255,255,0.86)',
  lightBorder: 'rgba(15,23,42,0.10)',
  blur: '20px',
});

// The particle globe keeps one visual baseline for both planets.  Planet
// adapters may still add their own texture, coastline and seasonal lighting.
export const OVERVIEW_GLOBE = Object.freeze({
  zoom: 3.75,
  palette: Object.freeze({ fieldTint: null, pointTint: '#34d399' }),
  particleDensity: 120,
  particleSize: 0.01,
  pointParticleSize: 0.024,
  darkGlobeColor: 0x14304f,
  lightGlobeColor: 0xcddff2,
  globeShininess: 6,
  lightingMode: 'fixed',
});

/**
 * 画布可用宽度。观测台没有左右栏，默认偏移为 0，保留参数只为兼容既有调用，
 * 禁止再按 viewport 减栏宽推算画布尺寸。
 */
export function desktopSceneWidth(viewportWidth, inset = 2 * OVERVIEW_LAYOUT.gutter) {
  return viewportWidth - inset;
}

/** 是否需要文档流布局：窗口过窄，或扣掉导航/条件栏后的工作区过矮。 */
export function shouldUseCompactOverview(viewportWidth, contentHeight = Number.POSITIVE_INFINITY) {
  return viewportWidth < OVERVIEW_LAYOUT.desktopBreakpoint
    || contentHeight < OVERVIEW_LAYOUT.minDesktopContentHeight;
}
