import { useMemo, useState } from 'react';
import { useT } from '../../i18n';
import TrainingHistory from '../../components/TrainingTags/TrainingHistory';
import { getTrainingStatusMeta } from './trainingStatusMeta';
import { createTrainingStatusMatcher } from '../../components/TrainingTags/trainingTagFilters';
import {
  EXPERIMENT_METRIC_KEYS,
  EXPERIMENT_STATUS_FILTERS,
  countExperimentStatuses,
  formatExperimentMetricValue,
  getExperimentArchitectureLabel,
  normalizeTaskChannels,
  parseTaskHyperparameters,
  readExperimentMetrics,
} from './experimentCenterModel';
import './experimentCenter.css';

function formatDirectoryDate(value, locale) {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return date.toLocaleString(locale, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function getCoreMetric(task) {
  const metrics = readExperimentMetrics(task?.metrics);
  const key = EXPERIMENT_METRIC_KEYS.find((candidate) => metrics[candidate] !== undefined);
  if (!key) return null;
  return { key, value: formatExperimentMetricValue(metrics[key]) };
}

/** 目录里有意义的模型身份：上传模型显示文件名，官方模型显示架构。 */
function getModelIdentity(task) {
  const hyperparameters = parseTaskHyperparameters(task?.hyperparameters);
  if (String(task?.model_source || hyperparameters.model_source).toLowerCase() === 'uploaded') {
    return task?.uploaded_model_name
      || hyperparameters._uploaded_model_name
      || hyperparameters._uploaded_model_id
      || '';
  }
  return getExperimentArchitectureLabel(hyperparameters.model_architecture);
}

/**
 * 目录行只负责「找到实验」：名称、任务号、状态、模型身份、数据集、通道、
 * 时间与一项核心指标。完整参数、日志、预测、比较、重命名、测试和删除
 * 全部在右侧工作区完成，这里不再渲染历史卡片式的内容。
 */
function ExperimentDirectoryRow({
  task,
  tagControls,
  t,
  locale,
  channelOrder,
  channelMap,
  baselineLabel,
  isActive,
  isProcessing,
  onSelect,
  onStop,
  copy,
}) {
  const statusMeta = getTrainingStatusMeta(task.status, t);
  const hyperparameters = useMemo(() => parseTaskHyperparameters(task.hyperparameters), [task.hyperparameters]);
  const metric = getCoreMetric(task);
  const isActiveRun = task.status === 'running' || task.status === 'pending';
  const channels = normalizeTaskChannels(task, channelOrder);
  const channelLabel = channels.length > 0
    ? channels.map((channel) => channelMap[channel]?.short || channel).join(' + ')
    : baselineLabel;
  const datasetLabel = task.dataset_id || hyperparameters.training_dataset || '--';
  const progress = Math.min(100, Math.max(0, Number(task.progress) || 0));

  return (
    <div
      role="button"
      tabIndex={0}
      className="experiment-directory-row"
      data-active={isActive ? 'true' : 'false'}
      data-status={task.status || 'unknown'}
      aria-pressed={isActive}
      onClick={() => onSelect(task.id)}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(task.id);
        }
      }}
    >
      {tagControls}

      <div className="experiment-directory-row-top">
        <span className="experiment-directory-name" title={task.custom_model_name || t('modelTraining.unnamedModel')}>
          {task.custom_model_name || t('modelTraining.unnamedModel')}
        </span>
        <span className="experiment-directory-id">{`#${task.id}`}</span>
      </div>

      <div className="experiment-directory-meta">
        <span className="experiment-directory-badge" style={{ background: statusMeta.tint, border: `1px solid ${statusMeta.border}`, color: statusMeta.color }}>
          <span className="experiment-directory-status-dot" style={{ background: statusMeta.color }} />
          {statusMeta.label}
        </span>
        {isActiveRun ? (
          <span className="experiment-directory-metric">{`${copy.progressLabel} ${progress.toFixed(0)}%`}</span>
        ) : null}
      </div>

      <div className="experiment-directory-meta">
        <span>{`${getModelIdentity(task) || '--'} · ${datasetLabel}`}</span>
      </div>

      <div className="experiment-directory-meta">
        <span>{channelLabel}</span>
        <span>{formatDirectoryDate(task.start_time, locale)}</span>
        {metric ? (
          <span className="experiment-directory-metric">{`${metric.key.toUpperCase()} ${metric.value}`}</span>
        ) : null}
      </div>

      {isActiveRun ? (
        <>
          <div className="experiment-directory-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-label={copy.progressLabel}>
            <div className="experiment-directory-progress-fill" style={{ width: `${progress}%` }} />
          </div>
          <div className="experiment-center-actions" onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              className="experiment-center-button"
              style={{ minHeight: 34, padding: '6px 10px', fontSize: 'calc(11px * var(--font-scale, 1))', color: '#d95c5c', borderColor: 'rgba(217,92,92,0.28)' }}
              disabled={isProcessing}
              onClick={() => onStop(task.id)}
            >
              {copy.stopTraining}
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

/**
 * 左侧实验目录：状态分组、名称搜索、标签筛选、未分组筛选、批量标签和紧凑实验行。
 *
 * 搜索、标签和批量标签逻辑复用 TrainingHistory；目录内不请求任何训练接口。
 */
export default function ExperimentDirectory({
  tasks,
  tagState,
  activeTaskId,
  isProcessing,
  onSelectTask,
  onStop,
  tasksLoading = false,
  tasksError = false,
  onCreateTask,
  onRetryTasks,
  copy,
  locale,
  isZh,
  channelOrder,
  channelMap,
  baselineLabel,
}) {
  const t = useT();
  const [statusFilter, setStatusFilter] = useState('all');
  const counts = useMemo(() => countExperimentStatuses(tasks), [tasks]);
  const statusMatcher = useMemo(() => createTrainingStatusMatcher(statusFilter), [statusFilter]);

  const filterLabels = {
    all: t('experimentCenter.filterAll'),
    running: t('experimentCenter.filterRunning'),
    completed: t('experimentCenter.filterCompleted'),
    failed: t('experimentCenter.filterFailed'),
  };

  // 目录只有三种需要区别对待的状态：还在取任务列表、取失败、或确实没有实验。
  // 只看真实加载标记（tasksLoading 由首次任务请求复位），不要用 scope 之类的
  // 登录信息推断，否则登录用户会永远停在「加载中」。这三个标记只影响展示与密度，
  // 不参与任何筛选或选中判断。
  const isEmptyDirectory = tasks.length === 0;
  const isPending = isEmptyDirectory && !tasksError && tasksLoading;
  const directoryState = tasksError ? 'error' : (isPending ? 'loading' : (isEmptyDirectory ? 'empty' : 'ready'));

  return (
    <div className="experiment-directory" data-directory-state={directoryState}>
      <div className="experiment-directory-head">
        <div className="experiment-directory-title">{t('experimentCenter.directoryTitle')}</div>
        <span className="training-tag-hint" role="status">
          {t('experimentCenter.directoryCount', { count: counts.all })}
        </span>
      </div>

      <div className="experiment-directory-filters" role="group" aria-label={t('experimentCenter.statusFilterLabel')}>
        {EXPERIMENT_STATUS_FILTERS.map((filter) => (
          <button
            key={filter}
            type="button"
            className="experiment-directory-filter"
            aria-pressed={statusFilter === filter}
            onClick={() => setStatusFilter(filter)}
          >
            {filterLabels[filter]}
            <span className="experiment-directory-filter-count">{counts[filter]}</span>
          </button>
        ))}
      </div>

      <TrainingHistory
        key={tagState.scope ?? 'guest'}
        tasks={tasks}
        tagState={tagState}
        isZh={isZh}
        renderMode="directory"
        statusMatcher={statusMatcher}
        emptyState={{
          reason: isEmptyDirectory ? (tasksError ? 'error' : (isPending ? 'loading' : 'no-experiments')) : 'no-match',
          zh: {
            loading: '正在加载实验…',
            error: '实验目录加载失败。',
            noExperiments: '暂无实验。新建实验后，实验会出现在这里。',
            noMatch: '没有匹配的实验，请调整筛选条件。',
          },
          en: {
            loading: 'Loading experiments…',
            error: 'Could not load the experiment directory.',
            noExperiments: 'No experiments yet. Create one and it will appear here.',
            noMatch: 'No matching experiments. Adjust your filters.',
          },
          actionLabel: isZh ? '新建实验' : 'New experiment',
          retryLabel: isZh ? '重试' : 'Retry',
          showAction: isEmptyDirectory && !tasksError && !isPending,
          showRetry: tasksError,
          onAction: onCreateTask,
          onRetry: onRetryTasks,
        }}
        renderTask={(task, tagControls) => (
          <ExperimentDirectoryRow
            key={task.id}
            task={task}
            tagControls={tagControls}
            t={t}
            locale={locale}
            channelOrder={channelOrder}
            channelMap={channelMap}
            baselineLabel={baselineLabel}
            isActive={task.id === activeTaskId}
            isProcessing={isProcessing}
            onSelect={onSelectTask}
            onStop={onStop}
            copy={copy}
          />
        )}
      />
    </div>
  );
}
