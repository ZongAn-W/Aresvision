/**
 * 首页轻量交互的纯函数集合。
 *
 * 这里只做数值计算、边界限制和输入能力判断，不读写 DOM，也不依赖 React：
 * HomePage 负责监听 pointermove / pointerleave 并把结果写成 CSS 自定义属性，
 * PlanetPreview 负责把旋转结果写入 Three.js 网格。拆分后所有规则都能用
 * Node 内置测试运行器直接验证。
 */

/** 通用数值边界限制。 */
export function clamp(value, min, max) {
  if (typeof value !== 'number' || Number.isNaN(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

// ─── 分层视差 ───

/** 三层视差幅度（CSS px）：轨道圈 > 地球 > 背景星点。 */
export const HOME_PARALLAX = Object.freeze({ stars: 4, orbit: 8, globe: 5 });

/** 指针回到元素中心时的归一化坐标。 */
export const HOME_PARALLAX_CENTER = Object.freeze({ x: 0, y: 0 });

/** 每层视差写入的 CSS 自定义属性，顺序与 HOME_PARALLAX 一致。 */
export const PARALLAX_PROPERTIES = Object.freeze({
  stars: Object.freeze(['--home-parallax-stars-x', '--home-parallax-stars-y']),
  orbit: Object.freeze(['--home-parallax-orbit-x', '--home-parallax-orbit-y']),
  globe: Object.freeze(['--home-parallax-globe-x', '--home-parallax-globe-y']),
});

/**
 * 指针坐标归一化：相对元素中心，宽高各映射到 [-1, 1]。
 * 元素尺寸为 0（隐藏或尚未布局）时返回中心值，避免除零产生 NaN。
 */
export function normalizePointer(clientX, clientY, rect) {
  const width = Number.isFinite(rect?.width) ? rect.width : 0;
  const height = Number.isFinite(rect?.height) ? rect.height : 0;
  const left = Number.isFinite(rect?.left) ? rect.left : 0;
  const top = Number.isFinite(rect?.top) ? rect.top : 0;
  const x = Number.isFinite(clientX) ? clientX : left;
  const y = Number.isFinite(clientY) ? clientY : top;

  return {
    x: width > 0 ? clamp(((x - left) / width) * 2 - 1, -1, 1) : 0,
    y: height > 0 ? clamp(((y - top) / height) * 2 - 1, -1, 1) : 0,
  };
}

/**
 * 单层视差位移：归一化坐标乘该层幅度，并限制在 ±幅度内。
 * 方向与指针一致（指针右移，图层轻微右移），文字区域不参与位移。
 */
export function parallaxOffset(normalized, amplitude) {
  const amount = Number.isFinite(amplitude) ? Math.abs(amplitude) : 0;
  const x = Number.isFinite(normalized?.x) ? normalized.x : 0;
  const y = Number.isFinite(normalized?.y) ? normalized.y : 0;
  return {
    x: clamp(x * amount, -amount, amount),
    y: clamp(y * amount, -amount, amount),
  };
}

/** 由归一化坐标得到三层视差位移。 */
export function parallaxLayers(normalized) {
  return {
    stars: parallaxOffset(normalized, HOME_PARALLAX.stars),
    orbit: parallaxOffset(normalized, HOME_PARALLAX.orbit),
    globe: parallaxOffset(normalized, HOME_PARALLAX.globe),
  };
}

function cssPixels(value) {
  const safe = Number.isFinite(value) ? value : 0;
  // 归一化 -0，避免写出 "-0.00px"。
  return `${(safe === 0 ? 0 : safe).toFixed(2)}px`;
}

/** 把三层视差位移转换成待写入的 CSS 自定义属性键值。 */
export function parallaxStyleValues(layers) {
  const source = layers ?? {};
  const values = {};
  Object.entries(PARALLAX_PROPERTIES).forEach(([layer, [xProperty, yProperty]]) => {
    const offset = source[layer] ?? HOME_PARALLAX_CENTER;
    values[xProperty] = cssPixels(offset.x);
    values[yProperty] = cssPixels(offset.y);
  });
  return values;
}

/** 将视差位移写入元素的 style（CSSStyleDeclaration 或等价对象）。 */
export function writeParallax(style, layers) {
  if (!style || typeof style.setProperty !== 'function') return;
  const values = parallaxStyleValues(layers);
  Object.entries(values).forEach(([property, value]) => style.setProperty(property, value));
}

/** 复位视差，用于指针离开和页面卸载。 */
export function clearParallax(style) {
  writeParallax(style, null);
}

// ─── 指针类型与媒体偏好 ───

/**
 * 只响应主鼠标和触控笔；触屏触摸保持页面正常纵向滚动，不参与交互。
 */
export function isInteractivePointer(pointerType) {
  return pointerType === 'mouse' || pointerType === 'pen';
}

/** matchMedia 结果判读，缺少 MediaQueryList 时按“未开启”处理。 */
export function prefersReducedMotion(queryList) {
  return Boolean(queryList?.matches);
}

export function isCoarsePointer(queryList) {
  return Boolean(queryList?.matches);
}

export const DEFAULT_MEDIA_PREFERENCES = Object.freeze({ reducedMotion: false, coarsePointer: false });

/** 减少动态效果：关闭视差与惯性，保留用户主动的拖拽和键盘旋转。 */
export const REDUCED_MOTION_CAPABILITIES = Object.freeze({ parallax: false, drag: true, inertia: false, keyboard: true });

/** 粗指针设备：关闭视差与拖拽，仅保留键盘操作。 */
export const COARSE_POINTER_CAPABILITIES = Object.freeze({ parallax: false, drag: false, inertia: false, keyboard: true });

export const FULL_CAPABILITIES = Object.freeze({ parallax: true, drag: true, inertia: true, keyboard: true });

/** 由媒体偏好解析出首页可用能力，返回冻结单例以便直接作为 React 状态比较。 */
export function resolveInteractionCapabilities(preferences) {
  if (preferences?.reducedMotion) return REDUCED_MOTION_CAPABILITIES;
  if (preferences?.coarsePointer) return COARSE_POINTER_CAPABILITIES;
  return FULL_CAPABILITIES;
}

/** 读取当前媒体偏好；无法读取 matchMedia 时返回默认值。 */
export function readMediaPreferences(scope) {
  const target = scope ?? (typeof window === 'undefined' ? null : window);
  if (typeof target?.matchMedia !== 'function') return DEFAULT_MEDIA_PREFERENCES;
  return {
    reducedMotion: prefersReducedMotion(target.matchMedia('(prefers-reduced-motion: reduce)')),
    coarsePointer: isCoarsePointer(target.matchMedia('(pointer: coarse)')),
  };
}

/**
 * 订阅媒体偏好变化：立即回调一次，之后在变化时回调。返回清理函数。
 */
export function observeMediaPreferences(scope, onChange) {
  const target = scope ?? (typeof window === 'undefined' ? null : window);
  if (typeof target?.matchMedia !== 'function') {
    onChange?.(DEFAULT_MEDIA_PREFERENCES);
    return () => {};
  }

  const motion = target.matchMedia('(prefers-reduced-motion: reduce)');
  const coarse = target.matchMedia('(pointer: coarse)');
  const notify = () => onChange?.({
    reducedMotion: prefersReducedMotion(motion),
    coarsePointer: isCoarsePointer(coarse),
  });
  const queryLists = [motion, coarse].filter(Boolean);

  queryLists.forEach((queryList) => {
    if (typeof queryList.addEventListener === 'function') queryList.addEventListener('change', notify);
    else if (typeof queryList.addListener === 'function') queryList.addListener(notify);
  });
  notify();

  return () => {
    queryLists.forEach((queryList) => {
      if (typeof queryList.removeEventListener === 'function') queryList.removeEventListener('change', notify);
      else if (typeof queryList.removeListener === 'function') queryList.removeListener(notify);
    });
  };
}

/** 视差是否应当响应该指针事件。 */
export function shouldTrackParallax(pointer, capabilities) {
  return Boolean(capabilities?.parallax) && isInteractivePointer(pointer?.pointerType);
}

/** 拖拽是否应当由该指针事件开始：主指针、主鼠标或触控笔、左键按下。 */
export function shouldStartDrag(pointer, capabilities) {
  if (!capabilities?.drag) return false;
  if (!pointer) return false;
  if (!isInteractivePointer(pointer.pointerType)) return false;
  if (pointer.isPrimary === false) return false;
  if (typeof pointer.button === 'number' && pointer.button !== 0) return false;
  return true;
}

// ─── 地球拖拽旋转与惯性 ───

/** 地球交互参数：灵敏度、垂直限制、惯性阻尼与键盘步长。 */
export const HOME_DRAG = Object.freeze({
  sensitivity: 0.005, // rad / CSS px
  maxPitch: 0.35, // rad，垂直旋转限制（俯仰偏移）
  damping: 0.8, // 每 1/60 秒保留的速度比例
  minSpeed: 0.0006, // rad / 帧，低于该值停止惯性
  maxSpeed: 0.12, // rad / 帧，松手速度上限
  keyboardStep: 0.12, // rad / 按键
});

/** 拖拽位移（CSS px）换算成旋转角度增量（rad）。 */
export function dragRotation(deltaX, deltaY, sensitivity = HOME_DRAG.sensitivity) {
  const x = Number.isFinite(deltaX) ? deltaX : 0;
  const y = Number.isFinite(deltaY) ? deltaY : 0;
  const scale = Number.isFinite(sensitivity) ? sensitivity : HOME_DRAG.sensitivity;
  return { yaw: x * scale, pitch: y * scale };
}

/** 横向角度回绕到 [-pi, pi]，避免长时间拖动后数值无限增长。 */
export function wrapAngle(angle) {
  if (!Number.isFinite(angle)) return 0;
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

/** 数值边界限制：横向回绕，纵向限制在 ±maxPitch。 */
export function clampRotation(rotation) {
  return {
    yaw: wrapAngle(rotation?.yaw),
    pitch: clamp(rotation?.pitch ?? 0, -HOME_DRAG.maxPitch, HOME_DRAG.maxPitch),
  };
}

/** 在既有旋转上叠加拖拽增量，并立即应用边界限制。 */
export function applyDragRotation(rotation, delta) {
  return clampRotation({
    yaw: (rotation?.yaw ?? 0) + (delta?.yaw ?? 0),
    pitch: (rotation?.pitch ?? 0) + (delta?.pitch ?? 0),
  });
}

/** 松手速度限制，防止快速甩动导致地球狂转。 */
export function clampVelocity(velocity, max = HOME_DRAG.maxSpeed) {
  if (!Number.isFinite(velocity)) return 0;
  return clamp(velocity, -max, max);
}

/**
 * 惯性速度衰减：每 1/60 秒保留 damping 比例，按真实帧间隔换算，
 * 因此 30 fps 与 120 fps 设备上的观感一致。
 */
export function decayVelocity(velocity, damping = HOME_DRAG.damping, delta = 1 / 60) {
  if (!Number.isFinite(velocity)) return 0;
  const ratio = Number.isFinite(damping) ? clamp(damping, 0, 1) : HOME_DRAG.damping;
  const seconds = Number.isFinite(delta) && delta > 0 ? delta : 1 / 60;
  return velocity * ratio ** (seconds * 60);
}

/** 速度低于阈值即认为惯性结束。 */
export function shouldStopInertia(velocity, minSpeed = HOME_DRAG.minSpeed) {
  if (!Number.isFinite(velocity)) return true;
  return Math.abs(velocity) < minSpeed;
}

/** 键盘方向键对应的旋转增量；非方向键返回 null。 */
export function rotationForKey(key, step = HOME_DRAG.keyboardStep) {
  const amount = Number.isFinite(step) ? step : HOME_DRAG.keyboardStep;
  switch (key) {
    case 'ArrowLeft': return { yaw: -amount, pitch: 0 };
    case 'ArrowRight': return { yaw: amount, pitch: 0 };
    case 'ArrowUp': return { yaw: 0, pitch: -amount };
    case 'ArrowDown': return { yaw: 0, pitch: amount };
    default: return null;
  }
}

/** Escape 用于立即停止惯性旋转。 */
export function isInertiaStopKey(key) {
  return key === 'Escape';
}

