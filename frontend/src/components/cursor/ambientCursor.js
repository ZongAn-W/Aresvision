/**
 * 环境光标（ambient cursor）——首页专用。
 *
 * 用自定义准星替换系统指针，并提供两种「高级」反馈：
 *  1. 磁吸（magnet）：指针进入交互元素后，准星收缩并减速贴向元素中心，
 *     元素本体同时被拉向指针 —— 即 `.magnet` 元素通过 CSS 变量消费偏移量。
 *  2. 拖拽（drag）：元素声明 `data-cursor="drag"` 后，悬停时准星放大、
 *     停止磁吸并显示旋转提示；按下期间记录抓手状态，供惯性旋转使用。
 *
 * 设计取舍：
 *  - 只在「精确指针 + 支持 hover」的设备启用；触摸屏与移动端完全跳过。
 *  - 不隐藏系统光标，只叠加准星：即使本模块抛错，页面依然可正常操作。
 *  - DOM 由本模块创建并直接写入 `transform` / `width` / `height`，
 *    不经过 React 渲染，避免每帧触发组件更新。
 *  - `prefers-reduced-motion: reduce` 下不跑 rAF 循环，准星瞬时跟随；
 *    该偏好下也不做磁吸位移，元素不会被拉动。
 */

export const INTERACTIVE_SELECTOR =
  'a[href], button, [role="button"], input:not([type="hidden"]), select, textarea, summary, [data-cursor="hover"]';

export const CURSOR_ATTR = 'data-ambient-cursor';

/** 准星几何（CSS px） */
export const CURSOR_METRICS = {
  /** 静止时的环直径 */
  ringIdle: 24,
  /** 悬停交互元素时的环直径 */
  ringHover: 46,
  /** 按下交互元素时的环直径 */
  ringPress: 34,
  /** 中心点直径 */
  dot: 3,
  /** 准星跟随阻尼（每帧向目标推进的比例） */
  follow: 0.34,
  /** 磁吸阻尼；越小越「黏」 */
  magnetFollow: 0.13,
  /** 磁吸生效半径相对元素短边的系数 */
  magnetRange: 0.72,
  /** 磁吸偏移上限（CSS px），避免元素被拉得过远 */
  magnetPull: 18,
};

const MASK_BG = '#02050b';

/** 路由卡片等元素会动态挂载，用观察器保持磁吸绑定 */
const MAGNET_TARGETS = '.home-action, .home-workflow__item, .atmos-home';

/**
 * 判断当前设备是否适合启用自定义光标。
 * @param {Window} [win]
 * @returns {boolean}
 */
export function shouldEnableAmbientCursor(win = typeof window === 'undefined' ? undefined : window) {
  if (!win || typeof win.matchMedia !== 'function') return false;
  if (typeof win.PointerEvent !== 'function') return false;
  try {
    return win.matchMedia('(hover: hover) and (pointer: fine)').matches === true;
  } catch {
    return false;
  }
}

function matchesReducedMotion(win) {
  try {
    return win.matchMedia('(prefers-reduced-motion: reduce)').matches === true;
  } catch {
    return false;
  }
}

/**
 * 在指针附近查找最具交互语义的元素。
 * @param {Document} doc
 * @param {number} x
 * @param {number} y
 * @returns {Element|null}
 */
export function resolveInteractiveTarget(doc, x, y) {
  const el = doc.elementFromPoint(x, y);
  if (!el || typeof el.closest !== 'function') return null;
  try {
    return el.closest(INTERACTIVE_SELECTOR);
  } catch {
    return null;
  }
}

function isDisabled(target) {
  return Boolean(target && (target.disabled || target.getAttribute?.('aria-disabled') === 'true'));
}

/**
 * 计算元素被「拉向」光标的偏移量，并夹在 magnetPull 半径内。
 * @param {{left:number,top:number,width:number,height:number}} rect
 * @param {number} x
 * @param {number} y
 * @returns {{x:number, y:number, active:boolean, magnetized:boolean, centerX:number, centerY:number}}
 */
