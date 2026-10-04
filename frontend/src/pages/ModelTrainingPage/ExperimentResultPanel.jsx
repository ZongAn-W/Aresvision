import { useMemo, useState } from 'react';
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
    <div className="experiment-result-detail">
      <dt>{label}</dt>
      <dd>
        {value || '--'}
      </dd>
    </div>
  );
}

function getUploadedModelIdentity(task, hyperparameters) {
  const modelSource = String(task?.model_source || hyperparameters?.model_source || '').trim().toLowerCase();
  if (modelSource !== 'uploaded') return null;

  const modelName = String(
    task?.uploaded_model_name
      || hyperparameters?._uploaded_model_name
      || task?.uploaded_model_id
      || hyperparameters?._uploaded_model_id
      || '',
  ).trim();
  const versionValue = task?.uploaded_model_version ?? hyperparameters?._uploaded_model_version;
  const modelVersion = versionValue == null ? '' : String(versionValue).trim();
  const storedFilename = String(hyperparameters?._uploaded_model_filename || '').trim();
  const storedPath = String(hyperparameters?._uploaded_model_path || '').trim();
  const pathFilename = storedPath.split(/[\\/]/).pop() || '';

  return {
    name: modelName,
    version: modelVersion,
    filename: storedFilename || pathFilename,
  };
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
  const uploadedModel = useMemo(
    () => getUploadedModelIdentity(activeTask, hyperparameters),
    [activeTask, hyperparameters]
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
    <div className="experiment-center-stack experiment-result">
      <div className="experiment-result-head">
        <div className="experiment-result-identity">
          <h3 className="experiment-result-name">
            {summary.name || t('experimentCenter.unnamedExperiment')}
          </h3>
          <p className="experiment-result-meta experiment-center-hint">
            {`${getExperimentArchitectureLabel(summary.architecture) || copy.uploadedModelsLabel} · ${summary.dataset || '--'}`}
          </p>
        </div>
        <div className="experiment-center-actions">
          <span className="experiment-directory-badge experiment-result-status" data-status={activeTask.status}>
            <span className="experiment-directory-status-dot" />
            {statusMeta.label}
          </span>
          <span
            className="experiment-directory-badge experiment-result-status"
            data-status={modelAvailable ? 'completed' : 'failed'}
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

      <section className="experiment-result-section" aria-labelledby="experiment-result-metrics-title">
        <h4 className="experiment-result-section-title" id="experiment-result-metrics-title">{copy.metricsTitle}</h4>
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
          <div className="experiment-result-empty experiment-center-hint">{copy.metricsUnavailable}</div>
        )}
      </section>

      <LossEvolutionChart
        lossHistory={lossHistory}
        isLight={isLight}
        compact
        height={280}
        title={copy.lossTitle}
        className="experiment-result-chart"
        subtitle={hasLossHistory ? copy.lossEpochCount(lossHistory.train.length) : null}
        emptyLabel={copy.noLossHistory}
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

      <section className="experiment-result-section" aria-labelledby="experiment-result-details-title">
        <h4 className="experiment-result-section-title" id="experiment-result-details-title">{copy.detailsTitle}</h4>
        <h5 className="experiment-result-group-title">{copy.datasetIdentityTitle}</h5>
        <dl className="experiment-result-detail-grid">
          <DetailField label={copy.datasetLabel} value={summary.dataset} />
          <DetailField label={copy.datasetVersionLabel} value={datasetVersion} />
          <DetailField label={copy.datasetStatusLabel} value={datasetStatus} />
          <DetailField label={copy.datasetFingerprintLabel} value={datasetFingerprint ? `${datasetFingerprint.slice(0, 12)}…` : ''} />
        </dl>
        <h5 className="experiment-result-group-title">{copy.trainingSettingsTitle}</h5>
        <dl className="experiment-result-detail-grid">
          <DetailField label={copy.modelSourceLabel} value={summary.modelSource === 'uploaded' ? copy.uploadedModelsLabel : copy.officialLabel} />
          {uploadedModel ? <DetailField label={copy.customModelLabel} value={uploadedModel.name} /> : null}
          {uploadedModel?.version ? <DetailField label={copy.customModelVersionLabel} value={uploadedModel.version} /> : null}
          {uploadedModel?.filename ? <DetailField label={copy.customModelFileLabel} value={uploadedModel.filename} /> : null}
          <DetailField label={copy.inputChannelsLabel} value={channelLabel} />
          <DetailField label={copy.windowLabel} value={hyperparameters.window != null ? String(hyperparameters.window) : ''} />
          <DetailField label={copy.horizonLabel} value={hyperparameters.horizon != null ? String(hyperparameters.horizon) : ''} />
          <DetailField label={copy.epochsLabel} value={hyperparameters.epochs != null ? String(hyperparameters.epochs) : ''} />
          <DetailField label={copy.batchSizeLabel} value={hyperparameters.batch_size != null ? String(hyperparameters.batch_size) : ''} />
          <DetailField label={copy.learningRateLabel} value={hyperparameters.learning_rate != null ? String(hyperparameters.learning_rate) : ''} />
        </dl>
        <div className="experiment-result-parameters">
          <TrainingTaskParameters
            showSummary={false}
            hyperparameters={hyperparameters}
            modelName={summary.name || activeTask.id}
            t={t}
            formatValue={onFormatValue}
          />
        </div>
      </section>

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
