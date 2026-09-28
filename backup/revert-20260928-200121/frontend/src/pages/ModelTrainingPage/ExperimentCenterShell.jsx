import { useEffect, useMemo, useRef, useState } from 'react';
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
 * 顶部是一条固定栏，只有两个视图按钮，每个视图都是**两列**：
 * - **配置实验**：左＝新建实验表单（配置画布），右＝配置检查器。底部运行条承载提交。
 * - **训练监控**：左＝实验目录，右＝实验结果。
 *
 * 阶段（configure / monitor / result）仍由任务状态推导并用于切换配置画布与结果，
 * 视图只决定哪两列可见。配置画布始终挂载（hidden 隐藏），切视图不会清空表单。
 *
 * 外壳只负责版式与视图切换；训练请求、轮询与 WebSocket 全部由页面控制器与
 * TrainingContext 持有，外壳不 import 任何训练接口。
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
  // 视图只控制列的组合，不参与阶段推导：视图 2 里配置画布保持挂载，因此切视图
  // 不会清空正在编辑的表单。
  // 初始视图跟随当前记录：有任务就直接看它（运行中=监控，已完成/失败=结果），
  // 一条记录都没有才停在新建配置。之后由用户点击在两个视图间切换。
  const [mode, setMode] = useState(() => (activeTask ? 'run' : 'config'));
  const isConfigMode = mode === 'config';
  const isConfigure = stage === 'configure';
  // 视图 2「训练监控」的右列只放实验结果。
  const showResult = Boolean(activeTask);

  // 记录消失（用户点「新建实验」清空选择、或任务被删除）时回到配置视图，
  // 否则会停在一个空的监控 / 结果视图上，看不到提交表单。
  useEffect(() => {
    if (!activeTask) setMode('config');
  }, [activeTask]);

  const stageLabels = useMemo(
    () => ({
      configure: t('experimentCenter.stageConfigure'),
      monitor: t('experimentCenter.stageMonitor'),
      result: t('experimentCenter.stageResult'),
    }),
    [t]
  );
  const viewLabels = useMemo(
    () => ({
      config: t('experimentCenter.viewConfig'),
      run: t('experimentCenter.viewRun'),
    }),
    [t]
  );

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
      {/* 固定视图栏：只有两个按钮，替代原来的标题 + 元信息 + 阶段指示三块内容。 */}
      <div className="experiment-view-bar" data-experiment-view-bar="true" role="group" aria-label={t('experimentCenter.viewNavLabel')}>
        {['config', 'run'].map((key) => {
          const active = mode === key;
          return (
            <button
              key={key}
              type="button"
              className="experiment-view-tab"
              aria-pressed={active}
              data-experiment-view={key}
              data-view-state={active ? 'current' : 'idle'}
              onClick={() => setMode(key)}
            >
              {viewLabels[key]}
            </button>
          );
        })}
      </div>

      <div
        className="experiment-center-grid"
        data-mode={mode}
        data-stage={stage}
        data-directory={isConfigMode ? 'closed' : 'open'}
        data-inspector={isConfigMode && inspector ? 'present' : 'absent'}
        style={isConfigMode && runBar && runBarHeight ? { paddingBottom: `${runBarHeight + 20}px` } : undefined}
      >
          {isConfigMode ? null : (
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
                <div className="experiment-center-hint" hidden={stage === 'result'}>
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

            {/* 配置画布始终挂载（hidden 隐藏），切视图不会清空正在编辑的表单。 */}
            <div
              className="experiment-center-workspace"
              data-stage-workspace="configure"
              hidden={stage !== 'configure'}
            >
              {workspace?.configure}
            </div>

            {/* 视图 2 的右列只显示实验结果（不再混入训练监控面板）。 */}
            <div
              className="experiment-center-workspace"
              data-stage-workspace="result"
              hidden={!showResult}
            >
              {showResult ? workspace?.result : null}
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

          {isConfigMode && inspector ? (
            <aside
              className="glass-card experiment-inspector-panel"
              data-config-inspector-panel="true"
              aria-label={t('experimentCenter.inspectorTitle')}
            >
              {inspector}
            </aside>
          ) : null}
      </div>

      {/* 运行条只在配置视图渲染：它是新建实验的提交入口。 */}
      {runBar && isConfigMode && isConfigure ? (
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
