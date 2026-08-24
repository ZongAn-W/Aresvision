import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pageSource = readFileSync(new URL('../ModelTrainingPage.jsx', import.meta.url), 'utf8');
const apiSource = readFileSync(new URL('../../services/api.js', import.meta.url), 'utf8');
const dialogSource = readFileSync(new URL('./RenameModelDialog.jsx', import.meta.url), 'utf8');

test('completed training cards expose the rename action', () => {
  assert.match(pageSource, /task\.status === 'completed'[\s\S]*onRename\(task\)/);
  assert.match(pageSource, /<EditRoundedIcon/);
});

test('training page saves a renamed model and refreshes shared tasks', () => {
  assert.match(pageSource, /await renameTrainingModel\(renameTask\.id, normalizedName\)/);
  assert.match(pageSource, /await loadTasks\(\)/);
  assert.match(pageSource, /<RenameModelDialog/);
});

test('rename API uses the authenticated PATCH task-name endpoint', () => {
  assert.match(apiSource, /export async function renameTrainingModel\(taskId, modelName\)/);
  assert.match(apiSource, /training\/tasks\/\$\{taskId\}\/name/);
  assert.match(apiSource, /method: 'PATCH'/);
});

test('rename dialog provides accessible form feedback and cancellation', () => {
  assert.match(dialogSource, /<label[^>]*htmlFor="trained-model-name"/);
  assert.match(dialogSource, /const visibleError = submitError \|\| \(touched \? validationError : ''\)/);
  assert.match(dialogSource, /aria-describedby=\{visibleError \? 'trained-model-name-error'/);
  assert.match(dialogSource, /event\.key === 'Escape'/);
  assert.match(dialogSource, /disabled=\{saving \|\| Boolean\(validationError\)\}/);
});
