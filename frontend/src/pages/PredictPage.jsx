import { useState, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
  clearPredictCache,
  getPredictCache,
  getEmptyPredictCache,
  getPredictionResultCacheForContext,
  resolvePredictCacheScope,
  setPredictCache,
  setPredictUiPreferences,
} from '../stores/predictCache';
import C from '../constants/colors';
import { useT } from '../i18n';
import { useSettings } from '../contexts/SettingsContext';
import { useAuth } from '../contexts/AuthContext';
import SectionTitle from '../components/SectionTitle';

import {
  runPrediction,
  fetchPredictMetrics,
  fetchErrorDistribution,
  fetchPermutationImportance,
  fetchDataInfo,
  fetchTasks,
  compareTrainingModelErrorDistributions,
  compareTrainingModelPfi,
  compareTrainingModels,
} from '../services/api';

import { VARIABLE_DEFS, VIEW_MODE_IDS, TRIPTYCH_PANEL_DEFS } from './PredictPage/PredictComponents';
import PredictSidebar from './PredictPage/PredictSidebar';
import PredictDisplay from './PredictPage/PredictDisplay';
import PredictMetrics from './PredictPage/PredictMetrics';
import PredictFullscreenHUD from './PredictPage/PredictFullscreenHUD';
import ErrorDistributionChart from './PredictPage/ErrorDistributionChart';
import PermutationImportanceChart from './PredictPage/PermutationImportanceChart';
import { getPredictAnalysisVisibility } from './PredictPage/predictAnalysisVisibility';
import {
  TRAINING_TASK_HANDOFF_KEY,
  getCompletedTrainingModelOptions,
  parseTrainingTaskHandoff,
} from './PredictPage/trainedModelSelection';
import {
  buildPerformanceMetricsFromEval,
} from './PredictPage/trainedModelAnalysisData';
import {
  buildErrorDistributionKey,
  buildPermutationImportanceKey,
  buildPredictionContextKey,
  buildPredictMetricsKey,
  buildTrainingModelCompareKey,
} from './PredictPage/predictAnalysisCacheKeys';
import {
  PREDICT_REQUEST_CHANNELS,
  createPredictRequestCoordinator,
  isAbortError,
} from './PredictPage/predictRequestCoordinator';
import {
  PREDICT_MODEL_MODE_COMPARE,
  PREDICT_MODEL_MODE_TRAINED,
  normalizePredictModelMode,
} from './PredictPage/predictModelModes';
import CompareTrainingModelsPanel from './PredictPage/CompareTrainingModels/CompareTrainingModelsPanel';
import { getCompareSelectionState } from './PredictPage/CompareTrainingModels/compareTrainingModelsData';
import {
  clampPredictionHorizon,
  resolvePredictionHorizonLimit,
} from './PredictPage/predictionHorizon';
import { validatePredictCacheTrainingTasks } from './PredictPage/predictCacheTaskValidation';

