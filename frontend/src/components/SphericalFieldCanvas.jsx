import React, { useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import * as THREE from 'three';
import { TrackballControls } from 'three/addons/controls/TrackballControls.js';
import { getRgb, rdbuRgb } from '../utils/colormaps';
import { useSettings } from '../contexts/SettingsContext';
import { buildCanvasFont, normalizeFontScale } from '../utils/fontScale';
import { buildSeasonalSunLight } from './sphericalLighting';
import { localPointToLatLng } from './sphericalPicking';
import {
  buildGridParticleSamples,
  buildPointParticleSamples,
  updateGridParticleBuffers,
  updatePointParticleBuffers,
} from './sphericalFieldParticles';

// --- 全局缓存贴图 ---
let cachedMarsTexture = null;
let cachedCircleTexture = null;

function latLonToVec3(latDeg, lonDeg, radius) {
  const phi = (90 - latDeg) * (Math.PI / 180);
  const theta = lonDeg * (Math.PI / 180);
  return new THREE.Vector3(
    radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  );
}

function createLabelSprite(text, isLight, fontScale = 1) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const fontSize = 30;
  const padX = 20;
  const padY = 8;
  const strokeWidth = 4;
  const labelFontFamily = '"Segoe UI Symbol", "Segoe UI", "Arial Unicode MS", "Noto Sans", sans-serif';
  ctx.font = buildCanvasFont(fontSize, { family: labelFontFamily, weight: 600, scale: fontScale });
  const textWidth = Math.ceil(ctx.measureText(text).width);

  canvas.width = Math.max(110, textWidth + padX * 2 + strokeWidth * 2 + 6);
  canvas.height = fontSize + padY * 2 + strokeWidth;

  ctx.font = buildCanvasFont(fontSize, { family: labelFontFamily, weight: 600, scale: fontScale });
  ctx.fillStyle = isLight ? '#203042' : '#d5e8ff';
  ctx.strokeStyle = isLight ? 'rgba(255,255,255,0.9)' : 'rgba(8,12,20,0.9)';
  ctx.lineWidth = strokeWidth;
  ctx.lineJoin = 'round';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.strokeText(text, canvas.width / 2, canvas.height / 2 + 1);
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 1);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  texture.minFilter = THREE.LinearFilter;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: true,
    depthWrite: false,
  });

  const sprite = new THREE.Sprite(material);
  const aspect = canvas.width / canvas.height;
  const baseScale = 0.095;
  sprite.scale.set(baseScale * aspect, baseScale, 1);
  sprite.renderOrder = 20;
  return sprite;
}

function updateGeoLabelVisibility(overlay, globeGroup, camera) {
  if (!overlay || !globeGroup || !camera) return;

  const cameraLocal = globeGroup
    .worldToLocal(camera.getWorldPosition(new THREE.Vector3()))
    .normalize();
  overlay.children.forEach((child) => {
    const normal = child.userData?.geoLabelNormal;
    if (!normal) return;
    const isPole = child.userData.geoLabelRole === 'latitude-pole';
    child.visible = isPole || normal.dot(cameraLocal) > 0.22;
  });
}

