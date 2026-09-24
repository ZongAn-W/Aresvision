import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import C from '../constants/colors';
import { useT } from '../i18n';
import { useSettings } from '../contexts/SettingsContext';
import { DataOverviewProvider, useDataOverview } from '../contexts/DataOverviewContext';
import { fetchOverviewGlobeData, fetchOverviewInfo, fetchOverviewOzoneSources, fetchOverviewPointProbe } from '../services/api';
import useHandTracking from '../hooks/useHandTracking';
import { buildOverviewSceneModel } from './DataOverviewPage/overviewSceneModel';
import { buildLocalPointProbe } from './DataOverviewPage/pointProbeModel';
import { filterOzoneOverlayBySourceModes } from './DataOverviewPage/uploadedSourceOptions';

// Sub-components
import TopStatusBar from './DataOverviewPage/TopStatusBar';
import SidebarMenu from './DataOverviewPage/SidebarMenu';
import DetailPanel from './DataOverviewPage/DetailPanel';
import DeepSpaceBackdrop from './DataOverviewPage/DeepSpaceBackdrop';
import Mars3DBackground from './DataOverviewPage/Mars3DBackground';
import TimelineController from './DataOverviewPage/TimelineController';
import AICopilotWidget from './DataOverviewPage/AICopilotWidget'; 
import GlobeLegend from './DataOverviewPage/GlobeLegend';
import PointProbeModal from './DataOverviewPage/PointProbeModal';
import PlanetSceneSwitch from './DataOverviewPage/PlanetSceneSwitch';
import EarthWorkbenchScene from './DataOverviewPage/EarthOverview/EarthWorkbenchScene.jsx';
import OverviewShell from './DataOverviewPage/workbench/OverviewShell.jsx';

