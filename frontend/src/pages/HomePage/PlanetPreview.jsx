import { useEffect, useRef } from 'react';
import * as THREE from 'three';

const TEXTURE = '/earth/blue-marble-2048.png';

// A texture-only illustration: no analytical field or live measurements are shown.
export default function PlanetPreview({ rotating, label }) {
  const mountRef = useRef(null);
  const rotatingRef = useRef(rotating);

  useEffect(() => { rotatingRef.current = rotating; }, [rotating]);

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
      globe.rotation.set(0.16, 2.8, 0.12);
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
          if (rotatingRef.current && !motion.matches) globe.rotation.y += delta * 0.045;
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

  return (
    <div className="home-planet" role="img" aria-label={label}>
      <div className="home-planet__fallback" aria-hidden="true" />
      <div className="home-planet__canvas" ref={mountRef} />
    </div>
  );
}