function buildGeoOverlay(isLight, fontScale = 1) {
  const group = new THREE.Group();
  group.name = 'geo-overlay';

  const minorColor = isLight ? 0x3b4f66 : 0x89a8c8;
  const majorColor = isLight ? 0x1e293b : 0xc7e1ff;
  const lineRadius = 0.902;
  const latStep = 30;
  const lonStep = 60;

  const makeLine = (points, color, opacity) => {
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
    });
    return new THREE.Line(geometry, material);
  };

  for (let lat = -90; lat <= 90; lat += latStep) {
    if (Math.abs(lat) === 90) continue; // 极点为退化点，网线使用标签表达更清晰
    const points = [];
    for (let lon = 0; lon <= 360; lon += 4) {
      points.push(latLonToVec3(lat, lon, lineRadius));
    }
    const isMajor = lat === 0;
    group.add(makeLine(points, isMajor ? majorColor : minorColor, isMajor ? 0.5 : 0.23));
  }

  for (let lon = 0; lon < 360; lon += lonStep) {
    const points = [];
    for (let lat = -90; lat <= 90; lat += 4) {
      points.push(latLonToVec3(lat, lon, lineRadius));
    }
    const isMajor = lon % 90 === 0;
    group.add(makeLine(points, isMajor ? majorColor : minorColor, isMajor ? 0.48 : 0.2));
  }

  const latLabels = [-90, -60, -30, 30, 60, 90];
  const degree = '\u00B0';
  const formatLatLabel = (lat) => (lat === 0 ? `0${degree}` : `${Math.abs(lat)}${degree}${lat > 0 ? 'N' : 'S'}`);
  latLabels.forEach((lat) => {
    const sprite = createLabelSprite(formatLatLabel(lat), isLight, fontScale);
    const p = latLonToVec3(lat, 8, lat === 90 || lat === -90 ? 1.06 : 1.03);
    sprite.position.set(p.x, p.y, p.z);
    sprite.userData.geoLabelNormal = p.clone().normalize();
    if (Math.abs(lat) === 90) sprite.userData.geoLabelRole = 'latitude-pole';
    group.add(sprite);
  });

  const lonLabels = Array.from({ length: 360 / lonStep }, (_, index) => index * lonStep);
  const lonLabelLat = 0;
  const formatLonLabel = (lon) => {
    if (lon === 0) return `0${degree}`;
    if (lon === 180) return `180${degree}`;
    if (lon > 0 && lon < 180) return `${lon}${degree}E`;
    return `${360 - lon}${degree}W`;
  };
  lonLabels.forEach((lon) => {
    const text = formatLonLabel(lon);
    const sprite = createLabelSprite(text, isLight, fontScale);
    const p = latLonToVec3(lonLabelLat, lon, 1.06);
    sprite.position.set(p.x, p.y, p.z);
    sprite.userData.geoLabelNormal = p.clone().normalize();
    group.add(sprite);
  });

  return group;
}

function disposeObject3D(root) {
  if (!root) return;
  root.traverse((node) => {
    if (node.geometry) node.geometry.dispose();
    if (node.material) {
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      materials.forEach((material) => {
        if (material?.map && material.map !== cachedMarsTexture && material.map !== cachedCircleTexture) {
          material.map.dispose();
        }
        material?.dispose?.();
      });
    }
  });
}

function createCircleTexture() {
  if (cachedCircleTexture) return cachedCircleTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 32, 32);
  cachedCircleTexture = new THREE.CanvasTexture(canvas);
  return cachedCircleTexture;
}

function getParticleLayerKey(layerConfig, index) {
  return `${index}:${layerConfig?.id || layerConfig?.source || (layerConfig?.renderAsPoints ? 'points' : 'grid')}`;
}

