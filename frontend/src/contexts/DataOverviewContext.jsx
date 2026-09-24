import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import {
  buildOzoneCapabilitiesForSourceModes,
  buildOzoneLayerSourceSelection,
} from '../pages/DataOverviewPage/uploadedSourceOptions';

const DataOverviewContext = createContext();

const EMPTY_UPLOAD_OPTIONS = { mcd: [], openmars: [], nomad: [] };
const DEFAULT_OZONE_CAPABILITIES = {
  openmars: true,
  nomad: false,
  diff_pairs: ['MCD-OpenMARS'],
  coverage: {},
};

export const useDataOverview = () => {
  const context = useContext(DataOverviewContext);
  if (!context) {
    throw new Error('useDataOverview must be used within a DataOverviewProvider');
  }
  return context;
};

export const DataOverviewProvider = ({ children }) => {
  const [activeAnalysisMode, setActiveAnalysisMode] = useState('temporal');
  const [selectedCoordinate, setSelectedCoordinate] = useState(null);
  const [marsYear, setMarsYear] = useState(27);
  const [availableMarsYears, setAvailableMarsYears] = useState([27, 28]);
  const [selectedMcdUploadId, setSelectedMcdUploadId] = useState(null);
  const [overviewUploadOptions, setOverviewUploadOptions] = useState(EMPTY_UPLOAD_OPTIONS);
  const [openMarsSourceMode, setOpenMarsSourceMode] = useState('official');
  const [nomadSourceMode, setNomadSourceMode] = useState('official');
  const [isSwitchingSource, setIsSwitchingSource] = useState(false);
  const [sourceMeta, setSourceMeta] = useState(null);
  const [overviewTimeline, setOverviewTimeline] = useState({ min: 0, max: 360, step: 5 });
  const [officialOverviewOzoneCapabilities, setOverviewOzoneCapabilities] = useState(DEFAULT_OZONE_CAPABILITIES);
  const [globalTimeLs, setGlobalTimeLs] = useState(0);
  const [isPlayingTimeline, setIsPlayingTimeline] = useState(false);
  const [autoRotate, setAutoRotate] = useState(true);
  const [gestureEnabled, setGestureEnabled] = useState(false);
  const [showConcentration3D, setShowConcentration3D] = useState(true);
  const [showGeoAnnotations, setShowGeoAnnotations] = useState(true);
  const [showMarsTexture, setShowMarsTexture] = useState(true);
  const [globeVariable, setGlobeVariable] = useState('o3col');
  const [ozoneDisplayMode, setOzoneDisplayMode] = useState('mcd');
  const [ozoneDiffPair, setOzoneDiffPair] = useState('MCD-OpenMARS');
  const [mcdMainSlice, setMcdMainSlice] = useState({ points: [], minVal: 0, maxVal: 1, variable: 'o3col' });
  const [ozoneOverlayPayload, setOzoneOverlayPayload] = useState(null);
  const [timeRange, setTimeRange] = useState({ start: 0, end: 360 });
  const [selectedVariables, setSelectedVariables] = useState(['o3col', 'temperature', 'pressure']);
  const [leftPanelWidth, setLeftPanelWidth] = useState(300);
  const [rightPanelWidth, setRightPanelWidth] = useState(540);
  const [expandedCard, setExpandedCard] = useState('');
  const aiInsightProvidersRef = useRef(new Map());

  const registerAiInsightProvider = useCallback((cardKey, provider) => {
    if (!cardKey || typeof provider !== 'function') return;
    aiInsightProvidersRef.current.set(cardKey, provider);
  }, []);

  const unregisterAiInsightProvider = useCallback((cardKey, provider) => {
    if (!cardKey) return;
    const current = aiInsightProvidersRef.current.get(cardKey);
    if (!provider || current === provider) {
      aiInsightProvidersRef.current.delete(cardKey);
    }
  }, []);

  const getAiInsight = useCallback((cardKey) => {
    if (!cardKey) return null;
    const provider = aiInsightProvidersRef.current.get(cardKey);
    if (typeof provider !== 'function') return null;
    try {
      return provider() ?? null;
    } catch (error) {
      console.warn('Failed to collect AI insight snapshot:', cardKey, error);
      return null;
    }
  }, []);

  const overviewSourceParams = useMemo(() => ({
    mcdUploadId: selectedMcdUploadId,
  }), [selectedMcdUploadId]);

  const ozoneLayerSourceSelection = useMemo(() => buildOzoneLayerSourceSelection({
    mcdUploadId: selectedMcdUploadId,
    uploads: overviewUploadOptions,
    marsYear,
    ls: globalTimeLs,
    openMarsSourceMode,
    nomadSourceMode,
  }), [globalTimeLs, marsYear, nomadSourceMode, openMarsSourceMode, overviewUploadOptions, selectedMcdUploadId]);

  const ozoneSourceParams = ozoneLayerSourceSelection.params;

  const overviewOzoneCapabilities = useMemo(() => buildOzoneCapabilitiesForSourceModes({
    officialCapabilities: officialOverviewOzoneCapabilities,
    uploads: overviewUploadOptions,
    openMarsSourceMode,
    nomadSourceMode,
  }), [nomadSourceMode, officialOverviewOzoneCapabilities, openMarsSourceMode, overviewUploadOptions]);

  const contextValue = {
    expandedCard,
    setExpandedCard,
    activeAnalysisMode,
    setActiveAnalysisMode,
    selectedCoordinate,
    setSelectedCoordinate,
    marsYear,
    setMarsYear,
    availableMarsYears,
    setAvailableMarsYears,
    selectedMcdUploadId,
    setSelectedMcdUploadId,
    overviewUploadOptions,
    setOverviewUploadOptions,
    openMarsSourceMode,
    setOpenMarsSourceMode,
    nomadSourceMode,
    setNomadSourceMode,
    overviewSourceParams,
    ozoneSourceParams,
    ozoneLayerSourceSelection,
    isSwitchingSource,
    setIsSwitchingSource,
    sourceMeta,
    setSourceMeta,
    overviewTimeline,
    setOverviewTimeline,
    overviewOzoneCapabilities,
    setOverviewOzoneCapabilities,
    globalTimeLs,
    setGlobalTimeLs,
    isPlayingTimeline,
    setIsPlayingTimeline,
    autoRotate,
    setAutoRotate,
    gestureEnabled,
    setGestureEnabled,
    showConcentration3D,
    setShowConcentration3D,
    showGeoAnnotations,
    setShowGeoAnnotations,
    showMarsTexture,
    setShowMarsTexture,
    globeVariable,
    setGlobeVariable,
    ozoneDisplayMode,
    setOzoneDisplayMode,
    ozoneDiffPair,
    setOzoneDiffPair,
    mcdMainSlice,
    setMcdMainSlice,
    ozoneOverlayPayload,
    setOzoneOverlayPayload,
    timeRange,
    setTimeRange,
    selectedVariables,
    setSelectedVariables,
    leftPanelWidth,
    setLeftPanelWidth,
    rightPanelWidth,
    setRightPanelWidth,
    registerAiInsightProvider,
    unregisterAiInsightProvider,
    getAiInsight,
    getSeasonName: (ls) => {
      if (ls >= 0 && ls < 90) return 'Northern Spring';
      if (ls >= 90 && ls < 180) return 'Northern Summer';
      if (ls >= 180 && ls < 270) return 'Northern Fall';
      return 'Northern Winter';
    },
    resetSelection: () => {
      setSelectedCoordinate(null);
      setTimeRange({ start: 0, end: 360 });
    },
    resetView: () => {
      setSelectedCoordinate(null);
      setActiveAnalysisMode('global');
    },
  };

  return (
    <DataOverviewContext.Provider value={contextValue}>
      {children}
    </DataOverviewContext.Provider>
  );
};

export default DataOverviewProvider;