export function computeMagnetOffset(rect, x, y) {
  const width = Number(rect?.width) || 0;
  const height = Number(rect?.height) || 0;
  const centerX = (Number(rect?.left) || 0) + width / 2;
  const centerY = (Number(rect?.top) || 0) + height / 2;
  const dx = x - centerX;
  const dy = y - centerY;
  const halfShort = Math.min(width, height) / 2;
  const range = halfShort + halfShort * CURSOR_METRICS.magnetRange;
  const distance = Math.hypot(dx, dy);
  const active = range > 0 && distance <= range;

  if (!active) {
    return { x: 0, y: 0, active: false, magnetized: false, centerX, centerY };
  }

  // 指针越靠近元素中心，拉动越强；边缘处几乎为零，避免元素边缘抖动
  const strength = 1 - distance / range;
  const limit = CURSOR_METRICS.magnetPull * strength;
  const scale = distance > 0 ? Math.min(1, limit / distance) : 0;

  return {
    x: dx * scale,
    y: dy * scale,
    active: true,
    magnetized: strength > 0.04,
    centerX,
    centerY,
  };
}

/**
 * 计算带阻尼与速度上限的跟随步长。
 * @param {number} current
 * @param {number} target
 * @param {number} factor
 * @returns {number}
 */
export function dampedStep(current, target, factor) {
  const delta = (target - current) * factor;
  if (!Number.isFinite(delta)) return current;
  return current + delta;
}

/**
 * 依据状态推导准星环直径。
 * @param {{pressed:boolean, drag:boolean, interactive:boolean}} state
 * @returns {number}
 */
export function resolveRingSize(state) {
  if (state?.pressed && state?.drag) return CURSOR_METRICS.ringHover + 6;
  if (state?.pressed) return CURSOR_METRICS.ringPress;
  if (state?.interactive) return CURSOR_METRICS.ringHover;
  return CURSOR_METRICS.ringIdle;
}

function createNode(doc, className) {
  const node = doc.createElement('div');
  node.className = className;
  node.setAttribute(CURSOR_ATTR, '');
  node.setAttribute('aria-hidden', 'true');
  return node;
}

/**
 * 挂载环境光标。
 *
 * @param {{
 *   doc?: Document,
 *   win?: Window,
 *   shouldEnable?: (win: Window) => boolean,
 * }} [options]
 * @returns {{
 *   enabled: boolean,
 *   setDragging: (dragging: boolean) => void,
 *   isDragging: () => boolean,
 *   getPosition: () => {x:number, y:number},
 *   destroy: () => void,
 * }}
 */
