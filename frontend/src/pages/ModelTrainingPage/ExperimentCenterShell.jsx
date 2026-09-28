import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import { useT } from '../../i18n';
import { useAuth } from '../../contexts/AuthContext';
import './experimentCenter.css';

const STAGE_KEYS = ['configure', 'monitor', 'result'];
const STAGE_ORDER = STAGE_KEYS;

/**
 * 运行条用 fixed 贴在浏览器底部，但**页面外壳带有 transform 过渡**
 * （App.jsx 的页面切换动画），带 transform 的祖先会成为 fixed 的包含块，
 * 从而把运行条变成“相对页面容器固定”。因此这里把运行条 portal 到 body，
 * 让它真正相对视口固定；侧栏的 sticky 不受影响（只要求祖先没有 overflow）。
 */
function runBarPortal(node) {
  if (typeof document === 'undefined') return null;
  return createPortal(node, document.body);
}

/**
 * 实验中心控制台外壳。
 *
 * 桌面端网格：左列实验目录（sticky）、中间画布 / 监控 / 结果、右列配置检查器（sticky）。
 * 新建配置首次进入默认**收起**目录（画布 + 检查器两列），点击「实验目录」才展开三列；
 * 监控 / 结果阶段默认展开（那里主要靠目录切换实验）。用户本次会话的展开状态优先于默认值，
 * 表单更新、阶段内重渲染都不会重置它。
 *
 * 外壳只负责版式、标题与阶段指示；训练请求、轮询与 WebSocket 全部由页面控制器
 * 与 TrainingContext 持有，外壳不 import 任何训练接口。
 */
