import React, { useEffect, useMemo, useLayoutEffect, useCallback, useRef, useState } from 'react';
import C from '../../constants/colors';
import { useDataOverview } from '../../contexts/DataOverviewContext';
import { useSettings } from '../../contexts/SettingsContext';
import SeasonalChart from './OverviewCharts/SeasonalChart';
import CorrelationMatrix from './OverviewCharts/CorrelationMatrix';
import RealtimeMonitor from './OverviewCharts/RealtimeMonitor';
import EnvironmentDashboard from './OverviewCharts/EnvironmentDashboard';
import DataDistribution from './OverviewCharts/DataDistribution';
import CouplingAnalysis from './OverviewCharts/CouplingAnalysis';
import PolarDynamics from './OverviewCharts/PolarDynamics';
import SolarSensitivity from './OverviewCharts/SolarSensitivity';
import WaveExplorer from './OverviewCharts/WaveExplorer';
import SeasonalExtremesChart from './OverviewCharts/SeasonalExtremesChart';
import GlobalTrendLinesChart from './OverviewCharts/GlobalTrendLinesChart';
import { getCardTitle, getModeCardKeys, MODE_DEFS } from './overviewChartLayout';
import OverviewAnalysisPanel from './workbench/OverviewAnalysisPanel.jsx';
import { CARD_STATUS } from './workbench/OverviewAdapter.js';

const NAVBAR_HEIGHT = 70;

