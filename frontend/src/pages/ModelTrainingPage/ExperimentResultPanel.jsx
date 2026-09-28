import { useMemo, useState } from 'react';
import C from '../../constants/colors';
import { useT } from '../../i18n';
import TrainingTaskParameters from './TrainingTaskParameters';
import LossEvolutionChart from '../../components/LossEvolutionChart';
import ExperimentLogPanel from './ExperimentLogPanel';
import {
  EXPERIMENT_METRIC_KEYS,
  buildExperimentSummary,
  canUseTaskForPrediction,
  formatExperimentMetricValue,
  getExperimentArchitectureLabel,
  getExperimentFailureMessage,
  normalizeTaskChannels,
  parseTaskHyperparameters,
} from './experimentCenterModel';
import { getTrainingStatusMeta } from './trainingStatusMeta';
import './experimentCenter.css';

const METRIC_LABEL_KEYS = {
  rmse: 'experimentCenter.metricRmse',
  mae: 'experimentCenter.metricMae',
  mse: 'experimentCenter.metricMse',
  r2: 'experimentCenter.metricR2',
  mape: 'experimentCenter.metricMape',
  smape: 'experimentCenter.metricSmape',
};

function DetailField({ label, value }) {
  return (
    <div className="experiment-center-card">
      <div className="experiment-monitor-metric-label">{label}</div>
      <div style={{ fontSize: 'calc(13px * var(--font-scale, 1))', fontWeight: 700, color: C.ice, lineHeight: 1.5, overflowWrap: 'anywhere' }}>
        {value || '--'}
      </div>
    </div>
  );
}

/**
 * 实验结果工作区：状态摘要、失败原因、指标、Loss、完整参数、数据集身份、
 * 运行日志与后续动作。
 *
 * 「用于预测」由父组件写入现有 TRAINING_TASK_HANDOFF_KEY 后跳转，只对
 * `completed && model_available` 开放；「去模型比较」跳转预测页并显式进入
 * 比较模式，不伪造预选结果。模型可用性只看后端返回的 model_available。
 */
