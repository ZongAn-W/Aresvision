import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const pageSource = fs.readFileSync(path.join(currentDir, '..', 'PredictPage.jsx'), 'utf8');
const sidebarSource = fs.readFileSync(path.join(currentDir, 'PredictSidebar.jsx'), 'utf8');

test('prediction page owns request coordination and context-aware cache restoration', () => {
  assert.match(pageSource, /useRef/);
  assert.match(pageSource, /createPredictRequestCoordinator/);
  assert.match(pageSource, /requestCoordinatorRef/);
  assert.match(pageSource, /buildPredictionContextKey/);
  assert.match(pageSource, /currentPredictionContextKey/);
  assert.match(pageSource, /getPredictionResultCacheForContext/);
  assert.match(pageSource, /resultContextKey/);
});

test('an exact trained-model cache match is not cleared by a mount-time visibility effect', () => {
  assert.doesNotMatch(
    pageSource,
    /if \(analysisVisibility\.performanceComparison\) return;[\s\S]*?setErrorDistData\(null\)[\s\S]*?setPfiData\(null\)/
  );
});

test('critical context changes invalidate requests and the complete visible result bundle', () => {
  assert.match(pageSource, /previousRequestContextKeyRef/);
  assert.match(pageSource, /requestCoordinator\.invalidateAll\(\)/);
  assert.match(pageSource, /setResults\(null\)/);
  assert.match(pageSource, /setMetrics\(null\)/);
  assert.match(pageSource, /setErrorDistData\(null\)/);
  assert.match(pageSource, /setPfiData\(null\)/);
  assert.match(pageSource, /setPerformanceData\(null\)/);
  assert.match(pageSource, /setError\(null\)/);
});

test('page unmount synchronously invalidates in-flight prediction requests', () => {
  assert.match(
    pageSource,
    /useLayoutEffect\(\(\) => \(\) => \{\s*requestCoordinator\.invalidateAll\(\);\s*\}, \[requestCoordinator\]\);/
  );
});

test('single prediction and all comparison analyses use guarded request channels', () => {
  assert.match(pageSource, /PREDICT_REQUEST_CHANNELS\.single/);
  assert.match(pageSource, /PREDICT_REQUEST_CHANNELS\.compareMetrics/);
  assert.match(pageSource, /PREDICT_REQUEST_CHANNELS\.compareErrorDistribution/);
  assert.match(pageSource, /PREDICT_REQUEST_CHANNELS\.comparePfi/);
  assert.match(pageSource, /requestCoordinator\.isCurrent\(/);
  assert.match(pageSource, /requestCoordinator\.finish\(/);
  assert.match(pageSource, /isAbortError\(/);
  assert.match(pageSource, /currentRequestContextKeysRef/);
  assert.match(pageSource, /isRequestCurrent/);
  assert.match(pageSource, /isRequestLatest/);
});

test('all protected page API calls receive the active request signal', () => {
  assert.match(pageSource, /runPrediction\([\s\S]*?signal:\s*requestToken\.signal/);
  assert.match(pageSource, /fetchPredictMetrics\([\s\S]*?signal:\s*requestToken\.signal/);
  assert.match(pageSource, /fetchErrorDistribution\([\s\S]*?signal:\s*requestToken\.signal/);
  assert.match(pageSource, /fetchPermutationImportance\([\s\S]*?signal:\s*requestToken\.signal/);
  assert.match(pageSource, /compareTrainingModels\([\s\S]*?signal:\s*requestToken\.signal/);
  assert.match(pageSource, /compareTrainingModelErrorDistributions\([\s\S]*?signal:\s*requestToken\.signal/);
  assert.match(pageSource, /compareTrainingModelPfi\([\s\S]*?signal:\s*requestToken\.signal/);
});

test('default prediction reuses run metrics instead of pairing runPrediction with fetchPredictMetrics', () => {
  const handlePredictSource = pageSource
    .split('const handlePredict = useCallback(async () => {', 2)[1]
    .split('const handleLoadCompareErrorDistribution', 1)[0];
  const predictionPromiseBlock = handlePredictSource
    .split('const [predResult, metricsResult] = await Promise.all([', 2)[1]
    .split(']);', 1)[0];

  assert.match(handlePredictSource, /predResult\.metrics/);
  assert.match(predictionPromiseBlock, /metricsPromise/);
  assert.doesNotMatch(predictionPromiseBlock, /fetchPredictMetrics\(/);
});

test('rendering uses only single-model results matching the current context', () => {
  assert.match(pageSource, /resultContextKey === currentPredictionContextKey/);
  assert.match(pageSource, /results=\{activeResults\}/);
  assert.match(pageSource, /metrics=\{activeMetrics\}/);
  assert.match(pageSource, /data=\{activeErrorDistData\}/);
  assert.match(pageSource, /data=\{activePfiData\}/);
});

test('request-owned analysis cache is written only in guarded completion paths', () => {
  assert.doesNotMatch(pageSource, /useEffect\(\(\) => \{ setPredictCache\(\{ pfiData \}\); \}, \[pfiData\]\)/);
  assert.doesNotMatch(pageSource, /useEffect\(\(\) => \{ setPredictCache\(\{ metricsKey \}\); \}, \[metricsKey\]\)/);
  assert.doesNotMatch(pageSource, /useEffect\(\(\) => \{ setPredictCache\(\{ compareTrainingMetricsData \}\);/);
  assert.match(pageSource, /resultContextKey:\s*requestContextKey/);
});

test('loading locks every control that can change prediction request context', () => {
  assert.match(pageSource, /requestContextLocked/);
  assert.match(pageSource, /requestContextLocked=\{requestContextLocked\}/);
  assert.match(sidebarSource, /requestContextLocked/);
  assert.match(sidebarSource, /OptionChips[\s\S]*disabled=\{requestContextLocked\}/);
  assert.match(sidebarSource, /disabled=\{requestContextLocked \|\| trainingTasksLoading/);
  assert.match(sidebarSource, /disabled=\{requestContextLocked \|\| predictionHorizonLimit == null\}/);
  assert.match(sidebarSource, /disabled=\{requestContextLocked \|\| isSwitchingSource\}/);
  assert.match(sidebarSource, /type="range"[\s\S]*disabled=\{requestContextLocked\}/);
  assert.match(sidebarSource, /type="checkbox"[\s\S]*disabled=\{requestContextLocked\}/);
});
