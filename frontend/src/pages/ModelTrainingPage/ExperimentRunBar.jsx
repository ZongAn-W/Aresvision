import './experimentCenter.css';

/**
 * 底部运行条：桌面配置阶段固定在浏览器底部的横向细条。
 *
 * 左侧是就绪 / 受阻状态，右侧是唯一主按钮与提交中的反馈。
 * 数据集、模型、输入变量与轮数的长摘要在信息减法中删除：这些值在中间画布的
 * 真实控件里都能直接读到，运行条只负责「能不能开始」。
 * 「开始实验」继续调用父组件传入的 `onStart`（页面控制器的 handleStartTraining），
 * 因此校验、上传模型检查、迁移学习检查与 `startTrainingTask` 调用链都没有变化；
 * 按钮是否可交互沿用同一个 `startDisabled`（访客可点，点了弹登录）。
 *
 * 运行条只显示状态，不判断状态：就绪结论来自页面控制器的 `readiness`。
 */
export default function ExperimentRunBar({
  resources,
  validation,
  readiness,
  copy,
  onStart,
  pendingSubmission,
  barRef,
}) {
  const { user } = resources;
  const { startDisabled, startButtonLabel } = validation;

  const canTrain = Boolean(readiness?.canTrain);

  const statusLabel = !user
    ? copy.runBarGuest
    : canTrain
      ? copy.runBarReadyToStart
      : copy.runBarNeedsAttention;

  return (
    <div
      className="experiment-run-bar"
      data-run-bar="true"
      data-run-state={canTrain ? 'ready' : (user ? 'blocked' : 'guest')}
      data-run-ready={canTrain ? 'true' : 'false'}
      data-run-interactive={startDisabled ? 'false' : 'true'}
      ref={barRef}
    >
      <div className="experiment-run-bar-main">
        <div className="experiment-run-bar-info">
          <span className="experiment-run-bar-state" data-run-state={canTrain ? 'ready' : (user ? 'blocked' : 'guest')} role="status">
            <span className="experiment-run-bar-dot" aria-hidden="true" />
            {statusLabel}
          </span>
        </div>

        <div className="experiment-run-bar-actions">
          {pendingSubmission ? <span className="experiment-run-bar-note" role="status">{pendingSubmission}</span> : null}
          <button
            type="button"
            className="experiment-run-bar-start"
            onClick={onStart}
            disabled={startDisabled}
            aria-disabled={startDisabled}
            data-run-bar-start="true"
          >
            {startButtonLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
