import test from 'node:test';
import assert from 'node:assert/strict';

import {
  areaWeightedMean,
  cellAreaWeights,
  clippedCellEdges,
  coastlinePaths,
  coverageRect,
  gridCellRect,
  nearestIndex,
  normalizeColorValue,
  normalizeLongitudeDegrees,
  pointInsideCoverage,
  project,
  segmentsToPath,
  splitCoastline,
  unproject,
} from './earthMapGeometry.js';

const LAT = Array.from({ length: 31 }, (_, i) => -60 + i * 4);
const LON = Array.from({ length: 49 }, (_, i) => -120 + i * 5);

test('edge cells end exactly at regional limits', () => {
  const a = clippedCellEdges(LAT);
  const b = clippedCellEdges(LON);
  const southwest = gridCellRect(a, b, 0, 0);
  const northeast = gridCellRect(a, b, 30, 48);
  assert.deepEqual(southwest, { x: 60, y: 148, width: 2.5, height: 2 });
  assert.deepEqual(northeast, { x: 297.5, y: 30, width: 2.5, height: 2 });
  assert.deepEqual(unproject(...Object.values(project(0, 0))), { lon: 0, lat: 0 });
});

test('the heat map cannot grow past the declared coverage', () => {
  const a = clippedCellEdges(LAT);
  const b = clippedCellEdges(LON);
  assert.equal(a[0], -60);
  assert.equal(a[a.length - 1], 60);
  assert.equal(b[0], -120);
  assert.equal(b[b.length - 1], 120);

  const first = gridCellRect(a, b, 0, 0);
  const last = gridCellRect(a, b, 30, 48);
  // SVG y grows downward: the southernmost cell's top edge is latitude 58 and
  // its bottom edge is the declared southern limit, 60 degrees south.
  assert.equal(unproject(first.x, first.y).lat, -58);
  assert.equal(unproject(first.x, first.y + first.height).lat, -60);
  // The whole data layer stays inside lon [-120,120] and lat [-60,60].
  assert.ok(first.x >= 60);
  assert.equal(unproject(last.x + last.width, last.y).lon, 120);
  assert.equal(unproject(last.x + last.width, last.y).lat, 60);
});

test('row 0 is south and column 0 is west', () => {
  const a = clippedCellEdges(LAT);
  const b = clippedCellEdges(LON);
  const southWestCell = gridCellRect(a, b, 0, 0);
  const northEastCell = gridCellRect(a, b, 30, 48);
  // SVG y grows downward, so the southern cell sits lower on screen.
  assert.ok(southWestCell.y > northEastCell.y);
  assert.ok(southWestCell.x < northEastCell.x);
  assert.equal(unproject(southWestCell.x, southWestCell.y).lat, -58);
  assert.equal(unproject(southWestCell.x, southWestCell.y).lon, -120);
  assert.equal(unproject(northEastCell.x, northEastCell.y).lat, 60);
  assert.equal(unproject(northEastCell.x + northEastCell.width, northEastCell.y).lon, 120);
});

test('clippedCellEdges rejects non-ascending or duplicate axes', () => {
  assert.throws(() => clippedCellEdges([0]), /Invalid ascending coordinate axis/);
  assert.throws(() => clippedCellEdges([0, 0]), /Invalid ascending coordinate axis/);
  assert.throws(() => clippedCellEdges([1, 0]), /Invalid ascending coordinate axis/);
  assert.throws(() => clippedCellEdges([0, Number.NaN]), /Invalid ascending coordinate axis/);
  assert.throws(() => clippedCellEdges('nope'), /Invalid ascending coordinate axis/);
});

