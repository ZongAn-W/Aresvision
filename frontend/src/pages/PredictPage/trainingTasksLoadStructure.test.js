import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const pageSource = fs.readFileSync(path.join(currentDir, '..', 'PredictPage.jsx'), 'utf8');
const sidebarSource = fs.readFileSync(path.join(currentDir, 'PredictSidebar.jsx'), 'utf8');
const displaySource = fs.readFileSync(path.join(currentDir, 'PredictDisplay.jsx'), 'utf8');
const earthCompareSource = fs.readFileSync(path.join(currentDir, 'EarthCompareWorkspace.jsx'), 'utf8');
const earthPanelSource = fs.readFileSync(path.join(currentDir, 'EarthPredictPanel.jsx'), 'utf8');

test('training task loading exposes a reusable retry path and aborts stale scope requests', () => {
  assert.match(pageSource, /const loadTrainingTasks = useCallback/);
  assert.match(pageSource, /fetchTasks\(\{ signal: controller\.signal \}\)/);
  assert.match(pageSource, /trainingTasksRequestRef\.current\.controller\?\.abort\(\)/);
  assert.match(pageSource, /trainingTasksRequestRef\.current\.id === requestId/);
  assert.match(pageSource, /predictScopeRef\.current === scope/);
  assert.match(pageSource, /setTrainingTasksError/);
  assert.match(pageSource, /onRetryTrainingTasks=\{loadTrainingTasks\}/);
});

test('task load failures are distinct from an empty successful model list in visible UI', () => {
  assert.match(sidebarSource, /trainingTasksError/);
  assert.match(sidebarSource, /Retry loading models/);
  assert.match(sidebarSource, /!trainingTasksError && filteredCompareOptions\.length === 0/);
  assert.match(displaySource, /modelsError/);
  assert.match(displaySource, /Training models could not be loaded/);
  assert.match(displaySource, /Retry loading models/);
  assert.match(earthCompareSource, /trainingTasksError=\{tasksError\}/);
  assert.match(earthPanelSource, /modelsError=\{modelsError\}/);
  assert.match(pageSource, /modelsError=\{trainingTasksError\} onRetryModels=\{loadTrainingTasks\}/);
});

test('Earth context and diagnostics stay lazy until the user starts prediction', () => {
  assert.match(pageSource, /if \(!selectedEarthTask\) \{ setEarthTaskId\(''\); setEarthContext\(null\); \}/);
  assert.doesNotMatch(pageSource, /if \(selectedEarthTask\) loadEarthContext\(earthTaskId\)/);
  assert.match(pageSource, /const context = earthContext && Number\(earthContext\.task_id\) === taskId/);
  assert.match(pageSource, /: await loadEarthContext\(taskId\)/);
  assert.match(pageSource, /deferContext=\{isEarthMode\}/);
  assert.match(pageSource, /selectedTaskId=\{earthContext \? earthTaskId : null\}/);
});