function getParticleSeed(key) {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function getGridLayerSignature(fieldData, particleDensity, radiusOffset) {
  const nLat = fieldData?.field?.length || 0;
  const nLon = fieldData?.field?.[0]?.length || 0;
  return `grid:${nLat}x${nLon}:${particleDensity}:${radiusOffset}`;
}

function getPointLayerSignature(points, radiusOffset) {
  const parts = (points || []).map((point) => [
    Number(point?.lat || 0).toFixed(3),
    Number(point?.lng || 0).toFixed(3),
    Math.round(16 * Math.min(3, Math.max(1, Math.sqrt(Math.max(1, point?.count || 1))))),
  ].join(':'));
  return `points:${radiusOffset}:${parts.join('|')}`;
}

function mapParticleColor(colorMode, colormap, t) {
  const rgb = colorMode === 'rdbu' ? rdbuRgb(t) : getRgb(colormap, t);
  return [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255];
}

function disposeParticleMesh(mesh) {
  if (!mesh) return;
  if (mesh.geometry) mesh.geometry.dispose();
  if (mesh.material) mesh.material.dispose();
}

const SphericalFieldCanvas = forwardRef(({
  fieldData,
  fieldLayers,
  colorMode = 'inferno',
  h = 240,
  forceFullscreen = false,
  autoRotate = true,
  zoom = 4.5,
  showMars = true,
  showConcentration = true,
  showGeoAnnotations = true,
  offsetX = 0,
  solarLongitudeLs = 0,
  onGlobeClick,
}, ref) => {
  const { settings } = useSettings();
  const fontScale = normalizeFontScale(settings.appearance?.uiScale);
  const isLight = settings.theme === 'light';
  const containerRef = useRef(null);
  const rendererRef = useRef(null);
  const sphereMeshRef = useRef(null);
  const particlesMeshRef = useRef(null);
  const particleLayersRef = useRef([]);
  const particleLayerCacheRef = useRef(new Map());
  const controlsRef = useRef(null);
  const autoRotateRef = useRef(autoRotate);
  const starMeshRef = useRef(null);
  const offsetXRef = useRef(offsetX);
  const geoOverlayRef = useRef(null);
  const marsMeshRef = useRef(null);
  const directionalLightRef = useRef(null);
  const pickingMeshRef = useRef(null);
  const onGlobeClickRef = useRef(onGlobeClick);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const raycasterRef = useRef(new THREE.Raycaster());
  const pointerRef = useRef(new THREE.Vector2());

  useEffect(() => {
    onGlobeClickRef.current = onGlobeClick;
  }, [onGlobeClick]);

  const addMarsMesh = (globeGroup) => {
    if (!globeGroup || marsMeshRef.current) return;
    const marsRadius = 0.86;
    const marsGeometry = new THREE.SphereGeometry(marsRadius, 64, 64);
    if (!cachedMarsTexture) {
      cachedMarsTexture = new THREE.TextureLoader().load('/mars_texture.jpg');
    }
    const marsMaterial = new THREE.MeshPhongMaterial({
      map: cachedMarsTexture,
      shininess: 5,
    });
    const marsMesh = new THREE.Mesh(marsGeometry, marsMaterial);
    globeGroup.add(marsMesh);
    marsMeshRef.current = marsMesh;
  };

  const removeMarsMesh = (globeGroup) => {
    if (!globeGroup || !marsMeshRef.current) return;
    const marsMesh = marsMeshRef.current;
    globeGroup.remove(marsMesh);
    if (marsMesh.geometry) marsMesh.geometry.dispose();
    const materials = Array.isArray(marsMesh.material) ? marsMesh.material : [marsMesh.material];
    materials.forEach((material) => {
      if (material?.map && material.map !== cachedMarsTexture) {
        material.map.dispose();
      }
      material?.dispose?.();
    });
    marsMeshRef.current = null;
  };

  const ensurePickingMesh = (globeGroup) => {
    if (!globeGroup || pickingMeshRef.current) return;
    const pickingGeometry = new THREE.SphereGeometry(0.9, 64, 64);
    const pickingMaterial = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const pickingMesh = new THREE.Mesh(pickingGeometry, pickingMaterial);
    pickingMesh.name = 'globe-picking-sphere';
    pickingMesh.renderOrder = -1;
    globeGroup.add(pickingMesh);
    pickingMeshRef.current = pickingMesh;
  };

  const ensureParticleEntry = ({
    key,
    signature,
    samples,
    materialOptions,
    globeGroup,
  }) => {
    const cache = particleLayerCacheRef.current;
    let entry = cache.get(key);

    if (!entry || entry.signature !== signature) {
      if (entry?.mesh) {
        globeGroup.remove(entry.mesh);
        disposeParticleMesh(entry.mesh);
      }

      const positions = new Float32Array(samples.count * 3);
      const colors = new Float32Array(samples.count * 3);
      const geometry = new THREE.BufferGeometry();
      const positionAttribute = new THREE.BufferAttribute(positions, 3);
      const colorAttribute = new THREE.BufferAttribute(colors, 3);
      positionAttribute.setUsage(THREE.DynamicDrawUsage);
      colorAttribute.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute('position', positionAttribute);
      geometry.setAttribute('color', colorAttribute);
      const material = new THREE.PointsMaterial({
        vertexColors: true,
        map: createCircleTexture(),
        transparent: true,
        depthWrite: false,
        ...materialOptions,
      });
      const mesh = new THREE.Points(geometry, material);
      globeGroup.add(mesh);
      entry = { key, signature, samples, mesh, positions, colors };
      cache.set(key, entry);
    } else {
      Object.assign(entry.mesh.material, materialOptions);
      entry.mesh.material.needsUpdate = true;
    }

    return entry;
  };

  const removeUnusedParticleEntries = (activeKeys, globeGroup) => {
    const cache = particleLayerCacheRef.current;
    for (const [key, entry] of cache.entries()) {
      if (activeKeys.has(key)) continue;
      globeGroup.remove(entry.mesh);
      disposeParticleMesh(entry.mesh);
      cache.delete(key);
    }
  };

  useEffect(() => {
    offsetXRef.current = offsetX;
  }, [offsetX]);

  const pickGlobeAtClientPoint = (clientX, clientY) => {
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    const globe = sphereMeshRef.current;
    const pickingMesh = pickingMeshRef.current;
    if (!renderer || !camera || !globe || !pickingMesh) return null;

    const rect = renderer.domElement.getBoundingClientRect();
    const xRatio = (clientX - rect.left) / rect.width;
    const yRatio = (clientY - rect.top) / rect.height;
    if (xRatio < 0 || xRatio > 1 || yRatio < 0 || yRatio > 1) return null;

    const pointer = pointerRef.current;
    pointer.x = xRatio * 2 - 1;
    pointer.y = -(yRatio * 2 - 1);
    raycasterRef.current.setFromCamera(pointer, camera);
    const [hit] = raycasterRef.current.intersectObject(pickingMesh, false);
    if (!hit) return null;

    const localPoint = globe.worldToLocal(hit.point.clone());
    return localPointToLatLng(localPoint);
  };

  // Expose imperative API for gesture control
  useImperativeHandle(ref, () => ({
    applyGestureRotation: (dx, dy) => {
      if (sphereMeshRef.current && cameraRef.current) {
        // 模型旋转：不要直接修改固定的 Euler 旋转（会产生万向节锁或方向反转）
        // 改为绕着相机空间内的世界轴（Up和Right）进行旋转
        // 放大倍率提高体验灵敏度

        // 算出相机在世界空间中的向上和向右向量
        const cameraUp = new THREE.Vector3(0, 1, 0).applyQuaternion(cameraRef.current.quaternion).normalize();
        const cameraRight = new THREE.Vector3(1, 0, 0).applyQuaternion(cameraRef.current.quaternion).normalize();

        // 绕着视角的Y（Up）轴左右转，绕X（Right）轴上下转
        sphereMeshRef.current.rotateOnWorldAxis(cameraUp, dx * 3.0);
        sphereMeshRef.current.rotateOnWorldAxis(cameraRight, dy * 3.0);
      }
    },
    applyGestureZoom: (dDist) => {
      if (cameraRef.current) {
        // 向内捏合变小 (-dDist): 视距变大 (离远); 向外张开 (+dDist): 视距变小 (凑近)
        const step = -dDist * 8.0;

        // 因为用户可能用鼠标（TrackballControls）转动过视角，相机的坐标不再是在纯正的 Z 轴上
        // 正确做法是直接缩放相机所在坐标向量的长度（维持到原点方向不变）
        const currentDist = cameraRef.current.position.length();
        const newDist = Math.max(1.2, Math.min(12.0, currentDist + step));
        cameraRef.current.position.setLength(newDist);
      }
    },
    pickGlobeAtClientPoint: (clientX, clientY) => pickGlobeAtClientPoint(clientX, clientY),
  }));

  // Update ref when prop changes so animation loop catches it
  useEffect(() => {
    autoRotateRef.current = autoRotate;
  }, [autoRotate]);

  // 1. 初始化 Three.js 场景、相机、渲染器和控制器（仅执行一次）
  useEffect(() => {
    if (!containerRef.current) return;

    // 清理可能存在的旧 Canvas
    containerRef.current.innerHTML = '';

    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    if (offsetX !== 0) {
      camera.setViewOffset(width, height, offsetX, 0, width, height);
    }
    camera.position.set(0, 0, zoom);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new TrackballControls(camera, renderer.domElement);
    controls.rotateSpeed = 3.0; // 适当降低些旋转的抽搐
    controls.zoomSpeed = 0.5; // 降低缩放灵敏度
    controls.panSpeed = 0.2; // 显著降低右键平移的灵敏度
    controls.noZoom = false;
    // 禁止右键平移，固定球体在这个中心位置
    controls.noPan = true;
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.ZOOM,
    };
    controls.staticMoving = false; // true可以去掉阻尼
    controls.dynamicDampingFactor = 0.15; // 阻尼系数

    // 让球体固定在画面中央
    controls.target.set(0, 0, 0);

    controlsRef.current = controls;

    let pointerStart = null;

    const handlePointerDown = (event) => {
      if (event.button !== 0) return;
      pointerStart = { x: event.clientX, y: event.clientY, time: performance.now() };
    };

    const handlePointerUp = (event) => {
      if (event.button !== 0 || !pointerStart || !cameraRef.current || !sphereMeshRef.current || !pickingMeshRef.current) {
        pointerStart = null;
        return;
      }
      const moved = Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y);
      const elapsed = performance.now() - pointerStart.time;
      pointerStart = null;
      if (moved > 5 || elapsed > 850 || typeof onGlobeClickRef.current !== 'function') return;

      const coord = pickGlobeAtClientPoint(event.clientX, event.clientY);
      if (coord) onGlobeClickRef.current(coord);
    };

    renderer.domElement.addEventListener('pointerdown', handlePointerDown);
    renderer.domElement.addEventListener('pointerup', handlePointerUp);

    // 光照对于 Points 材质不生效，但可用于内部火星球体
    const ambientLight = new THREE.AmbientLight(0xffffff, isLight ? 0.8 : 0.2);
    scene.add(ambientLight);

    const seasonalSunlight = buildSeasonalSunLight(solarLongitudeLs);
    const dirLight = new THREE.DirectionalLight(0xffffff, isLight ? 1.0 : 1.5);
    dirLight.position.set(
      seasonalSunlight.position.x,
      seasonalSunlight.position.y,
      seasonalSunlight.position.z,
    );
    scene.add(dirLight);
    directionalLightRef.current = dirLight;

    // --- 背景星星特效（恒定不变，在此初始化）---
    const starGeometry = new THREE.BufferGeometry();
    const starCount = 500;
    const starPositions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      // 随机散布在半宽 10 的立方体内，挖空中间半径 2 的核心（避免挡住主星）
      let r = 2.5 + Math.random() * 8.0;
      let theta = Math.random() * Math.PI * 2;
      let phi = Math.acos(2 * Math.random() - 1);

      const x = r * Math.sin(phi) * Math.cos(theta);
      const y = r * Math.cos(phi);
      const z = r * Math.sin(phi) * Math.sin(theta);

      starPositions[i * 3] = x;
      starPositions[i * 3 + 1] = y;
      starPositions[i * 3 + 2] = z;
    }
    starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    const starMaterial = new THREE.PointsMaterial({
      color: isLight ? 0x1e293b : 0xffffff,
      size: 0.02,
      transparent: true,
      opacity: isLight ? 0 : 0.6, // 浅色模式初始就不显示
      depthWrite: false,
    });
    const stars = new THREE.Points(starGeometry, starMaterial);
    stars.visible = !isLight; // 初始可见性
    scene.add(stars);
    starMeshRef.current = stars;

    let reqId;
    const animate = () => {
      reqId = requestAnimationFrame(animate);
      if (controlsRef.current) controlsRef.current.update();
      if (sphereMeshRef.current && autoRotateRef.current) {
        sphereMeshRef.current.rotateY(0.001); // 绕模型本身的极点（局部 Y 轴）自转，即使手势倾斜了球体也始终按纬度线旋转
      }
      updateGeoLabelVisibility(geoOverlayRef.current, sphereMeshRef.current, cameraRef.current);
      stars.rotateY(0.0003); // 星空背景微弱伴走
      if (rendererRef.current) rendererRef.current.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      if (!containerRef.current || !rendererRef.current) return;
      const w = containerRef.current.clientWidth;
      const h2 = containerRef.current.clientHeight;
      camera.aspect = w / h2;
      if (offsetXRef.current !== 0) {
        camera.setViewOffset(w, h2, offsetXRef.current, 0, w, h2);
      } else {
        camera.clearViewOffset();
      }
      camera.updateProjectionMatrix();
      if (controlsRef.current) {
        controlsRef.current.handleResize();
      }
      rendererRef.current.setSize(w, h2);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
      renderer.domElement.removeEventListener('pointerup', handlePointerUp);
      cancelAnimationFrame(reqId);
      if (rendererRef.current) {
        rendererRef.current.dispose();
      }
      starGeometry.dispose();
      starMaterial.dispose();
    };
  }, [forceFullscreen]); // 仅在尺寸模式切换时重新初始化控制台

  // 主题变化：更新场景背景色和星星可见性
  useEffect(() => {
    if (!sceneRef.current) return;
    sceneRef.current.background = null;
    if (starMeshRef.current) {
      starMeshRef.current.visible = !isLight; // 浅色模式下隐藏星星，保持画面纯净
      starMeshRef.current.material.color.setHex(isLight ? 0x1e293b : 0xffffff);
    }
    sceneRef.current.children.forEach(child => {
      if (child instanceof THREE.AmbientLight) {
        child.intensity = isLight ? 0.8 : 0.2;
      }
    });
    if (directionalLightRef.current) {
      directionalLightRef.current.intensity = isLight ? 1.0 : 1.5;
    }
  }, [isLight]);

  useEffect(() => {
    const seasonalSunlight = buildSeasonalSunLight(solarLongitudeLs);
    if (directionalLightRef.current) {
      directionalLightRef.current.intensity = isLight ? 1.0 : 1.5;
      directionalLightRef.current.position.set(
        seasonalSunlight.position.x,
        seasonalSunlight.position.y,
        seasonalSunlight.position.z,
      );
    }
  }, [isLight, solarLongitudeLs]);

  useEffect(() => {
    if (sphereMeshRef.current) {
      if (geoOverlayRef.current) {
        sphereMeshRef.current.remove(geoOverlayRef.current);
        disposeObject3D(geoOverlayRef.current);
        geoOverlayRef.current = null;
      }
      const overlay = buildGeoOverlay(isLight, fontScale);
      overlay.visible = showGeoAnnotations;
      sphereMeshRef.current.add(overlay);
      geoOverlayRef.current = overlay;
    }
  }, [fontScale, isLight]);

  useEffect(() => {
    if (geoOverlayRef.current) {
      geoOverlayRef.current.visible = showGeoAnnotations;
    }
  }, [showGeoAnnotations]);

  useEffect(() => {
    if (particlesMeshRef.current) {
      particlesMeshRef.current.visible = showConcentration;
    }
    particleLayersRef.current.forEach((layer) => {
      layer.visible = showConcentration;
    });
  }, [showConcentration]);

  // 当外部动态调整窗口边界宽度时，实时保持地球在可用中间区域的正中心
  useEffect(() => {
    if (!cameraRef.current || !containerRef.current) return;
    const w = containerRef.current.clientWidth;
    const h2 = containerRef.current.clientHeight;
    if (offsetX !== 0) {
      cameraRef.current.setViewOffset(w, h2, offsetX, 0, w, h2);
    } else {
      cameraRef.current.clearViewOffset();
    }
    cameraRef.current.updateProjectionMatrix();
  }, [offsetX]);

  useEffect(() => {
    if (!sceneRef.current) return;
    const sourceLayers = Array.isArray(fieldLayers) && fieldLayers.length
      ? fieldLayers
      : [{ id: 'fieldData', source: 'fieldData', fieldData, colorMode }];
    const drawableLayers = sourceLayers.filter((layer) => layer?.fieldData?.field || (layer?.renderAsPoints && layer?.points?.length));

    const scene = sceneRef.current;
    if (!sphereMeshRef.current) {
      const globeGroup = new THREE.Group();
      globeGroup.rotation.y = -Math.PI / 2;
      scene.add(globeGroup);
      sphereMeshRef.current = globeGroup;

      const overlay = buildGeoOverlay(isLight, fontScale);
      overlay.visible = showGeoAnnotations;
      globeGroup.add(overlay);
      geoOverlayRef.current = overlay;
    }

    const globeGroup = sphereMeshRef.current;
    if (showMars) addMarsMesh(globeGroup);
    else removeMarsMesh(globeGroup);

    if (!drawableLayers.length) {
      removeUnusedParticleEntries(new Set(), globeGroup);
      particleLayersRef.current = [];
      particlesMeshRef.current = null;
      return;
    }

    if (!showConcentration) {
      particleLayerCacheRef.current.forEach((entry) => {
        entry.mesh.visible = false;
      });
      particleLayersRef.current = Array.from(particleLayerCacheRef.current.values()).map((entry) => entry.mesh);
      particlesMeshRef.current = particleLayersRef.current[0] || null;
      return;
    }

    const isLayeredMode = Array.isArray(fieldLayers) && fieldLayers.length > 1;
    const activeKeys = new Set();
    const nextLayers = [];

    drawableLayers.forEach((layerConfig, index) => {
      const key = getParticleLayerKey(layerConfig, index);
      activeKeys.add(key);

      if (layerConfig.renderAsPoints) {
        const layerColorMode = layerConfig.layerColorMode || layerConfig.colorMode || colorMode;
        const radiusOffset = layerConfig.radiusOffset || 0;
        const signature = getPointLayerSignature(layerConfig.points, radiusOffset);
        const cachedEntry = particleLayerCacheRef.current.get(key);
        const samples = cachedEntry?.signature === signature
          ? cachedEntry.samples
          : buildPointParticleSamples(layerConfig.points, {
            radiusOffset,
            seed: getParticleSeed(key),
          });
        const entry = ensureParticleEntry({
          key,
          signature,
          samples,
          globeGroup,
          materialOptions: {
            size: 0.024,
            opacity: isLight ? 0.86 : 0.96,
            blending: isLight ? THREE.NormalBlending : THREE.AdditiveBlending,
          },
        });

        updatePointParticleBuffers({
          samples: entry.samples,
          points: layerConfig.points,
          colorMode: layerColorMode,
          positions: entry.positions,
          colors: entry.colors,
          colorMapper: mapParticleColor,
          tint: '#34d399',
          radiusOffset,
        });
        entry.mesh.geometry.attributes.position.needsUpdate = true;
        entry.mesh.geometry.attributes.color.needsUpdate = true;
        entry.mesh.visible = true;
        nextLayers.push(entry.mesh);
        return;
      }

      const layerFieldData = layerConfig.fieldData;
      const layerColorMode = layerConfig.colorMode || colorMode;
      const radiusOffset = layerConfig.radiusOffset || 0;
      const particleDensity = isLayeredMode ? 55 : 120;
      const signature = getGridLayerSignature(layerFieldData, particleDensity, radiusOffset);
      const cachedEntry = particleLayerCacheRef.current.get(key);
      const samples = cachedEntry?.signature === signature
        ? cachedEntry.samples
        : buildGridParticleSamples(layerFieldData.field, {
          particleDensity,
          radiusOffset,
          seed: getParticleSeed(key),
        });
      const entry = ensureParticleEntry({
        key,
        signature,
        samples,
        globeGroup,
        materialOptions: {
          size: 0.01,
          opacity: isLayeredMode ? (isLight ? 0.58 : 0.78) : (isLight ? 0.7 : 0.9),
          blending: isLight ? THREE.NormalBlending : THREE.AdditiveBlending,
        },
      });

      updateGridParticleBuffers({
        samples: entry.samples,
        fieldData: layerFieldData,
        colorMode: layerColorMode,
        colormap: settings.colormap,
        positions: entry.positions,
        colors: entry.colors,
        colorMapper: mapParticleColor,
        tint: layerConfig.tint || null,
        radiusOffset,
        equatorHighlight: !isLayeredMode,
      });
      entry.mesh.geometry.attributes.position.needsUpdate = true;
      entry.mesh.geometry.attributes.color.needsUpdate = true;
      entry.mesh.visible = true;
      nextLayers.push(entry.mesh);
    });

    removeUnusedParticleEntries(activeKeys, globeGroup);
    particleLayersRef.current = nextLayers;
    particlesMeshRef.current = nextLayers[0] || null;
  }, [fieldData, fieldLayers, colorMode, settings.colormap, showConcentration, showMars, isLight, fontScale, showGeoAnnotations]);


  // 组件完全卸载时，清空 sphereMeshRef / 材质资源
  useEffect(() => {
    return () => {
      if (sphereMeshRef.current && sceneRef.current) {
        sceneRef.current.remove(sphereMeshRef.current);
        disposeObject3D(sphereMeshRef.current);
        sphereMeshRef.current = null;
        particlesMeshRef.current = null;
        particleLayersRef.current = [];
        particleLayerCacheRef.current.clear();
        geoOverlayRef.current = null;
        marsMeshRef.current = null;
        directionalLightRef.current = null;
        pickingMeshRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (sphereMeshRef.current) {
      ensurePickingMesh(sphereMeshRef.current);
    }
  }, [fieldData, fieldLayers, showConcentration, showMars]);

  if (forceFullscreen) {
    return (
      <div
        ref={containerRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
        }}
      />
    );
  }

  // 内嵌状态（如果以后还需要作为内嵌卡片的话）
  return (
    <div
      ref={containerRef}
      className="observation-window"
      style={{
        width: '100%',
        height: h,
        background: isLight ? '#f5f6f8' : 'rgba(0,0,0,0.3)',
        cursor: 'zoom-in',
        overflow: 'hidden',
      }}
    />
  );
});

export default SphericalFieldCanvas;
