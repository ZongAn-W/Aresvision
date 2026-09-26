import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import C from '../constants/colors';
import { useT } from '../i18n';
import { useSettings } from '../contexts/SettingsContext';
import { DataOverviewProvider, useDataOverview } from '../contexts/DataOverviewContext';
import { fetchOverviewGlobeData, fetchOverviewInfo, fetchOverviewOzoneSources, fetchOverviewPointProbe } from '../services/api';
import useHandTracking from '../hooks/useHandTracking';
import { buildOverviewSceneModel } from './DataOverviewPage/overviewSceneModel';
import { buildLocalPointProbe } from './DataOverviewPage/pointProbeModel';
import { formatTimelineLs } from './DataOverviewPage/timelineFormatting.js';
import { lsBounds } from './DataOverviewPage/workbench/marsObservationRail.js';
import { makeColorSpec } from '../utils/colormaps.js';
import { filterOzoneOverlayBySourceModes } from './DataOverviewPage/uploadedSourceOptions';

// Sub-components
import TopStatusBar from './DataOverviewPage/TopStatusBar';
import Mars3DBackground from './DataOverviewPage/Mars3DBackground';
import MarsObservationRail, { useMarsGlobalSeries } from './DataOverviewPage/workbench/MarsObservationRail.jsx';
import AICopilotWidget from './DataOverviewPage/AICopilotWidget';
import GlobeLegend from './DataOverviewPage/GlobeLegend';
import PointProbeContent from './DataOverviewPage/PointProbeContent.jsx';
import PlanetSceneSwitch from './DataOverviewPage/PlanetSceneSwitch';
import EarthWorkbenchScene from './DataOverviewPage/EarthOverview/EarthWorkbenchScene.jsx';
import OverviewShell from './DataOverviewPage/workbench/OverviewShell.jsx';
import ObservatoryTools from './DataOverviewPage/workbench/ObservatoryTools.jsx';
import { AnalysisEntryButton } from './DataOverviewPage/workbench/ObservatoryToolbar.jsx';
import AnalysisDock from './DataOverviewPage/workbench/AnalysisDock.jsx';
import { MarsAnalysisConditions, MarsObservatoryToolbar, useMarsObservatoryPanels } from './DataOverviewPage/ObservatoryMars.jsx';
import { MarsAnalysisProvider } from './DataOverviewPage/workbench/MarsAnalysisSettings.jsx';
import { createMarsOverviewAdapter } from './DataOverviewPage/workbench/marsOverviewAdapter.js';
import { MODE_DEFS } from './DataOverviewPage/overviewChartLayout.js';
import SeasonalChart from './DataOverviewPage/OverviewCharts/SeasonalChart';
import CorrelationMatrix from './DataOverviewPage/OverviewCharts/CorrelationMatrix';
import RealtimeMonitor from './DataOverviewPage/OverviewCharts/RealtimeMonitor';
import EnvironmentDashboard from './DataOverviewPage/OverviewCharts/EnvironmentDashboard';
import DataDistribution from './DataOverviewPage/OverviewCharts/DataDistribution';
import CouplingAnalysis from './DataOverviewPage/OverviewCharts/CouplingAnalysis';
import PolarDynamics from './DataOverviewPage/OverviewCharts/PolarDynamics';
import SolarSensitivity from './DataOverviewPage/OverviewCharts/SolarSensitivity';
import WaveExplorer from './DataOverviewPage/OverviewCharts/WaveExplorer';
import SeasonalExtremesChart from './DataOverviewPage/OverviewCharts/SeasonalExtremesChart';
import GlobalTrendLinesChart from './DataOverviewPage/OverviewCharts/GlobalTrendLinesChart';
import MarsAnalysisBoard from './DataOverviewPage/OverviewCharts/MarsAnalysisBoard.jsx';
import { getCardTitle } from './DataOverviewPage/overviewChartLayout';
import { CARD_STATUS } from './DataOverviewPage/workbench/OverviewAdapter.js';
import { pickActiveCard, buildObservatoryGroups } from './DataOverviewPage/workbench/observatoryLayout.js';