export default function ExperimentCenterShell({
  stage,
  activeTask,
  onCreate,
  onSelectTask,
  onBackToDirectory,
  directory,
  workspace,
  inspector,
  runBar,
  runBarHeight = 0,
}) {
  const t = useT();
  const { user } = useAuth();
  const stageRef = useRef(null);
  const focusedStageRef = useRef(null);
  const isConfigure = stage === 'configure';
  // 整页默认显示实验目录（配置阶段也一样）；用户手动收起后本次会话保持收起。
  const [directoryCollapsed, setDirectoryCollapsed] = useState(false);

  const stageLabels = useMemo(
    () => ({
      configure: t('experimentCenter.stageConfigure'),
      monitor: t('experimentCenter.stageMonitor'),
      result: t('experimentCenter.stageResult'),
    }),
    [t]
  );
  const eyebrow = t('experimentCenter.eyebrow');

  // 阶段切换后把焦点移到阶段标题，键盘用户不会停在已卸载的控件上。
  useEffect(() => {
    if (focusedStageRef.current === null) {
      focusedStageRef.current = stage;
      return;
    }
    if (focusedStageRef.current === stage) return;
    focusedStageRef.current = stage;
    stageRef.current?.focus();
  }, [stage]);

  const toggleDirectory = () => {
    setDirectoryCollapsed((value) => !value);
  };

  return (
    <div className="experiment-center">
      <header className="experiment-center-header">
        <div style={{ minWidth: 0 }}>
          {eyebrow && eyebrow !== 'experimentCenter.eyebrow' ? (
            <div className="experiment-center-eyebrow">{eyebrow}</div>
          ) : null}
          <h1 className="experiment-center-title">
            {isConfigure ? t('experimentCenter.newExperimentTitle') : t('experimentCenter.title')}
          </h1>
        </div>

        <div className="experiment-center-header-meta">
          <button
            type="button"
            className="experiment-center-button"
            aria-expanded={!directoryCollapsed}
            aria-controls="experiment-directory-panel"
            onClick={toggleDirectory}
          >
            {directoryCollapsed ? t('experimentCenter.showDirectory') : t('experimentCenter.hideDirectory')}
          </button>
          <button type="button" className="experiment-center-button" onClick={onCreate}>
            <AddRoundedIcon aria-hidden="true" sx={{ fontSize: 17, verticalAlign: '-3px', marginRight: '6px' }} />
            {t('experimentCenter.newExperiment')}
          </button>
        </div>
      </header>

      <ol className="experiment-center-stage-nav" aria-label={t('experimentCenter.stageNavLabel')}>
        {STAGE_KEYS.map((key, index) => {
          const current = stage === key;
          const done = STAGE_ORDER.indexOf(stage) > index;
          return (
            <li key={key} className="experiment-center-stage-step">
              <span
                className="experiment-center-stage-tab"
                aria-current={current ? 'step' : undefined}
                data-stage-tab={key}
                data-stage-state={current ? 'current' : (done ? 'done' : 'upcoming')}
              >
                <span className="experiment-center-stage-index" aria-hidden="true">
                  {done
                    ? <CheckRoundedIcon sx={{ fontSize: 14 }} />
                    : String(index + 1).padStart(2, '0')}
                </span>
                {stageLabels[key]}
              </span>
              {index < STAGE_KEYS.length - 1 ? (
                <span className="experiment-center-stage-arrow" aria-hidden="true">→</span>
              ) : null}
            </li>
          );
        })}
      </ol>

      <div
        className="experiment-center-grid"
        data-stage={stage}
        data-directory-collapsed={directoryCollapsed ? 'true' : 'false'}
        data-directory={directoryCollapsed ? 'closed' : 'open'}
        data-inspector={isConfigure && inspector ? 'present' : 'absent'}
        style={isConfigure && runBar && runBarHeight ? { paddingBottom: `${runBarHeight + 20}px` } : undefined}
      >
          {directoryCollapsed ? null : (
            <aside
              id="experiment-directory-panel"
              className="glass-card experiment-directory"
              aria-label={t('experimentCenter.directoryTitle')}
            >
              {directory}
            </aside>
          )}

          <section
            className="glass-card experiment-center-panel experiment-center-canvas"
            data-stage-panel={stage}
            aria-live="off"
          >
            <div className="experiment-center-panel-header" hidden={isConfigure}>
              <div style={{ minWidth: 0 }}>
                <h2 className="experiment-center-panel-title" tabIndex={-1} ref={stageRef} data-stage-heading={stage}>
                  {stageLabels[stage]}
                </h2>
                <div className="experiment-center-hint">
                  {activeTask
                    ? `${activeTask.custom_model_name || t('experimentCenter.unnamedExperiment')} · #${activeTask.id}`
                    : t('experimentCenter.noActiveTask')}
                </div>
              </div>

              {activeTask ? (
                <div className="experiment-center-actions">
                  <span className="experiment-center-hint">{`#${activeTask.id}`}</span>
                  <button type="button" className="experiment-center-button experiment-center-button-quiet" onClick={onBackToDirectory}>
                    {t('experimentCenter.backToDirectory')}
                  </button>
                </div>
              ) : null}
            </div>

            {/* 三个工作区都保持挂载（hidden 隐藏），目录筛选与阶段切换不会清空正在编辑的表单。 */}
            <div
              className="experiment-center-workspace"
              data-stage-workspace="configure"
              hidden={stage !== 'configure'}
            >
              {workspace?.configure}
            </div>
            <div className="experiment-center-workspace" data-stage-workspace="monitor" hidden={stage !== 'monitor'}>
              {stage === 'monitor' ? workspace?.monitor : null}
            </div>
            <div className="experiment-center-workspace" data-stage-workspace="result" hidden={stage !== 'result'}>
              {stage === 'result' ? workspace?.result : null}
            </div>

            {stage !== 'configure' && !activeTask ? (
              <div className="experiment-center-empty">
                <div>{t('experimentCenter.noActiveTask')}</div>
                <button type="button" className="experiment-center-button" onClick={onCreate}>
                  {t('experimentCenter.newExperiment')}
                </button>
              </div>
            ) : null}
          </section>

          {isConfigure && inspector ? (
            <aside
              className="glass-card experiment-inspector-panel"
              data-config-inspector-panel="true"
              aria-label={t('experimentCenter.inspectorTitle')}
            >
              {inspector}
            </aside>
          ) : null}
      </div>

      {isConfigure && runBar ? (
        runBarPortal(
          <div className="experiment-center-runbar-slot" data-run-bar-slot="true">
            {runBar}
          </div>
        )
      ) : null}

      {!user ? <span className="sr-only">{t('experimentCenter.guestHint')}</span> : null}
    </div>
  );
}
