import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAnomalyField,
  buildContourSegments,
  buildTerminatorDirection,
  buildWindVectors,
  fieldSpatialMean,
  earthSunDirection,
  marsSunDirection,
} from './sphericalFieldLayers.js';

test('fieldSpatialMean uses latitude weights when coordinates are provided', () => {
  const mean = fieldSpatialMean([[10], [0]], { latCenters: [0, 60] });
  assert.ok(Math.abs(mean - 20 / 3) < 1e-12);
});

test('buildAnomalyField centers the current field on its spatial mean', () => {
  const result = buildAnomalyField({
    field: [[1, 3], [5, 7]],
    minVal: 1,
    maxVal: 7,
  });
  assert.ok(Math.abs(result.mean - 4) < 1e-12);
  assert.deepEqual(result.field.map((row) => row.map((value) => Number(value.toFixed(12)))), [[-3, -1], [1, 3]]);
  assert.ok(Math.abs(result.minVal + 3) < 1e-12);
  assert.ok(Math.abs(result.maxVal - 3) < 1e-12);
});

test('buildContourSegments returns geographic segments at requested levels', () => {
  const result = buildContourSegments({
    field: [[0, 10], [0, 10]],
    minVal: 0,
    maxVal: 10,
  }, { levels: [5], latCenters: [10, -10], lonCenters: [0, 20] });
  assert.equal(result.length, 1);
  assert.equal(result[0].level, 5);
  assert.equal(result[0].points.length, 2);
  assert.deepEqual(result[0].points[0], [10, 10]);
  assert.deepEqual(result[0].points[1], [-10, 10]);
});

test('buildWindVectors combines U and V components into arrows', () => {
  const vectors = buildWindVectors(
    { field: [[3]], minVal: 3, maxVal: 3 },
    { field: [[4]], minVal: 4, maxVal: 4 },
    { latCenters: [0], lonCenters: [30], scale: 0.2 },
  );
  assert.equal(vectors.length, 1);
  assert.equal(vectors[0].speed, 5);
  assert.deepEqual(vectors[0].start, [0, 30]);
  assert.ok(vectors[0].end[0] > vectors[0].start[0]);
  assert.ok(vectors[0].end[1] > vectors[0].start[1]);
});

test('buildTerminatorDirection returns a normalized solar direction', () => {
  const direction = buildTerminatorDirection({ solarLongitudeLs: 90 });
  const length = Math.hypot(direction.x, direction.y, direction.z);
  assert.ok(Math.abs(length - 1) < 1e-12);
  assert.ok(direction.y > 0);
});

test('polar row means retain their true area and ignore missing values', () => {
  const c = Math.cos(87.5 * Math.PI / 180);
  assert.ok(Math.abs(fieldSpatialMean({ field: [[10, NaN], [0, 0]] }, { latCenters: [87.5, 0] }) - 10 * c / (c + 2)) < 1e-10);
  assert.ok(Math.abs(buildAnomalyField({ field: [[7, 7], [7, 7]] }).colorRange.max) < 1e-12);
  assert.equal(fieldSpatialMean({ field: [[NaN]] }), null);
});

test('contours close the global longitude seam, keep both saddle branches, and skip missing cells', () => {
  const grid = { latCenters: [10, -10], lonCenters: [-180, -60, 60], wrapLongitude: true, levels: [5] };
  const segments = buildContourSegments({ field: [[0, 0, 10], [0, 0, 10]] }, grid);
  assert.equal(segments.length, 2);
  assert.ok(segments.some(segment => segment.points.every(point => point[1] === 120)));
  const square = { latCenters: [10, -10], lonCenters: [0, 20], levels: [5] };
  assert.equal(buildContourSegments({ field: [[0, 10], [10, 0]] }, square).length, 2);
  assert.equal(buildContourSegments({ field: [[0, 10], [NaN, 0]] }, square).length, 0);
  assert.equal(buildContourSegments({ field: [[NaN, NaN], [NaN, NaN]] }, square).length, 0);
});

test('wind arrows have a latitude-independent angular length and skip calm or missing cells', () => {
  const coords = { latCenters: [0, 80], lonCenters: [0], scale: 0.2 };
  const vectors = buildWindVectors({ field: [[10], [10]] }, { field: [[0], [0]] }, coords);
  const distance = ([a,b], [c,d]) => Math.acos(Math.min(1, Math.sin(a*Math.PI/180)*Math.sin(c*Math.PI/180) + Math.cos(a*Math.PI/180)*Math.cos(c*Math.PI/180)*Math.cos((d-b)*Math.PI/180)));
  assert.ok(Math.abs(distance(vectors[0].start, vectors[0].end) - distance(vectors[1].start, vectors[1].end)) < 1e-9);
  assert.equal(buildWindVectors({ field: [[0], [NaN]] }, { field: [[0], [5]] }, coords).length, 0);
});

