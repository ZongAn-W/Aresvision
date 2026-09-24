import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import {
  FULL_CAPABILITIES,
  HOME_DRAG,
  applyDragRotation,
  clampVelocity,
  decayVelocity,
  dragRotation,
  isInertiaStopKey,
  rotationForKey,
  shouldStartDrag,
  shouldStopInertia,
} from './homePointerInteraction';

const TEXTURE = '/earth/blue-marble-2048.png';
const BASE_TILT = 0.16;
const BASE_YAW = 2.8;
const BASE_ROLL = 0.12;
const AUTO_ROTATE_SPEED = 0.045; // rad / s
const RELEASE_IDLE_MS = 120; // 松手前停顿超过该时长就不再保留惯性

// A texture-only illustration: no analytical field or live measurements are shown.
// 旋转状态保存在 ref 中，动画循环直接读取，指针移动不触发 React 重新渲染。
export default function PlanetPreview({ rotating, label, capabilities = FULL_CAPABILITIES }) {
  const mountRef = useRef(null);
  const rotatingRef = useRef(rotating);
  const capabilitiesRef = useRef(capabilities);
  const rotationRef = useRef({ yaw: 0, pitch: 0 });
  const dragRef = useRef({ active: false, pointerId: null, lastX: 0, lastY: 0, lastTime: 0, velocity: 0 });
  const [dragging, setDragging] = useState(false);

  useEffect(() => { rotatingRef.current = rotating; }, [rotating]);
  useEffect(() => { capabilitiesRef.current = capabilities; }, [capabilities]);

  const endDrag = useCallback((pointerId) => {
    const drag = dragRef.current;
    if (!drag.active) return;
    if (pointerId != null && drag.pointerId !== pointerId) return;
    drag.active = false;
    drag.pointerId = null;
    // 减少动态效果或粗指针设备不保留惯性。
    if (!capabilitiesRef.current.inertia) drag.velocity = 0;
    setDragging(false);
  }, []);

  const handlePointerDown = (event) => {
    if (!shouldStartDrag(event, capabilitiesRef.current)) return;
    const drag = dragRef.current;
    drag.active = true;
    drag.pointerId = event.pointerId;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    drag.lastTime = event.timeStamp;
    drag.velocity = 0;
    // 指针捕获保证拖出地球后仍能连续接收事件。
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDragging(true);
  };

  const handlePointerMove = (event) => {
    const drag = dragRef.current;
    if (!drag.active || event.pointerId !== drag.pointerId) return;
    const delta = dragRotation(event.clientX - drag.lastX, event.clientY - drag.lastY);
    const elapsed = Math.max((event.timeStamp - drag.lastTime) / 1000, 1 / 240);
    rotationRef.current = applyDragRotation(rotationRef.current, delta);
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    drag.lastTime = event.timeStamp;
    // 换算成 60 fps 基准的每帧角度，作为松手后的惯性初速度。
    drag.velocity = clampVelocity(delta.yaw / (elapsed * 60));
  };

  const handlePointerEnd = (event) => {
    const drag = dragRef.current;
    if (!drag.active || event.pointerId !== drag.pointerId) return;
    if (event.timeStamp - drag.lastTime > RELEASE_IDLE_MS) drag.velocity = 0;
    endDrag(event.pointerId);
  };

  const handlePointerCancel = (event) => {
    dragRef.current.velocity = 0;
    handlePointerEnd(event);
  };

  const handleLostPointerCapture = (event) => {
    // 正常松手已经结束拖拽；此处仍在拖拽说明捕获异常丢失，不再保留惯性。
    if (dragRef.current.active) dragRef.current.velocity = 0;
    handlePointerEnd(event);
  };

  const handlePointerLeave = (event) => {
    // 未成功捕获指针时的兜底：松开按键后离开元素也要结束拖拽。
    if (event.buttons === 0) endDrag(event.pointerId);
  };

  const handleKeyDown = (event) => {
    if (!capabilitiesRef.current.keyboard) return;
    if (isInertiaStopKey(event.key)) {
      dragRef.current.velocity = 0;
      event.preventDefault();
      return;
    }
    const delta = rotationForKey(event.key);
    if (!delta) return;
    event.preventDefault();
    dragRef.current.velocity = 0;
    rotationRef.current = applyDragRotation(rotationRef.current, delta);
  };

  useEffect(() => {
    const container = mountRef.current;
    let disposed = false;
    let renderer;
    let frame;
    let resizeObserver;
    let visibilityObserver;
    let visible = true;
    const resources = [];
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');

    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
      renderer.setClearColor(0x000000, 0);
      renderer.domElement.setAttribute('aria-hidden', 'true');
      container.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 20);
      camera.position.z = 3.7;
      const geometry = new THREE.SphereGeometry(1, 64, 48);
      const material = new THREE.MeshStandardMaterial({
        color: 0x508fb4,
        roughness: 1,
      });
      resources.push(geometry, material);
      const globe = new THREE.Mesh(geometry, material);
      globe.rotation.set(BASE_TILT, BASE_YAW, BASE_ROLL);
      scene.add(globe);

      // A thin decorative atmosphere follows the sphere, not a measured field.
      const atmosphereMaterial = new THREE.ShaderMaterial({
        uniforms: { atmosphereColor: { value: new THREE.Color(0x9ad9ef) } },
        vertexShader: `
          varying vec3 vNormal;
          varying vec3 vViewPosition;
          void main() {
            vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
            vNormal = normalize(normalMatrix * normal);
            vViewPosition = -viewPosition.xyz;
            gl_Position = projectionMatrix * viewPosition;
          }
        `,
        fragmentShader: `
          uniform vec3 atmosphereColor;
          varying vec3 vNormal;
          varying vec3 vViewPosition;
          void main() {
            float facing = clamp(dot(normalize(vNormal), normalize(vViewPosition)), 0.0, 1.0);
            float edge = pow(1.0 - facing, 5.0);
            gl_FragColor = vec4(atmosphereColor, edge * 0.3);
            #include <colorspace_fragment>
          }
        `,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      });
      resources.push(atmosphereMaterial);
      const atmosphere = new THREE.Mesh(geometry, atmosphereMaterial);
      atmosphere.scale.setScalar(1.012);
      globe.add(atmosphere);

      scene.add(new THREE.AmbientLight(0xe6f3ff, 1.9));
      const sun = new THREE.DirectionalLight(0xffffff, 1.9);
      sun.position.set(-3, 4, 6);
      scene.add(sun);
      const rim = new THREE.DirectionalLight(0x9ad9ef, 0.65);
      rim.position.set(3, 1, -2);
      scene.add(rim);

      new THREE.TextureLoader().load(TEXTURE, (texture) => {
        if (disposed) { texture.dispose(); return; }
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
        material.map = texture;
        material.color.set(0xe2f2ff);
        material.needsUpdate = true;
        resources.push(texture);
      });

      resizeObserver = new ResizeObserver(() => {
        const size = container.clientWidth;
        if (size > 0) renderer.setSize(size, size);
      });
      resizeObserver.observe(container);
      visibilityObserver = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; });
      visibilityObserver.observe(container);
      let previous = 0;
      const render = (now) => {
        if (disposed) return;
        const delta = Math.min((now - previous) / 1000, 0.05);
        previous = now;
        if (visible && !document.hidden) {
          const drag = dragRef.current;
          if (drag.active) {
            // 拖拽期间暂停自动旋转，朝向只跟随指针。
          } else if (!shouldStopInertia(drag.velocity)) {
            rotationRef.current = applyDragRotation(rotationRef.current, { yaw: drag.velocity, pitch: 0 });
            drag.velocity = capabilitiesRef.current.inertia
              ? decayVelocity(drag.velocity, HOME_DRAG.damping, delta)
              : 0;
          } else {
            if (drag.velocity !== 0) drag.velocity = 0;
            if (rotatingRef.current && !motion.matches) {
              rotationRef.current = applyDragRotation(rotationRef.current, { yaw: delta * AUTO_ROTATE_SPEED, pitch: 0 });
            }
          }
          const rotation = rotationRef.current;
          globe.rotation.set(BASE_TILT + rotation.pitch, BASE_YAW + rotation.yaw, BASE_ROLL);
          renderer.render(scene, camera);
        }
        frame = requestAnimationFrame(render);
      };
      frame = requestAnimationFrame(render);
    } catch {
      // The CSS sphere remains visible on devices without WebGL.
    }

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      visibilityObserver?.disconnect();
      resources.forEach((resource) => resource.dispose());
      if (renderer) {
        renderer.dispose();
        renderer.domElement.remove();
      }
    };
  }, []);

  const className = [
    'home-planet',
    capabilities.drag ? 'home-planet--interactive' : '',
    dragging ? 'home-planet--dragging' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={className}
      role="img"
      aria-label={label}
      aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown"
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={handleLostPointerCapture}
      onPointerLeave={handlePointerLeave}
      onKeyDown={handleKeyDown}
    >
      <div className="home-orbit" aria-hidden="true" />
      <div className="home-planet__fallback" aria-hidden="true" />
      <div className="home-planet__canvas" ref={mountRef} />
    </div>
  );
}
