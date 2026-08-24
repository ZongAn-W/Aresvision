export function normalizeTrainedModelName(value) {
  return String(value ?? '').trim();
}

export function validateTrainedModelName(value, tasks = [], taskId, language = 'zh') {
  const normalized = normalizeTrainedModelName(value);
  const isZh = language !== 'en';

  if (!normalized) {
    return isZh ? '模型名称不能为空' : 'Model name is required';
  }
  if (normalized.length > 255) {
    return isZh ? '模型名称不能超过 255 个字符' : 'Model name must be 255 characters or fewer';
  }

  const currentTask = tasks.find((task) => task.id === taskId);
  if (normalizeTrainedModelName(currentTask?.custom_model_name) === normalized) {
    return isZh ? '请输入新的模型名称' : 'Enter a different model name';
  }

  const duplicate = tasks.some(
    (task) => task.id !== taskId && normalizeTrainedModelName(task.custom_model_name) === normalized
  );
  if (duplicate) {
    return isZh
      ? `模型名称 '${normalized}' 已被使用`
      : `Model name '${normalized}' is already in use`;
  }

  return '';
}
