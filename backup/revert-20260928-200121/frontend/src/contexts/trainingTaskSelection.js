/**
 * 决定当前选中的训练任务。
 *
 * `preferredTaskId` 仍然可用时保持不变；不可用时按顺序回退：
 * 1. 第一个运行中 / 排队中的任务 —— 刷新页面后运行中的实验仍自动进入监控；
 * 2. 否则取列表里最新的一条记录（`tasks[0]`，服务端按创建时间倒序返回）——
 *    进入训练页默认展示最新一条记录的实验结果，而不是空白配置画布。
 *
 * `options.suppressAutoSelect` 用于用户**主动**进入新建配置（点「新建实验」）之后：
 * 此时不能再自动选中任何任务（既包括运行中的，也包括最新完成的那条），否则任务
 * 列表每 5 秒轮询一次就会把用户从配置画布拽走（目录展开、切页签等重渲染同样会触发）。
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
  if (runningTask) return runningTask.id;

  const latestTask = availableTasks.find((task) => task && task.id !== undefined && task.id !== null);
  return latestTask?.id ?? null;
}