export default function DetailPanel({ sliceData, overviewSourceParams = {}, embedded = false }) {
  const { settings } = useSettings();
  const isLight = settings?.theme === 'light';
  const isZh = settings?.language !== 'en';
  const {
    activeAnalysisMode,
    selectedCoordinate,
    resetView,
    marsYear,
    globalTimeLs,
    rightPanelWidth,
    setRightPanelWidth,
    expandedCard,
    setExpandedCard,
  } = useDataOverview();

  const panelBg = isLight ? 'rgba(255,255,255,0.82)' : 'rgba(10,12,18,0.54)';
  const borderSoft = isLight ? 'rgba(15,23,42,0.10)' : 'rgba(255,255,255,0.08)';
  const subtleBg = isLight ? 'rgba(15,23,42,0.08)' : 'rgba(255,255,255,0.08)';
  const subtleBorder = isLight ? 'rgba(15,23,42,0.14)' : 'rgba(255,255,255,0.16)';

  const [isVisible, setIsVisible] = useState(false);
  const [renderedCards, setRenderedCards] = useState(() => new Set());
  const dragFrameRef = useRef(0);

  const handleMouseDown = useCallback((e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = rightPanelWidth;

    const onMouseMove = (moveEvent) => {
      const nextWidth = startWidth - (moveEvent.clientX - startX);
      const clamped = Math.max(400, Math.min(nextWidth, 1240));
      setRightPanelWidth(clamped);

      if (!dragFrameRef.current) {
        dragFrameRef.current = window.requestAnimationFrame(() => {
          window.dispatchEvent(new Event('resize'));
          dragFrameRef.current = 0;
        });
      }
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      window.dispatchEvent(new Event('resize'));
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [rightPanelWidth, setRightPanelWidth]);

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 100);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => () => {
    if (dragFrameRef.current) {
      window.cancelAnimationFrame(dragFrameRef.current);
    }
  }, []);

  useLayoutEffect(() => {
    const rafId = window.requestAnimationFrame(() => {
      window.dispatchEvent(new Event('resize'));
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [rightPanelWidth]);

  const getActiveCards = useCallback(() => {
    if (selectedCoordinate) return ['distribution'];
    return getModeCardKeys(activeAnalysisMode);
  }, [activeAnalysisMode, selectedCoordinate]);

  const activeCards = useMemo(() => getActiveCards(), [getActiveCards]);

  useEffect(() => {
    setExpandedCard((prev) => (activeCards.includes(prev) ? prev : (activeCards[0] || '')));
  }, [activeCards, setExpandedCard]);

  useEffect(() => {
    setRenderedCards((prev) => {
      const next = new Set();
      activeCards.forEach((key) => {
        if (prev.has(key)) next.add(key);
      });
      if (activeCards[0]) next.add(activeCards[0]);
      if (expandedCard && activeCards.includes(expandedCard)) next.add(expandedCard);
      if (next.size === prev.size && Array.from(next).every((key) => prev.has(key))) {
        return prev;
      }
      return next;
    });
  }, [activeCards, expandedCard]);

  useEffect(() => {
    const dispatchResize = () => window.dispatchEvent(new Event('resize'));
    const t1 = setTimeout(dispatchResize, 100);
    const t2 = setTimeout(dispatchResize, 350);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [expandedCard, activeAnalysisMode, selectedCoordinate]);

  const realtimeComponent = useMemo(() => <RealtimeMonitor marsYear={marsYear} lsValue={globalTimeLs} overviewSourceParams={overviewSourceParams} />, [marsYear, globalTimeLs, overviewSourceParams]);
  const seasonalComponent = useMemo(() => <SeasonalChart marsYear={marsYear} overviewSourceParams={overviewSourceParams} />, [marsYear, overviewSourceParams]);
  const seasonalExtremesComponent = useMemo(() => <SeasonalExtremesChart marsYear={marsYear} overviewSourceParams={overviewSourceParams} />, [marsYear, overviewSourceParams]);
  const globalTrendComponent = useMemo(() => <GlobalTrendLinesChart marsYear={marsYear} overviewSourceParams={overviewSourceParams} />, [marsYear, overviewSourceParams]);
  const environmentComponent = useMemo(() => <EnvironmentDashboard marsYear={marsYear} overviewSourceParams={overviewSourceParams} />, [marsYear, overviewSourceParams]);
  const solarsensComponent = useMemo(() => <SolarSensitivity marsYear={marsYear} overviewSourceParams={overviewSourceParams} />, [marsYear, overviewSourceParams]);
  const waveComponent = useMemo(() => <WaveExplorer marsYear={marsYear} overviewSourceParams={overviewSourceParams} />, [marsYear, overviewSourceParams]);
  const polarComponent = useMemo(() => <PolarDynamics marsYear={marsYear} overviewSourceParams={overviewSourceParams} />, [marsYear, overviewSourceParams]);
  const couplingComponent = useMemo(() => <CouplingAnalysis marsYear={marsYear} overviewSourceParams={overviewSourceParams} />, [marsYear, overviewSourceParams]);
  const distributionComponent = useMemo(
    () => (
      <DataDistribution
        marsYear={marsYear}
        lsValue={globalTimeLs}
        sliceData={sliceData}
        coordinate={selectedCoordinate}
        overviewSourceParams={overviewSourceParams}
      />
    ),
    [marsYear, globalTimeLs, sliceData, selectedCoordinate, overviewSourceParams],
  );
  const correlationComponent = useMemo(
    () => <CorrelationMatrix marsYear={marsYear} coordinate={selectedCoordinate} overviewSourceParams={overviewSourceParams} />,
    [marsYear, selectedCoordinate, overviewSourceParams],
  );

  const cardsMap = {
    realtime: { title: getCardTitle('realtime', isZh), component: realtimeComponent, color: C.mars },
    seasonal: { title: getCardTitle('seasonal', isZh), component: seasonalComponent, color: C.blue },
    seasonalExtremes: { title: getCardTitle('seasonalExtremes', isZh), component: seasonalExtremesComponent, color: '#f09c4a' },
    globalTrend: { title: getCardTitle('globalTrend', isZh), component: globalTrendComponent, color: C.green },
    environment: { title: getCardTitle('environment', isZh), component: environmentComponent, color: C.green },
    solarsens: { title: getCardTitle('solarsens', isZh), component: solarsensComponent, color: '#d9a441' },
    wave: { title: getCardTitle('wave', isZh), component: waveComponent, color: '#d2b48c' },
    polar: { title: getCardTitle('polar', isZh), component: polarComponent, color: '#cbeef3' },
    coupling: { title: getCardTitle('coupling', isZh), component: couplingComponent, color: '#ffb347' },
    distribution: { title: getCardTitle('distribution', isZh), component: distributionComponent, color: C.mars },
    correlation: { title: getCardTitle('correlation', isZh), component: correlationComponent, color: C.blue },
  };

  // Mars 卡片沿用原有请求与单位逻辑，只把卡片外壳换成共用组件。
  const panelCards = activeCards.map((key) => {
    const cardDef = cardsMap[key];
    if (!cardDef) return null;
    return {
      key,
      title: { zh: cardDef.title, en: cardDef.title },
      color: cardDef.color,
      state: {
        status: CARD_STATUS.READY,
        reason: null,
        message: null,
        data: null,
        errorCode: null,
        updatedAt: null,
      },
      component: cardDef.component,
      mounted: renderedCards.has(key),
    };
  }).filter(Boolean);

  const currentModeInfo = selectedCoordinate
    ? {
      icon: 'P',
      title: isZh ? '点位聚焦' : 'Point focus',
      color: C.mars,
      desc: isZh
        ? `聚焦 LAT ${selectedCoordinate.lat.toFixed(1)}°、LNG ${selectedCoordinate.lng.toFixed(1)}° 的局地时空特征。`
        : `Focus on local spatiotemporal features at LAT ${selectedCoordinate.lat.toFixed(1)}°, LNG ${selectedCoordinate.lng.toFixed(1)}°.`,
    }
    : (() => {
      const mode = MODE_DEFS.find((item) => item.id === activeAnalysisMode) || MODE_DEFS[0];
      return {
        icon: mode.icon,
        title: isZh ? mode.title.zh : mode.title.en,
        desc: isZh ? mode.desc.zh : mode.desc.en,
        color: mode.color,
      };
    })();

  return (
    <div
      className={embedded ? 'overview-analysis overview-analysis--embedded' : undefined}
      style={embedded ? {
        position: 'relative',
        width: '100%',
        height: '100%',
        minHeight: 0,
        background: 'transparent',
        padding: '24px',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        boxSizing: 'border-box',
      } : {
        position: 'fixed',
        top: `${NAVBAR_HEIGHT}px`,
        right: isVisible ? '0' : `-${rightPanelWidth + 20}px`,
        width: rightPanelWidth,
        height: `calc(100vh - ${NAVBAR_HEIGHT}px)`,
        background: panelBg,
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderLeft: `1px solid ${borderSoft}`,
        zIndex: 1000,
        padding: '24px',
        transition: 'right 0.6s cubic-bezier(0.4, 0, 0.2, 1)',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
      }}
    >
      <OverviewAnalysisPanel
        mode={activeAnalysisMode}
        showModePicker={false}
        cards={panelCards}
        expandedCard={expandedCard}
        onExpandedCardChange={setExpandedCard}
        isZh={isZh}
        isLight={isLight}
        headerOverride={{
          icon: currentModeInfo.icon,
          title: currentModeInfo.title,
          desc: currentModeInfo.desc,
          color: currentModeInfo.color,
        }}
        headerExtra={selectedCoordinate ? (
          <button
            onClick={resetView}
            style={{
              background: subtleBg,
              border: `1px solid ${subtleBorder}`,
              color: C.ice,
              padding: '6px 12px',
              borderRadius: 999,
              cursor: 'pointer',
              fontFamily: 'var(--font-body)',
              fontSize: 'calc(11px * var(--font-scale, 1))',
              fontWeight: 600,
              transition: '0.2s',
            }}
            onMouseEnter={(event) => { event.currentTarget.style.background = isLight ? 'rgba(15,23,42,0.14)' : 'rgba(255,255,255,0.18)'; }}
            onMouseLeave={(event) => { event.currentTarget.style.background = subtleBg; }}
          >
            {isZh ? '返回全局' : 'Back to globe'}
          </button>
        ) : null}
        renderCard={(card) => (card.mounted ? card.component : (
          <div style={{ color: C.ice40, fontSize: 'calc(11px * var(--font-scale, 1))', fontFamily: 'var(--font-body)' }}>
            {isZh ? '展开后加载该分析模块。' : 'Expand to load this analysis module.'}
          </div>
        ))}
      />

      <div
        onMouseDown={handleMouseDown}
        style={{
          display: embedded ? 'none' : undefined,
          position: 'absolute',
          left: -3,
          top: 0,
          bottom: 0,
          width: 6,
          cursor: 'col-resize',
          zIndex: 10,
          background: 'transparent',
        }}
      />
    </div>
  );
}