export function mountAmbientCursor(options = {}) {
  const win = options.win ?? (typeof window === 'undefined' ? undefined : window);
  const doc = options.doc ?? win?.document;
  const enableCheck = options.shouldEnable ?? shouldEnableAmbientCursor;

  const noop = {
    enabled: false,
    setDragging() {},
    isDragging: () => false,
    getPosition: () => ({ x: 0, y: 0 }),
    destroy() {},
  };

  if (!win || !doc || !enableCheck(win)) return noop;

  const reduced = matchesReducedMotion(win);
  const root = createNode(doc, 'ambient-cursor');
  root.setAttribute('data-reduced-motion', reduced ? 'true' : 'false');
  const ring = createNode(doc, 'ambient-cursor__ring');
  const dot = createNode(doc, 'ambient-cursor__dot');
  const hint = createNode(doc, 'ambient-cursor__hint');
  ring.appendChild(hint);
  root.append(ring, dot);
  doc.body.appendChild(root);

  const state = {
    pointerX: win.innerWidth / 2,
    pointerY: win.innerHeight / 2,
    ringX: win.innerWidth / 2,
    ringY: win.innerHeight / 2,
    dotX: win.innerWidth / 2,
    dotY: win.innerHeight / 2,
    ringSize: CURSOR_METRICS.ringIdle,
    interactive: null,
    dragTarget: null,
    pressed: false,
    dragging: false,
    inside: false,
    visible: false,
  };

  /** 当前磁吸目标的稳定偏移量，逐帧平滑到目标值 */
  const magnet = { x: 0, y: 0, targetX: 0, targetY: 0, element: null };
  let frame = 0;
  let destroyed = false;
  let leaving = 0;

  const show = () => {
    if (state.visible) return;
    state.visible = true;
    root.setAttribute('data-visible', 'true');
  };

  const hide = () => {
    if (!state.visible) return;
    state.visible = false;
    root.removeAttribute('data-visible');
  };

  const syncHint = () => {
    const next = state.dragging ? 'grabbing' : state.dragTarget ? 'drag' : '';
    if (next) hint.setAttribute('data-hint', next);
    else hint.removeAttribute('data-hint');
  };

  const releaseMagnet = () => {
    if (magnet.element) {
      magnet.element.style.removeProperty('--cursor-magnet-x');
      magnet.element.style.removeProperty('--cursor-magnet-y');
      magnet.element = null;
    }
    magnet.targetX = 0;
    magnet.targetY = 0;
  };

  const updateInteractive = (x, y) => {
    const target = resolveInteractiveTarget(doc, x, y);
    const usable = target && !isDisabled(target) ? target : null;
    if (usable !== state.interactive) {
      state.interactive = usable;
      if (usable) root.setAttribute('data-interactive', 'true');
      else root.removeAttribute('data-interactive');
    }

    const dragEl = usable && usable.closest && usable.closest('[data-cursor="drag"]');
    const dragTarget = dragEl || (usable?.getAttribute?.('data-cursor') === 'drag' ? usable : null);
    if (dragTarget !== state.dragTarget) {
      state.dragTarget = dragTarget;
      if (dragTarget) root.setAttribute('data-drag', 'true');
      else root.removeAttribute('data-drag');
      syncHint();
    }
  };

  const updateMagnet = () => {
    const el = state.dragging ? null : magnet.element || (state.interactive?.classList?.contains('magnet') ? state.interactive : null);
    if (!el || reduced || typeof el.getBoundingClientRect !== 'function') {
      releaseMagnet();
      return;
    }
    if (!el.isConnected) {
      releaseMagnet();
      return;
    }
    magnet.element = el;
    const result = computeMagnetOffset(el.getBoundingClientRect(), state.pointerX, state.pointerY);
    magnet.targetX = result.active ? result.x : 0;
    magnet.targetY = result.active ? result.y : 0;
  };

  const paint = () => {
    ring.style.width = `${state.ringSize}px`;
    ring.style.height = `${state.ringSize}px`;
    ring.style.transform = `translate3d(${Math.round(state.ringX - state.ringSize / 2)}px, ${Math.round(
      state.ringY - state.ringSize / 2
    )}px, 0)`;
    dot.style.transform = `translate3d(${Math.round(state.dotX - CURSOR_METRICS.dot / 2)}px, ${Math.round(
      state.dotY - CURSOR_METRICS.dot / 2
    )}px, 0)`;

    if (magnet.element) {
      magnet.element.style.setProperty('--cursor-magnet-x', `${magnet.x.toFixed(2)}px`);
      magnet.element.style.setProperty('--cursor-magnet-y', `${magnet.y.toFixed(2)}px`);
    }
  };

  const tick = () => {
    if (destroyed) return;
    const follow = reduced ? 1 : state.interactive ? CURSOR_METRICS.magnetFollow : CURSOR_METRICS.follow;
    state.ringX = dampedStep(state.ringX, state.pointerX, follow);
    state.ringY = dampedStep(state.ringY, state.pointerY, follow);
    state.dotX = dampedStep(state.dotX, state.pointerX, reduced ? 1 : 0.6);
    state.dotY = dampedStep(state.dotY, state.pointerY, reduced ? 1 : 0.6);
    state.ringSize = dampedStep(
      state.ringSize,
      resolveRingSize({ pressed: state.pressed, drag: Boolean(state.dragTarget), interactive: Boolean(state.interactive) }),
      reduced ? 1 : 0.22
    );
    magnet.x = dampedStep(magnet.x, magnet.targetX, reduced ? 1 : 0.2);
    magnet.y = dampedStep(magnet.y, magnet.targetY, reduced ? 1 : 0.2);
    paint();
    frame = win.requestAnimationFrame(tick);
  };

  const onPointerMove = (event) => {
    if (event.pointerType && event.pointerType !== 'mouse') return;
    show();
    state.pointerX = event.clientX;
    state.pointerY = event.clientY;
    state.inside = true;
    if (leaving) {
      win.clearTimeout(leaving);
      leaving = 0;
    }
    updateInteractive(event.clientX, event.clientY);
    updateMagnet();
    if (reduced) {
      state.ringX = state.pointerX;
      state.ringY = state.pointerY;
      state.dotX = state.pointerX;
      state.dotY = state.pointerY;
      state.ringSize = resolveRingSize({
        pressed: state.pressed,
        drag: Boolean(state.dragTarget),
        interactive: Boolean(state.interactive),
      });
      paint();
    }
  };

  const onPointerDown = (event) => {
    if (event.pointerType && event.pointerType !== 'mouse') return;
    state.pressed = true;
    root.setAttribute('data-pressed', 'true');
    if (state.dragTarget) {
      state.dragging = true;
      root.setAttribute('data-dragging', 'true');
      syncHint();
    }
  };

  const onPointerUp = () => {
    state.pressed = false;
    state.dragging = false;
    root.removeAttribute('data-pressed');
    root.removeAttribute('data-dragging');
    syncHint();
  };

  const onPointerLeave = () => {
    state.inside = false;
    leaving = win.setTimeout(() => {
      if (!state.inside) {
        hide();
        state.interactive = null;
        state.dragTarget = null;
        releaseMagnet();
        root.removeAttribute('data-interactive');
        root.removeAttribute('data-drag');
        syncHint();
      }
    }, 160);
  };

  const onWindowBlur = () => {
    onPointerUp();
    onPointerLeave();
  };

  win.addEventListener('pointermove', onPointerMove, { passive: true });
  win.addEventListener('pointerdown', onPointerDown, { passive: true });
  win.addEventListener('pointerup', onPointerUp, { passive: true });
  win.addEventListener('pointercancel', onPointerUp, { passive: true });
  doc.addEventListener('pointerleave', onPointerLeave);
  win.addEventListener('blur', onWindowBlur);

  // 动态挂载的元素（路由切换、训练卡片等）重新进入时刷新一次状态
  let observer;
  if (typeof win.MutationObserver === 'function') {
    observer = new win.MutationObserver(() => {
      if (!state.inside) return;
      updateInteractive(state.pointerX, state.pointerY);
      updateMagnet();
    });
    observer.observe(doc.body, { childList: true, subtree: true });
  }

  if (!reduced) frame = win.requestAnimationFrame(tick);
  else paint();

  return {
    enabled: true,
    setDragging(dragging) {
      state.dragging = Boolean(dragging);
      if (state.dragging) root.setAttribute('data-dragging', 'true');
      else root.removeAttribute('data-dragging');
      syncHint();
    },
    isDragging: () => state.dragging,
    getPosition: () => ({ x: state.pointerX, y: state.pointerY }),
    destroy() {
      destroyed = true;
      win.cancelAnimationFrame(frame);
      if (leaving) win.clearTimeout(leaving);
      win.removeEventListener('pointermove', onPointerMove);
      win.removeEventListener('pointerdown', onPointerDown);
      win.removeEventListener('pointerup', onPointerUp);
      win.removeEventListener('pointercancel', onPointerUp);
      doc.removeEventListener('pointerleave', onPointerLeave);
      win.removeEventListener('blur', onWindowBlur);
      observer?.disconnect();
      releaseMagnet();
      root.remove();
    },
  };
}

/** 供 CSS 与环境光标共享的遮罩色常量（浅色主题在 CSS 侧覆盖） */
export const CURSOR_MASK_BG = MASK_BG;
