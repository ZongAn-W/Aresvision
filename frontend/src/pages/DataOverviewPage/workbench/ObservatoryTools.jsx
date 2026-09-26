/**
 * 观测台的画布工具外壳：图层 / 点位 / 显示三个入口与对应设置面板。
 *
 * 面板内容由调用方提供（Mars 走 `DataOverviewContext`，Earth 走
 * `useOverviewController`），本组件只负责：
 * - 一次只打开一个面板，打开另一个会替换当前面板；
 * - 桌面使用贴画布左边的非模态面板，窄屏使用 MUI 模态抽屉并管理焦点；
 * - Escape / 关闭按钮退出，焦点交还触发按钮（按钮注册见 OverviewShell）。
 */

import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import Drawer from '@mui/material/Drawer';
import C from '../../../constants/colors';
import { useOverviewLayout } from './OverviewShell.jsx';
import { ToolbarToolButton } from './ObservatoryToolbar.jsx';

export const OBSERVATORY_TOOL_KEYS = Object.freeze(['layers', 'point', 'display']);

/** 数据源按钮在条件栏左侧，仍使用同一份焦点注册与面板状态。 */
export function ObservatorySourceButton({ label, openPanel, onOpenPanelChange }) {
  const { registerPanelButton } = useOverviewLayout();
  return <ToolbarToolButton label={label} active={openPanel === 'source'}
    buttonRef={registerPanelButton('source')}
    onClick={() => onOpenPanelChange?.(openPanel === 'source' ? null : 'source')} />;
}

export function ObservatoryPanelClose({ label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      style={{
        width: 32,
        height: 32,
        borderRadius: 8,
        border: `1px solid ${C.border}`,
        background: 'transparent',
        color: C.ice60,
        cursor: 'pointer',
        fontSize: 'calc(14px * var(--font-scale, 1))',
        lineHeight: 1,
        flexShrink: 0,
      }}
    >
      ✕
    </button>
  );
}

/** 面板骨架：可见标题 + 关闭按钮，桌面与窄屏共用同一份内容。 */
export function ObservatoryPanel({ title, onClose, closeLabel, children, testId = null }) {
  const titleId = `observatory-panel-${testId || 'panel'}`;
  return (
    <>
      <div className="observatory-panel__header">
        <h2 className="observatory-panel__title" id={titleId}>{title}</h2>
        <ObservatoryPanelClose label={closeLabel} onClick={onClose} />
      </div>
      <div className="observatory-panel__body">{children}</div>
    </>
  );
}

/**
 * 桌面非模态面板：不锁全页焦点，但整块面板阻止事件落入三维拖拽/选点。
 */
export function ObservatoryInlinePanel({ panelKey, title, closeLabel, onClose, children }) {
  const ref = useRef(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const stop = (event) => event.stopPropagation();
    // 指针事件与滚轮都要挡住，否则在面板里拖动会旋转球体。
    node.addEventListener('pointerdown', stop);
    node.addEventListener('wheel', stop, { passive: true });
    node.addEventListener('dblclick', stop);
    return () => {
      node.removeEventListener('pointerdown', stop);
      node.removeEventListener('wheel', stop);
      node.removeEventListener('dblclick', stop);
    };
  }, []);

  return (
    <aside
      ref={ref}
      className="observatory-panel"
      role="dialog"
      aria-modal="false"
      aria-label={title}
      data-panel={panelKey}
    >
      <ObservatoryPanel
        title={title}
        onClose={onClose}
        closeLabel={closeLabel}
        testId={panelKey}
      >
        {children}
      </ObservatoryPanel>
    </aside>
  );
}

/** 窄屏模态抽屉：MUI 负责焦点陷阱、Escape 与关闭后归还焦点。 */
export function ObservatoryDrawer({ panelKey, title, closeLabel, onClose, children }) {
  return (
    <Drawer
      anchor="bottom"
      open
      onClose={onClose}
      ModalProps={{ keepMounted: false, disableScrollLock: false }}
      PaperProps={{
        'aria-label': title,
        sx: {
          background: C.bgElevated,
          color: C.ice,
          border: `1px solid ${C.border}`,
          '--overview-hairline': C.border,
          '--overview-control-radius': '8px',
          maxHeight: '80vh',
          borderTopLeftRadius: 16,
          borderTopRightRadius: 16,
        },
      }}
      sx={{ zIndex: 2400 }}
    >
      <div data-panel={panelKey} style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <ObservatoryPanel
          title={title}
          onClose={onClose}
          closeLabel={closeLabel}
          testId={panelKey}
        >
          {children}
        </ObservatoryPanel>
      </div>
    </Drawer>
  );
}

/**
 * 工具入口 + 当前面板。
 *
 * @param {object} props
 * @param {Array<{key: string, label: string, title: string, hint?: string}>} props.tools
 * @param {string|null} props.openPanel
 * @param {(key: string|null) => void} props.onOpenPanelChange
 * @param {Record<string, React.ReactNode>} props.content 面板内容（按 key）
 */
export default function ObservatoryTools({
  tools = [],
  openPanel = null,
  onOpenPanelChange = null,
  content = {},
  closeLabel = 'Close',
  sourceTitle = 'Data source',
}) {
  const { compact, registerPanelButton, panelHostRef, setOpenPanel } = useOverviewLayout();
  const active = tools.find((tool) => tool.key === openPanel)
    || (openPanel === 'source' && content.source ? { key: 'source', title: sourceTitle } : null);

  return (
    <>
      {tools.map((tool) => (
        <ToolbarToolButton
          key={tool.key}
          label={tool.label}
          hint={tool.hint}
          active={openPanel === tool.key}
          buttonRef={registerPanelButton(tool.key)}
          onClick={() => onOpenPanelChange?.(openPanel === tool.key ? null : tool.key)}
        />
      ))}

      {active ? (
        compact ? (
          <ObservatoryDrawer
            panelKey={active.key}
            title={active.title}
            closeLabel={closeLabel}
            onClose={() => setOpenPanel(null)}
          >
            {content[active.key]}
          </ObservatoryDrawer>
        ) : panelHostRef.current ? createPortal(
          <ObservatoryInlinePanel
            panelKey={active.key}
            title={active.title}
            closeLabel={closeLabel}
            onClose={() => setOpenPanel(null)}
          >
            {content[active.key]}
          </ObservatoryInlinePanel>,
          panelHostRef.current,
        ) : null
      ) : null}
    </>
  );
}
