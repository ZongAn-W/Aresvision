/** Shared layout owns both planets' rails, scene and overlays. */
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import DeepSpaceBackdrop from '../DeepSpaceBackdrop';
import { OVERVIEW_LAYOUT, shouldUseCompactOverview } from './overviewVisualContract.js';
import './overviewWorkbench.css';

export const NAVBAR_HEIGHT = OVERVIEW_LAYOUT.navbarHeight;
export const MIN_SCENE_WIDTH = OVERVIEW_LAYOUT.minSceneWidth;
const LayoutContext = createContext({ offsetX: 0, compact: false });
export const useOverviewLayout = () => useContext(LayoutContext);

export default function OverviewShell({
  planet = 'mars', isLight = false, scene, sidebar, analysis, timeline, overlay,
  notification, children,
  leftWidth = OVERVIEW_LAYOUT.leftWidth, rightWidth = OVERVIEW_LAYOUT.rightWidth,
  onLeftWidthChange, onRightWidthChange,
}) {
  const [viewport, setViewport] = useState(() => typeof window === 'undefined' ? 1440 : window.innerWidth);
  const cleanupDrag = useRef(null);
  const compact = shouldUseCompactOverview(viewport);
  // Clamp displayed widths after a window resize, while retaining each planet's preference.
  const available = Math.max(0, viewport - MIN_SCENE_WIDTH - 8);
  const scale = Math.min(1, available / (leftWidth + rightWidth));
  const left = Math.round(leftWidth * scale);
  const right = Math.round(rightWidth * scale);
  const offsetX = compact ? 0 : (right - left) / 2;
  useEffect(() => {
    const measure = () => setViewport(window.innerWidth);
    window.addEventListener('resize', measure);
    return () => { window.removeEventListener('resize', measure); cleanupDrag.current?.(); };
  }, []);
  const startResize = useCallback((side) => (event) => {
    event.preventDefault();
    cleanupDrag.current?.();
    const startX = event.clientX;
    const startWidth = side === 'left' ? left : right;
    const setWidth = side === 'left' ? onLeftWidthChange : onRightWidthChange;
    const other = side === 'left' ? right : left;
    if (!setWidth) return;
    const onMouseMove = (move) => {
      const delta = (move.clientX - startX) * (side === 'left' ? 1 : -1);
      const minimum = side === 'left' ? 240 : 360;
      setWidth(Math.max(minimum, Math.min(startWidth + delta, window.innerWidth - other - MIN_SCENE_WIDTH - 8)));
    };
    const stop = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', stop);
      cleanupDrag.current = null;
      window.dispatchEvent(new Event('resize'));
    };
    cleanupDrag.current = stop;
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', stop);
  }, [left, right, onLeftWidthChange, onRightWidthChange]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    return () => cancelAnimationFrame(frame);
  }, [left, right]);
  return (
    <LayoutContext.Provider value={{ compact, offsetX }}>
      <div className={`overview-shell${compact ? ' overview-shell--compact' : ''}${isLight ? ' is-light' : ''}`}
        data-planet={planet} style={{
          '--overview-left-width': `${left}px`, '--overview-right-width': `${right}px`,
          '--overview-navbar-height': `${NAVBAR_HEIGHT}px`,
          '--overview-scene-left': `${compact ? 0 : left}px`, '--overview-scene-right': `${compact ? 0 : right}px`,
          '--overview-timeline-bottom': `${OVERVIEW_LAYOUT.timelineBottom}px`,
          '--overview-overlay-gap': `${OVERVIEW_LAYOUT.overlayGap}px`,
        }}>
        <DeepSpaceBackdrop />
        <div className="overview-shell__scene">{scene}</div>
        <div className="overview-shell__sidebar overview-panel-surface">
          {sidebar}
          {!compact && onLeftWidthChange ? <div className="overview-resizer overview-resizer--left" role="separator" aria-orientation="vertical" aria-label="Resize left panel" onMouseDown={startResize('left')} /> : null}
        </div>
        <div className="overview-shell__analysis overview-panel-surface">
          {analysis}
          {!compact && onRightWidthChange ? <div className="overview-resizer overview-resizer--right" role="separator" aria-orientation="vertical" aria-label="Resize right panel" onMouseDown={startResize('right')} /> : null}
        </div>
        <div className="overview-shell__timeline">{timeline}</div>
        <div className="overview-shell__overlays">{overlay}</div>
        {notification}{children}
      </div>
    </LayoutContext.Provider>
  );
}
