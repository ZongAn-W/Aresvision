function formatPx(value) {
  return `${Math.max(0, Math.round(value))}px`;
}

/**
 * 观测台外壳。
 *
 * 结构固定为：顶部观测条件栏 → 全幅行星画布 → 时间轨道 → 底部分析区。
 * 两档布局（observe / analyze）共用同一个场景容器：切换 view 只改 Grid 行高，
 * 不改变 scene 的 React 元素身份，因此三维实例、相机与在途业务请求都不会重建。
 *
 * 尺寸来源只有一个，而且必须与内容无关：窗口可用高度取自 `window.innerHeight`
 * 减去实测到的全站导航高度。绝不能使用外壳自身高度或网格行高，因为行高由本次
 * 计算结果回写，用自身尺寸当输入会形成“越排越高”的正反馈。
 */

import React, {
  createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState,
} from 'react';
import DeepSpaceBackdrop from '../DeepSpaceBackdrop';
import { OVERVIEW_LAYOUT, shouldUseCompactOverview } from './overviewVisualContract.js';
import { getObservatoryLayout } from './observatoryLayout.js';
import './overviewWorkbench.css';

export const NAVBAR_HEIGHT = OVERVIEW_LAYOUT.navbarHeight;
export const MIN_SCENE_WIDTH = OVERVIEW_LAYOUT.minSceneWidth;

const LayoutContext = createContext({
  compact: false,
  flow: false,
  offsetX: 0,
  panelWidth: OVERVIEW_LAYOUT.panelWidth,
  sceneRef: { current: null },
  panelHostRef: { current: null },
  sceneHeight: null,
  dockHeight: null,
  openPanel: null,
  setOpenPanel: () => {},
  registerPanelButton: () => () => {},
});

export const useOverviewLayout = () => useContext(LayoutContext);

