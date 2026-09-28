import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../../i18n';
import { useAuth } from '../../contexts/AuthContext';
import './experimentCenter.css';

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
 * 配置视图显示画布和检查器；监控视图显示目录及所选任务的监控/结果。
 *
 * 外壳只负责版式与视图切换；训练请求、轮询与 WebSocket 全部由页面控制器
 * 与 TrainingContext 持有，外壳不 import 任何训练接口。
 */
export default function ExperimentCenterShell({
  view,
  onChangeView,
  stage,
  activeTask,
  onCreate,
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
  const isConfigure = view === 'config';
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

        <div className="experiment-center-header-meta" role="group" aria-label={t('experimentCenter.viewLabel')}>
          <button
            type="button"
            className="experiment-center-button experiment-center-view-button"
            aria-pressed={view === 'config'}
            onClick={() => onChangeView('config')}
          >
            {t('experimentCenter.stageConfigure')}
          </button>
          <button
            type="button"
            className="experiment-center-button experiment-center-view-button"
            aria-pressed={view === 'monitor'}
            onClick={() => onChangeView('monitor')}
          >
            {t('experimentCenter.monitorResultsView')}
          </button>
        </div>
      </header>

      <div
        className="experiment-center-grid"
        data-stage={stage}
        data-view={view}
        data-inspector={isConfigure && inspector ? 'present' : 'absent'}
        style={view === 'config' && runBar && runBarHeight ? { paddingBottom: `${runBarHeight + 20}px` } : undefined}
      >
          {view === 'monitor' ? (
            <aside
              id="experiment-directory-panel"
              className="glass-card experiment-directory"
              aria-label={t('experimentCenter.directoryTitle')}
            >
              {directory}
            </aside>
          ) : null}

          <section
            className="glass-card experiment-center-panel experiment-center-canvas"
            data-stage-panel={isConfigure ? 'configure' : stage}
            aria-live="off"
          >
            <div className="experiment-center-panel-header" hidden={isConfigure || !activeTask}>
              <div style={{ minWidth: 0 }}>
                <h2 className="experiment-center-panel-title" tabIndex={-1} ref={stageRef} data-stage-heading={stage}>
                  {t(stage === 'result' ? 'experimentCenter.stageResult' : 'experimentCenter.stageMonitor')}
                </h2>
                <div className="experiment-center-hint" hidden={stage === 'result'}>
                  {activeTask
                    ? `${activeTask.custom_model_name || t('experimentCenter.unnamedExperiment')} · #${activeTask.id}`
                    : t('experimentCenter.noActiveTask')}
                </div>
              </div>

            </div>

            {/* 配置工作区始终挂载，切换视图不会清空输入。 */}
            <div
              className="experiment-center-workspace"
              data-stage-workspace="configure"
              hidden={view !== 'config'}
            >
              {workspace?.configure}
            </div>
            <div className="experiment-center-workspace" data-stage-workspace="monitor" hidden={view !== 'monitor' || stage !== 'monitor' || !activeTask}>
              {view === 'monitor' && stage === 'monitor' && activeTask ? workspace?.monitor : null}
            </div>
            <div className="experiment-center-workspace" data-stage-workspace="result" hidden={view !== 'monitor' || stage !== 'result'}>
              {view === 'monitor' && stage === 'result' ? workspace?.result : null}
            </div>

            {view === 'monitor' && !activeTask ? (
              <div className="experiment-center-empty">
                <div>{t('experimentCenter.noActiveTask')}</div>
                <button type="button" className="experiment-center-button" onClick={onCreate}>
                  {t('experimentCenter.newExperiment')}
                </button>
              </div>
            ) : null}
          </section>

          {view === 'config' && inspector ? (
            <aside
              className="glass-card experiment-inspector-panel"
              data-config-inspector-panel="true"
              aria-label={t('experimentCenter.inspectorTitle')}
            >
              {inspector}
            </aside>
          ) : null}
      </div>

      {view === 'config' && runBar ? (
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
