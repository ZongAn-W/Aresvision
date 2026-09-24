import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COARSE_POINTER_CAPABILITIES,
  FULL_CAPABILITIES,
  HOME_DRAG,
  HOME_PARALLAX,
  HOME_PARALLAX_CENTER,
  PARALLAX_PROPERTIES,
  REDUCED_MOTION_CAPABILITIES,
  applyDragRotation,
  clamp,
  clampRotation,
  clampVelocity,
  clearParallax,
  decayVelocity,
  dragRotation,
  isCoarsePointer,
  isInertiaStopKey,
  isInteractivePointer,
  normalizePointer,
  observeMediaPreferences,
  parallaxLayers,
  parallaxOffset,
  parallaxStyleValues,
  prefersReducedMotion,
  readMediaPreferences,
  resolveInteractionCapabilities,
  rotationForKey,
  shouldStartDrag,
  shouldStopInertia,
  shouldTrackParallax,
  writeParallax,
} from './homePointerInteraction.js';

const closeTo = (actual, expected, tolerance = 1e-9) => assert.ok(
  Math.abs(actual - expected) <= tolerance,
  `expected ${actual} to be within ${tolerance} of ${expected}`,
);

const rect = { left: 0, top: 0, width: 200, height: 100 };

// ─── 指针坐标归一化 ───

test('pointer coordinates normalize around the element centre', () => {
  assert.deepEqual(normalizePointer(100, 50, rect), { x: 0, y: 0 });
  assert.deepEqual(normalizePointer(0, 0, rect), { x: -1, y: -1 });
  assert.deepEqual(normalizePointer(200, 100, rect), { x: 1, y: 1 });
  assert.deepEqual(normalizePointer(150, 25, rect), { x: 0.5, y: -0.5 });
});

test('pointer coordinates stay inside [-1, 1] and survive a zero-size element', () => {
  assert.deepEqual(normalizePointer(-500, 900, rect), { x: -1, y: 1 });
  assert.deepEqual(normalizePointer(50, 50, { left: 10, top: 20, width: 0, height: 0 }), { x: 0, y: 0 });
  assert.deepEqual(normalizePointer(50, 50, null), { x: 0, y: 0 });
});

test('offset rects keep the pointer mapped to the element centre', () => {
  assert.deepEqual(normalizePointer(160, 70, { left: 60, top: 20, width: 200, height: 100 }), { x: 0, y: 0 });
});

// ─── 视差幅度与边界 ───

test('parallax amplitudes match the layered interaction contract', () => {
  assert.equal(HOME_PARALLAX.stars, 4);
  assert.equal(HOME_PARALLAX.orbit, 8);
  assert.equal(HOME_PARALLAX.globe, 5);
  assert.ok(HOME_PARALLAX.orbit > HOME_PARALLAX.globe);
  assert.ok(HOME_PARALLAX.globe > HOME_PARALLAX.stars);
});

test('parallax layers stay at the centre when the pointer is centred', () => {
  assert.deepEqual(parallaxLayers(HOME_PARALLAX_CENTER), {
    stars: { x: 0, y: 0 },
    orbit: { x: 0, y: 0 },
    globe: { x: 0, y: 0 },
  });
});

test('parallax layers use their own amplitude at the pointer edge', () => {
  const layers = parallaxLayers({ x: 1, y: -1 });
  assert.deepEqual(layers.stars, { x: 4, y: -4 });
  assert.deepEqual(layers.orbit, { x: 8, y: -8 });
  assert.deepEqual(layers.globe, { x: 5, y: -5 });
});

test('parallax offsets clamp out-of-range input and invalid amplitudes', () => {
  assert.deepEqual(parallaxOffset({ x: 9, y: -9 }, 4), { x: 4, y: -4 });
  assert.deepEqual(parallaxOffset({ x: 0.5, y: 0.25 }, 8), { x: 4, y: 2 });
  assert.deepEqual(parallaxOffset(null, 5), { x: 0, y: 0 });
  assert.deepEqual(parallaxOffset({ x: Number.NaN, y: 1 }, Number.NaN), { x: 0, y: 0 });
});

