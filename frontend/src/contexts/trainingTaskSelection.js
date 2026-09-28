/**
 * 决定当前选中的训练任务。
 *
 * `preferredTaskId` 仍然可用时保持不变；不可用时回退到第一个运行中 / 排队中的任务，
 * 这样刷新页面后运行中的实验仍会自动进入监控阶段。
 *
 * `options.suppressAutoSelect` 用于用户**主动**进入新建配置（点「新建实验」）之后：
 * 此时不能再自动选中运行中的任务，否则任务列表每 5 秒轮询一次就会把用户
 * 从配置画布拽回监控阶段（目录展开、切页签等重渲染同样会触发）。
 * 用户主动点击目录里的实验时再解除该抑制。
 */
export function reconcileActiveTrainingTaskId(tasks, preferredTaskId, { suppressAutoSelect = false } = {}) {
  const availableTasks = Array.isArray(tasks) ? tasks : [];

  if (availableTasks.some((task) => task.id === preferredTaskId)) {
    return preferredTaskId;
  }

  if (suppressAutoSelect) return null;

  const runningTask = availableTasks.find(
    (task) => task.status === 'running' || task.status === 'pending'
  );

  return runningTask?.id ?? null;
}
