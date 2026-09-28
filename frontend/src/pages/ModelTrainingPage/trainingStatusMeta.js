import C from '../../constants/colors';

/**
 * 训练状态配色与文案。实验目录、监控工作区和进度组件共用同一份定义，
 * 避免同一状态在不同区域出现不同颜色或不同标签。
 */
export function getTrainingStatusMeta(status, t) {
  if (status === 'completed') {
    return {
      label: t('modelTraining.statusCompleted'),
      color: C.green,
      tint: 'rgba(74, 207, 172, 0.12)',
      border: 'rgba(74, 207, 172, 0.22)',
    };
  }
  if (status === 'failed') {
    return {
      label: t('modelTraining.statusFailed'),
      color: '#d95c5c',
      tint: 'rgba(217, 92, 92, 0.12)',
      border: 'rgba(217, 92, 92, 0.22)',
    };
  }
  if (status === 'running') {
    return {
      label: t('modelTraining.statusRunning'),
      color: '#79bbdf',
      tint: 'rgba(121, 187, 223, 0.12)',
      border: 'rgba(121, 187, 223, 0.26)',
    };
  }
  if (status === 'pending') {
    return {
      label: t('modelTraining.statusPending'),
      color: '#c89448',
      tint: 'rgba(200, 148, 72, 0.12)',
      border: 'rgba(200, 148, 72, 0.22)',
    };
  }
  return {
    label: t('modelTraining.idle'),
    color: C.ice60,
    tint: 'rgba(255, 255, 255, 0.04)',
    border: 'rgba(255, 255, 255, 0.08)',
  };
}

export function isActiveTrainingStatus(status) {
  return status === 'running' || status === 'pending';
}