const DataOverviewPageContent = ({ sceneSwitch = null }) => {
  const t = useT();
  const { settings } = useSettings();
  const isLight = settings?.theme === 'light';
  const isZh = settings?.language !== 'en';
  const { 
    marsYear, 
    setMarsYear,
    overviewSourceParams,
    ozoneSourceParams,
    ozoneLayerSourceSelection,
    setAvailableMarsYears,
    setSourceMeta,
    setIsSwitchingSource,
    setOverviewTimeline,
    setOverviewOzoneCapabilities,
    globalTimeLs, setGlobalTimeLs, 
    isPlayingTimeline, setIsPlayingTimeline,
    overviewTimeline,
    autoRotate,
    gestureEnabled,
    showConcentration3D,
    showGeoAnnotations,
    showMarsTexture,
    globeVariable,
    ozoneDisplayMode,
    ozoneDiffPair,
    mcdMainSlice,
    setMcdMainSlice,
    ozoneOverlayPayload,
    setOzoneOverlayPayload,
    leftPanelWidth,
    rightPanelWidth
  } = useDataOverview();

  const [loadingGlobe, setLoadingGlobe] = useState(false);
  const [pointProbe, setPointProbe] = useState(null);
  const [pointProbeLoading, setPointProbeLoading] = useState(false);
  const [pointProbeError, setPointProbeError] = useState('');
  const [gestureStatus, setGestureStatus] = useState(null);
  const [gesturePointer, setGesturePointer] = useState(null);

  const timerRef = useRef(null);
  const mainAbortRef = useRef(null);
  const overlayAbortRef = useRef(null);
  const pointProbeAbortRef = useRef(null);
  const globeCanvasRef = useRef(null);
  const landmarksCanvasRef = useRef(null);

  const { setVideoRef, error: gestureError, setOnGesture, setOnLandmarks } = useHandTracking(gestureEnabled);

  // Keep gesture capture window compact to reduce scene occlusion.
  const GESTURE_WINDOW_WIDTH = 138;
  const GESTURE_WINDOW_HEIGHT = 96;

  useEffect(() => {
    setOnLandmarks((landmarks) => {
      const canvas = landmarksCanvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (!landmarks || landmarks.length === 0) return;

      ctx.fillStyle = C.mars;
      ctx.strokeStyle = C.blue;
      ctx.lineWidth = 1.4;

      for (const hand of landmarks) {
        for (const point of hand) {
          ctx.beginPath();
          ctx.arc(point.x * canvas.width, point.y * canvas.height, 2.2, 0, 2 * Math.PI);
          ctx.fill();
        }

        const drawLine = (p1, p2) => {
          ctx.beginPath();
          ctx.moveTo(p1.x * canvas.width, p1.y * canvas.height);
          ctx.lineTo(p2.x * canvas.width, p2.y * canvas.height);
          ctx.stroke();
        };

        if (hand[0] && hand[5]) drawLine(hand[0], hand[5]); 
        if (hand[0] && hand[9]) drawLine(hand[0], hand[9]); 
        if (hand[0] && hand[13]) drawLine(hand[0], hand[13]); 
        if (hand[0] && hand[17]) drawLine(hand[0], hand[17]); 
        if (hand[5] && hand[9]) drawLine(hand[5], hand[9]);
        if (hand[9] && hand[13]) drawLine(hand[9], hand[13]);
        if (hand[13] && hand[17]) drawLine(hand[13], hand[17]);
      }
    });
  }, [setOnLandmarks]);

  const loadMainSlice = useCallback(async (ls, year, variable) => {
    if (mainAbortRef.current) mainAbortRef.current.abort();
    const ctrl = new AbortController();
    mainAbortRef.current = ctrl;
    setLoadingGlobe(true);
    try {
      const d = await fetchOverviewGlobeData(year, ls, variable, ctrl.signal, overviewSourceParams);
      if (!ctrl.signal.aborted) {
        setMcdMainSlice({
          points: d.points || [],
          minVal: d.minVal ?? 0,
          maxVal: d.maxVal ?? 1,
          variable: d.variable || variable || 'o3col',
        });
        setSourceMeta(d?.source_meta || null);
        setLoadingGlobe(false);
      }
    } catch (e) {
      if (!ctrl.signal.aborted) {
        console.error('Globe data error:', e);
        setLoadingGlobe(false);
      }
    }
  }, [overviewSourceParams, setMcdMainSlice, setSourceMeta]);

  const loadOzoneOverlay = useCallback(async (ls, year) => {
    if (overlayAbortRef.current) overlayAbortRef.current.abort();
    if (globeVariable !== 'o3col' || ozoneDisplayMode === 'mcd') {
      setOzoneOverlayPayload(null);
      return;
    }

    const ctrl = new AbortController();
    overlayAbortRef.current = ctrl;
    try {
      const payload = await fetchOverviewOzoneSources(year, ls, ozoneSourceParams);
      if (!ctrl.signal.aborted) {
        setOzoneOverlayPayload(filterOzoneOverlayBySourceModes(payload, ozoneLayerSourceSelection));
      }
    } catch (e) {
      if (!ctrl.signal.aborted) {
        console.error('Ozone overlay data error:', e);
        setOzoneOverlayPayload(null);
      }
    }
  }, [globeVariable, ozoneDisplayMode, ozoneLayerSourceSelection, ozoneSourceParams, setOzoneOverlayPayload]);

  const handleClosePointProbe = useCallback(() => {
    if (pointProbeAbortRef.current) pointProbeAbortRef.current.abort();
    setPointProbe(null);
    setPointProbeLoading(false);
    setPointProbeError('');
  }, []);

  const handleGlobeClick = useCallback((coord) => {
    if (!Number.isFinite(coord?.lat) || !Number.isFinite(coord?.lng)) return;
    if (pointProbeAbortRef.current) pointProbeAbortRef.current.abort();

    const localProbe = buildLocalPointProbe({
      requested: { ...coord, ls: globalTimeLs },
      sliceData: { ...mcdMainSlice, ls: globalTimeLs, variable: globeVariable },
    });
    setPointProbe(localProbe || {
      status: 'local',
      variable: globeVariable,
      requested: { ...coord, ls: globalTimeLs },
      gridPoint: coord,
      current: { ls: globalTimeLs, value: null },
      series: { ls: [], point: [], globalMean: [], latitudeMean: [] },
      comparison: {},
    });
    setPointProbeLoading(true);
    setPointProbeError('');

    const ctrl = new AbortController();
    pointProbeAbortRef.current = ctrl;
    fetchOverviewPointProbe(marsYear, coord.lat, coord.lng, globalTimeLs, globeVariable, {
      ...overviewSourceParams,
      signal: ctrl.signal,
    })
      .then((payload) => {
        if (!ctrl.signal.aborted) {
          setPointProbe({ status: 'ready', ...payload });
        }
      })
      .catch((err) => {
        if (!ctrl.signal.aborted) {
          console.error('Point probe data error:', err);
          setPointProbeError(err?.message || 'Point probe data failed');
        }
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setPointProbeLoading(false);
      });
  }, [globalTimeLs, globeVariable, marsYear, mcdMainSlice, overviewSourceParams]);

  const mapGesturePointerToClientPoint = useCallback((gesture) => {
    const viewportWidth = typeof window === 'undefined' ? 1280 : window.innerWidth;
    const viewportHeight = typeof window === 'undefined' ? 720 : window.innerHeight;
    const left = Math.max(24, Math.min(viewportWidth - 160, leftPanelWidth + 28));
    const right = Math.max(left + 160, viewportWidth - rightPanelWidth - 28);
    const top = 86;
    const bottom = Math.max(top + 160, viewportHeight - 156);
    const x = Math.max(0, Math.min(1, gesture.x ?? 0.5));
    const y = Math.max(0, Math.min(1, gesture.y ?? 0.5));
    return {
      x: left + x * (right - left),
      y: top + y * (bottom - top),
    };
  }, [leftPanelWidth, rightPanelWidth]);

  useEffect(() => {
    if (!gestureEnabled) {
      setGesturePointer(null);
      setGestureStatus(null);
      return;
    }

    setOnGesture((gesture) => {
      if (gesture.type === 'status' && gesture.mode === 'idle') {
        setGesturePointer(null);
        setGestureStatus({
          text: isZh ? '等待手势进入画面' : 'Waiting for a hand gesture',
          accent: C.ice50,
        });
        return;
      }

      if (gesture.type === 'rotate') {
        globeCanvasRef.current?.applyGestureRotation?.(gesture.dx, gesture.dy);
        setGesturePointer(null);
        setGestureStatus({
          text: isZh ? '单手拖拽：旋转火星' : 'One hand: rotating Mars',
          accent: C.mars,
        });
        return;
      }

      if (gesture.type === 'zoom') {
        globeCanvasRef.current?.applyGestureZoom?.(gesture.dDist);
        setGesturePointer(null);
        setGestureStatus({
          text: isZh ? '双手开合：缩放视图' : 'Two hands: zooming view',
          accent: C.blue,
        });
        return;
      }

      if (gesture.type === 'toggleTimeline') {
        if (pointProbe) {
          handleClosePointProbe();
          setGesturePointer(null);
          setGestureStatus({
            text: isZh ? '握拳：关闭点位数据' : 'Fist: closed point probe',
            accent: C.green,
          });
          return;
        }
        setIsPlayingTimeline((value) => !value);
        setGesturePointer(null);
        setGestureStatus({
          text: isZh ? '握拳：切换播放 / 暂停' : 'Fist: toggled play / pause',
          accent: C.green,
        });
        return;
      }

      if (gesture.type === 'pointHover') {
        const clientPoint = mapGesturePointerToClientPoint(gesture);
        const progress = Math.max(0, Math.min(1, gesture.progress ?? 0));
        setGesturePointer({ ...clientPoint, progress });
        setGestureStatus({
          text: isZh
            ? `张掌停留选点 ${Math.round(progress * 100)}%`
            : `Open palm dwell to probe ${Math.round(progress * 100)}%`,
          accent: C.marsLight,
        });
        return;
      }

      if (gesture.type === 'selectPoint') {
        const clientPoint = mapGesturePointerToClientPoint(gesture);
        const coord = globeCanvasRef.current?.pickGlobeAtClientPoint?.(clientPoint.x, clientPoint.y);
        setGesturePointer({ ...clientPoint, progress: 1, selected: Boolean(coord) });
        setGestureStatus({
          text: coord
            ? (isZh ? '已选中火星点位' : 'Mars point selected')
            : (isZh ? '准星未命中球体' : 'Reticle missed the globe'),
          accent: coord ? C.green : C.mars,
        });
        if (coord) handleGlobeClick(coord);
      }
    });
  }, [gestureEnabled, handleClosePointProbe, handleGlobeClick, isZh, mapGesturePointerToClientPoint, pointProbe, setIsPlayingTimeline, setOnGesture]);

  useEffect(() => () => {
    // 卸载时取消所有在途请求并清掉定时器，避免旧回包写入持久的 Mars provider。
    if (mainAbortRef.current) mainAbortRef.current.abort();
    if (overlayAbortRef.current) overlayAbortRef.current.abort();
    if (pointProbeAbortRef.current) pointProbeAbortRef.current.abort();
    clearInterval(timerRef.current);
  }, []);

  useEffect(() => {
    let active = true;
    setIsSwitchingSource(true);
    fetchOverviewInfo(overviewSourceParams)
      .then((info) => {
        if (!active) return;
        const years = Array.isArray(info?.available_years) && info.available_years.length > 0
          ? info.available_years
          : [27, 28];
        setAvailableMarsYears(years);
        setOverviewTimeline(info?.timeline || { min: 0, max: 360, step: 5 });
        setOverviewOzoneCapabilities(info?.ozone_capabilities || { openmars: true, nomad: false, diff_pairs: ['MCD-OpenMARS'] });
        setSourceMeta(info?.source_meta || null);
        setMarsYear((prev) => (years.includes(prev) ? prev : years[0]));
      })
      .catch((err) => {
        console.error('Data source info error:', err);
        if (!active) return;
        setAvailableMarsYears([27, 28]);
      })
      .finally(() => {
        if (!active) return;
        setIsSwitchingSource(false);
      });
    return () => {
      active = false;
    };
  }, [overviewSourceParams, setAvailableMarsYears, setMarsYear, setOverviewOzoneCapabilities, setOverviewTimeline, setSourceMeta, setIsSwitchingSource]);

  useEffect(() => {
    loadMainSlice(globalTimeLs, marsYear, globeVariable);
  }, [globalTimeLs, marsYear, globeVariable, loadMainSlice]);

  useEffect(() => {
    loadOzoneOverlay(globalTimeLs, marsYear);
  }, [globalTimeLs, marsYear, globeVariable, ozoneDisplayMode, loadOzoneOverlay]);

  const sceneModel = useMemo(
    () => buildOverviewSceneModel({
      globeVariable,
      ozoneDisplayMode,
      ozoneDiffPair,
      mainSlice: mcdMainSlice,
      ozoneOverlay: ozoneOverlayPayload,
    }),
    [globeVariable, ozoneDisplayMode, ozoneDiffPair, mcdMainSlice, ozoneOverlayPayload],
  );

  useEffect(() => {
    if (isPlayingTimeline) {
      timerRef.current = setInterval(() => {
        setGlobalTimeLs(v => {
          const min = Number.isFinite(overviewTimeline?.min) ? overviewTimeline.min : 0;
          const max = Number.isFinite(overviewTimeline?.max) ? overviewTimeline.max : 360;
          const step = Number.isFinite(overviewTimeline?.step) ? overviewTimeline.step : 5;
          if (v >= max - step) { setIsPlayingTimeline(false); return min; }
          return Math.min(max, v + step);
        });
      }, 600);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [isPlayingTimeline, overviewTimeline, setGlobalTimeLs, setIsPlayingTimeline]);

  return (
    <OverviewShell
      planet="mars"
      isLight={isLight}
      panelMode="external"
      scene={(
        <div className="space-scene" style={{ width: '100vw', height: '100vh', overflow: 'hidden', position: 'relative' }}>
          <DeepSpaceBackdrop />

          {/* 绝对底层的 3D 背景 */}
          <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 0 }}>
            <Mars3DBackground
              ref={globeCanvasRef}
              ozoneData={sceneModel.layers[0] || mcdMainSlice}
              sceneModel={sceneModel}
              is3DMode={true}
              autoRotate={autoRotate}
              showConcentration3D={showConcentration3D}
              showGeoAnnotations={showGeoAnnotations}
              showMarsTexture={showMarsTexture}
              leftPanelWidth={leftPanelWidth}
              rightPanelWidth={rightPanelWidth}
              solarLongitudeLs={globalTimeLs}
              poseKey="mars"
              onGlobeClick={handleGlobeClick}
            />
          </div>
        </div>
      )}
      overlay={(
        <>

      {gestureEnabled && (
        <div className="gesture-capture-hud" title={gestureError || gestureStatus?.text || t('overview.controls.cameraTracking')} style={{
          position: 'fixed',
          top: '82px',
          left: `${leftPanelWidth + 18}px`,
          width: `${GESTURE_WINDOW_WIDTH}px`,
          height: `${GESTURE_WINDOW_HEIGHT}px`,
          zIndex: 1450,
          borderRadius: '12px',
          overflow: 'hidden',
          border: `1px solid ${gestureError ? C.mars : C.borderStrong}`,
          boxShadow: isLight ? '0 10px 22px rgba(15,23,42,0.10)' : '0 12px 28px rgba(0,0,0,0.24)',
          background: isLight ? 'rgba(255,255,255,0.72)' : 'rgba(8,12,18,0.50)',
          backdropFilter: 'blur(10px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          pointerEvents: 'none',
          opacity: gestureError ? 0.96 : 0.76,
          transition: 'opacity 0.2s ease, transform 0.2s ease',
        }}>
          {!gestureError && (
            <>
              <div style={{ position: 'absolute', width: '100%', height: '100%', opacity: 0.42 }}>
                <video
                  ref={setVideoRef}
                  style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }}
                  playsInline
                  muted
                />
              </div>
              <canvas
                ref={landmarksCanvasRef}
                width={GESTURE_WINDOW_WIDTH}
                height={GESTURE_WINDOW_HEIGHT}
                style={{ position: 'absolute', width: '100%', height: '100%', zIndex: 2, transform: 'scaleX(-1)' }}
              />
            </>
          )}
          <div style={{
            position: 'absolute',
            left: 7,
            right: 7,
            bottom: 6,
            background: isLight ? 'rgba(255,255,255,0.82)' : 'rgba(12,18,28,0.64)',
            padding: '3px 6px',
            borderRadius: '999px',
            color: gestureStatus?.accent || C.ice,
            fontSize: 'calc(8px * var(--font-scale, 1))',
            fontWeight: 700,
            fontFamily: 'var(--font-body)',
            lineHeight: 1,
            zIndex: 3,
            border: `1px solid ${C.border}`,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            {gestureError ? t('overview.controls.gestureErrorTitle') : (gestureStatus?.text || t('overview.controls.cameraTracking'))}
          </div>
          {gestureError && (
            <div style={{
              position: 'absolute',
              inset: 0,
              zIndex: 4,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '24px 8px 8px',
              textAlign: 'center',
              color: isLight ? '#7f1d1d' : '#fecaca',
              fontSize: 'calc(8px * var(--font-scale, 1))',
              lineHeight: 1.35,
              background: isLight ? 'rgba(255,245,245,0.86)' : 'rgba(46,10,12,0.68)',
              overflow: 'hidden',
            }}>
              {gestureError}
            </div>
          )}
        </div>
      )}

      {gestureEnabled && gesturePointer && !gestureError && (
        <div
          aria-hidden="true"
          style={{
            position: 'fixed',
            left: gesturePointer.x,
            top: gesturePointer.y,
            width: 46,
            height: 46,
            transform: 'translate(-50%, -50%)',
            zIndex: 1900,
            pointerEvents: 'none',
            borderRadius: '50%',
            background: `conic-gradient(${gesturePointer.selected ? C.green : C.marsLight} ${Math.round((gesturePointer.progress || 0) * 360)}deg, rgba(255,255,255,0.14) 0deg)`,
            boxShadow: gesturePointer.selected
              ? '0 0 28px rgba(52,211,153,0.42)'
              : '0 0 24px rgba(255,143,104,0.28)',
            display: 'grid',
            placeItems: 'center',
          }}
        >
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              background: isLight ? 'rgba(255,255,255,0.86)' : 'rgba(8,12,18,0.82)',
              border: `1px solid ${gesturePointer.selected ? C.green : C.marsLight}`,
              boxShadow: 'inset 0 0 12px rgba(0,0,0,0.24)',
            }}
          />
          <div
            style={{
              position: 'absolute',
              width: 2,
              height: 58,
              background: gesturePointer.selected ? C.green : C.marsLight,
              opacity: 0.55,
            }}
          />
          <div
            style={{
              position: 'absolute',
              width: 58,
              height: 2,
              background: gesturePointer.selected ? C.green : C.marsLight,
              opacity: 0.55,
            }}
          />
        </div>
      )}

      {/* HUD UI 层：仅保留状态栏、AI 与图例；控件栏/分析栏/时间轴由共用工作台外壳承载 */}
      <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 100, pointerEvents: 'none' }}>

        <div style={{ pointerEvents: 'auto' }}>
          <TopStatusBar />
        </div>

        <div style={{ pointerEvents: 'auto' }}>
          <AICopilotWidget />
        </div>

        <div style={{ pointerEvents: 'auto' }}>
          <GlobeLegend ozoneData={sceneModel.layers[0] || mcdMainSlice} sceneModel={sceneModel} />
        </div>
      </div>
        </>
      )}
      sidebar={<SidebarMenu sceneSwitch={sceneSwitch} />}
      analysis={<DetailPanel sliceData={mcdMainSlice} overviewSourceParams={overviewSourceParams} />}
      timeline={<TimelineController />}
      notification={(
        <PointProbeModal
          probe={pointProbe}
          loading={pointProbeLoading}
          error={pointProbeError}
          onClose={handleClosePointProbe}
        />
      )}
    />
  );
};

