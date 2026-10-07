export function isValidTagName(name) {
  const length = [...name.trim()].length;
  return length >= 1 && length <= 64;
}

export function filterTaggedTasks(tasks = [], { tagIds = [], untagged = false, search = '', statusMatcher } = {}) {
  const query = search.trim().toLocaleLowerCase();
  const selected = tagIds.map(Number);
  const seen = new Set();
  return tasks.filter((task) => {
    if (seen.has(task.id)) return false;
    seen.add(task.id);
    if (typeof statusMatcher === 'function' && !statusMatcher(task)) return false;
    const tags = (task.tags || []).map(tag => Number(tag.id));
    if (untagged ? tags.length > 0 : !selected.every(id => tags.includes(id))) return false;
    return !query || String(task.custom_model_name || `Task #${task.id}`).toLocaleLowerCase().includes(query);
  });
}

/** 目录状态分组：运行中同时覆盖排队中的任务。 */
export const TRAINING_STATUS_GROUPS = {
  all: null,
  queued: ['queued'],
  running: ['pending', 'running'],
  completed: ['completed'],
  failed: ['failed'],
  cancelled: ['cancelled'],
};

export function createTrainingStatusMatcher(statusQuery) {
  const allowed = TRAINING_STATUS_GROUPS[statusQuery];
  if (!Array.isArray(allowed)) return null;
  return (task) => allowed.includes(String(task?.status || '').toLowerCase());
}

export function addVisibleSelection(selected = [], visible = []) {
  return [...new Set([...selected, ...visible])];
}

// Invalidate on account changes and mutations as well as newer reads.
export function createScopedRequestGate() {
  let scope = null;
  let version = 0;
  return {
    setScope(next) { if (scope !== next) { scope = next; version += 1; } },
    start() { return { scope, version: ++version }; },
    invalidate() { version += 1; },
    isCurrent(request) { return request.scope === scope && request.version === version; },
  };
}