const MARS_CARD_COLORS = {
  realtime: C.mars,
  seasonal: C.blue,
  seasonalExtremes: '#f09c4a',
  globalTrend: C.green,
  environment: C.green,
  solarsens: '#d9a441',
  wave: '#d2b48c',
  polar: '#cbeef3',
  coupling: '#ffb347',
  distribution: C.mars,
  correlation: C.blue,
};

/** 只有「一张有真实序列的折线图」适合缩进 120px 的紧凑预览位。 */
const MARS_COMPACT_PREVIEW_KEYS = new Set(['globalTrend']);

const DataOverviewPageContent = ({
  sceneSwitch = null,
  observatoryView = 'observe',
  onObservatoryViewChange = null,
  openPanel = null,
  onOpenPanelChange = null,
  selectedCard = '',
  onSelectedCardChange = null,
}) => {
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
    setSelectedCoordinate,
    ozoneDisplayMode,
    ozoneDiffPair,
    mcdMainSlice,
    setMcdMainSlice,
    ozoneOverlayPayload,
    setOzoneOverlayPayload,
  } = useDataOverview();

  const [loadingGlobe, setLoadingGlobe] = useState(false);
  const [pointProbe, setPointProbe] = useState(null);
  const [pointProbeLoading, setPointProbeLoading] = useState(false);
  const [pointProbeError, setPointProbeError] = useState('');
  const globalRailState = useMarsGlobalSeries(observatoryView === 'observe');
  const [gestureStatus, setGestureStatus] = useState(null);
  const [gesturePointer, setGesturePointer] = useState(null);

  const timerRef = useRef(null);
  const mainAbortRef = useRef(null);
  const overlayAbortRef = useRef(null);
  const pointProbeAbortRef = useRef(null);
  const globeCanvasRef = useRef(null);
  const landmarksCanvasRef = useRef(null);
  // 观测台画布的真实矩形：手势选点、HUD 与图例都以它为唯一依据。
  const sceneContainerRef = useRef(null);

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
    setSelectedCoordinate(null);
  }, [setSelectedCoordinate]);

  // A probe belongs to one year, variable and MCD source. Cancel it when that identity changes.
  useEffect(() => {
    handleClosePointProbe();
  }, [marsYear, globeVariable, overviewSourceParams, handleClosePointProbe]);

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
    setSelectedCoordinate(coord);
    // 点选暂停播放，结果直接显示在观测页右侧，保留球体和左侧全局曲线。
    setIsPlayingTimeline(false);

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
  }, [
    globalTimeLs, globeVariable, marsYear, mcdMainSlice,
    overviewSourceParams, setIsPlayingTimeline, setSelectedCoordinate,
  ]);

  /**
   * 手势坐标 → 客户端坐标。
   *
   * 唯一依据是观测台画布的真实矩形（`sceneContainerRef`），不再按窗口宽度减去
   * 左右栏宽推算：模式切换、抽屉开合与窗口缩放都不会让准星偏移。
   */
  const mapGesturePointerToClientPoint = useCallback((gesture) => {
    const rect = sceneContainerRef.current?.getBoundingClientRect();
    const viewportWidth = typeof window === 'undefined' ? 1280 : window.innerWidth;
    const viewportHeight = typeof window === 'undefined' ? 720 : window.innerHeight;
    const box = rect && rect.width > 0 && rect.height > 0
      ? rect
      : {
        left: 0,
        top: 0,
        width: viewportWidth,
        height: Math.max(240, viewportHeight - 200),
      };
    const padX = Math.min(24, box.width * 0.06);
    const padY = Math.min(24, box.height * 0.06);
    const left = box.left + padX;
    const right = box.left + box.width - padX;
    const top = box.top + padY;
    const bottom = box.top + box.height - padY;
    const x = Math.max(0, Math.min(1, gesture.x ?? 0.5));
    const y = Math.max(0, Math.min(1, gesture.y ?? 0.5));
    return {
      x: left + x * Math.max(0, right - left),
      y: top + y * Math.max(0, bottom - top),
    };
  }, []);

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
    if (observatoryView === 'observe') loadMainSlice(globalTimeLs, marsYear, globeVariable);
  }, [observatoryView, globalTimeLs, marsYear, globeVariable, loadMainSlice]);

  useEffect(() => {
    const { min, max } = lsBounds(overviewTimeline);
    setGlobalTimeLs(value => Math.max(min, Math.min(max, value)));
  }, [overviewTimeline, setGlobalTimeLs]);

  useEffect(() => {
    if (observatoryView === 'observe') loadOzoneOverlay(globalTimeLs, marsYear);
  }, [observatoryView, globalTimeLs, marsYear, globeVariable, ozoneDisplayMode, loadOzoneOverlay]);

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

  // 观测轨填充色：色带与球体一致，颜色由本轨数值范围铺满（不需要球体色标范围）。
  const marsRailColor = useMemo(() => makeColorSpec({
    variable: globeVariable,
    colormap: sceneModel?.colorMode,
  }), [globeVariable, sceneModel]);

  useEffect(() => {
    if (isPlayingTimeline && observatoryView === 'observe') {
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
  }, [isPlayingTimeline, observatoryView, overviewTimeline, setGlobalTimeLs, setIsPlayingTimeline]);

  // ── 分析目录：卡片由 Mars adapter 声明，正文沿用原有图表组件 ──────────
  const marsAdapter = useMemo(() => createMarsOverviewAdapter({ marsYear }), [marsYear]);

  const cardsByMode = useMemo(() => {
    const model = marsAdapter.describe?.();
    const catalog = model?.cards || {};
    return ['temporal', 'drivers', 'dynamics'].reduce((accumulator, modeId) => {
      accumulator[modeId] = (catalog[modeId] || []).map((card) => ({
        ...card,
        state: {
          status: CARD_STATUS.READY,
          reason: null,
          message: null,
          data: null,
          errorCode: null,
          updatedAt: null,
        },
      }));
      return accumulator;
    }, {});
  }, [marsAdapter]);

  const [activeMode, setActiveMode] = useState('temporal');
  const [analysisPresentation, setAnalysisPresentation] = useState('board');
  const modeCards = cardsByMode[activeMode] || [];

  // 观测台两档共用同一个主图身份；切组或目录变化后回落到合法项。
  useEffect(() => {
    const next = pickActiveCard(modeCards, selectedCard);
    if (next !== selectedCard) onSelectedCardChange?.(next ?? '');
  }, [modeCards, onSelectedCardChange, selectedCard]);

  // Mars 卡片组件：沿用原有请求、单位与图表实现，只换承载容器。
  const cardComponents = useMemo(() => ({
    realtime: <RealtimeMonitor marsYear={marsYear} lsValue={globalTimeLs} overviewSourceParams={overviewSourceParams} />,
    seasonal: <SeasonalChart marsYear={marsYear} overviewSourceParams={overviewSourceParams} />,
    seasonalExtremes: <SeasonalExtremesChart marsYear={marsYear} overviewSourceParams={overviewSourceParams} />,
    environment: <EnvironmentDashboard marsYear={marsYear} overviewSourceParams={overviewSourceParams} />,
    solarsens: <SolarSensitivity marsYear={marsYear} overviewSourceParams={overviewSourceParams} />,
    wave: <WaveExplorer marsYear={marsYear} overviewSourceParams={overviewSourceParams} />,
    polar: <PolarDynamics marsYear={marsYear} overviewSourceParams={overviewSourceParams} />,
    coupling: <CouplingAnalysis marsYear={marsYear} overviewSourceParams={overviewSourceParams} />,
    distribution: (
      <DataDistribution
        marsYear={marsYear}
        lsValue={globalTimeLs}
        sliceData={mcdMainSlice}
        coordinate={null}
        overviewSourceParams={overviewSourceParams}
      />
    ),
    correlation: (
      <CorrelationMatrix
        marsYear={marsYear}
        coordinate={null}
        overviewSourceParams={overviewSourceParams}
      />
    ),
  }), [globalTimeLs, marsYear, mcdMainSlice, overviewSourceParams]);

  const renderMarsCard = useCallback((card, { compact = false, height: heightOverride = null } = {}) => {
    if (compact && !MARS_COMPACT_PREVIEW_KEYS.has(card.key)) {
      return (
        <div style={{
          display: 'grid',
          alignContent: 'center',
          justifyItems: 'center',
          gap: 4,
          height: '100%',
          color: C.ice50,
          fontSize: 'calc(11px * var(--font-scale, 1))',
          textAlign: 'center',
          padding: '0 12px',
        }}
        >
          <span>{isZh
            ? '该分析需要较大画布（表格或多子图），展开分析后查看。'
            : 'This analysis needs a larger canvas (table or multiple subplots); open the dock to view it.'}</span>
        </div>
      );
    }
    // 年内全球变化：同一份序列既用于紧凑预览，也用于主图，只是尺寸与图例不同。
    // 分析档主图用分析区算出的确定高度，观测档紧凑预览用像素基准。
    if (card.key === 'globalTrend') {
      return (
        <GlobalTrendLinesChart
          marsYear={marsYear}
          overviewSourceParams={overviewSourceParams}
          compact={compact}
          height={compact ? 84 : (heightOverride ?? '100%')}
        />
      );
    }
    const component = cardComponents[card.key] || null;
    if (!component) {
      return (
        <p style={{ margin: 0, color: C.ice45, fontSize: 'calc(11px * var(--font-scale, 1))' }}>
          {isZh ? '该分析尚未接入。' : 'This analysis is not connected yet.'}
        </p>
      );
    }
    // 多图按内容排版，统一由 dock-body 滚动，避免结果藏在图内滚动框里。
    return (
      <div className="mars-analysis-chart">
        {component}
      </div>
    );
  }, [cardComponents, isZh, marsYear, overviewSourceParams]);

  const groups = useMemo(() => buildObservatoryGroups(MODE_DEFS), []);

  const { panels } = useMarsObservatoryPanels();
  const dockContext = {
    loadingLabel: loadingGlobe
      ? (isZh ? '正在加载当前时间的数据场…' : 'Loading the field for the current time…')
      : null,
  };

  const pointSlot = pointProbe ? (
    <div
      style={{
        display: 'grid',
        gap: 8,
        padding: '10px 0 4px',
        borderTop: `1px solid ${C.border}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <span style={{ color: C.ice, fontFamily: 'var(--font-display)', fontSize: 'calc(12px * var(--font-scale, 1))', fontWeight: 700 }}>
          {isZh ? '点位结果' : 'Point result'}
        </span>
        <button
          type="button"
          onClick={handleClosePointProbe}
          style={{
            padding: '4px 12px',
            borderRadius: 999,
            border: `1px solid ${C.border}`,
            background: 'transparent',
            color: C.ice,
            cursor: 'pointer',
            fontSize: 'calc(11px * var(--font-scale, 1))',
          }}
        >
          {isZh ? '关闭点位' : 'Close point'}
        </button>
      </div>
      <PointProbeContent
        probe={pointProbe}
        loading={pointProbeLoading}
        error={pointProbeError}
        onClose={handleClosePointProbe}
        dialog={false}
      />
    </div>
  ) : null;

  const setMarsMode = useCallback((modeId) => {
    setActiveMode(modeId);
    onSelectedCardChange?.('');
  }, [onSelectedCardChange]);

  // 观测档只保留与观测直接相关的入口：星球、数据源、变量、时间、显示与视角。
  // 「图层」（多源 / 验证 / 差值 / 分析分组）与「点位」属于分析任务，切到分析档后才出现。
  const allToolDefinitions = useMemo(() => ([
    { key: 'layers', label: t('observatory.tools.layers'), title: t('observatory.tools.layersTitle'), hint: t('observatory.tools.layersHint') },
    { key: 'point', label: t('observatory.tools.point'), title: t('observatory.tools.pointTitle'), hint: t('observatory.tools.pointHint') },
    { key: 'display', label: t('observatory.tools.display'), title: t('observatory.tools.displayTitle'), hint: t('observatory.tools.displayHint') },
  ]), [t]);

  const toolDefinitions = useMemo(
    () => (observatoryView === 'observe'
      ? allToolDefinitions
      : []),
    [allToolDefinitions, observatoryView],
  );

  // 分析档不保留球体工具面板；数据源入口两档共用。
  useEffect(() => {
    if (observatoryView === 'analyze' && openPanel && openPanel !== 'source') {
      onOpenPanelChange?.(null);
    }
  }, [observatoryView, openPanel, onOpenPanelChange]);

  const toolsContent = {
    source: panels.source,
    layers: panels.layers,
    point: panels.point,
    display: panels.display,
  };

  return (
    <OverviewShell
      planet="mars"
      isLight={isLight}
      view={observatoryView}
      onViewChange={onObservatoryViewChange}
      openPanel={openPanel}
      onOpenPanelChange={onOpenPanelChange}
      toolbar={(
        <MarsObservatoryToolbar
          sceneSwitch={sceneSwitch}
          openPanel={openPanel}
          onOpenPanelChange={onOpenPanelChange}
          view={observatoryView}
          onViewChange={onObservatoryViewChange}
          isZh={isZh}
          toolsSlot={(
            <ObservatoryTools
              tools={toolDefinitions}
              openPanel={openPanel}
              onOpenPanelChange={onOpenPanelChange}
              content={toolsContent}
              closeLabel={t('observatory.tools.close')}
              sourceTitle={t('observatory.dataSource.title')}
            />
          )}
          statusItems={[
            observatoryView === 'observe'
              ? { label: isZh ? '太阳黄经' : 'Solar longitude', value: `Ls ${formatTimelineLs(globalTimeLs)}°`, color: C.mars }
              : null,
            observatoryView === 'observe' ? { label: 'MY', value: String(marsYear) } : null,
            observatoryView === 'observe'
              ? { label: t('observatory.scene.source'), value: sourceLabelForToolbar(ozoneDisplayMode, isZh) }
              : null,
          ]}
        />
      )}
      scene={observatoryView === 'observe' ? (
        <div
          ref={sceneContainerRef}
          className="space-scene"
          data-scene-container="mars"
          style={{ width: '100%', height: '100%', overflow: 'hidden', position: 'relative' }}
        >
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
              solarLongitudeLs={globalTimeLs}
              poseKey="mars"
              onGlobeClick={handleGlobeClick}
            />
          </div>
        </div>
      ) : null}
      overlay={observatoryView === 'observe' ? (
        <>
          {gestureEnabled && (
            <div className="gesture-capture-hud" title={gestureError || gestureStatus?.text || t('overview.controls.cameraTracking')} style={{
              position: 'absolute',
              top: '12px',
              left: '12px',
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
                position: 'absolute',
                left: gesturePointerLocalX(sceneContainerRef, gesturePointer.x),
                top: gesturePointerLocalY(sceneContainerRef, gesturePointer.y),
                width: 46,
                height: 46,
                transform: 'translate(-50%, -50%)',
                zIndex: 1460,
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

          {/* 场景状态与图例：只在画布内绝对定位，不再按窗口减栏宽 */}
          <div className="overview-mars-hud">
            <TopStatusBar embedded />
            <GlobeLegend ozoneData={sceneModel.layers[0] || mcdMainSlice} sceneModel={sceneModel} embedded />
          </div>
        </>
      ) : null}
      rail={observatoryView === 'observe' ? (
        <MarsObservationRail
          globalState={globalRailState}
          fieldLoading={loadingGlobe}
          probe={pointProbe}
          colorMode={marsRailColor.mode}
          actions={(
            <AnalysisEntryButton
              label={t('observatory.view.expand')}
              onClick={() => onObservatoryViewChange?.('analyze')}
            />
          )}
        />
      ) : null}
      railEnd={observatoryView === 'observe' ? (
        <MarsObservationRail side="point" globalState={globalRailState} probe={pointProbe}
          pointLoading={pointProbeLoading} pointError={pointProbeError} onClear={handleClosePointProbe}
          colorMode={marsRailColor.mode}
          onRetryPoint={() => handleGlobeClick(pointProbe?.requested)} />
      ) : null}
      analysis={(
        <AnalysisDock
          planet="mars"
          view={observatoryView}
          groups={groups}
          mode={activeMode}
          onModeChange={setMarsMode}
          cards={modeCards}
          activeCard={selectedCard}
          onCardChange={onSelectedCardChange}
          onExpand={() => onObservatoryViewChange?.('analyze')}
          onCollapse={() => onObservatoryViewChange?.('observe')}
          renderCard={renderMarsCard}
          isZh={isZh}
          isLight={isLight}
          conditionsSlot={<MarsAnalysisConditions cardKey={selectedCard} />}
          presentation={analysisPresentation}
          onPresentationChange={setAnalysisPresentation}
          boardConditionsSlot={<MarsAnalysisConditions cardKey={`board-${activeMode}`} />}
          boardSlot={<MarsAnalysisBoard mode={activeMode} marsYear={marsYear} overviewSourceParams={overviewSourceParams} />}
          loadingLabel={observatoryView === 'observe' ? dockContext.loadingLabel : null}
          pointSlot={observatoryView === 'analyze' ? pointSlot : null}
          aiSlot={observatoryView === 'analyze'
            ? <AICopilotWidget embedded cardKey={selectedCard || null} />
            : null}
        />
      )}
      notification={null}
    />
  );
};

function sourceLabelForToolbar(ozoneDisplayMode, isZh) {
  if (ozoneDisplayMode === 'mcd') return 'MCD';
  if (ozoneDisplayMode === 'multi-source') return isZh ? '多源' : 'Multi-source';
  if (ozoneDisplayMode === 'validation') return isZh ? '验证' : 'Validation';
  if (ozoneDisplayMode === 'diff') return isZh ? '差值' : 'Difference';
  return 'MCD';
}

/** 手势坐标（客户端 px）→ 画布内局部 px；准星在画布内绝对定位，仍与实际拾取点一致。 */
function gesturePointerLocalX(ref, clientX) {
  const rect = ref?.current?.getBoundingClientRect?.();
  return rect ? clientX - rect.left : clientX;
}

function gesturePointerLocalY(ref, clientY) {
  const rect = ref?.current?.getBoundingClientRect?.();
  return rect ? clientY - rect.top : clientY;
}

/**
 * 总览场景选择：默认地球，保留原有 Mars 实现文件与 provider。
 *
 * Mars 与 Earth 互斥挂载（不做 hidden 双挂载），切换前统一暂停 Mars 播放，
 * Earth 的基础选择保存在本层，返回时按当前 descriptor fingerprint 重新校验加载。
 * 观测台两档（observe / analyze）与设置面板状态也保存在这一层：切换星球时
 * 保留档位，回到观测模式并关闭临时面板。
 */
function OverviewSceneContent() {
  const [planet, setPlanet] = useState('earth');
  const [earthSelection, setEarthSelection] = useState({ date: null, variable: 'TO3', point: null });
  const [observatoryView, setObservatoryView] = useState('observe');
  const [openPanel, setOpenPanel] = useState(null);
  const [marsCard, setMarsCard] = useState('');
  const [earthCard, setEarthCard] = useState('');
  const { setIsPlayingTimeline } = useDataOverview();

  const switchObservatoryView = useCallback((next) => {
    if (next !== 'observe' && next !== 'analyze') return;
    if (next === 'analyze') setIsPlayingTimeline(false);
    setOpenPanel(null);
    setObservatoryView(next);
  }, [setIsPlayingTimeline]);

  const switchPlanet = useCallback((next) => {
    if (next === planet) return;
    // 切换前暂停 Mars 播放；Mars content 卸载时会 abort 在途请求并取消 timer。
    setIsPlayingTimeline(false);
    // 星球切换保留两档状态，但关闭临时面板，避免把一个星球的面板留在另一个星球上。
    setOpenPanel(null);
    setPlanet(next);
  }, [planet, setIsPlayingTimeline]);

  const sceneSwitch = <PlanetSceneSwitch value={planet} onChange={switchPlanet} variant="toolbar" />;

  if (planet === 'earth') {
    return (
      <EarthWorkbenchScene
        selection={earthSelection}
        onSelectionChange={setEarthSelection}
        sceneSwitch={sceneSwitch}
        observatoryView={observatoryView}
        onObservatoryViewChange={switchObservatoryView}
        openPanel={openPanel}
        onOpenPanelChange={setOpenPanel}
        selectedCard={earthCard}
        onSelectedCardChange={setEarthCard}
      />
    );
  }

  return (
    <DataOverviewPageContent
      sceneSwitch={sceneSwitch}
      observatoryView={observatoryView}
      onObservatoryViewChange={switchObservatoryView}
      openPanel={openPanel}
      onOpenPanelChange={setOpenPanel}
      selectedCard={marsCard}
      onSelectedCardChange={setMarsCard}
    />
  );
}

export default function DataOverviewPage() {
  return (
    <DataOverviewProvider>
      <MarsAnalysisProvider>
        <OverviewSceneContent />
      </MarsAnalysisProvider>
    </DataOverviewProvider>
  );
}
