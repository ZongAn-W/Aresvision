import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DISPLAY_FIELD_KINDS,
  activatePredictionDialog,
  fullscreenFieldModel,
  predictionPhysicalRange,
  predictionStepItems,
} from './predictionDisplayModel.js';
import { marsPredictionGrid } from './marsPredictionGrid.js';
import { fmtNum } from '../../utils/fmt.js';

const field = () => ({ field: [[300, 320], [280, 290]], minVal: 280, maxVal: 320, lat: [70, -50], lon: [-120, 80] });

test('triptych order and shared physical range remain stable across single views', () => {
  assert.deepEqual(DISPLAY_FIELD_KINDS, ['truth', 'prediction', 'residual']);
  assert.deepEqual(predictionPhysicalRange(field(), { minVal: 270, maxVal: 310 }), { min: 270, max: 320 });
  assert.deepEqual(predictionPhysicalRange({ minVal: 0, maxVal: 0 }, { minVal: 0, maxVal: 0 }), { min: -1e-6, max: 1e-6 });
  assert.equal(predictionPhysicalRange(null, field()), null);
  assert.equal(predictionPhysicalRange(field(), { minVal: NaN, maxVal: 300 }), null);
});

test('display steps use every saved horizon and adapter labels without changing result identity', () => {
  const earth = { horizon: 24, timestamps: ['2026-10-09T03:00:00Z'] };
  const seen = [];
  const adapter = { stepLabel: (results, index) => {
    seen.push(results);
    return `+${(index + 1) * 3} h · UTC step ${index + 1}`;
  } };
  const steps = predictionStepItems(earth, adapter);
  assert.equal(steps.length, 24);
  assert.equal(steps[0].label, '+3 h · UTC step 1');
  assert.equal(steps.at(-1).label, '+72 h · UTC step 24');
  assert.equal(steps.at(-1).id, '23');
  assert.ok(seen.every((results) => results === earth));
  assert.equal(earth.horizon, 24);
  assert.deepEqual(predictionStepItems(null, adapter), []);
  assert.deepEqual(predictionStepItems({ horizon: 2 }, null, (index) => `Ls step ${index + 1}`), [
    { id: '0', label: 'Ls step 1' }, { id: '1', label: 'Ls step 2' },
  ]);
});

test('Earth fullscreen statistics and profiles retain DU and original row coordinates', () => {
  const data = field();
  const grid = marsPredictionGrid(data);
  const earth = fullscreenFieldModel(data, grid, (value) => value, false);
  assert.deepEqual(earth.heatmap, data.field);
  assert.deepEqual(earth.profile, [310, 285]);
  assert.deepEqual(grid.latitude, [70, -50]);
  assert.deepEqual(grid.longitude, [-120, 80]);
  assert.equal(earth.minimum, 280);
  assert.equal(earth.maximum, 320);
  assert.equal(earth.average, 297.5);
  assert.equal(earth.nLat, 2);
  assert.equal(earth.nLon, 2);
  assert.equal(fmtNum(earth.average, 4), '297.5000');
  assert.equal(fmtNum(earth.average, 'full'), '297.5');
});

test('Mars adapter conversion happens once and residual scales preserve negatives', () => {
  const data = { ...field(), field: [[-1, 2], [-3, 0]] };
  const model = fullscreenFieldModel(data, marsPredictionGrid(data), (value) => value * 100, true);
  assert.deepEqual(model.heatmap, [[-100, 200], [-300, 0]]);
  assert.equal(model.minimum, -300);
  assert.equal(model.colorMinimum, -300);
  assert.equal(model.colorMaximum, 300);
  assert.equal(model.average, -50);
  assert.equal(fullscreenFieldModel(data, { latitude: [70], longitude: [-120, 80] }, (v) => v, true), null);
  assert.equal(fullscreenFieldModel({ ...data, field: [[NaN, 2], [-3, 0]] }, marsPredictionGrid(data), (v) => v, true), null);
});

function dialogEnvironment() {
  const listeners = new Map();
  const document = {
    body: { style: { overflow: 'auto' } },
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: (name, callback) => {
      assert.equal(listeners.get(name), callback);
      listeners.delete(name);
    },
  };
  const control = (name) => ({
    name, tabIndex: 0, disabled: false, isConnected: true,
    getClientRects: () => [1], focus() { document.activeElement = this; },
  });
  const openButton = control('open fullscreen');
  const closeButton = control('close');
  const lastButton = control('last');
  document.activeElement = openButton;
  const dialog = { querySelectorAll: () => [closeButton, lastButton], focus() {} };
  return { document, dialog, listeners, openButton, closeButton, lastButton };
}

test('fullscreen Escape restores scroll and focus; tab navigation stays within the dialog', () => {
  const env = dialogEnvironment();
  let closed = 0;
  let prevented = 0;
  const release = activatePredictionDialog(env.document, env.dialog, () => closed++);
  assert.equal(env.document.body.style.overflow, 'hidden');
  assert.equal(env.document.activeElement, env.closeButton);
  env.listeners.get('keydown')({ key: 'Tab', shiftKey: true, preventDefault: () => prevented++ });
  assert.equal(env.document.activeElement, env.lastButton);
  env.listeners.get('keydown')({ key: 'Tab', shiftKey: false, preventDefault: () => prevented++ });
  assert.equal(env.document.activeElement, env.closeButton);
  env.listeners.get('keydown')({ key: 'Escape', preventDefault: () => prevented++ });
  assert.equal(closed, 1);
  assert.equal(prevented, 3);
  release();
  assert.equal(env.document.body.style.overflow, 'auto');
  assert.equal(env.document.activeElement, env.openButton);
  assert.equal(env.listeners.size, 0);
});

test('closing by task or planet unmount restores scrolling even when trigger is removed', () => {
  const env = dialogEnvironment();
  const release = activatePredictionDialog(env.document, env.dialog, () => assert.fail('unmount must not fire a second close'));
  env.openButton.isConnected = false;
  release();
  assert.equal(env.document.body.style.overflow, 'auto');
  assert.equal(env.listeners.size, 0);
});
