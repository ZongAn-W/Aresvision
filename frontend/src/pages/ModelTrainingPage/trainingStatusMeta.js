/**
 * 训练状态配色与文案。实验目录、监控工作区和进度组件共用同一份定义，
 * 避免同一状态在不同区域出现不同颜色或不同标签。
 */
export function getTrainingStatusMeta(status, t) {
  if (status === 'completed') {
    return {
      label: t('modelTraining.statusCompleted'),
      color: 'var(--status-success)',
      tint: 'color-mix(in srgb, var(--status-success) 8%, transparent)',
      border: 'color-mix(in srgb, var(--status-success) 28%, transparent)',
    };
  }
  if (status === 'failed') {
    return {
      label: t('modelTraining.statusFailed'),
      color: 'var(--status-danger)',
      tint: 'color-mix(in srgb, var(--status-danger) 8%, transparent)',
      border: 'color-mix(in srgb, var(--status-danger) 28%, transparent)',
    };
  }
  if (status === 'running') {
    return {
      label: t('modelTraining.statusRunning'),
      color: 'var(--brand-ice)',
      tint: 'color-mix(in srgb, var(--brand-ice) 8%, transparent)',
      border: 'color-mix(in srgb, var(--brand-ice) 28%, transparent)',
    };
  }
  if (status === 'pending') {
    return {
      label: t('modelTraining.statusPending'),
      color: 'var(--status-warning)',
      tint: 'color-mix(in srgb, var(--status-warning) 8%, transparent)',
      border: 'color-mix(in srgb, var(--status-warning) 28%, transparent)',
    };
  }
  if (status === 'queued') {
    return {
      label: t('modelTraining.statusQueued'),
      color: 'var(--status-warning)',
      tint: 'color-mix(in srgb, var(--status-warning) 8%, transparent)',
      border: 'color-mix(in srgb, var(--status-warning) 28%, transparent)',
    };
  }
  if (status === 'cancelled') {
    return {
      label: t('modelTraining.statusCancelled'),
      color: 'var(--text-secondary)',
      tint: 'var(--surface-2)',
      border: 'var(--line-default)',
    };
  }
  return {
    label: t('modelTraining.idle'),
    color: 'var(--text-secondary)',
    tint: 'var(--surface-2)',
    border: 'var(--line-subtle)',
  };
}

export function isActiveTrainingStatus(status) {
  return status === 'running' || status === 'pending' || status === 'queued';
}
