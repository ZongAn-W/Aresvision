/**
 * Earth 总览独立的请求协调器。
 *
 * 每个通道最多一个 active controller；新请求取消旧请求，并同时用 token 身份与
 * context 双重检查，即使模拟 fetch 不尊重 abort 也不会写入旧结果。
 */

export function createEarthRequestCoordinator() {
  const active = new Map();

  return {
    start(channel, contextKey) {
      const previous = active.get(channel);
      if (previous) previous.controller.abort();
      const controller = new AbortController();
      const token = { channel, contextKey, controller, signal: controller.signal };
      active.set(channel, token);
      return token;
    },

    isCurrent(token, contextKey = token.contextKey) {
      if (!token) return false;
      return active.get(token.channel) === token
        && !token.signal.aborted
        && token.contextKey === contextKey;
    },

    /** 只有仍是最新且 context 未变的 token 才允许写入状态。 */
    settle(token, contextKey) {
      if (!this.isCurrent(token, contextKey)) return false;
      active.delete(token.channel);
      return true;
    },

    cancel(channel) {
      const token = active.get(channel);
      if (token) {
        token.controller.abort();
        active.delete(channel);
      }
    },

    invalidateAll() {
      for (const token of active.values()) token.controller.abort();
      active.clear();
    },
  };
}