export default function PredictPage() {
  const t = useT();
  const { settings } = useSettings();
  const { user, isLoading } = useAuth();
  const precision = settings.precision;
  const ozoneUnit = settings.units.ozone;
  const isLight = settings.theme === 'light';

  const VARIABLES = VARIABLE_DEFS.map((v) => ({ ...v, label: t(`predict.variables.${v.id}`) }));
  const VIEW_MODES = VIEW_MODE_IDS.map((id) => ({ id, label: t(`predict.viewModes.${id}`) }));
  const TRIPTYCH_PANELS = TRIPTYCH_PANEL_DEFS.map((p) => ({ ...p, title: t(`predict.panels.${p.key}`) }));

  const plotTextColor = isLight ? 'rgba(23,33,47,0.96)' : 'rgba(236,244,255,0.96)';
  const plotText60 = isLight ? 'rgba(23,33,47,0.76)' : 'rgba(214,228,244,0.78)';
  const plotGridColor = isLight ? 'rgba(23,33,47,0.12)' : 'rgba(160,196,240,0.16)';

  const predictScope = resolvePredictCacheScope({ user, isLoading });
  const emptyCache = getEmptyPredictCache(predictScope);
  const requestCoordinatorRef = useRef(null);
  if (!requestCoordinatorRef.current) {
    requestCoordinatorRef.current = createPredictRequestCoordinator();
  }
  const requestCoordinator = requestCoordinatorRef.current;
  const predictScopeRef = useRef(null);
  const cacheReadyScopeRef = useRef(null);
  const restoredScopeRef = useRef(null);
  const [cacheReadyScope, setCacheReadyScope] = useState(null);
  const pendingTrainingTaskHandoffRef = useRef(null);
  const writePredictCache = useCallback((updates) => {
    const scope = predictScopeRef.current;
    if (!scope || cacheReadyScopeRef.current !== scope) return false;
    return setPredictCache(scope, updates);
  }, []);

  const [selectedVars, setSelectedVars] = useState(() => VARIABLE_DEFS.map((v) => v.id));
  const [predStep, setPredStep] = useState(3);
  const [lsStart, setLsStart] = useState(90);
  const [marsYear, setMarsYear] = useState(27);
  const dataSourceMode = 'default';
  const [modelMode, setModelMode] = useState(() => normalizePredictModelMode());
  const [trainingTasks, setTrainingTasks] = useState([]);
  const [trainingTasksScope, setTrainingTasksScope] = useState(null);
  const [trainingTasksLoading, setTrainingTasksLoading] = useState(false);
  const [trainingTasksLoaded, setTrainingTasksLoaded] = useState(false);
  const [selectedTrainingTaskId, setSelectedTrainingTaskId] = useState(null);
  const [selectedCompareTrainingTaskIds, setSelectedCompareTrainingTaskIds] = useState([]);
  const [availableMarsYears, setAvailableMarsYears] = useState([27, 28]);
  const [activeHorizon, setActiveHorizon] = useState(0);
  const [viewMode, setViewMode] = useState(emptyCache.viewMode);

  const [loading, setLoading] = useState(false);
  const [isSwitchingSource, setIsSwitchingSource] = useState(false);
  const [resultContextKey, setResultContextKey] = useState(null);
  const [results, setResults] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [errorDistData, setErrorDistData] = useState(null);
  const [pfiData, setPfiData] = useState(null);
  const [metricsKey, setMetricsKey] = useState(null);
  const [errorDistKey, setErrorDistKey] = useState(null);
  const [pfiKey, setPfiKey] = useState(null);
  const [compareTrainingMetricsData, setCompareTrainingMetricsData] = useState(null);
  const [compareTrainingMetricsKey, setCompareTrainingMetricsKey] = useState(null);
  const [compareTrainingErrorData, setCompareTrainingErrorData] = useState(null);
  const [compareTrainingErrorKey, setCompareTrainingErrorKey] = useState(null);
  const [compareTrainingPfiData, setCompareTrainingPfiData] = useState(null);
  const [compareTrainingPfiKey, setCompareTrainingPfiKey] = useState(null);
  const [compareTrainingLoading, setCompareTrainingLoading] = useState(false);
  const [compareTrainingErrorLoading, setCompareTrainingErrorLoading] = useState(false);
  const [compareTrainingPfiLoading, setCompareTrainingPfiLoading] = useState(false);
  const [error, setError] = useState(null);

  const [fullscreen3D, setFullscreen3D] = useState(null);

  const [performanceData, setPerformanceData] = useState(null);
  const [performanceKey, setPerformanceKey] = useState(null);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [errorDistLoading, setErrorDistLoading] = useState(false);
  const [pfiLoading, setPfiLoading] = useState(false);

  const [compareConfigs, setCompareConfigs] = useState([]);
  const [selectedCompareIds, setSelectedCompareIds] = useState([]);

  const analysisVisibility = useMemo(
    () => getPredictAnalysisVisibility(modelMode),
    [modelMode]
  );
  const trainingModelOptions = useMemo(
    () => getCompletedTrainingModelOptions(
      trainingTasksScope === predictScope ? trainingTasks : []
    ),
    [predictScope, trainingTasks, trainingTasksScope]
  );
  const selectedTrainingOption = useMemo(
    () => trainingModelOptions.find((option) => option.id === Number(selectedTrainingTaskId)) || null,
    [selectedTrainingTaskId, trainingModelOptions]
  );
  const compareSelection = useMemo(
    () => getCompareSelectionState(selectedCompareTrainingTaskIds),
    [selectedCompareTrainingTaskIds]
  );
  const compareSelectionIdKey = compareSelection.ids.join(',');
  const selectedCompareTrainingTasks = useMemo(() => {
    const selectedIds = new Set(compareSelection.ids);
    return trainingModelOptions
      .filter((option) => selectedIds.has(option.id))
      .map((option) => option.task);
  }, [compareSelectionIdKey, trainingModelOptions]);
  const predictionHorizonLimit = useMemo(
    () => resolvePredictionHorizonLimit({
      modelMode,
      selectedTask: selectedTrainingOption?.task,
      selectedTasks: selectedCompareTrainingTasks,
    }),
    [modelMode, selectedCompareTrainingTasks, selectedTrainingOption]
  );
  const currentPredictionContext = useMemo(() => ({
    modelMode,
    trainingTaskId: modelMode === PREDICT_MODEL_MODE_TRAINED
      ? Number(selectedTrainingTaskId) || null
      : null,
    horizon: predStep,
    selectedVars,
    marsYear,
    lsStart,
  }), [lsStart, marsYear, modelMode, predStep, selectedTrainingTaskId, selectedVars]);
  const currentPredictionContextKey = useMemo(
    () => buildPredictionContextKey(currentPredictionContext),
    [currentPredictionContext]
  );
  const currentPageRequestContextKey = `${currentPredictionContextKey}|compare:${compareSelectionIdKey}`;
  const previousRequestContextKeyRef = useRef(currentPageRequestContextKey);
  const currentCompareTrainingMetricsKey = useMemo(
    () => buildTrainingModelCompareKey({
      taskIds: compareSelection.ids,
      horizon: predStep,
      compareType: 'metrics',
    }),
    [compareSelectionIdKey, predStep]
  );
  const activeCompareTrainingData = currentCompareTrainingMetricsKey === compareTrainingMetricsKey
    ? compareTrainingMetricsData
    : null;
  const currentCompareTrainingErrorKey = useMemo(
    () => buildTrainingModelCompareKey({
      taskIds: compareSelection.ids,
      horizon: predStep,
      compareType: 'error-distribution',
    }),
    [compareSelectionIdKey, predStep]
  );
  const activeCompareTrainingErrorData = currentCompareTrainingErrorKey === compareTrainingErrorKey
    ? compareTrainingErrorData
    : null;
  const currentCompareTrainingPfiKey = useMemo(
    () => buildTrainingModelCompareKey({
      taskIds: compareSelection.ids,
      horizon: predStep,
      compareType: 'pfi',
    }),
    [compareSelectionIdKey, predStep]
  );
  const currentPerformanceContextKey = useMemo(() => {
    const selectedConfigIds = [...selectedCompareIds].map(String).sort().join(',');
    return `${currentPredictionContextKey}|performance:${selectedConfigIds}`;
  }, [currentPredictionContextKey, selectedCompareIds]);
  const currentRequestContextKeysRef = useRef({});
  currentRequestContextKeysRef.current = {
    [PREDICT_REQUEST_CHANNELS.single]: currentPredictionContextKey,
    [PREDICT_REQUEST_CHANNELS.compareMetrics]: currentCompareTrainingMetricsKey,
    [PREDICT_REQUEST_CHANNELS.compareErrorDistribution]: currentCompareTrainingErrorKey,
    [PREDICT_REQUEST_CHANNELS.comparePfi]: currentCompareTrainingPfiKey,
    [PREDICT_REQUEST_CHANNELS.performance]: currentPerformanceContextKey,
  };
  const isRequestCurrent = (requestToken, requestContextKey) => (
    requestToken.scope === predictScopeRef.current
    &&
    currentRequestContextKeysRef.current[requestToken.channel] === requestContextKey
    && requestCoordinator.isCurrent(requestToken, requestContextKey)
  );
  const isRequestLatest = (requestToken, requestContextKey) => (
    requestToken.scope === predictScopeRef.current
    &&
    currentRequestContextKeysRef.current[requestToken.channel] === requestContextKey
    && requestCoordinator.isLatest(requestToken, requestContextKey)
  );
  const activeCompareTrainingPfiData = currentCompareTrainingPfiKey === compareTrainingPfiKey
    ? compareTrainingPfiData
    : null;
  const hasCurrentSingleResult = modelMode !== PREDICT_MODEL_MODE_COMPARE
    && resultContextKey === currentPredictionContextKey;
  const activeResults = hasCurrentSingleResult ? results : null;
  const activeMetrics = hasCurrentSingleResult ? metrics : null;
  const activeErrorDistData = hasCurrentSingleResult ? errorDistData : null;
  const activePfiData = hasCurrentSingleResult ? pfiData : null;
  const activeError = previousRequestContextKeyRef.current === currentPageRequestContextKey
    ? error
    : null;
  const requestContextLocked = loading
    || metricsLoading
    || errorDistLoading
    || pfiLoading
    || compareTrainingLoading
    || compareTrainingErrorLoading
    || compareTrainingPfiLoading;

  const toggleVar = (id) => {
    setSelectedVars((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  useEffect(() => {
    if (!predictScope) return;
    const handoff = parseTrainingTaskHandoff(
      sessionStorage.getItem(TRAINING_TASK_HANDOFF_KEY),
      predictScope
    );
    sessionStorage.removeItem(TRAINING_TASK_HANDOFF_KEY);
    pendingTrainingTaskHandoffRef.current = handoff;
  }, [predictScope]);

  useLayoutEffect(() => {
    if (predictScopeRef.current === predictScope) return;

    const previousScope = predictScopeRef.current;
    requestCoordinator.invalidateAll();
    if (previousScope?.startsWith('user:')) clearPredictCache(previousScope);
    predictScopeRef.current = predictScope;
    cacheReadyScopeRef.current = null;
    restoredScopeRef.current = null;
    setCacheReadyScope(null);
    previousRequestContextKeyRef.current = null;

    setSelectedVars(VARIABLE_DEFS.map((variable) => variable.id));
    setPredStep(3);
    setLsStart(90);
    setMarsYear(27);
    setModelMode(normalizePredictModelMode());
    setSelectedTrainingTaskId(null);
    setSelectedCompareTrainingTaskIds([]);
    setTrainingTasks([]);
    setTrainingTasksScope(null);
    setTrainingTasksLoading(false);
    setTrainingTasksLoaded(false);
    setIsSwitchingSource(false);
    setCompareConfigs([]);
    setSelectedCompareIds([]);

    setLoading(false);
    setMetricsLoading(false);
    setErrorDistLoading(false);
    setPfiLoading(false);
    setCompareTrainingLoading(false);
    setCompareTrainingErrorLoading(false);
    setCompareTrainingPfiLoading(false);
    setError(null);

    setResultContextKey(null);
    setResults(null);
    setMetrics(null);
    setErrorDistData(null);
    setPfiData(null);
    setPerformanceData(null);
    setPerformanceKey(null);
    setMetricsKey(null);
    setErrorDistKey(null);
    setPfiKey(null);
    setActiveHorizon(0);
    setCompareTrainingMetricsData(null);
    setCompareTrainingMetricsKey(null);
    setCompareTrainingErrorData(null);
    setCompareTrainingErrorKey(null);
    setCompareTrainingPfiData(null);
    setCompareTrainingPfiKey(null);
    setFullscreen3D(null);

    if (!predictScope) return;
  }, [predictScope, requestCoordinator]);

  useEffect(() => {
    if (isLoading) return undefined;

    if (!user) {
      setTrainingTasks([]);
      setTrainingTasksScope(null);
      setTrainingTasksLoading(false);
      setTrainingTasksLoaded(false);
      setSelectedTrainingTaskId(null);
      setSelectedCompareTrainingTaskIds([]);
      return undefined;
    }

    let active = true;
    setTrainingTasksLoading(true);
    setTrainingTasksLoaded(false);
    setTrainingTasksScope(null);

    fetchTasks()
      .then((items) => {
        if (!active) return;
        setTrainingTasks(Array.isArray(items) ? items : []);
        setTrainingTasksScope(predictScope);
      })
      .catch(() => {
        if (!active) return;
        setTrainingTasks([]);
        setTrainingTasksScope(predictScope);
      })
      .finally(() => {
        if (!active) return;
        setTrainingTasksLoading(false);
        setTrainingTasksLoaded(true);
      });

    return () => {
      active = false;
    };
  }, [isLoading, predictScope, user?.id]);

  useEffect(() => {
    if (!predictScope || predictScopeRef.current !== predictScope) return;
    const authenticatedScope = predictScope.startsWith('user:');
    if (authenticatedScope && (
      trainingTasksScope !== predictScope
      || trainingTasksLoading
      || !trainingTasksLoaded
    )) return;
    if (restoredScopeRef.current === predictScope) return;

    const accessibleTaskIds = trainingModelOptions.map((option) => option.id);
    const validatedCache = validatePredictCacheTrainingTasks(
      getPredictCache(predictScope),
      accessibleTaskIds
    );

    const cachedParams = validatedCache.params || {};
    const restoredSelectedVars = Array.isArray(cachedParams.selectedVars)
      ? cachedParams.selectedVars
      : VARIABLE_DEFS.map((variable) => variable.id);
    const restoredPredStep = cachedParams.predStep ?? 3;
    const restoredLsStart = cachedParams.lsStart ?? 90;
    const restoredMarsYear = cachedParams.marsYear ?? 27;
    const restoredModelMode = normalizePredictModelMode(cachedParams.modelMode);
    let restoredTrainingTaskId = cachedParams.trainingTaskId ?? null;

    const handoff = pendingTrainingTaskHandoffRef.current;
    if (authenticatedScope && handoff && accessibleTaskIds.includes(Number(handoff.taskId))) {
      restoredTrainingTaskId = Number(handoff.taskId);
      pendingTrainingTaskHandoffRef.current = null;
    } else if (!authenticatedScope || handoff) {
      pendingTrainingTaskHandoffRef.current = null;
    }

    const effectiveRestoredModelMode = handoff
      ? PREDICT_MODEL_MODE_TRAINED
      : restoredModelMode;
    const restoredContext = {
      modelMode: effectiveRestoredModelMode,
      trainingTaskId: effectiveRestoredModelMode === PREDICT_MODEL_MODE_TRAINED
        ? restoredTrainingTaskId
        : null,
      horizon: restoredPredStep,
      selectedVars: restoredSelectedVars,
      marsYear: restoredMarsYear,
      lsStart: restoredLsStart,
    };
    const restoredContextKey = buildPredictionContextKey(restoredContext);
    const restoredPerformanceKey = `${restoredContextKey}|performance:${[
      ...(validatedCache.selectedCompareIds || []),
    ].map(String).sort().join(',')}`;
    const restoredResult = getPredictionResultCacheForContext(
      validatedCache,
      predictScope,
      restoredContextKey,
      {
        metricsKey: buildPredictMetricsKey(restoredContext),
        errorDistKey: buildErrorDistributionKey(restoredContext),
        pfiKey: buildPermutationImportanceKey(restoredContext),
        performanceKey: restoredPerformanceKey,
      }
    );

    const restoredCompareIds = getCompareSelectionState(
      validatedCache.selectedCompareTrainingTaskIds
    ).ids;
    const restoredCompareMetricsKey = buildTrainingModelCompareKey({
      taskIds: restoredCompareIds,
      horizon: restoredPredStep,
      compareType: 'metrics',
    });
    const restoredCompareErrorKey = buildTrainingModelCompareKey({
      taskIds: restoredCompareIds,
      horizon: restoredPredStep,
      compareType: 'error-distribution',
    });
    const restoredComparePfiKey = buildTrainingModelCompareKey({
      taskIds: restoredCompareIds,
      horizon: restoredPredStep,
      compareType: 'pfi',
    });
    const compareMetricsMatch = Boolean(restoredCompareMetricsKey)
      && validatedCache.compareTrainingMetricsKey === restoredCompareMetricsKey;
    const compareErrorMatch = Boolean(restoredCompareErrorKey)
      && validatedCache.compareTrainingErrorKey === restoredCompareErrorKey;
    const comparePfiMatch = Boolean(restoredComparePfiKey)
      && validatedCache.compareTrainingPfiKey === restoredComparePfiKey;
    const restoredCache = {
      ...validatedCache,
      ...restoredResult,
      compareTrainingMetricsData: compareMetricsMatch
        ? validatedCache.compareTrainingMetricsData
        : null,
      compareTrainingMetricsKey: compareMetricsMatch ? restoredCompareMetricsKey : null,
      compareTrainingErrorData: compareErrorMatch
        ? validatedCache.compareTrainingErrorData
        : null,
      compareTrainingErrorKey: compareErrorMatch ? restoredCompareErrorKey : null,
      compareTrainingPfiData: comparePfiMatch ? validatedCache.compareTrainingPfiData : null,
      compareTrainingPfiKey: comparePfiMatch ? restoredComparePfiKey : null,
    };
    setPredictCache(predictScope, restoredCache);

    setSelectedVars(restoredSelectedVars);
    setPredStep(restoredPredStep);
    setLsStart(restoredLsStart);
    setMarsYear(restoredMarsYear);
    setModelMode(effectiveRestoredModelMode);
    setSelectedTrainingTaskId(restoredTrainingTaskId);
    setSelectedCompareTrainingTaskIds(restoredCache.selectedCompareTrainingTaskIds || []);
    setCompareConfigs(restoredCache.compareConfigs || []);
    setSelectedCompareIds(restoredCache.selectedCompareIds || []);

    setResultContextKey(restoredResult.resultContextKey);
    setResults(restoredResult.results);
    setMetrics(restoredResult.metrics);
    setErrorDistData(restoredResult.errorDistData);
    setPfiData(restoredResult.pfiData);
    setPerformanceData(restoredResult.performanceData);
    setPerformanceKey(restoredResult.performanceKey);
    setMetricsKey(restoredResult.metricsKey);
    setErrorDistKey(restoredResult.errorDistKey);
    setPfiKey(restoredResult.pfiKey);
    setActiveHorizon(restoredResult.activeHorizon);
    setCompareTrainingMetricsData(restoredCache.compareTrainingMetricsData);
    setCompareTrainingMetricsKey(restoredCache.compareTrainingMetricsKey);
    setCompareTrainingErrorData(restoredCache.compareTrainingErrorData);
    setCompareTrainingErrorKey(restoredCache.compareTrainingErrorKey);
    setCompareTrainingPfiData(restoredCache.compareTrainingPfiData);
    setCompareTrainingPfiKey(restoredCache.compareTrainingPfiKey);

    const restoredCompareIdKey = restoredCompareIds.join(',');
    previousRequestContextKeyRef.current = `${restoredContextKey}|compare:${restoredCompareIdKey}`;
    restoredScopeRef.current = predictScope;
    setCacheReadyScope(predictScope);
  }, [
    predictScope,
    trainingModelOptions,
    trainingTasksLoaded,
    trainingTasksLoading,
    trainingTasksScope,
  ]);

  useLayoutEffect(() => {
    cacheReadyScopeRef.current = cacheReadyScope === predictScope ? predictScope : null;
  }, [cacheReadyScope, predictScope]);

  useEffect(() => {
    if (modelMode !== PREDICT_MODEL_MODE_TRAINED || trainingTasksLoading || !trainingTasksLoaded) return;
    if (trainingModelOptions.length === 0) {
      setSelectedTrainingTaskId(null);
      return;
    }
    if (!selectedTrainingOption) {
      setSelectedTrainingTaskId(trainingModelOptions[0].id);
    }
  }, [modelMode, selectedTrainingOption, trainingModelOptions, trainingTasksLoaded, trainingTasksLoading]);

  useEffect(() => {
    if (predictionHorizonLimit == null) return;
    setPredStep((current) => clampPredictionHorizon(current, predictionHorizonLimit));
  }, [predictionHorizonLimit]);

  useLayoutEffect(() => {
    if (cacheReadyScopeRef.current !== predictScope) return;
    if (previousRequestContextKeyRef.current === currentPageRequestContextKey) return;
    previousRequestContextKeyRef.current = currentPageRequestContextKey;
    requestCoordinator.invalidateAll();

    setLoading(false);
    setMetricsLoading(false);
    setErrorDistLoading(false);
    setPfiLoading(false);
    setCompareTrainingLoading(false);
    setCompareTrainingErrorLoading(false);
    setCompareTrainingPfiLoading(false);
    setError(null);

    setResultContextKey(null);
    setResults(null);
    setMetrics(null);
    setErrorDistData(null);
    setPfiData(null);
    setPerformanceData(null);
    setPerformanceKey(null);
    setMetricsKey(null);
    setErrorDistKey(null);
    setPfiKey(null);
    setActiveHorizon(0);
    setCompareTrainingMetricsData(null);
    setCompareTrainingMetricsKey(null);
    setCompareTrainingErrorData(null);
    setCompareTrainingErrorKey(null);
    setCompareTrainingPfiData(null);
    setCompareTrainingPfiKey(null);

    writePredictCache({
      resultContextKey: null,
      results: null,
      metrics: null,
      errorDistData: null,
      pfiData: null,
      performanceData: null,
      performanceKey: null,
      metricsKey: null,
      errorDistKey: null,
      pfiKey: null,
      activeHorizon: 0,
      compareTrainingMetricsData: null,
      compareTrainingMetricsKey: null,
      compareTrainingErrorData: null,
      compareTrainingErrorKey: null,
      compareTrainingPfiData: null,
      compareTrainingPfiKey: null,
      selectedCompareTrainingTaskIds: compareSelection.ids,
      params: {
        selectedVars,
        predStep,
        lsStart,
        marsYear,
        dataSource: dataSourceMode,
        modelMode,
        trainingTaskId: currentPredictionContext.trainingTaskId,
        compareTrainingTaskIds: compareSelection.ids,
      },
    });
  }, [
    compareSelection.ids,
    currentPageRequestContextKey,
    currentPredictionContext.trainingTaskId,
    dataSourceMode,
    lsStart,
    marsYear,
    modelMode,
    predStep,
    requestCoordinator,
    selectedVars,
    predictScope,
    writePredictCache,
  ]);

  useLayoutEffect(() => () => {
    requestCoordinator.invalidateAll();
  }, [requestCoordinator]);

  useEffect(() => {
    let active = true;
    setIsSwitchingSource(true);

    fetchDataInfo({ dataSource: 'default' })
      .then((info) => {
        if (!active) return;
        const years = Array.isArray(info?.available_years) && info.available_years.length > 0
          ? info.available_years
          : [27, 28];
        setAvailableMarsYears(years);
        setMarsYear((prev) => (years.includes(prev) ? prev : years[0]));
      })
      .catch(() => {
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
  }, [user?.id]);

  const handlePredict = useCallback(async () => {
    if (isSwitchingSource) return;
    if (predictionHorizonLimit == null || predStep < 1 || predStep > predictionHorizonLimit) {
      setError(settings?.language !== 'en'
        ? '当前模型没有有效的输出窗口配置。'
        : 'The selected model does not have a valid output horizon.');
      return;
    }
    if (modelMode === PREDICT_MODEL_MODE_COMPARE) {
      const compareTaskIds = compareSelection.ids;
      if (!compareSelection.canCompare) {
        setError(settings?.language !== 'en' ? '至少选择 2 个已完成训练模型。' : 'Select at least 2 completed trained models.');
        return;
      }
      const nextCompareKey = currentCompareTrainingMetricsKey;
      if (!nextCompareKey) {
        setError(settings?.language !== 'en' ? '至少选择 2 个已完成训练模型。' : 'Select at least 2 completed trained models.');
        return;
      }
      setError(null);
      if (nextCompareKey === compareTrainingMetricsKey && compareTrainingMetricsData) {
        return;
      }
      const requestContextKey = nextCompareKey;
      const requestToken = {
        ...requestCoordinator.start(
        PREDICT_REQUEST_CHANNELS.compareMetrics,
        requestContextKey
        ),
        scope: predictScopeRef.current,
      };
      setCompareTrainingLoading(true);
      try {
        const compareResult = await compareTrainingModels(compareTaskIds, {
          horizon: predStep,
          signal: requestToken.signal,
        });
        if (!isRequestCurrent(requestToken, requestContextKey)) return;
        setCompareTrainingMetricsData(compareResult);
        setCompareTrainingMetricsKey(nextCompareKey);
        writePredictCache({
          compareTrainingMetricsData: compareResult,
          compareTrainingMetricsKey: nextCompareKey,
          selectedCompareTrainingTaskIds: compareTaskIds,
          params: {
            selectedVars,
            predStep,
            lsStart,
            marsYear,
            dataSource: dataSourceMode,
            modelMode,
            compareTrainingTaskIds: compareTaskIds,
          },
        });
      } catch (e) {
        if (!isRequestLatest(requestToken, requestContextKey) || isAbortError(e)) return;
        setError(e.message || (settings?.language !== 'en' ? '多模型对比失败。' : 'Training model comparison failed.'));
      } finally {
        if (isRequestCurrent(requestToken, requestContextKey)
          && requestCoordinator.finish(requestToken, requestContextKey)) {
          setCompareTrainingLoading(false);
        }
      }
      return;
    }

    const trainingTaskId = modelMode === PREDICT_MODEL_MODE_TRAINED ? Number(selectedTrainingTaskId) : null;
    if (modelMode === PREDICT_MODEL_MODE_TRAINED && (!Number.isFinite(trainingTaskId) || trainingTaskId <= 0)) {
      setError(settings?.language !== 'en' ? '请先选择一个已完成的训练模型。' : 'Select a completed trained model first.');
      return;
    }

    const body = {
      selected_variables: selectedVars,
      horizon: predStep,
      ls_start: lsStart,
      mars_year: marsYear,
      ...(trainingTaskId ? { training_task_id: trainingTaskId } : {}),
    };
    const analysisContext = {
      modelMode,
      trainingTaskId,
      horizon: predStep,
      selectedVars,
      dataSourceMode,
      marsYear,
      lsStart,
    };
    const requestContextKey = buildPredictionContextKey(analysisContext);
    const requestToken = {
      ...requestCoordinator.start(
      PREDICT_REQUEST_CHANNELS.single,
      requestContextKey
      ),
      scope: predictScopeRef.current,
    };
    setError(null);
    setLoading(true);
    const nextMetricsKey = buildPredictMetricsKey(analysisContext);
    const nextErrorDistKey = analysisVisibility.errorDistribution
      ? buildErrorDistributionKey(analysisContext)
      : null;
    const nextPfiKey = analysisVisibility.permutationImportance
      ? buildPermutationImportanceKey(analysisContext)
      : null;
    const shouldFetchMetrics = modelMode === PREDICT_MODEL_MODE_TRAINED
      && Boolean(nextMetricsKey)
      && (nextMetricsKey !== metricsKey || !metrics);
    const shouldFetchErrorDist = Boolean(nextErrorDistKey) && (nextErrorDistKey !== errorDistKey || !errorDistData);
    const shouldFetchPfi = Boolean(nextPfiKey) && (nextPfiKey !== pfiKey || !pfiData);
    const metricsPromise = shouldFetchMetrics
      ? fetchPredictMetrics(body, {
          dataSource: dataSourceMode,
          signal: requestToken.signal,
        })
      : Promise.resolve(null);

    if (shouldFetchMetrics) {
      setMetricsLoading(true);
    }
    if (shouldFetchErrorDist) {
      setErrorDistLoading(true);
    }
    if (shouldFetchPfi) {
      setPfiLoading(true);
    }

    try {
      const [predResult, metricsResult] = await Promise.all([
        runPrediction(body, {
          dataSource: dataSourceMode,
          signal: requestToken.signal,
        }),
        metricsPromise,
      ]);
      if (!isRequestCurrent(requestToken, requestContextKey)) return;
      const resolvedMetrics = modelMode === PREDICT_MODEL_MODE_TRAINED
        ? metricsResult ?? predResult.metrics ?? null
        : predResult.metrics ?? null;

      const errorDistPromise = analysisVisibility.errorDistribution
        ? !nextErrorDistKey
          ? Promise.resolve(null)
          : !shouldFetchErrorDist
          ? Promise.resolve(errorDistData)
          : modelMode === PREDICT_MODEL_MODE_TRAINED
          ? fetchErrorDistribution(predResult.selected_variables || [], {
              trainingTaskId,
              horizon: predStep,
              signal: requestToken.signal,
            })
          : fetchErrorDistribution(selectedVars, { signal: requestToken.signal })
        : Promise.resolve(null);
      const pfiVariables = modelMode === PREDICT_MODEL_MODE_TRAINED
        ? (predResult.selected_variables || [])
        : selectedVars;
      const pfiPromise = analysisVisibility.permutationImportance
        ? !shouldFetchPfi
          ? Promise.resolve(pfiData)
          : fetchPermutationImportance(pfiVariables, {
              trainingTaskId,
              marsYear,
              lsStart,
              horizon: predStep,
              signal: requestToken.signal,
            })
        : Promise.resolve(null);
      const [errorDistResult, pfiResult] = await Promise.all([errorDistPromise, pfiPromise]);
      if (!isRequestCurrent(requestToken, requestContextKey)) return;
      const nextPerformanceData = modelMode === PREDICT_MODEL_MODE_TRAINED
        ? { results: { current: buildPerformanceMetricsFromEval(resolvedMetrics) } }
        : performanceData;
      const nextPerformanceKey = modelMode === PREDICT_MODEL_MODE_TRAINED
        ? currentPerformanceContextKey
        : performanceKey;

      setResults(predResult);
      setMetrics(resolvedMetrics);
      setErrorDistData(errorDistResult);
      setPfiData(pfiResult);
      setResultContextKey(requestContextKey);
      if (nextMetricsKey) setMetricsKey(nextMetricsKey);
      setErrorDistKey(nextErrorDistKey);
      if (nextPfiKey) setPfiKey(nextPfiKey);
      if (modelMode === PREDICT_MODEL_MODE_TRAINED) {
        setPerformanceData(nextPerformanceData);
        setPerformanceKey(nextPerformanceKey);
      }
      setActiveHorizon(0);
      writePredictCache({
        resultContextKey: requestContextKey,
        results: predResult,
        metrics: resolvedMetrics,
        errorDistData: errorDistResult,
        pfiData: pfiResult,
        metricsKey: nextMetricsKey,
        errorDistKey: nextErrorDistKey,
        pfiKey: nextPfiKey,
        performanceData: nextPerformanceData,
        performanceKey: nextPerformanceKey,
        activeHorizon: 0,
        params: {
          selectedVars,
          predStep,
          lsStart,
          marsYear,
          dataSource: dataSourceMode,
          modelMode,
          trainingTaskId,
        },
      });
    } catch (e) {
      if (!isRequestLatest(requestToken, requestContextKey) || isAbortError(e)) return;
      setError(e.message || t('predict.errorPrefix'));
    } finally {
      if (isRequestCurrent(requestToken, requestContextKey)
        && requestCoordinator.finish(requestToken, requestContextKey)) {
        setLoading(false);
        setMetricsLoading(false);
        setErrorDistLoading(false);
        setPfiLoading(false);
      }
    }
  }, [
    analysisVisibility.errorDistribution,
    analysisVisibility.permutationImportance,
    compareSelection,
    compareTrainingMetricsData,
    compareTrainingMetricsKey,
    currentCompareTrainingMetricsKey,
    currentPerformanceContextKey,
    dataSourceMode,
    errorDistData,
    errorDistKey,
    isSwitchingSource,
    lsStart,
    marsYear,
    metrics,
    metricsKey,
    modelMode,
    performanceData,
    performanceKey,
    predictionHorizonLimit,
    predStep,
    pfiData,
    pfiKey,
    requestCoordinator,
    selectedTrainingTaskId,
    selectedVars,
    settings?.language,
    t,
    writePredictCache,
  ]);

  const handleLoadCompareErrorDistribution = useCallback(async () => {
    if (!compareSelection.canCompare || !currentCompareTrainingErrorKey) {
      setError(settings?.language !== 'en' ? '至少选择 2 个已完成训练模型。' : 'Select at least 2 completed trained models.');
      return;
    }
    if (activeCompareTrainingErrorData) return;
    const requestContextKey = currentCompareTrainingErrorKey;
    const requestToken = {
      ...requestCoordinator.start(
      PREDICT_REQUEST_CHANNELS.compareErrorDistribution,
      requestContextKey
      ),
      scope: predictScopeRef.current,
    };
    setError(null);
    setCompareTrainingErrorLoading(true);
    try {
      const result = await compareTrainingModelErrorDistributions(compareSelection.ids, {
        horizon: predStep,
        signal: requestToken.signal,
      });
      if (!isRequestCurrent(requestToken, requestContextKey)) return;
      setCompareTrainingErrorData(result);
      setCompareTrainingErrorKey(requestContextKey);
      writePredictCache({
        compareTrainingErrorData: result,
        compareTrainingErrorKey: requestContextKey,
      });
    } catch (e) {
      if (!isRequestLatest(requestToken, requestContextKey) || isAbortError(e)) return;
      setError(e.message || (settings?.language !== 'en' ? '误差分布对比失败。' : 'Error distribution comparison failed.'));
    } finally {
      if (isRequestCurrent(requestToken, requestContextKey)
        && requestCoordinator.finish(requestToken, requestContextKey)) {
        setCompareTrainingErrorLoading(false);
      }
    }
  }, [
    activeCompareTrainingErrorData,
    compareSelection,
    currentCompareTrainingErrorKey,
    predStep,
    requestCoordinator,
    settings?.language,
    writePredictCache,
  ]);

  const handleLoadComparePfi = useCallback(async () => {
    if (!compareSelection.canCompare || !currentCompareTrainingPfiKey) {
      setError(settings?.language !== 'en' ? '至少选择 2 个已完成训练模型。' : 'Select at least 2 completed trained models.');
      return;
    }
    if (activeCompareTrainingPfiData) return;
    const requestContextKey = currentCompareTrainingPfiKey;
    const requestToken = {
      ...requestCoordinator.start(
      PREDICT_REQUEST_CHANNELS.comparePfi,
      requestContextKey
      ),
      scope: predictScopeRef.current,
    };
    setError(null);
    setCompareTrainingPfiLoading(true);
    try {
      const result = await compareTrainingModelPfi(compareSelection.ids, {
        horizon: predStep,
        signal: requestToken.signal,
      });
      if (!isRequestCurrent(requestToken, requestContextKey)) return;
      setCompareTrainingPfiData(result);
      setCompareTrainingPfiKey(requestContextKey);
      writePredictCache({
        compareTrainingPfiData: result,
        compareTrainingPfiKey: requestContextKey,
      });
    } catch (e) {
      if (!isRequestLatest(requestToken, requestContextKey) || isAbortError(e)) return;
      setError(e.message || (settings?.language !== 'en' ? 'PFI 对比失败。' : 'PFI comparison failed.'));
    } finally {
      if (isRequestCurrent(requestToken, requestContextKey)
        && requestCoordinator.finish(requestToken, requestContextKey)) {
        setCompareTrainingPfiLoading(false);
      }
    }
  }, [
    activeCompareTrainingPfiData,
    compareSelection,
    currentCompareTrainingPfiKey,
    predStep,
    requestCoordinator,
    settings?.language,
    writePredictCache,
  ]);

  useEffect(() => { setPredictUiPreferences({ viewMode }); }, [viewMode]);
  useEffect(() => { writePredictCache({ activeHorizon }); }, [activeHorizon, writePredictCache]);
  useEffect(() => { writePredictCache({ compareConfigs }); }, [compareConfigs, writePredictCache]);
  useEffect(() => { writePredictCache({ selectedCompareIds }); }, [selectedCompareIds, writePredictCache]);
  useEffect(() => {
    writePredictCache({ selectedCompareTrainingTaskIds: compareSelection.ids });
  }, [compareSelectionIdKey, writePredictCache]);

  useEffect(() => {
    if (modelMode !== PREDICT_MODEL_MODE_COMPARE) return;
    setResults(null);
    setMetrics(null);
    setPerformanceData(null);
    setPerformanceKey(null);
    setErrorDistData(null);
    setPfiData(null);
  }, [modelMode]);

  const step = activeResults ? Math.min(activeHorizon, (activeResults.horizon || 1) - 1) : 0;
  const truthField = activeResults?.ground_truth?.[step] ?? null;
  const predField = activeResults?.prediction?.[step] ?? null;
  const residField = activeResults?.residual?.[step] ?? null;
  const stepLs = activeResults?.ls_values?.[step];

  const stepLabel = (ls) => (ls != null ? ` · Ls=${ls.toFixed(3)}°` : '');

  return (
    <div className="page-enter" style={{ padding: '100px 40px 60px', maxWidth: 1400, margin: '0 auto' }}>
      <SectionTitle title={t('predict.title')} subtitle={t('predict.subtitle')} />

      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 24 }}>
        <PredictSidebar
          isLight={isLight}
          loading={modelMode === PREDICT_MODEL_MODE_COMPARE ? compareTrainingLoading : loading}
          requestContextLocked={requestContextLocked}
          isSwitchingSource={isSwitchingSource}
          error={activeError}
          modelMode={modelMode}
          setModelMode={setModelMode}
          trainingModelOptions={trainingModelOptions}
          selectedTrainingTaskId={selectedTrainingTaskId}
          setSelectedTrainingTaskId={setSelectedTrainingTaskId}
          selectedCompareTrainingTaskIds={selectedCompareTrainingTaskIds}
          setSelectedCompareTrainingTaskIds={setSelectedCompareTrainingTaskIds}
          trainingTasksLoading={trainingTasksLoading}
          selectedTrainingOption={selectedTrainingOption}
          analysisVisibility={analysisVisibility}
          marsYear={marsYear}
          setMarsYear={setMarsYear}
          availableMarsYears={availableMarsYears}
          lsStart={lsStart}
          setLsStart={setLsStart}
          predStep={predStep}
          setPredStep={setPredStep}
          predictionHorizonLimit={predictionHorizonLimit}
          selectedVars={selectedVars}
          toggleVar={toggleVar}
          VARIABLES={VARIABLES}
          handlePredict={handlePredict}
          precision={precision}
        />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {analysisVisibility.predictionFields ? (
          <PredictDisplay
            viewMode={viewMode}
            setViewMode={setViewMode}
            VIEW_MODES={VIEW_MODES}
            results={activeResults}
            activeHorizon={activeHorizon}
            setActiveHorizon={setActiveHorizon}
            loading={loading}
            truthField={truthField}
            predField={predField}
            residField={residField}
            stepLs={stepLs}
            stepLabel={stepLabel}
            setFullscreen3D={setFullscreen3D}
            TRIPTYCH_PANELS={TRIPTYCH_PANELS}
          />
          ) : null}

          {analysisVisibility.metrics ? (
          <PredictMetrics
            loading={metricsLoading}
            metrics={activeMetrics}
            precision={precision}
            ozoneUnit={ozoneUnit}
            modelMode={modelMode}
          />
          ) : null}

          {analysisVisibility.errorDistribution ? (
            <ErrorDistributionChart
              data={activeErrorDistData}
              loading={errorDistLoading}
              isLight={isLight}
              plotTextColor={plotTextColor}
              plotText60={plotText60}
              plotGridColor={plotGridColor}
            />
          ) : null}

          {analysisVisibility.permutationImportance ? (
            <PermutationImportanceChart
              data={activePfiData}
              loading={pfiLoading}
              plotTextColor={plotTextColor}
              plotText60={plotText60}
              plotGridColor={plotGridColor}
            />
          ) : null}

          {analysisVisibility.compareSummary ? (
            <CompareTrainingModelsPanel
              data={activeCompareTrainingData}
              loading={compareTrainingLoading}
              errorDistributionData={activeCompareTrainingErrorData}
              errorDistributionLoading={compareTrainingErrorLoading}
              onLoadErrorDistribution={handleLoadCompareErrorDistribution}
              pfiData={activeCompareTrainingPfiData}
              pfiLoading={compareTrainingPfiLoading}
              onLoadPfi={handleLoadComparePfi}
              selectedCount={compareSelection.count}
              precision={precision}
              isZh={settings?.language !== 'en'}
              plotTextColor={plotTextColor}
              plotGridColor={plotGridColor}
            />
          ) : null}
        </div>
      </div>

      <PredictFullscreenHUD
        fullscreen3D={fullscreen3D}
        setFullscreen3D={setFullscreen3D}
        truthField={truthField}
        stepLs={stepLs}
        step={activeHorizon}
        precision={precision}
        ozoneUnit={ozoneUnit}
      />

    </div>
  );
}
