/**
 * 工作台请求通道协调器（无框架依赖，可单元测试）。
 *
 * 每个通道最多一个在途请求；新请求取消旧请求，并用 token + identity 双重检查，
 * 即使 fetch 实现不尊重 AbortSignal，迟到的回包也不会写回状态。
 *
 * 星球切换时调用 `cancelAll()`：这一步同时取消旧星球的全部通道，
 * 因而旧星球任何仍在路上的响应都无法 settle。
 */

export const WORKBENCH_CHANNELS = Object.freeze(['source', 'field', 'regional', 'point']);

export function createOverviewCoordinator() {
  const state = new Map();

  const ensure = (channel) => {
    let entry = state.get(channel);
    if (!entry) {
      entry = { token: 0, controller: null, identity: null };
      state.set(channel, entry);
    }
    return entry;
  };

  return {
    start(channel, identity) {
      const entry = ensure(channel);
      entry.controller?.abort();
      entry.token += 1;
      entry.identity = identity;
      entry.controller = new AbortController();
      return {
        channel,
        token: entry.token,
        identity,
        signal: entry.controller.signal,
      };
    },

    settle(request) {
      const entry = state.get(request?.channel);
      if (!entry) return false;
      if (entry.token !== request.token) return false;
      if (entry.identity !== request.identity) return false;
      if (request.signal?.aborted) return false;
      return true;
    },

    cancel(channel) {
      const entry = state.get(channel);
      if (!entry) return;
      entry.controller?.abort();
      entry.controller = null;
      entry.token += 1;
      entry.identity = null;
    },

    cancelAll() {
      for (const channel of new Set([...WORKBENCH_CHANNELS, ...state.keys()])) {
        this.cancel(channel);
      }
    },

    channels() {
      return Array.from(state.keys());
    },
  };
}

export default createOverviewCoordinator;