test('parallax values are written as translucent-safe CSS custom properties', () => {
  assert.deepEqual(Object.keys(PARALLAX_PROPERTIES), ['stars', 'orbit', 'globe']);
  assert.deepEqual(parallaxStyleValues(parallaxLayers({ x: 1, y: -1 })), {
    '--home-parallax-stars-x': '4.00px',
    '--home-parallax-stars-y': '-4.00px',
    '--home-parallax-orbit-x': '8.00px',
    '--home-parallax-orbit-y': '-8.00px',
    '--home-parallax-globe-x': '5.00px',
    '--home-parallax-globe-y': '-5.00px',
  });
  assert.equal(parallaxStyleValues(parallaxLayers(HOME_PARALLAX_CENTER))['--home-parallax-stars-x'], '0.00px');
});

test('parallax can be written into and cleared from a style object', () => {
  const written = new Map();
  const style = { setProperty: (name, value) => written.set(name, value) };

  writeParallax(style, parallaxLayers({ x: 1, y: 0 }));
  assert.equal(written.get('--home-parallax-orbit-x'), '8.00px');
  assert.equal(written.get('--home-parallax-globe-x'), '5.00px');
  assert.equal(written.size, 6);

  clearParallax(style);
  assert.equal(written.get('--home-parallax-stars-x'), '0.00px');
  assert.equal(written.get('--home-parallax-globe-y'), '0.00px');
  assert.equal(written.get('--home-parallax-orbit-x'), '0.00px');

  // 缺少样式对象时不抛错，页面卸载路径必须安全。
  assert.doesNotThrow(() => writeParallax(null, parallaxLayers(HOME_PARALLAX_CENTER)));
  assert.doesNotThrow(() => clearParallax(undefined));
  assert.doesNotThrow(() => writeParallax({}, parallaxLayers(HOME_PARALLAX_CENTER)));
});

// ─── 鼠标、触控笔与触摸屏判断 ───

test('only the primary mouse and pen are interactive pointers', () => {
  assert.equal(isInteractivePointer('mouse'), true);
  assert.equal(isInteractivePointer('pen'), true);
  assert.equal(isInteractivePointer('touch'), false);
  assert.equal(isInteractivePointer(''), false);
  assert.equal(isInteractivePointer(undefined), false);
  assert.equal(isInteractivePointer(null), false);
});

test('parallax ignores touch pointers and reduced-motion sessions', () => {
  assert.equal(shouldTrackParallax({ pointerType: 'mouse' }, FULL_CAPABILITIES), true);
  assert.equal(shouldTrackParallax({ pointerType: 'pen' }, FULL_CAPABILITIES), true);
  assert.equal(shouldTrackParallax({ pointerType: 'touch' }, FULL_CAPABILITIES), false);
  assert.equal(shouldTrackParallax({ pointerType: 'mouse' }, REDUCED_MOTION_CAPABILITIES), false);
  assert.equal(shouldTrackParallax({ pointerType: 'mouse' }, null), false);
  assert.equal(shouldTrackParallax(null, FULL_CAPABILITIES), false);
});

test('dragging starts only for a primary mouse or pen press', () => {
  const mouse = { pointerType: 'mouse', isPrimary: true, button: 0 };
  assert.equal(shouldStartDrag(mouse, FULL_CAPABILITIES), true);
  assert.equal(shouldStartDrag({ ...mouse, pointerType: 'pen' }, FULL_CAPABILITIES), true);
  assert.equal(shouldStartDrag({ ...mouse, pointerType: 'touch' }, FULL_CAPABILITIES), false);
  assert.equal(shouldStartDrag({ ...mouse, button: 2 }, FULL_CAPABILITIES), false);
  assert.equal(shouldStartDrag({ ...mouse, isPrimary: false }, FULL_CAPABILITIES), false);
  assert.equal(shouldStartDrag(mouse, COARSE_POINTER_CAPABILITIES), false);
  assert.equal(shouldStartDrag(mouse, null), false);
  assert.equal(shouldStartDrag(null, FULL_CAPABILITIES), false);
});

// ─── prefers-reduced-motion 与粗指针判断 ───

test('reduced motion and coarse pointer queries are read defensively', () => {
  assert.equal(prefersReducedMotion({ matches: true }), true);
  assert.equal(prefersReducedMotion({ matches: false }), false);
  assert.equal(prefersReducedMotion(null), false);
  assert.equal(prefersReducedMotion(undefined), false);
  assert.equal(isCoarsePointer({ matches: true }), true);
  assert.equal(isCoarsePointer({ matches: false }), false);
  assert.equal(isCoarsePointer(null), false);
});

