/**
 * Mars 左栏遗留控件（兼容外壳）。
 *
 * 观测台改版后不再有常驻左栏：Mars 的条件栏与设置面板分别由
 * `ObservatoryMars.jsx` 组装。本文件保留两项职责，避免既有导入与回归断言失效：
 *
 * 1. 重新导出数据源选择控件（`SourceScopePicker` / `OzoneSourceModePicker`），
 *    它们承载官方 / 个人 MCD、OpenMARS、NOMAD 的完整来源切换流程；
 * 2. 导出 `SidebarMenu` 兼容组件：把面板内容渲染进一个最小容器，供尚未迁移的
 *    调用方使用；观测台本身不再渲染它。
 *
 * 不再有固定宽度、拖拽改宽或导航高度偏移。
 */

import React from 'react';
import C from '../../constants/colors';
import { useSettings } from '../../contexts/SettingsContext';
import { useMarsObservatoryPanels } from './ObservatoryMars.jsx';
export {
  OzoneSourceModePicker,
  SourceScopePicker,
} from './MarsSourceControls.jsx';

export { MODE_DEFS as SHARED_MODE_DEFS } from './overviewChartLayout';

/**
 * 兼容渲染器：`panel` 指定要显示的面板内容（source / layers / display / point）。
 * 观测台使用 `ObservatoryTools` + `useMarsObservatoryPanels()`；这个组件只为
 * 旧调用点保留，不参与观测台布局。
 */
export default function SidebarMenu({ sceneSwitch = null, embedded = false, panel = 'layers' }) {
  const { settings } = useSettings();
  const isLight = settings?.theme === 'light';
  const { panels } = useMarsObservatoryPanels();

  const content = (() => {
    if (panel === 'source') return panels.source;
    if (panel === 'display') return panels.display;
    if (panel === 'point') return panels.point;
    return panels.layers;
  })();

  return (
    <div
      className={embedded ? 'overview-sidebar overview-sidebar--embedded' : undefined}
      data-sidebar-panel={panel}
      style={{
        display: 'grid',
        gap: 12,
        alignContent: 'start',
        padding: 12,
        minWidth: 0,
        background: isLight ? 'rgba(255,255,255,0.72)' : 'rgba(255,255,255,0.02)',
        color: C.ice,
      }}
    >
      {sceneSwitch ? <div data-testid="planet-scene-switch-slot">{sceneSwitch}</div> : null}
      {content}
    </div>
  );
}