function useElementWidth(ref) {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const read = () => {
      const next = node.getBoundingClientRect().width;
      setWidth((previous) => (Math.abs(previous - next) < 0.5 ? previous : next));
    };
    read();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(read);
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

export default function OverviewShell({
  planet = 'earth',
  isLight = false,
  view = 'observe',
  onViewChange = null,
  toolbar = null,
  tools = null,
  rail = null,
  railEnd = null,
  scene = null,
  timeline = null,
  analysis = null,
  overlay = null,
  notification = null,
  children = null,
  openPanel = null,
  onOpenPanelChange = null,
}) {
  const shellRef = useRef(null);
  const sceneRef = useRef(null);
  const panelHostRef = useRef(null);
  const panelButtonRefs = useRef(new Map());
  const [viewport, setViewport] = useState(() => (
    typeof window === 'undefined'
      ? { width: 1440, height: 900 }
      : { width: window.innerWidth, height: window.innerHeight }
  ));
  // 全站导航的实际高度：直接量 `nav.nav-glass`，不在各处复制 70px。
  // 必须量导航本身而不是外壳自己的 top——外壳用 top 让开导航，量自己会得到 0。
  const [chromeHeight, setChromeHeight] = useState(OVERVIEW_LAYOUT.navbarHeight);

  useEffect(() => {
    const measure = () => setViewport((previous) => (
      previous.width === window.innerWidth && previous.height === window.innerHeight
        ? previous
        : { width: window.innerWidth, height: window.innerHeight }
    ));
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  useLayoutEffect(() => {
    const read = () => {
      const nav = typeof document === 'undefined' ? null : document.querySelector('nav.nav-glass');
      const height = nav ? nav.getBoundingClientRect().height : OVERVIEW_LAYOUT.navbarHeight;
      if (Number.isFinite(height) && height > 0) {
        setChromeHeight((previous) => (Math.abs(previous - height) < 1 ? previous : height));
      }
    };
    read();
    const nav = document.querySelector('nav.nav-glass');
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(read);
    if (nav) observer?.observe(nav);
    window.addEventListener('resize', read);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', read);
    };
  }, [viewport.width, viewport.height]);

  const shellWidth = useElementWidth(shellRef);

  // 可用高度只来自窗口与全站导航：`window.innerHeight - 导航高度`。
  // 不使用外壳自身高度、也不使用网格行高，否则会形成越排越高的正反馈。
  // 条件栏高度直接使用基准常量：它本身就是 Grid 行高，反向测量会自我压缩。
  const measuredHeight = Math.max(0, viewport.height - Math.max(0, chromeHeight));

  const layout = useMemo(() => getObservatoryLayout({
    width: shellWidth || viewport.width,
    height: viewport.height,
    navHeight: chromeHeight,
    timelineHeight: timeline ? OVERVIEW_LAYOUT.timelineHeight : 0,
    view,
  }), [chromeHeight, shellWidth, timeline, view, viewport.height, viewport.width]);

  const compact = shouldUseCompactOverview(viewport.width, layout.contentHeight);
  const flow = layout.flow;

  const setOpenPanel = useCallback((next) => {
    onOpenPanelChange?.(next ?? null);
    if (next == null) panelButtonRefs.current.get(openPanel)?.focus?.();
  }, [onOpenPanelChange, openPanel]);

  const registerPanelButton = useCallback((key) => (node) => {
    if (node) panelButtonRefs.current.set(key, node);
    else panelButtonRefs.current.delete(key);
  }, []);

  // Escape 关闭当前设置面板并把焦点还给触发按钮；一次只允许一个面板打开。
  useEffect(() => {
    if (!openPanel) return undefined;
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setOpenPanel(null);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [openPanel, setOpenPanel]);

  const sceneHeight = layout.sceneHeight;
  const layoutDockHeight = layout.dockHeight;
  // 调用方可以不传场景（例如分析档只放主图、不显示球体）；
  // 这时场景行整行不渲染，高度归零并交给分析区。
  const hasScene = Boolean(scene);
  // 分析区的「有效高度」：没有场景时它还拿走原本留给场景的那一段。
  // 上下文与 CSS 必须用同一个值，否则图表会按旧高度留白。
  const effectiveDockHeight = flow ? null : Math.round(
    (hasScene ? 0 : sceneHeight) + (layoutDockHeight || 0)
    + (!timeline && view === 'analyze' ? layout.timelineHeight : 0),
  );
  // 工作区相对导航下移：外壳是普通文档流元素，偏移量只写在内联 top 上。
  const shellOffsetStyle = flow
    ? { marginTop: formatPx(chromeHeight) }
    : { position: 'relative', top: formatPx(chromeHeight) };

  const contextValue = useMemo(() => ({
    compact,
    flow,
    // 兼容字段：旧组件曾按左右栏推算偏移；观测台没有左右栏，固定 0。
    offsetX: 0,
    panelWidth: OVERVIEW_LAYOUT.panelWidth,
    sceneRef,
    panelHostRef,
    sceneHeight,
    dockHeight: effectiveDockHeight,
    openPanel,
    setOpenPanel,
    registerPanelButton,
    onViewChange,
  }), [
    compact, effectiveDockHeight, flow, onViewChange, openPanel,
    registerPanelButton, sceneHeight, setOpenPanel,
  ]);

  return (
    <LayoutContext.Provider value={contextValue}>
      <div
        ref={shellRef}
        className={`overview-shell${flow ? ' overview-shell--flow' : ''}${isLight ? ' is-light' : ''}${rail ? ' overview-shell--with-rail' : ''}${railEnd ? ' overview-shell--with-rail-end' : ''}`}
        data-planet={planet}
        data-observatory-view={view}
        data-observatory-layout={flow ? 'flow' : 'desktop'}
        data-observatory-rail={rail ? 'left' : 'bottom'}
        data-observatory-rail-end={railEnd ? 'right' : 'none'}
        data-observatory-scene={hasScene ? 'visible' : 'hidden'}
        data-available-height={Math.round(measuredHeight)}
        data-toolbar-baseline={OVERVIEW_LAYOUT.toolbarHeight}
        data-chrome-height={Math.round(chromeHeight)}
        style={{
          // 桌面两档布局把工作区钉在导航下方的一屏高度内：导航是 fixed 浮层
          // （z-index 2000），工作区若从 0 开始，条件栏会被它压住。
          ...(flow
            ? null
            : {
              height: formatPx(measuredHeight),
              minHeight: 0,
              overflow: 'hidden',
            }),
          ...shellOffsetStyle,
          '--overview-toolbar-height': `${OVERVIEW_LAYOUT.toolbarHeight}px`,
          // 观测档 + 竖轨：时间轴就是那条竖轨，底部时间轨道行高度为 0（整行不渲染），
          // 画布因此吃掉这一行的高度。
          '--overview-timeline-height': `${timeline ? OVERVIEW_LAYOUT.timelineHeight : 0}px`,
          '--overview-scene-height': `${hasScene ? Math.round(sceneHeight) : 0}px`,
          // 没有场景时把场景那一行的高度让给分析区，主图因此拿到整块剩余空间。
          '--overview-dock-height': effectiveDockHeight == null ? 'auto' : `${effectiveDockHeight}px`,
          // 竖轨纵向贯穿「场景 + 时间轨道 + 分析区」三行。
          '--overview-rail-row-height': `${Math.round(sceneHeight + (layoutDockHeight || 0))}px`,
          '--overview-panel-width': `${OVERVIEW_LAYOUT.panelWidth}px`,
          '--overview-gutter': `${OVERVIEW_LAYOUT.gutter}px`,
          '--overview-overlay-gap': `${OVERVIEW_LAYOUT.overlayGap}px`,
          '--overview-timeline-bottom': `${OVERVIEW_LAYOUT.overlayGap}px`,
        }}
      >
        <DeepSpaceBackdrop />

        <header className="overview-shell__toolbar">
          <div className="overview-shell__toolbar-inner">{toolbar}</div>
        </header>

        {/*
          观测刻度轨：观测档把时间轴立在画布左侧，因此它和画布共用同一行的两列，
          底部不再有独立的时间轨道行。没有 rail 的调用方可使用独立 timeline 槽位。
        */}
        {rail ? <div className="overview-shell__rail">{rail}</div> : null}

        {hasScene ? (
          <main className="overview-shell__scene" ref={sceneRef}>
            {scene}
            {overlay ? <div className="overview-shell__overlays">{overlay}</div> : null}
          </main>
        ) : null}

        {railEnd ? <div className="overview-shell__rail-end">{railEnd}</div> : null}

        {timeline ? <div className="overview-shell__timeline">{timeline}</div> : null}

        <section className="overview-shell__analysis">{analysis}</section>

        {/* 设置面板是浮层，必须留在 Grid 之外，否则会被自动放进隐式网格行。 */}
        <div className="overview-shell__tools" ref={panelHostRef}>{tools}</div>
        {notification}
        {children}
      </div>
    </LayoutContext.Provider>
  );
}