test('interaction capabilities drop the effects that must not run', () => {
  assert.deepEqual(resolveInteractionCapabilities(), FULL_CAPABILITIES);
  assert.deepEqual(resolveInteractionCapabilities({ reducedMotion: true }), REDUCED_MOTION_CAPABILITIES);
  assert.deepEqual(resolveInteractionCapabilities({ coarsePointer: true }), COARSE_POINTER_CAPABILITIES);
  assert.deepEqual(resolveInteractionCapabilities({ reducedMotion: true, coarsePointer: true }), REDUCED_MOTION_CAPABILITIES);

  // 减少动态效果：只关闭视差与惯性，直接拖拽与键盘仍可用。
  assert.equal(REDUCED_MOTION_CAPABILITIES.parallax, false);
  assert.equal(REDUCED_MOTION_CAPABILITIES.inertia, false);
  assert.equal(REDUCED_MOTION_CAPABILITIES.drag, true);
  assert.equal(REDUCED_MOTION_CAPABILITIES.keyboard, true);

  // 粗指针设备：不提供拖拽与视差，键盘说明仍然可用。
  assert.equal(COARSE_POINTER_CAPABILITIES.drag, false);
  assert.equal(COARSE_POINTER_CAPABILITIES.parallax, false);

  // 返回单例，媒体查询未变化时不会触发额外渲染。
  assert.equal(resolveInteractionCapabilities({ coarsePointer: true }), resolveInteractionCapabilities({ coarsePointer: true }));
});

test('media preferences are read from a matchMedia scope', () => {
  const scope = { matchMedia: (query) => ({ matches: query === '(pointer: coarse)' }) };
  assert.deepEqual(readMediaPreferences(scope), { reducedMotion: false, coarsePointer: true });
  assert.deepEqual(readMediaPreferences(null), { reducedMotion: false, coarsePointer: false });
  assert.deepEqual(readMediaPreferences({}), { reducedMotion: false, coarsePointer: false });
});

test('media preference changes are observed and the subscription is removable', () => {
  let coarse = true;
  const listeners = [];
  const scope = {
    // MediaQueryList.matches 是实时值，用 getter 模拟媒体状态变化。
    matchMedia: (query) => ({
      get matches() { return query === '(pointer: coarse)' ? coarse : false; },
      addEventListener: (type, listener) => listeners.push(listener),
      removeEventListener: (type, listener) => {
        const index = listeners.indexOf(listener);
        if (index >= 0) listeners.splice(index, 1);
      },
    }),
  };

  const seen = [];
  const stop = observeMediaPreferences(scope, (preferences) => seen.push(preferences));
  assert.deepEqual(seen, [{ reducedMotion: false, coarsePointer: true }]);
  assert.equal(listeners.length, 2);

  coarse = false;
  listeners.forEach((listener) => listener());
  assert.deepEqual(seen.at(-1), { reducedMotion: false, coarsePointer: false });

  stop();
  assert.equal(listeners.length, 0);

  // 没有 matchMedia 的环境回退到默认值，并且清理函数可直接调用。
  const fallback = [];
  const stopFallback = observeMediaPreferences({}, (preferences) => fallback.push(preferences));
  assert.deepEqual(fallback, [{ reducedMotion: false, coarsePointer: false }]);
  assert.doesNotThrow(() => stopFallback());
  assert.doesNotThrow(() => observeMediaPreferences(null, null)());
});

// ─── 地球水平与垂直旋转限制 ───

test('horizontal drag follows the documented sensitivity', () => {
  assert.equal(HOME_DRAG.sensitivity, 0.005);
  assert.equal(HOME_DRAG.maxPitch, 0.35);
  closeTo(dragRotation(200, 0).yaw, 1);
  closeTo(dragRotation(-100, 0).yaw, -0.5);
  closeTo(dragRotation(0, 100).pitch, 0.5);
  assert.deepEqual(dragRotation(Number.NaN, Number.NaN), { yaw: 0, pitch: 0 });
});

test('vertical rotation stops at the documented limit', () => {
  const down = applyDragRotation({ yaw: 0, pitch: 0.3 }, dragRotation(0, 100));
  closeTo(down.pitch, HOME_DRAG.maxPitch);

  const up = applyDragRotation({ yaw: 0, pitch: -0.3 }, dragRotation(0, -100));
  closeTo(up.pitch, -HOME_DRAG.maxPitch);

  // 再继续拖动也不会越过限制
  const further = applyDragRotation(down, dragRotation(0, 400));
  closeTo(further.pitch, HOME_DRAG.maxPitch);
});