test('nearestIndex snaps and refuses points outside coverage', () => {
  assert.equal(nearestIndex(LON, -120), 0);
  assert.equal(nearestIndex(LON, 120), 48);
  assert.equal(nearestIndex(LON, 0), 24);
  assert.equal(nearestIndex(LON, 2), 24);
  assert.equal(nearestIndex(LON, 3), 25);
  // -117.5 is equidistant from -120 and -115: the smaller index wins.
  assert.equal(nearestIndex(LON, -117.5), 0);
  assert.equal(nearestIndex(LON, 117.5), 47);
  assert.equal(nearestIndex(LAT, 58), 29);
  assert.equal(nearestIndex(LAT, -58), 0);
  // Outside coverage is refused, never clamped to the edge.
  assert.equal(nearestIndex(LON, 240), null);
  assert.equal(nearestIndex(LON, -240), null);
  assert.equal(nearestIndex(LON, 122.5), null);
  assert.equal(nearestIndex(LON, -122.5), null);
  assert.equal(nearestIndex(LAT, 60.001), null);
  assert.equal(nearestIndex(LAT, -60.001), null);
  assert.equal(nearestIndex(LAT, 90), null);
  assert.equal(nearestIndex(LAT, Number.NaN), null);
});

test('normalizeColorValue keeps a constant field out of a divide by zero', () => {
  assert.equal(normalizeColorValue(5, 0, 10), 0.5);
  assert.equal(normalizeColorValue(0, 0, 10), 0);
  assert.equal(normalizeColorValue(10, 0, 10), 1);
  assert.equal(normalizeColorValue(20, 0, 10), 1);
  assert.equal(normalizeColorValue(-5, 0, 10), 0);
  // A constant field uses the ramp midpoint rather than NaN.
  assert.equal(normalizeColorValue(7, 7, 7), 0.5);
  assert.equal(normalizeColorValue(Number.NaN, 0, 10), null);
});

test('the antimeridian is never bridged by a coastline path', () => {
  // A jump across +/-180 must break the line instead of drawing around the world.
  const twoPoints = splitCoastline([[170, 0], [-170, 0]]);
  assert.equal(twoPoints.length, 0, 'single-point fragments are dropped, never bridged');

  const across = splitCoastline([[179, 10], [178, 10], [-179, 11], [-178, 11]]);
  assert.equal(across.length, 2);
  assert.equal(across[0].length, 2);
  assert.equal(across[1].length, 2);
  // The two fragments sit on opposite sides of the map, not across it.
  assert.ok(across[0][0][0] > 300);
  assert.ok(across[1][0][0] < 60);

  const normal = splitCoastline([[0, 0], [10, 0], [20, 0]]);
  assert.equal(normal.length, 1);
  assert.deepEqual(normal[0], [[180, 90], [190, 90], [200, 90]]);

  // A line that itself runs to the map edge stays one continuous path.
  const single = splitCoastline([[-180, 0], [-170, 0], [-160, 0]]);
  assert.equal(single.length, 1);
  assert.equal(single[0].length, 3);
});

test('coastline paths never close automatically and skip empty geometry', () => {
  const geojson = {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1], [2, 2]] } },
      { type: 'Feature', geometry: { type: 'LineString', coordinates: [[0, 0]] } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] } },
      { type: 'Feature', geometry: null },
      { type: 'Feature' },
    ],
  };
  const paths = coastlinePaths(geojson);
  assert.equal(paths.length, 1);
  assert.ok(paths[0].startsWith('M'));
  assert.equal(paths[0].endsWith('Z'), false);
  assert.equal(paths[0].split('L').length, 3);
  assert.equal(coastlinePaths(null).length, 0);
});

test('segmentsToPath renders each segment as an independent subpath', () => {
  const path = segmentsToPath([[[0, 0], [1, 1]], [[5, 5], [6, 6]]]);
  assert.equal(path, 'M0.000 0.000 L1.000 1.000 M5.000 5.000 L6.000 6.000');
});