/**
 * 总览场景选择：默认火星，保留原有 Mars 实现文件与 provider。
 *
 * Mars 与 Earth 互斥挂载（不做 hidden 双挂载），切换前统一暂停 Mars 播放，
 * Earth 的基础选择保存在本层，返回时按当前 descriptor fingerprint 重新校验加载。
 */
function OverviewSceneContent() {
  const [planet, setPlanet] = useState('mars');
  const [earthSelection, setEarthSelection] = useState({ date: null, variable: 'TO3', point: null });
  const { setIsPlayingTimeline } = useDataOverview();

  const switchPlanet = useCallback((next) => {
    if (next === planet) return;
    // 切换前暂停 Mars 播放；Mars content 卸载时会 abort 在途请求并取消 timer。
    setIsPlayingTimeline(false);
    setPlanet(next);
  }, [planet, setIsPlayingTimeline]);

  const sceneSwitch = <PlanetSceneSwitch value={planet} onChange={switchPlanet} />;

  return planet === 'earth'
    ? (
      <EarthWorkbenchScene
        selection={earthSelection}
        onSelectionChange={setEarthSelection}
        sceneSwitch={sceneSwitch}
      />
    )
    : <DataOverviewPageContent sceneSwitch={sceneSwitch} />;}

export default function DataOverviewPage() {
  return (
    <DataOverviewProvider>
      <OverviewSceneContent />
    </DataOverviewProvider>
  );
}