test('horizontal rotation keeps accumulating and wraps into [-pi, pi]', () => {
  const spun = applyDragRotation({ yaw: 0, pitch: 0 }, dragRotation(600, 0));
  closeTo(spun.yaw, 3);
  const wrapped = clampRotation({ yaw: Math.PI * 2 + 0.4, pitch: 0 });
  closeTo(wrapped.yaw, 0.4);
  const negative = clampRotation({ yaw: -Math.PI - 1, pitch: 0 });
  closeTo(negative.yaw, Math.PI - 1);
  assert.deepEqual(clampRotation(null), { yaw: 0, pitch: 0 });
});

test('rotation keys map to the documented step and escape stops inertia', () => {
  assert.equal(HOME_DRAG.keyboardStep, 0.12);
  assert.deepEqual(rotationForKey('ArrowLeft'), { yaw: -0.12, pitch: 0 });
  assert.deepEqual(rotationForKey('ArrowRight'), { yaw: 0.12, pitch: 0 });
  assert.deepEqual(rotationForKey('ArrowUp'), { yaw: 0, pitch: -0.12 });
  assert.deepEqual(rotationForKey('ArrowDown'), { yaw: 0, pitch: 0.12 });
  assert.equal(rotationForKey('Tab'), null);
  assert.equal(rotationForKey('Escape'), null);
  assert.equal(rotationForKey(undefined), null);

  assert.equal(isInertiaStopKey('Escape'), true);
  assert.equal(isInertiaStopKey('Esc'), false);
  assert.equal(isInertiaStopKey('ArrowLeft'), false);
  assert.equal(isInertiaStopKey(undefined), false);

  // 方向键受同一套垂直限制约束
  const pitched = applyDragRotation({ yaw: 0, pitch: 0.3 }, rotationForKey('ArrowDown'));
  closeTo(pitched.pitch, HOME_DRAG.maxPitch);
});

// ─── 惯性阻尼 ───

test('inertia damping keeps 80% of the speed per 60 fps frame', () => {
  assert.equal(HOME_DRAG.damping, 0.8);
  closeTo(decayVelocity(0.1), 0.08);
  closeTo(decayVelocity(0.1, HOME_DRAG.damping, 1 / 30), 0.064);
  closeTo(decayVelocity(0.1, HOME_DRAG.damping, 1 / 120), 0.1 * 0.8 ** 0.5);
  assert.ok(decayVelocity(0.1, HOME_DRAG.damping, 10) < 1e-9);
  // 非法 delta 回退到单帧衰减
  closeTo(decayVelocity(0.1, HOME_DRAG.damping, 0), 0.08);
  closeTo(decayVelocity(0.1, HOME_DRAG.damping, Number.NaN), 0.08);
  assert.equal(decayVelocity(Number.NaN), 0);
});

test('release speed is clamped so a fast flick cannot spin the globe wildly', () => {
  assert.equal(HOME_DRAG.maxSpeed, 0.12);
  assert.equal(clampVelocity(5), HOME_DRAG.maxSpeed);
  assert.equal(clampVelocity(-5), -HOME_DRAG.maxSpeed);
  closeTo(clampVelocity(0.02), 0.02);
  assert.equal(clampVelocity(Number.NaN), 0);
});

test('inertia ends after a short decay window', () => {
  assert.equal(HOME_DRAG.minSpeed, 0.0006);
  assert.equal(shouldStopInertia(0.0005), true);
  assert.equal(shouldStopInertia(-0.0005), true);
  assert.equal(shouldStopInertia(0.01), false);
  assert.equal(shouldStopInertia(Number.NaN), true);

  let velocity = clampVelocity(0.05);
  let frames = 0;
  while (!shouldStopInertia(velocity) && frames < 600) {
    velocity = decayVelocity(velocity);
    frames += 1;
  }
  assert.ok(frames >= 10 && frames <= 120, `expected a short inertia window, got ${frames} frames`);
  assert.ok(shouldStopInertia(velocity));
});

test('clamp is the shared numeric guard for every bound', () => {
  assert.equal(clamp(5, -1, 1), 1);
  assert.equal(clamp(-5, -1, 1), -1);
  assert.equal(clamp(0.25, -1, 1), 0.25);
  assert.equal(clamp(3, 0, 1), 1);
});