test('coverageRect and pointInsideCoverage describe the real data area', () => {
  const coverage = { latitude_range: [-60, 60], longitude_range: [-120, 120], wrap_longitude: false };
  assert.deepEqual(coverageRect(coverage), { x: 60, y: 30, width: 240, height: 120 });
  assert.equal(pointInsideCoverage(coverage, 0, 0), true);
  assert.equal(pointInsideCoverage(coverage, 60, 120), true);
  assert.equal(pointInsideCoverage(coverage, -60, -120), true);
  assert.equal(pointInsideCoverage(coverage, 60.001, 0), false);
  assert.equal(pointInsideCoverage(coverage, 0, 240), false);
  assert.equal(pointInsideCoverage(coverage, 0, Number.NaN), false);
});

test('projection is a plain 2:1 equirectangular mapping', () => {
  assert.deepEqual(project(-180, 90), { x: 0, y: 0 });
  assert.deepEqual(project(180, -90), { x: 360, y: 180 });
  assert.deepEqual(project(0, 0), { x: 180, y: 90 });
  assert.deepEqual(unproject(180, 90), { lon: 0, lat: 0 });
});


test('global cells meet poles and dateline and permit edge picking', () => {
  const lat = Array.from({ length: 36 }, (_, i) => -87.5 + i * 5);
  const lon = Array.from({ length: 72 }, (_, i) => -177.5 + i * 5);
  const y = clippedCellEdges(lat, [-90, 90]);
  const x = clippedCellEdges(lon, [-180, 180]);
  assert.deepEqual(gridCellRect(y, x, 0, 0), { x: 0, y: 175, width: 5, height: 5 });
  assert.deepEqual(gridCellRect(y, x, 35, 71), { x: 355, y: 0, width: 5, height: 5 });
  assert.equal(nearestIndex(lat, 90, [-90, 90]), 35);
  assert.equal(nearestIndex(lon, -180, [-180, 180]), 0);
  assert.equal(nearestIndex(lon, 180, [-180, 180]), 71);
  assert.equal(nearestIndex(lon, 181, [-180, 180]), null);
});

test('global v2 cell area weights match the backend spherical formula', () => {
  const edges = [-90, -85, 0, 85, 90];
  const weights = cellAreaWeights(edges);
  assert.equal(weights.length, 4);
  const expected = edges.slice(1).map((north, index) => (
    Math.sin((north * Math.PI) / 180) - Math.sin((edges[index] * Math.PI) / 180)
  ));
  weights.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 1e-12));
  // Polar cells carry far less area than the equatorial cells.
  assert.ok(weights[0] < weights[1]);
  assert.throws(() => cellAreaWeights([10, 5]), /Invalid latitude edges/);
  assert.throws(() => cellAreaWeights([0]), /Invalid latitude edges/);
});

test('area weighted mean keeps missing values as a failure instead of zero', () => {
  const edges = [-90, 0, 90];
  const mean = areaWeightedMean([[10, 10], [20, 20]], edges);
  assert.ok(Math.abs(mean - 15) < 1e-12);
  assert.equal(areaWeightedMean([[10, null], [20, 20]], edges), null);
  assert.equal(areaWeightedMean([[10, 10]], edges), null);
  assert.equal(areaWeightedMean([], edges), null);
});

test('longitude normalisation is a representation change only, never a coverage wrap', () => {
  assert.equal(normalizeLongitudeDegrees(180), -180);
  assert.equal(normalizeLongitudeDegrees(-180), -180);
  assert.equal(normalizeLongitudeDegrees(540), -180);
  assert.equal(normalizeLongitudeDegrees(-177.5), -177.5);
  assert.equal(normalizeLongitudeDegrees(Number.NaN), null);
  // The regional v1 release keeps its own coverage test: the raw 240 is rejected,
  // and callers must not normalise before the coverage check on a regional release
  // (normalising 240 would silently land on -120 inside the box).
  const regional = { latitude_range: [-60, 60], longitude_range: [-120, 120] };
  assert.equal(pointInsideCoverage(regional, 0, 120), true);
  assert.equal(pointInsideCoverage(regional, 0, 240), false);
  assert.equal(pointInsideCoverage(regional, 0, normalizeLongitudeDegrees(240)), true);
});