export default function ExperimentResultPanel({
  activeTask,
  progress,
  logs,
  isLight,
  isProcessing,
  copy,
  channelOrder,
  channelMap,
  baselineLabel,
  onPredict,
  onCompare,
  onCopyConfig,
  onRename,
  onDelete,
  onTest,
  onFormatValue,
}) {
  const t = useT();
  const [logOpen, setLogOpen] = useState(false);
  const summary = useMemo(() => buildExperimentSummary(activeTask), [activeTask]);
  const hyperparameters = useMemo(
    () => parseTaskHyperparameters(activeTask?.hyperparameters),
    [activeTask?.hyperparameters]
  );
  const failure = useMemo(() => getExperimentFailureMessage(activeTask), [activeTask]);

  if (!activeTask) {
    return (
      <div className="experiment-center-empty">
        <div>{t('experimentCenter.noActiveTask')}</div>
      </div>
    );
  }

  const statusMeta = getTrainingStatusMeta(activeTask.status, t);
  const channels = normalizeTaskChannels(activeTask, channelOrder);
  const channelLabel = channels.length > 0
    ? channels.map((channel) => channelMap[channel]?.name || channel).join(', ')
    : baselineLabel;
  const lossHistory = progress?.loss_history || { train: [], val: [] };
  const hasLossHistory = Array.isArray(lossHistory.train) && lossHistory.train.length > 0;
  const modelAvailable = canUseTaskForPrediction(activeTask);

  const metrics = EXPERIMENT_METRIC_KEYS
    .filter((key) => summary.metrics[key] !== undefined)
    .map((key) => ({ key, label: t(METRIC_LABEL_KEYS[key]), value: formatExperimentMetricValue(summary.metrics[key]) }));

  const datasetFingerprint = activeTask.dataset_fingerprint || '';
  const datasetVersion = activeTask.dataset_version || '';
  const datasetStatus = activeTask.dataset_identity_status || '';

  return (
    <div className="experiment-center-stack">
      <div className="experiment-result-head">
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 'calc(20px * var(--font-scale, 1))', fontWeight: 700, color: C.ice, lineHeight: 1.35 }}>
            {summary.name || t('experimentCenter.unnamedExperiment')}
          </div>
          <div className="experiment-center-hint">
            {`#${activeTask.id} · ${getExperimentArchitectureLabel(summary.architecture) || copy.uploadedModelsLabel} · ${channelLabel}`}
          </div>
        </div>
        <div className="experiment-center-actions">
          <span className="experiment-directory-badge" style={{ background: statusMeta.tint, border: `1px solid ${statusMeta.border}`, color: statusMeta.color }}>
            <span className="experiment-directory-status-dot" style={{ background: statusMeta.color }} />
            {statusMeta.label}
          </span>
          <span
            className="experiment-directory-badge"
            style={
              modelAvailable
                ? { background: 'rgba(74,207,172,0.12)', border: '1px solid rgba(74,207,172,0.22)', color: C.green }
                : { background: 'rgba(217,92,92,0.12)', border: '1px solid rgba(217,92,92,0.22)', color: '#d95c5c' }
            }
          >
            {modelAvailable ? copy.weightsAvailable : copy.weightsUnavailable}
          </span>
        </div>
      </div>

      {/* 失败、停止与缺少权重的任务：显示 metrics 里的真实原因与恢复建议。 */}
      {!modelAvailable ? (
        <div
          className="experiment-result-note"
          data-tone={failure.stopped ? 'warning' : 'error'}
          role="status"
        >
          <strong>{failure.stopped ? t(failure.messageKey) : copy.modelUnavailableTitle}</strong>
          {failure.hasReason ? (
            <>
              {!failure.stopped ? <span>{t(failure.messageKey)}</span> : null}
              {failure.suggestionKey ? <span>{t(failure.suggestionKey)}</span> : null}
              {failure.detail ? <span className="experiment-center-hint">{failure.detail}</span> : null}
              {failure.errorCode ? <span className="experiment-center-hint">{failure.errorCode}</span> : null}
            </>
          ) : (
            <span>{copy.notCompletedReason}</span>
          )}
        </div>
      ) : null}

      <div className="experiment-center-card">
        <div className="experiment-center-section-title">{copy.metricsTitle}</div>
        {metrics.length > 0 ? (
          <div className="experiment-result-metrics">
            {metrics.map((metric) => (
              <div className="experiment-result-metric" key={metric.key}>
                <div className="experiment-result-metric-label">{metric.label}</div>
                <div className="experiment-result-metric-value">{metric.value}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="experiment-center-hint">{copy.metricsUnavailable}</div>
        )}
      </div>

      <LossEvolutionChart
        lossHistory={lossHistory}
        isLight={isLight}
        compact
        height={240}
        title={copy.lossTitle}
        emptyLabel={hasLossHistory ? copy.waitingLogs : copy.noLossHistory}
      />

      {/* 默认折叠的运行日志：复用 TrainingContext 的 logs，不新增请求或轮询。 */}
      <ExperimentLogPanel
        task={activeTask}
        logs={logs}
        isLight={isLight}
        autoFollow={false}
        collapsible
        open={logOpen}
        onToggle={() => setLogOpen((value) => !value)}
        title={copy.viewRunLogs}
        hint={logOpen ? copy.logLines((logs || []).length) : copy.viewRunLogsHint}
        emptyLabel={copy.noLogsForTask}
        copy={copy}
      />

      <div className="experiment-center-card">
        <div className="experiment-center-section-title">{copy.detailsTitle}</div>
        <div className="experiment-result-detail-grid">
          <DetailField label={copy.datasetLabel} value={summary.dataset} />
          <DetailField label={copy.datasetVersionLabel} value={datasetVersion} />
          <DetailField label={copy.datasetStatusLabel} value={datasetStatus} />
          <DetailField label={copy.datasetFingerprintLabel} value={datasetFingerprint ? `${datasetFingerprint.slice(0, 12)}…` : ''} />
          <DetailField label={copy.modelSourceLabel} value={summary.modelSource === 'uploaded' ? copy.uploadedModelsLabel : copy.officialLabel} />
          <DetailField label={copy.inputChannelsLabel} value={channelLabel} />
          <DetailField label={copy.windowLabel} value={hyperparameters.window != null ? String(hyperparameters.window) : ''} />
          <DetailField label={copy.horizonLabel} value={hyperparameters.horizon != null ? String(hyperparameters.horizon) : ''} />
          <DetailField label={copy.epochsLabel} value={hyperparameters.epochs != null ? String(hyperparameters.epochs) : ''} />
          <DetailField label={copy.batchSizeLabel} value={hyperparameters.batch_size != null ? String(hyperparameters.batch_size) : ''} />
          <DetailField label={copy.learningRateLabel} value={hyperparameters.learning_rate != null ? String(hyperparameters.learning_rate) : ''} />
        </div>
        <div style={{ marginTop: 12 }}>
          <TrainingTaskParameters
            hyperparameters={hyperparameters}
            modelName={summary.name || activeTask.id}
            t={t}
            formatValue={onFormatValue}
          />
        </div>
      </div>

      <div className="experiment-center-action-row">
        <div className="experiment-center-actions">
          {modelAvailable ? (
            <button
              type="button"
              className="experiment-center-button experiment-center-button-primary"
              onClick={() => onPredict(activeTask)}
            >
              {copy.useForPrediction}
            </button>
          ) : null}
          <button
            type="button"
            className="experiment-center-button"
            disabled={!modelAvailable}
            title={modelAvailable ? undefined : copy.compareUnavailableToast}
            onClick={() => onCompare(activeTask)}
          >
            {copy.goCompare}
          </button>
          <button type="button" className="experiment-center-button" onClick={() => onCopyConfig(activeTask)}>
            {copy.copyConfig}
          </button>
        </div>
        <div className="experiment-center-actions">
          <button
            type="button"
            className="experiment-center-button"
            disabled={isProcessing}
            onClick={() => onRename(activeTask)}
          >
            {copy.renameModel}
          </button>
          <button
            type="button"
            className="experiment-center-button"
            onClick={() => onTest(activeTask.id)}
          >
            {copy.testModel}
          </button>
          <button
            type="button"
            className="experiment-center-button experiment-center-button-quiet"
            disabled={isProcessing}
            onClick={() => onDelete(activeTask.id)}
          >
            {copy.deleteRecord}
          </button>
        </div>
      </div>
    </div>
  );
}
