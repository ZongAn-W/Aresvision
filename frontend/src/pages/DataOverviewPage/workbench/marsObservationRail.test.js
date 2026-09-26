import test from 'node:test';
import assert from 'node:assert/strict';
import { lsBounds, lsTicks, railSeries, railDomain, railPath, nearestLsSample } from './marsObservationRail.js';

test('Ls ticks respect fractional uploaded coverage and include both endpoints', () => {
  const bounds = lsBounds({ min: 12.5, max: 273.5, step: 0.5 });
  assert.deepEqual(lsTicks(bounds), [12.5, 90, 180, 270, 273.5]);
  assert.deepEqual(lsBounds({ min: 30, max: 30 }), { min: 30, max: 30, step: 5 });
});

test('physical unit conversion preserves null gaps and the actual Ls coordinates', () => {
  const rows = railSeries([0, 90, 180], [273.15, null, 283.15], 'Temperature', { temperature: 'C' });
  assert.deepEqual(rows, [{ ls: 0, value: 0 }, { ls: 90, value: null }, { ls: 180, value: 10 }]);
  assert.equal(railSeries([0], [20], 'o3col', { ozone: 'DU' })[0].value, 2);
});

/** 取出路径里每个顶点的 x 坐标（横向幅度），用于比较两条轨是否各自独立缩放。 */
function pathXs(path) {
  return [...path.matchAll(/[ML] ([\d.]+) ([\d.]+)/g)].map((match) => Number(match[1]));
}

function pathYs(path) {
  return [...path.matchAll(/[ML] ([\d.]+) ([\d.]+)/g)].map((match) => Number(match[2]));
}

test('each rail scales its own value range so the global curve never reshapes with the point', () => {
  const global = railSeries([0, 90, 180], [1, 2, 3], 'Temperature', { temperature: 'K' });
  const narrowPoint = railSeries([0, 90, 180], [1.5, 2.5, 2.2], 'Temperature', { temperature: 'K' });
  const widePoint = railSeries([0, 90, 180], [-40, 10, 60], 'Temperature', { temperature: 'K' });
  const bounds = { min: 0, max: 360 };

  // 每条轨只用自己的序列算刻度：极值永远映射到基准线 22 与最大幅度 76。
  assert.deepEqual(railDomain(global), [1, 3]);
  assert.deepEqual(railDomain(narrowPoint), [1.5, 2.5]);
  assert.deepEqual(railDomain(widePoint), [-40, 60]);
  assert.deepEqual(pathXs(railPath(global, bounds, railDomain(global))), [22, 49, 76]);
  assert.deepEqual(railDomain([]), null);

  // 全球轨的路径只由全球序列决定，与对侧选哪个点无关（这就是“取点不同形状变化”的回归点）。
  const globalPath = railPath(global, bounds, railDomain(global));
  assert.equal(globalPath, 'M 22.00 0.00 L 49.00 115.00 L 76.00 230.00');

  // 点位轨用自己的刻度，因此仍然能看清自身的起伏，而不是被全球均值压平。
  const widePointXs = pathXs(railPath(widePoint, bounds, railDomain(widePoint)));
  const narrowPointXs = pathXs(railPath(narrowPoint, bounds, railDomain(narrowPoint)));
  assert.notDeepEqual(widePointXs, narrowPointXs);
  assert.equal(widePointXs[0], 22);
  assert.equal(widePointXs[2], 76);

  // 垂直 Ls 轴仍然严格共用：同一 Ls 在两条轨上落在同一 y 坐标。
  assert.deepEqual(pathYs(globalPath), pathYs(railPath(widePoint, bounds, railDomain(widePoint))));
});

test('paths break at missing samples and the Mars-year wrap; flat series remain visible', () => {
  const rows = railSeries([350, 355, 0, 5, 10, 15], [1, 2, 3, null, 4, 5], 'o3col');
  const path = railPath(rows, { min: 0, max: 360 }, [1, 5]);
  assert.equal((path.match(/M /g) || []).length, 3);
  const flat = railPath(railSeries([0, 90], [2, 2], 'o3col'), { min: 0, max: 360 }, [2, 2]);
  assert.ok(flat.includes('L '));
  assert.doesNotMatch(flat, /NaN|Infinity/);
});

test('current readout selects the nearest real sample without filling a missing value', () => {
  const rows = railSeries([0, 90, 180], [10, null, 30], 'o3col');
  assert.deepEqual(nearestLsSample(rows, 89), { ls: 90, value: null });
  assert.deepEqual(nearestLsSample(rows, 179), { ls: 180, value: 30 });
  assert.equal(nearestLsSample([], 0), null);
});
