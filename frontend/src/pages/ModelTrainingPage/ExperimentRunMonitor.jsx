import { useT } from '../../i18n';
import TrainingProgressMonitor from '../../components/TrainingProgressMonitor';
import LossEvolutionChart from '../../components/LossEvolutionChart';
import ExperimentLogPanel from './ExperimentLogPanel';
import { getExperimentFailureMessage } from './experimentCenterModel';
import { isActiveTrainingStatus } from './trainingStatusMeta';
import './experimentCenter.css';

/**
 * 训练监控工作区：状态、进度、Epoch、Loss、ETA、Loss 曲线和实时日志。
 *
 * 这里不创建定时器、不建立 WebSocket、也不请求日志；进度与日志由
 * TrainingContext 轮询后通过 props 传入，停止训练也只调用父组件回调。
 */
export default function ExperimentRunMonitor({
  activeTask,
  progress,
  logs,
  isProcessing,
  isLight,
  autoScrollPinned,
  logContainerRef,
  onScroll,
  onStop,
  copy,
}) {
  const t = useT();
  const status = activeTask ? activeTask.status || 'running' : 'idle';
  const isActive = isActiveTrainingStatus(status);
  const resolvedProgress = progress || {};
  const lossHistory = resolvedProgress.loss_history || { train: [], val: [] };
  // 正在跑的失败（例如子进程启动失败）也要在监控区说明原因。
  const failure = activeTask && !isActive ? getExperimentFailureMessage(activeTask) : null;

  return (
    <div className="experiment-center-stack experiment-monitor-workspace">
      <section className="experiment-monitor-status" aria-label={copy.currentStatus}>
        <h3 className="experiment-monitor-section-title">{copy.currentStatus}</h3>
        <TrainingProgressMonitor
          progress={resolvedProgress.progress || 0}
          currentEpoch={resolvedProgress.current_epoch || 0}
          totalEpochs={resolvedProgress.total_epochs || 0}
          loss={resolvedProgress.current_loss}
          eta={resolvedProgress.eta || '--:--'}
          isLight={isLight}
          status={status}
        />
        {failure?.hasReason ? (
          <div className="experiment-result-note" data-tone={failure.stopped ? 'warning' : 'error'} role="status">
            <strong>{t(failure.messageKey)}</strong>
            {failure.suggestionKey ? <span>{t(failure.suggestionKey)}</span> : null}
            {failure.detail ? <span className="experiment-center-hint">{failure.detail}</span> : null}
          </div>
        ) : null}
      </section>

      <LossEvolutionChart
        lossHistory={lossHistory}
        isLight={isLight}
        compact
        height={280}
        title={copy.lossTitle}
        className="experiment-monitor-chart"
        subtitle={lossHistory.train?.length ? copy.lossEpochCount(lossHistory.train.length) : null}
        emptyLabel={t('modelTraining.charts.noMetrics')}
      />

      <ExperimentLogPanel
        task={activeTask}
        logs={logs}
        isLight={isLight}
        autoScrollPinned={autoScrollPinned}
        logContainerRef={logContainerRef}
        onScroll={onScroll}
        title={copy.liveLogs}
        hint={copy.liveLogsHint}
        emptyLabel={copy.waitingLogs}
        actions={isActive && activeTask ? (
          <button
            type="button"
            className="experiment-center-button"
            style={{ color: '#d95c5c', borderColor: 'rgba(217,92,92,0.28)', background: 'rgba(217,92,92,0.08)' }}
            aria-label={`${copy.stopTraining} #${activeTask.id}`}
            disabled={isProcessing}
            onClick={() => onStop(activeTask.id)}
          >
            {copy.stopTraining}
          </button>
        ) : null}
        copy={copy}
      />
    </div>
  );
}