test('Earth sun uses the ISO date and UTC reference hour; Mars uses Ls and prime meridian solar time', () => {
  const june = earthSunDirection('2020-06-21', 12);
  const december = earthSunDirection('2020-12-21', 12);
  assert.ok(june.y > 0.39 && december.y < -0.39);
  assert.ok(june.x > 0.9);
  assert.ok(earthSunDirection('2020-06-21', 0).x < -0.9);
  assert.equal(earthSunDirection('invalid', 12), null);
  assert.ok(marsSunDirection(90, 12).y > 0.42);
  assert.ok(marsSunDirection(270, 12).y < -0.42);
  assert.ok(marsSunDirection(0, 0).x < -0.99);
});

test('default latitude weights use equal-step cell centers instead of polar samples', () => {
  assert.ok(Math.abs(fieldSpatialMean({ field: [[10], [0], [0]] }) - 2.5) < 1e-12);
  assert.equal(fieldSpatialMean({ field: [[3, NaN, 5]] }), 4);
  const anomaly = buildAnomalyField({ field: [[0, 1], [1, 1]] });
  assert.deepEqual(anomaly.colorRange, { min: -0.75, max: 0.75, centeredOnZero: true, scope: 'spatial-mean' });
});

test('contours reject inconsistent coordinate dimensions and deduplicate exact vertex hits', () => {
  const data = { field: [[0, 5], [5, 10]] };
  assert.deepEqual(buildContourSegments(data, { levels: [5], latCenters: [10], lonCenters: [0, 20] }), []);
  assert.deepEqual(buildContourSegments(data, { levels: [5], latCenters: [10, -10], lonCenters: [0, NaN] }), []);
  assert.deepEqual(buildContourSegments({ field: [[0, 5], [5]] }, {
    levels: [5], latCenters: [10, -10], lonCenters: [0, 20],
  }), []);
  assert.deepEqual(buildContourSegments(data, { levels: [5], latCenters: [10, -10], lonCenters: [0, 20] }), [
    { level: 5, points: [[10, 20], [-10, 0]] },
  ]);
});

test('saddle contours choose the dominant bilinear diagonal for either sign', () => {
  const geometry = { levels: [0], latCenters: [10, -10], lonCenters: [0, 20] };
  const records = buildContourSegments({ field: [[-4, 1], [1, -4]] }, geometry);
  // The negative diagonal connects through the centre, isolating the two positive corners.
  assert.deepEqual(records.map(({ points }) => points), [
    [[10, 16], [6, 20]],
    [[-10, 4], [-6, 0]],
  ]);
  const negated = buildContourSegments({ field: [[4, -1], [-1, 4]] }, geometry);
  assert.deepEqual(negated, records);
});

test('wind arrows preserve bearing, cross the pole, use the default scale and cap angular distance', () => {
  const pair = (u, v, latitude, longitude = 0, extra = {}) => buildWindVectors(
    { field: [[u]] }, { field: [[v]] }, { latCenters: [latitude], lonCenters: [longitude], ...extra },
  )[0];
  const distance = ({ start: [latA, lonA], end: [latB, lonB] }) => {
    const a = latA * Math.PI / 180;
    const b = latB * Math.PI / 180;
    const dlon = (lonB - lonA) * Math.PI / 180;
    const haversine = Math.sin((b - a) / 2) ** 2 + Math.cos(a) * Math.cos(b) * Math.sin(dlon / 2) ** 2;
    return 2 * Math.asin(Math.sqrt(Math.max(0, Math.min(1, haversine)))) * 180 / Math.PI;
  };
  assert.ok(Math.abs(distance(pair(3, 4, 45)) - 1.2) < 1e-9);
  assert.ok(Math.abs(distance(pair(100, 100, 45)) - 6) < 1e-9);
  const overPole = pair(0, 10, 89, 30);
  assert.ok(Math.abs(overPole.end[0] - 88.6) < 1e-9);
  assert.ok(Math.abs(overPole.end[1] + 150) < 1e-9);
  assert.equal(pair(0, 0, 90), undefined);
  assert.equal(pair(10, 0, NaN), undefined);
});

test('Sun vectors use westward UTC progression and the exact Mars obliquity relationship', () => {
  const earthNoon = earthSunDirection('2020-03-20', 12);
  const earthAfternoon = earthSunDirection('2020-03-20', 13);
  assert.ok(earthAfternoon.z < earthNoon.z);
  assert.ok(marsSunDirection(0, 13).z < 0);
  const ls = 45;
  assert.ok(Math.abs(marsSunDirection(ls, 12).y - Math.sin(25.19 * Math.PI / 180) * Math.sin(ls * Math.PI / 180)) < 1e-12);
  assert.deepEqual(buildTerminatorDirection({ planet: 'earth', date: '2020-03-20', hour: 13 }), earthAfternoon);
  assert.deepEqual(buildTerminatorDirection({ planet: 'mars', Ls: ls, referenceHour: 13 }), marsSunDirection(ls, 13));
  assert.equal(earthSunDirection('2021-02-29', 12), null);
  assert.equal(marsSunDirection(NaN, 12), null);
});


