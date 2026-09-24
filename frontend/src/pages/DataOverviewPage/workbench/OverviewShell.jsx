/**
 * 共用三栏分析工作台外壳。
 *
 * Mars 与 Earth 使用同一份结构：全屏三维场景 + 左侧控件栏 + 右侧分析栏 +
 * 底部时间轴 + 叠加层（状态栏、AI、图例、手势 HUD）。左右面板可拖动调宽，
 * 中央始终保留最小可用空间；窄屏改为顺序布局，避免面板挤掉球体。
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';

import './overviewWorkbench.css';

export const NAVBAR_HEIGHT = 70;
export const MIN_SCENE_WIDTH = 280;

export default function OverviewShell({
  planet = 'mars',
  isLight = false,
  scene = null,
  sidebar = null,
  analysis = null,
  timeline = null,
  overlay = null,
  notification = null,
  leftWidth = 280,
  rightWidth = 540,
  onLeftWidthChange = null,
  onRightWidthChange = null,
  leftResizable = true,
  rightResizable = true,
  sceneOffset = null,
  // 'slots'：外壳提供左右固定面板容器（Earth 使用）。
  // 'external'：面板自行定位，外壳只负责槽位组合（Mars 兼容路径，
  //   SidebarMenu / DetailPanel 自身是 position: fixed 面板）。
  panelMode = 'slots',
  children = null,
}) {
  const [compact, setCompact] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    const measure = () => {
      const width = typeof window === 'undefined' ? 1440 : window.innerWidth;
      setCompact(width <= 900);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const startResize = useCallback((side) => (event) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = side === 'left' ? leftWidth : rightWidth;
    const setWidth = side === 'left' ? onLeftWidthChange : onRightWidthChange;
    if (typeof setWidth !== 'function') return;

    const onMouseMove = (moveEvent) => {
      const delta = moveEvent.clientX - startX;
      const viewport = typeof window === 'undefined' ? 1440 : window.innerWidth;
      const other = side === 'left' ? rightWidth : leftWidth;
      const maxWidth = Math.max(200, viewport - other - MIN_SCENE_WIDTH);
      const raw = side === 'left' ? startWidth + delta : startWidth - delta;
      setWidth(Math.max(200, Math.min(raw, maxWidth)));
    };
    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      window.dispatchEvent(new Event('resize'));
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [leftWidth, rightWidth, onLeftWidthChange, onRightWidthChange]);

  if (panelMode === 'external') {
    // Mars 兼容路径：面板自行定位，结构完全沿用原页面，只把槽位组合交给外壳。
    return (
      <div
        className={`overview-shell overview-shell--external${isLight ? ' is-light' : ''}`}
        data-planet={planet}
        ref={containerRef}
      >
        {scene}
        {sidebar}
        {analysis}
        {timeline}
        {overlay}
        {notification}
        {children}
      </div>
    );
  }

  const panelBackground = isLight ? 'rgba(255,255,255,0.86)' : 'rgba(10,12,18,0.62)';
  const borderSoft = isLight ? 'rgba(15,23,42,0.10)' : 'rgba(255,255,255,0.08)';

  if (compact) {
    // 窄屏：控件区、主视图、图表区顺序排列，不固定叠加面板。
    return (
      <div className="overview-shell overview-shell--compact" data-planet={planet} ref={containerRef}>
        <div className="overview-shell__scene overview-shell__scene--compact">
          {scene}
          {overlay}
        </div>
        <div className="overview-shell__compact-panels">
          <div className="overview-shell__compact-panel">{sidebar}</div>
          <div className="overview-shell__compact-panel">{timeline}</div>
          <div className="overview-shell__compact-panel">{analysis}</div>
        </div>
        {notification}
        {children}
      </div>
    );
  }

  return (
    <div className="overview-shell" data-planet={planet} ref={containerRef}>
      <div className="overview-shell__scene">
        {scene}
      </div>

      <div
        className="overview-shell__sidebar"
        style={{
          position: 'fixed',
          left: 0,
          top: `${NAVBAR_HEIGHT}px`,
          width: leftWidth,
          height: `calc(100vh - ${NAVBAR_HEIGHT}px)`,
          zIndex: 1000,
          background: panelBackground,
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderRight: `1px solid ${borderSoft}`,
        }}
      >
        {sidebar}
        {leftResizable ? (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize left panel"
            onMouseDown={startResize('left')}
            style={{
              position: 'absolute', right: -3, top: 0, bottom: 0, width: 6,
              cursor: 'col-resize', zIndex: 10, background: 'transparent',
            }}
          />
        ) : null}
      </div>

      <div
        className="overview-shell__analysis"
        style={{
          position: 'fixed',
          right: 0,
          top: `${NAVBAR_HEIGHT}px`,
          width: rightWidth,
          height: `calc(100vh - ${NAVBAR_HEIGHT}px)`,
          zIndex: 1000,
          background: panelBackground,
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderLeft: `1px solid ${borderSoft}`,
        }}
      >
        {analysis}
        {rightResizable ? (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize right panel"
            onMouseDown={startResize('right')}
            style={{
              position: 'absolute', left: -3, top: 0, bottom: 0, width: 6,
              cursor: 'col-resize', zIndex: 10, background: 'transparent',
            }}
          />
        ) : null}
      </div>

      {timeline}
      {overlay}
      {notification}
      {children}
      <span hidden data-scene-offset={sceneOffset ?? ''} />
    </div>
  );
}
