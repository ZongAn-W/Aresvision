import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCoastlineSphereLines,
  buildRegionalCellGeometry,
  buildRegionalCellSampleValues,
  cartesianToGeographic,
  geographicToCartesian,
  mapRegionalRgb,
  nearestRegionalCell,
  updateRegionalCellColors,
} from './sphericalRegionalGrid.js';
import { localPointToLatLng } from './sphericalPicking.js';
import { clippedCellEdges, nearestIndex } from '../pages/DataOverviewPage/EarthOverview/earthMapGeometry.js';

const LAT = Array.from({ length: 36 }, (_, i) => -87.5 + i * 5);
const LON = Array.from({ length: 72 }, (_, i) => -177.5 + i * 5);
const LAT_BOUNDS = [-90, 90];
const LON_BOUNDS = [-180, 180];

const GEO = buildRegionalCellGeometry({
  latCenters: LAT,
  lonCenters: LON,
  latBounds: LAT_BOUNDS,
  lonBounds: LON_BOUNDS,
  wrapLongitude: false,
  radius: 1,
  subdivisions: [2, 3],
});

const LAT_EDGES = clippedCellEdges(LAT, LAT_BOUNDS);
const LON_EDGES = clippedCellEdges(LON, LON_BOUNDS);

function positionsOf(geometry) {
  const out = [];
  for (let i = 0; i < geometry.positions.length; i += 3) {
    out.push([geometry.positions[i], geometry.positions[i + 1], geometry.positions[i + 2]]);
  }
  return out;
}

function ramp(t) {
  const c = Math.round(Math.max(0, Math.min(1, t)) * 255);
  return [c, c, c];
}

function assertRadius(point, radius, tolerance = 1e-5, label = '') {
  const length = Math.hypot(point[0], point[1], point[2]);
  assert.ok(
    Math.abs(length - radius) <= tolerance,
    `${label} expected radius ${radius} but got ${length}`,
  );
}

test('v2 grid produces 2592 cells with a consistent non-empty index buffer', () => {
  assert.equal(GEO.cellCount, 2592);
  assert.equal(GEO.cellCount, 36 * 72);
  assert.equal(GEO.vertexCount, 2592 * 3 * 4);
  assert.equal(GEO.indices.length, 2592 * 12 * 3);
  assert.equal(GEO.triangleCount, GEO.indices.length / 3);
  assert.equal(GEO.triangleCount, 31104);
  assert.ok(GEO.indices.length > 0);
  assert.ok(GEO.positions instanceof Float32Array);
  assert.ok(GEO.indices instanceof Uint32Array);
  assert.ok(GEO.cellIndexByVertex instanceof Uint32Array);
  assert.equal(GEO.cellIndexByVertex.length, GEO.vertexCount);
  assert.equal(GEO.positions.length, GEO.vertexCount * 3);
  assert.equal(GEO.cellCenters.length, GEO.cellCount);

  // Every triangle index is in range and every vertex has a finite position.
  for (const index of GEO.indices) {
    assert.ok(index < GEO.vertexCount, `index ${index} out of range`);
  }
  for (const value of GEO.positions) {
    assert.ok(Number.isFinite(value), 'positions must never contain NaN or Infinity');
  }

  // cellIndexByVertex points at the owning cell so per-cell vertex colours work.
  const counts = new Uint32Array(GEO.cellCount);
  for (let vertex = 0; vertex < GEO.vertexCount; vertex += 1) {
    const cell = GEO.cellIndexByVertex[vertex];
    assert.ok(cell < GEO.cellCount);
    counts[cell] += 1;
  }
  for (let cell = 0; cell < GEO.cellCount; cell += 1) {
    assert.equal(counts[cell], 12, `cell ${cell} does not own exactly 12 vertices`);
  }

  // Every cell contributes exactly 12 triangles.
  const triangleOwners = new Uint32Array(GEO.cellCount);
  for (let v = 0; v < GEO.indices.length; v += 3) {
    const owner = GEO.cellIndexByVertex[GEO.indices[v]];
    triangleOwners[owner] += 1;
  }
  for (let cell = 0; cell < GEO.cellCount; cell += 1) {
    assert.equal(triangleOwners[cell], 12, `cell ${cell} does not own exactly 12 triangles`);
  }
});

test('every vertex stays inside the declared bounds and shares the picking convention', () => {
  const positions = positionsOf(GEO);
  const min = { lat: Infinity, lon: Infinity };
  const max = { lat: -Infinity, lon: -Infinity };

  for (const point of positions) {
    assert.ok(point.every(Number.isFinite), 'vertex position must be finite');
    const { lat, lon } = cartesianToGeographic(point[0], point[1], point[2]);
    assert.ok(Number.isFinite(lat) && Number.isFinite(lon));
    assert.ok(lat >= -90 && lat <= 90, `lat ${lat} outside [-90, 90]`);
    assert.ok(lon >= -180 && lon <= 180, `lon ${lon} outside [-180, 180]`);
    assert.ok(lat >= LAT_BOUNDS[0] - 1e-5 && lat <= LAT_BOUNDS[1] + 1e-5);
    assert.ok(lon >= LON_BOUNDS[0] - 1e-5 && lon <= LON_BOUNDS[1] + 1e-5);
    assertRadius(point, 1, 1e-5, 'grid vertex');
    min.lat = Math.min(min.lat, lat);
    min.lon = Math.min(min.lon, lon);
    max.lat = Math.max(max.lat, lat);
    max.lon = Math.max(max.lon, lon);
  }

  // The whole grid really does cover the globe rather than a sub-range.
  assert.ok(min.lat <= -87.5 && max.lat >= 87.5);
  assert.ok(min.lon <= -177.5 && max.lon >= 177.5);

  // One shared convention: the renderer's own picking maths agrees with ours.
  const samples = [
    positions[0],
    positions[Math.floor(positions.length / 2)],
    positions[positions.length - 1],
    geographicToCartesian(0, 0),
    geographicToCartesian(90, 0),
    geographicToCartesian(-90, 0),
    geographicToCartesian(87.5, 177.5),
    geographicToCartesian(-87.5, -177.5),
  ];
  for (const sample of samples) {
    const [x, y, z] = Array.isArray(sample)
      ? sample
      : [sample.x, sample.y, sample.z];
    const direct = cartesianToGeographic(x, y, z);
    const viaPicking = localPointToLatLng({ x, y, z });
    assert.ok(
      Math.abs(direct.lat - viaPicking.lat) <= 1e-3,
      `lat mismatch: ${direct.lat} vs ${viaPicking.lat}`,
    );
    let lonDelta = Math.abs(direct.lon - viaPicking.lng);
    lonDelta = Math.min(lonDelta, Math.abs(lonDelta - 360));
    assert.ok(lonDelta <= 1e-3, `lon mismatch: ${direct.lon} vs ${viaPicking.lng}`);
  }
});

test('geographicToCartesian round-trips through cartesianToGeographic', () => {
  const cases = [
    [87.5, 177.5],
    [87.5, -177.5],
    [-87.5, 177.5],
    [-87.5, -177.5],
    [0, 0],
    [90, 0],
    [-90, 0],
    [45, 90],
    [-45, -90],
    [12.5, -62.5],
  ];
  for (const [lat, lon] of cases) {
    const point = geographicToCartesian(lat, lon, 1);
    assertRadius([point.x, point.y, point.z], 1, 1e-12, `(${lat}, ${lon})`);
    const back = cartesianToGeographic(point.x, point.y, point.z);
    assert.ok(Math.abs(back.lat - lat) <= 1e-9, `lat ${lat} -> ${back.lat}`);
    const expectedLon = lat === 90 || lat === -90 ? 0 : lon;
    assert.ok(Math.abs(back.lon - expectedLon) <= 1e-9, `lon ${lon} -> ${back.lon}`);
  }

  // Poles are the exact sphere poles, never NaN, whatever the longitude is.
  for (const lon of [-180, -90, 0, 90, 180]) {
    const north = geographicToCartesian(90, lon, 1);
    assert.ok(Math.abs(north.y - 1) < 1e-15);
    assert.ok(Math.abs(north.x) < 1e-12 && Math.abs(north.z) < 1e-12);
    const south = geographicToCartesian(-90, lon, 1);
    assert.ok(Math.abs(south.y + 1) < 1e-15);
  }

  // A non-unit radius is honoured on both directions.
  const scaled = geographicToCartesian(0, 0, 2.5);
  assert.equal(scaled.x, 2.5);
  assert.deepEqual(cartesianToGeographic(scaled.x, scaled.y, scaled.z), { lat: 0, lon: 0 });
  // The cardinal directions match the renderer convention exactly.
  assert.deepEqual(cartesianToGeographic(1, 0, 0), { lat: 0, lon: 0 });
  assert.deepEqual(cartesianToGeographic(0, 0, 1), { lat: 0, lon: 90 });
  assert.deepEqual(cartesianToGeographic(0, 1, 0), { lat: 90, lon: 0 });
  assert.deepEqual(cartesianToGeographic(0, -1, 0), { lat: -90, lon: 0 });
  const atanSouth = cartesianToGeographic(-1, 0, -1e-9);
  assert.equal(atanSouth.lat, 0);
  assert.ok(Math.abs(atanSouth.lon + 180) <= 1e-6, `lon ${atanSouth.lon}`);
  assert.deepEqual(cartesianToGeographic(0, 0, 0), { lat: 0, lon: 0 });
});

test('triangle winding faces outward so the globe is not turned inside out', () => {
  for (let t = 0; t < GEO.indices.length; t += 3) {
    const [a, b, c] = [GEO.indices[t], GEO.indices[t + 1], GEO.indices[t + 2]]
      .map((v) => [GEO.positions[v * 3], GEO.positions[v * 3 + 1], GEO.positions[v * 3 + 2]]);
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0],
    ];
    const area = Math.hypot(n[0], n[1], n[2]);
    if (area < 1e-9) continue; // Degenerate pole caps are legal.
    const outward = n[0] * a[0] + n[1] * a[1] + n[2] * a[2];
    assert.ok(outward > 0, `triangle ${t / 3} is wound inwards`);
  }
});

test('the -180 / +180 seam is never bridged by a triangle', () => {
  const positions = positionsOf(GEO);
  const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

  // A triangle that bridged the seam would need an edge spanning most of the sphere:
  // the two meridians are the same physical point, so such an edge is ~2r long.
  // Every legitimate edge is a sub-quad edge: at most sqrt((2.5 deg)^2 + (1.67 deg)^2)
  // of arc, well under 0.07 at radius 1.
  let longestEdge = 0;
  for (let t = 0; t < GEO.indices.length; t += 3) {
    const [a, b, c] = [GEO.indices[t], GEO.indices[t + 1], GEO.indices[t + 2]]
      .map((v) => positions[v]);
    longestEdge = Math.max(longestEdge, distance(a, b), distance(b, c), distance(c, a));
  }
  assert.ok(
    longestEdge < 0.15,
    `longest triangle edge ${longestEdge} suggests an antimeridian bridge`,
  );

  // Longitude may only differ by one cell width inside a triangle. Each vertex is
  // unwrapped onto the meridian of the cell that owns it, because +180 and -180 are the
  // same meridian and float32 rounding can land a 177.5-degree vertex on either side.
  const longitudes = positions.map((point, vertex) => {
    const { lat, lon } = cartesianToGeographic(point[0], point[1], point[2]);
    const cellLongitude = GEO.cellCenters[GEO.cellIndexByVertex[vertex]].lon;
    const unwrapped = Math.abs(lon - cellLongitude) > 90
      ? lon + (lon < cellLongitude ? 360 : -360)
      : lon;
    // Near a pole a 5-degree cell spans a sliver where atan2(z, x) is dominated by
    // float32 noise, so longitude is only asserted away from the caps.
    return { lat, lon: unwrapped, polar: Math.abs(point[1]) > 0.99 };
  });
  for (let t = 0; t < GEO.indices.length; t += 3) {
    const vertices = [GEO.indices[t], GEO.indices[t + 1], GEO.indices[t + 2]];
    const nonPolar = vertices.filter((vertex) => !longitudes[vertex].polar);
    if (nonPolar.length < vertices.length) continue; // pole triangles: longitude degenerate
    const lons = nonPolar.map((vertex) => longitudes[vertex].lon);
    const spread = Math.max(...lons) - Math.min(...lons);
    assert.ok(spread <= 6, `triangle ${t / 3} spans ${spread} degrees of longitude`);
  }

  // The seam is duplicated: +180 and -180 are separate vertices at the same point.
  const seamColumn = [];
  for (let vertex = 0; vertex < GEO.vertexCount; vertex += 1) {
    if (Math.abs(GEO.positions[vertex * 3] + 1) <= 1e-6) seamColumn.push(vertex);
  }
  const equatorialSeam = seamColumn.filter(
    (vertex) => Math.abs(GEO.positions[vertex * 3 + 1]) < 0.99,
  );
  assert.ok(equatorialSeam.length > 0, 'the -180/+180 column must exist');
  assert.ok(GEO.positions[seamColumn[0] * 3] < 0, 'the seam sits at negative x');

  // No triangle jumps from the far west of the grid to the far east of it.
  for (let t = 0; t < GEO.indices.length; t += 3) {
    const lons = [GEO.indices[t], GEO.indices[t + 1], GEO.indices[t + 2]]
      .map((v) => longitudes[v])
      .map((entry) => entry.lon);
    const eastern = lons.filter((lon) => lon >= 170);
    const western = lons.filter((lon) => lon <= -170);
    if (eastern.length === 0 || western.length === 0) continue;
    const nearPole = [GEO.indices[t], GEO.indices[t + 1], GEO.indices[t + 2]]
      .some((v) => longitudes[v].polar);
    if (nearPole) continue;
    assert.fail(`triangle ${t / 3} bridges the antimeridian`);
  }
});

test('polar caps reach exactly +/-90 and close the sphere', () => {
  let maxY = -Infinity;
  let minY = Infinity;
  let topCapLat = -Infinity;
  let bottomCapLat = Infinity;

  for (let vertex = 0; vertex < GEO.vertexCount; vertex += 1) {
    const y = GEO.positions[vertex * 3 + 1];
    maxY = Math.max(maxY, y);
    minY = Math.min(minY, y);
    const { lat } = cartesianToGeographic(
      GEO.positions[vertex * 3],
      y,
      GEO.positions[vertex * 3 + 2],
    );
    topCapLat = Math.max(topCapLat, lat);
    bottomCapLat = Math.min(bottomCapLat, lat);
  }
  assert.ok(Math.abs(maxY - 1) <= 1e-6, `max y ${maxY} never reaches the north pole`);
  assert.ok(Math.abs(minY + 1) <= 1e-6, `min y ${minY} never reaches the south pole`);
  assert.ok(Math.abs(topCapLat - 90) <= 1e-6, `top cap latitude is ${topCapLat}`);
  assert.ok(Math.abs(bottomCapLat + 90) <= 1e-6, `bottom cap latitude is ${bottomCapLat}`);

  // The cap is filled, not just a set of collapsed points. Positions (not latitudes)
  // are inspected because a Float32 y of 1.0 back-converts to 89.99999766 degrees.
  const atNorthCap = (vertex) => Math.abs(GEO.positions[vertex * 3 + 1] - 1) <= 1e-9;
  const atSouthCap = (vertex) => Math.abs(GEO.positions[vertex * 3 + 1] + 1) <= 1e-9;
  let topCapVertices = 0;
  let bottomCapVertices = 0;
  for (let vertex = 0; vertex < GEO.vertexCount; vertex += 1) {
    if (atNorthCap(vertex)) {
      topCapVertices += 1;
      assert.ok(Math.abs(GEO.positions[vertex * 3]) < 1e-6, 'north cap must sit on the axis');
      assert.ok(Math.abs(GEO.positions[vertex * 3 + 2]) < 1e-6, 'north cap must sit on the axis');
    }
    if (atSouthCap(vertex)) {
      bottomCapVertices += 1;
      assert.ok(Math.abs(GEO.positions[vertex * 3]) < 1e-6, 'south cap must sit on the axis');
      assert.ok(Math.abs(GEO.positions[vertex * 3 + 2]) < 1e-6, 'south cap must sit on the axis');
    }
  }
  // Row 35 spans 87.5..90, so all four vertices of its 90-degree column collapse onto
  // the pole: 72 cells x 4 vertices = 288 degenerate-latitude vertices, none of them NaN.
  assert.equal(topCapVertices, 72 * 4, 'row 35 must reach the north pole');
  assert.equal(bottomCapVertices, 72 * 4, 'row 0 must reach the south pole');

  // Every triangle that touches a pole joins it to the neighbouring 87.5-degree ring,
  // so the cap is a fan of triangles rather than a hole.
  const ringY = Math.abs(Math.fround(Math.sin(87.5 * Math.PI / 180)));
  let capTriangles = 0;
  for (let t = 0; t < GEO.indices.length; t += 3) {
    const vertices = [GEO.indices[t], GEO.indices[t + 1], GEO.indices[t + 2]];
    const poleVertices = vertices.filter((v) => atNorthCap(v) || atSouthCap(v));
    if (poleVertices.length === 0) continue;
    // A sub-quad whose corner column sits on the pole has two vertices collapsed onto
    // it; the spec requires those degenerate-latitude vertices to exist, not to vanish.
    assert.ok(poleVertices.length <= 2, 'a cap triangle uses the pole at most twice');
    const ringVertex = vertices.find((v) => !(atNorthCap(v) || atSouthCap(v)));
    assert.ok(
      Math.abs(Math.abs(GEO.positions[ringVertex * 3 + 1]) - ringY) <= 1e-6,
      'the cap must join the pole to the 87.5-degree ring',
    );
    capTriangles += 1;
  }
  assert.ok(capTriangles > 0, 'the north cap must be triangulated');

  // clippedCellEdges prepends the coverage bound, so row 0 spans -90..-85 (its centre
  // is the declared -87.5) and row 35 spans 85..90: the caps land exactly on the poles.
  assert.equal(GEO.cellCenters[0].lat, -87.5);
  assert.equal(GEO.cellCenters[35 * 72].lat, 87.5);
  assert.equal(LAT_EDGES[0], -90);
  assert.equal(LAT_EDGES[36], 90);
  assert.equal(LON_EDGES[0], -180);
  assert.equal(LON_EDGES[72], 180);
  assert.equal(GEO.cellCenters[LAT.length - 1].lat, -87.5);
});

test('row 0 is south and row 35 is north, columns run west to east', () => {
  const northRow = 35 * 72;
  assert.ok(GEO.cellCenters[0].lat < 0);
  assert.ok(GEO.cellCenters[northRow].lat > 0);
  assert.equal(GEO.cellCenters[0].row, 0);
  assert.equal(GEO.cellCenters[0].col, 0);
  assert.equal(GEO.cellCenters[northRow].row, 35);
  assert.equal(GEO.cellCenters[35].row, 0);
  assert.equal(GEO.cellCenters[35].col, 35);

  let previous = -Infinity;
  for (let row = 0; row < 36; row += 1) {
    const center = GEO.cellCenters[row * 72];
    assert.ok(center.lat > previous, `row ${row} latitude did not increase`);
    previous = center.lat;
  }
  assert.equal(GEO.cellCenters[0].lon, -177.5);
  assert.equal(GEO.cellCenters[71].lon, 177.5);
  assert.equal(GEO.cellCenters[0].lat, (LAT_EDGES[0] + LAT_EDGES[1]) / 2);
  assert.equal(GEO.cellCenters[0].lon, (LON_EDGES[0] + LON_EDGES[1]) / 2);
  assert.equal(
    GEO.cellCenters[35 * 72 + 71].lat,
    (LAT_EDGES[35] + LAT_EDGES[36]) / 2,
  );
  assert.equal(
    GEO.cellCenters[35 * 72 + 71].lon,
    (LON_EDGES[71] + LON_EDGES[72]) / 2,
  );
});

test('key is stable for identical inputs and changes when coordinates or bounds change', () => {
  const rebuild = () => buildRegionalCellGeometry({
    latCenters: LAT,
    lonCenters: LON,
    latBounds: LAT_BOUNDS,
    lonBounds: LON_BOUNDS,
    wrapLongitude: false,
    radius: 1,
    subdivisions: [2, 3],
  });
  const other = rebuild();
  assert.equal(other.key, GEO.key);
  assert.equal(rebuild().key, GEO.key);
  assert.deepEqual(Array.from(other.positions.slice(0, 9)), Array.from(GEO.positions.slice(0, 9)));

  const signature = (options) => buildRegionalCellGeometry({
    latCenters: LAT,
    lonCenters: LON,
    latBounds: LAT_BOUNDS,
    lonBounds: LON_BOUNDS,
    wrapLongitude: false,
    radius: 1,
    subdivisions: [2, 3],
    ...options,
  }).key;

  // The same 36x72 shape with different declared bounds must not collide.
  assert.notEqual(signature({ lonBounds: [-180, 180.5] }), GEO.key);
  assert.notEqual(signature({ lonBounds: [-180.5, 180] }), GEO.key);
  assert.notEqual(signature({ latBounds: [-90.5, 90] }), GEO.key);
  assert.notEqual(signature({ radius: 1.5 }), GEO.key);
  assert.notEqual(signature({ wrapLongitude: true }), GEO.key);
  assert.notEqual(signature({ subdivisions: [3, 3] }), GEO.key);
  assert.notEqual(signature({ subdivisions: [2, 4] }), GEO.key);

  // Coordinates shifted without changing the clipped shape still change the key:
  // each shifted sub-axis stays strictly inside its (widened) bounds, so the set of
  // cell edges - and therefore the geometry - is identical while the values differ.
  const shiftedBounds = { lonBounds: [-181, 181], radius: 1, subdivisions: [2, 3] };
  const shiftedLat = buildRegionalCellGeometry({
    ...shiftedBounds,
    latCenters: LAT.slice(0, 35).map((value) => value + 0.001),
    lonCenters: LON.slice(0, 71),
  });
  const shiftedLon = buildRegionalCellGeometry({
    ...shiftedBounds,
    latCenters: LAT.slice(0, 35),
    lonCenters: LON.slice(0, 71).map((value) => value + 0.001),
  });
  const sameShape = buildRegionalCellGeometry({
    ...shiftedBounds,
    latCenters: LAT.slice(0, 35),
    lonCenters: LON.slice(0, 71),
  });
  assert.equal(shiftedLat.cellCount, sameShape.cellCount);
  assert.equal(shiftedLat.vertexCount, sameShape.vertexCount);
  assert.equal(shiftedLat.vertexCount, shiftedLon.vertexCount);
  assert.equal(shiftedLat.positions.length, sameShape.positions.length);
  assert.notEqual(shiftedLat.key, sameShape.key);
  assert.notEqual(shiftedLon.key, sameShape.key);
  assert.notEqual(shiftedLat.key, shiftedLon.key);

  // A different shape entirely must also differ.
  assert.notEqual(buildRegionalCellGeometry({
    latCenters: [-2.5, 2.5],
    lonCenters: [-2.5, 2.5],
    latBounds: [-5, 5],
    lonBounds: [-5, 5],
    subdivisions: [1, 1],
  }).key, GEO.key);
});

test('updateRegionalCellColors writes finite 0..1 floats and falls back to the midpoint', () => {
  const cellCount = GEO.cellCount;
  const rampField = new Float32Array(cellCount);
  for (let cell = 0; cell < cellCount; cell += 1) rampField[cell] = cell;

  const colors = updateRegionalCellColors({
    geometry: GEO,
    values: rampField,
    colorRange: { min: 0, max: cellCount - 1 },
    colorMapper: ramp,
  });
  assert.ok(colors instanceof Float32Array);
  assert.equal(colors.length, GEO.vertexCount * 3);
  for (const channel of colors) {
    assert.ok(Number.isFinite(channel), 'colours must never be NaN');
    assert.ok(channel >= 0 && channel <= 1, `channel ${channel} outside 0..1`);
  }

  // South-west cell (value 0) is black, north-east cell (value max) is white.
  const swVertex = 0;
  assert.deepEqual(
    [colors[swVertex * 3], colors[swVertex * 3 + 1], colors[swVertex * 3 + 2]],
    [0, 0, 0],
  );
  const neCell = cellCount - 1;
  const neVertex = GEO.cellIndexByVertex.findIndex((cell) => cell === neCell);
  assert.deepEqual(
    [colors[neVertex * 3], colors[neVertex * 3 + 1], colors[neVertex * 3 + 2]],
    [1, 1, 1],
  );

  // A constant field (min === max) paints the ramp midpoint, never a divide by zero.
  const midpoint = updateRegionalCellColors({
    geometry: GEO,
    values: new Float32Array(cellCount).fill(7),
    colorRange: { min: 7, max: 7 },
    colorMapper: ramp,
  });
  assert.equal(midpoint.length, GEO.vertexCount * 3);
  const midpointChannel = Math.fround(Math.round(0.5 * 255) / 255);
  for (let i = 0; i < midpoint.length; i += 1) {
    assert.equal(midpoint[i], midpointChannel, `midpoint channel ${midpoint[i]}`);
  }
  assert.ok(
    Math.abs(midpointChannel - 0.5) < 0.003,
    'the midpoint really is half way (128/255 in 8-bit)',
  );

  // A NaN value and a non-finite range also fall back to the midpoint.
  const withNaN = new Float32Array(cellCount).fill(3);
  withNaN[0] = Number.NaN;
  withNaN[1] = Number.POSITIVE_INFINITY;
  const nanColors = updateRegionalCellColors({
    geometry: GEO,
    values: withNaN,
    colorRange: { min: 0, max: 6 },
    colorMapper: ramp,
  });
  assert.equal(nanColors.length, GEO.vertexCount * 3);
  for (const channel of nanColors) assert.ok(Number.isFinite(channel));
  const cellZeroVertex = 0;
  assert.equal(nanColors[cellZeroVertex * 3], midpointChannel);

  const brokenRange = updateRegionalCellColors({
    geometry: GEO,
    values: withNaN,
    colorRange: { min: Number.NaN, max: 6 },
    colorMapper: ramp,
  });
  for (const channel of brokenRange) assert.ok(Number.isFinite(channel));

  // A mapper that misbehaves still cannot leak NaN into the buffer.
  const hostile = updateRegionalCellColors({
    geometry: GEO,
    values: rampField,
    colorRange: { min: 0, max: cellCount - 1 },
    colorMapper: () => [Number.NaN, 999, -5],
  });
  for (const channel of hostile) assert.ok(Number.isFinite(channel));

  assert.throws(() => updateRegionalCellColors({
    geometry: GEO,
    values: new Float32Array(cellCount - 1),
    colorRange: { min: 0, max: 1 },
    colorMapper: ramp,
  }), /values must have length 2592/);
  assert.throws(() => updateRegionalCellColors({
    geometry: GEO,
    values: rampField,
    colorRange: { min: 0, max: 1 },
    colorMapper: null,
  }), /colorMapper must be a function/);
});

test('buildRegionalCellSampleValues flattens a rectangular field and rejects bad input', () => {
  const field = [
    [1, 2, 3],
    [4, 5, 6],
  ];
  const values = buildRegionalCellSampleValues(field, 6);
  assert.ok(values instanceof Float32Array);
  assert.deepEqual(Array.from(values), [1, 2, 3, 4, 5, 6]);

  const regional = buildRegionalCellSampleValues(
    Array.from({ length: 36 }, (_, row) => Array.from({ length: 72 }, (_, col) => row * 72 + col)),
    GEO.cellCount,
  );
  assert.equal(regional.length, GEO.cellCount);
  assert.equal(regional[GEO.cellCount - 1], GEO.cellCount - 1);

  assert.throws(() => buildRegionalCellSampleValues([[1, 2], [3]], 3), /rectangular/);
  assert.throws(() => buildRegionalCellSampleValues([[1, 2]], 3), /does not match cellCount/);
  assert.throws(() => buildRegionalCellSampleValues([], 3), /non-empty/);
  assert.throws(() => buildRegionalCellSampleValues([[1, Number.NaN]], 2), /not a finite number/);
  assert.throws(
    () => buildRegionalCellSampleValues([[1, Number.POSITIVE_INFINITY]], 2),
    /not a finite number/,
  );
  assert.throws(() => buildRegionalCellSampleValues([[1, 2]], 0), /positive integer/);
});

test('nearestRegionalCell never wraps longitude and matches the 2D nearestIndex', () => {
  // Exact cell centres resolve to their own cell.
  assert.deepEqual(nearestRegionalCell({
    latCenters: LAT,
    lonCenters: LON,
    latBounds: LAT_BOUNDS,
    lonBounds: LON_BOUNDS,
    lat: LAT[0],
    lon: LON[0],
  }), { row: 0, col: 0, lat: -87.5, lon: -177.5 });
  assert.deepEqual(nearestRegionalCell({
    latCenters: LAT,
    lonCenters: LON,
    latBounds: LAT_BOUNDS,
    lonBounds: LON_BOUNDS,
    lat: LAT[35],
    lon: LON[71],
  }), { row: 35, col: 71, lat: 87.5, lon: 177.5 });

  // An interior cell centre too.
  const mid = nearestRegionalCell({
    latCenters: LAT,
    lonCenters: LON,
    latBounds: LAT_BOUNDS,
    lonBounds: LON_BOUNDS,
    lat: LAT[18],
    lon: LON[36],
  });
  assert.deepEqual(mid, { row: 18, col: 36, lat: 2.5, lon: 2.5 });

  // Ties go to the smaller index, matching nearestIndex().
  assert.equal(nearestRegionalCell({
    latCenters: LAT,
    lonCenters: LON,
    latBounds: LAT_BOUNDS,
    lonBounds: LON_BOUNDS,
    lat: -85,
    lon: -175,
  }).col, 0);
  assert.equal(nearestIndex(LON, -175, LON_BOUNDS), 0);

  const outOfBounds = [
    [91, 0],
    [-91, 0],
    [0, 181],
    [0, -181],
    [90.0001, 0],
    [Number.NaN, 0],
    [0, Number.NaN],
  ];
  for (const [lat, lon] of outOfBounds) {
    assert.equal(
      nearestRegionalCell({
        latCenters: LAT,
        lonCenters: LON,
        latBounds: LAT_BOUNDS,
        lonBounds: LON_BOUNDS,
        lat,
        lon,
      }),
      null,
      `(${lat}, ${lon}) must be outside the coverage`,
    );
  }

  const probePoints = [
    [90, 0],
    [-90, 0],
    [0, 180],
    [0, -180],
    [0, 179.9],
    [0, -179.9],
    [45, 90],
    [-45, -90],
    [12.5, -62.5],
    [87.4, 177.4],
    [-87.4, -177.4],
    [37.5, 100],
  ];
  for (const [lat, lon] of probePoints) {
    const result = nearestRegionalCell({
      latCenters: LAT,
      lonCenters: LON,
      latBounds: LAT_BOUNDS,
      lonBounds: LON_BOUNDS,
      lat,
      lon,
    });
    assert.notEqual(result, null, `(${lat}, ${lon}) should be inside the coverage`);
    assert.equal(result.row, nearestIndex(LAT, lat, LAT_BOUNDS), `row for lat ${lat}`);
    assert.equal(result.col, nearestIndex(LON, lon, LON_BOUNDS), `col for lon ${lon}`);
    assert.equal(result.lat, LAT[result.row]);
    assert.equal(result.lon, LON[result.col]);
  }

  // The poles land on the outermost rows without any wrapping.
  assert.equal(nearestRegionalCell({
    latCenters: LAT,
    lonCenters: LON,
    latBounds: LAT_BOUNDS,
    lonBounds: LON_BOUNDS,
    lat: 90,
    lon: 180,
  }).col, 71);
  assert.equal(nearestRegionalCell({
    latCenters: LAT,
    lonCenters: LON,
    latBounds: LAT_BOUNDS,
    lonBounds: LON_BOUNDS,
    lat: -90,
    lon: -180,
  }).col, 0);

  assert.equal(nearestRegionalCell({ latCenters: [], lonCenters: LON, lat: 0, lon: 0 }), null);
});

test('buildCoastlineSphereLines splits the antimeridian, skips bad points and keeps the radius', () => {
  const geojson = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [[179, 10], [178, 10], [-179, 11], [-178, 11]],
        },
      },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] } },
      { type: 'Feature', geometry: null },
      { type: 'Feature' },
      {
        type: 'Feature',
        geometry: {
          type: 'MultiLineString',
          coordinates: [
            [[0, 0], [1, 0]],
            [[5, 5], [6, 6]],
          ],
        },
      },
    ],
  };

  const segments = buildCoastlineSphereLines(geojson, { radius: 1 });
  assert.equal(segments.length, 4);
  for (const segment of segments) {
    assert.ok(segment instanceof Float32Array);
    assert.equal(segment.length % 3, 0);
    for (let i = 0; i < segment.length; i += 3) {
      assertRadius([segment[i], segment[i + 1], segment[i + 2]], 1, 1e-6, 'coastline point');
    }
  }

  const [first, second] = segments;
  assert.equal(first.length, 6);
  assert.equal(second.length, 6);
  // The two fragments land on opposite sides of the sphere instead of crossing it:
  // 179 degrees sits just west of the +x axis (x < 0, z > 0), -179 just east of it.
  assert.ok(first[0] < 0, 'the 179-degree point sits at negative x');
  assert.ok(second[0] < 0, 'the -179-degree point sits at negative x');
  assert.ok(first[2] > 0, 'the 179-degree point sits at positive z');
  assert.ok(second[2] < 0, 'the -179-degree point sits at negative z');
  assert.ok(Math.abs(first[1] - Math.sin(10 * Math.PI / 180)) < 1e-6);
  assert.ok(Math.abs(second[1] - Math.sin(11 * Math.PI / 180)) < 1e-6);

  // Non-finite coordinates are skipped, single leftover points keep their own segment.
  const withBadPoints = buildCoastlineSphereLines({
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          [0, 0],
          [Number.NaN, 10],
          [Number.POSITIVE_INFINITY, 10],
          [10, Number.NaN],
          ['20', '10'],
          [30, 0],
          null,
          'nope',
        ],
      },
    }],
  }, { radius: 2 });
  assert.equal(withBadPoints.length, 1);
  assert.equal(withBadPoints[0].length, 9);
  assertRadius(
    [withBadPoints[0][0], withBadPoints[0][1], withBadPoints[0][2]],
    2,
    1e-6,
    'first valid point',
  );
  assertRadius(
    [withBadPoints[0][3], withBadPoints[0][4], withBadPoints[0][5]],
    2,
    1e-6,
    'numeric string point',
  );

  // The default gap is 180 degrees: a 100-degree jump is not split.
  const gentle = buildCoastlineSphereLines({
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [[0, 0], [100, 0]] },
    }],
  });
  assert.equal(gentle.length, 1);
  assert.equal(gentle[0].length, 6);

  // Nothing to build from never throws.
  assert.deepEqual(buildCoastlineSphereLines(null), []);
  assert.deepEqual(buildCoastlineSphereLines({ features: [] }), []);
});

test('the region grid works for a non-global rectangular grid too', () => {
  const latCenters = Array.from({ length: 4 }, (_, i) => -30 + i * 20);
  const lonCenters = Array.from({ length: 8 }, (_, i) => -70 + i * 20);
  const geometry = buildRegionalCellGeometry({
    latCenters,
    lonCenters,
    latBounds: [-40, 50],
    lonBounds: [-80, 90],
    subdivisions: [1, 1],
    radius: 0.5,
  });
  assert.equal(geometry.cellCount, 32);
  assert.equal(geometry.vertexCount, 32 * 4);
  assert.equal(geometry.triangleCount, 32 * 2);
  assert.equal(geometry.indices.length, geometry.triangleCount * 3);
  assert.equal(geometry.cellCenters[0].lat, (clippedCellEdges(latCenters, [-40, 50])[0]
    + clippedCellEdges(latCenters, [-40, 50])[1]) / 2);
  for (let i = 0; i < geometry.positions.length; i += 3) {
    assertRadius(
      [geometry.positions[i], geometry.positions[i + 1], geometry.positions[i + 2]],
      0.5,
      1e-6,
      'regional vertex',
    );
    const { lat, lon } = cartesianToGeographic(
      geometry.positions[i],
      geometry.positions[i + 1],
      geometry.positions[i + 2],
    );
    // Float32 positions carry ~1e-7 relative error, hence the looser bound here.
    assert.ok(lat >= -40 - 1e-5 && lat <= 50 + 1e-5);
    assert.ok(lon >= -80 - 1e-5 && lon <= 90 + 1e-5);
  }
  assert.throws(() => buildRegionalCellGeometry({
    latCenters,
    lonCenters,
    latBounds: [-40, 50],
    lonBounds: [-80, 90],
    subdivisions: [0, 1],
  }), /positive integer/);
});

test('mapRegionalRgb returns 0..255 so real field colours are not near-black', () => {
  const rgb = mapRegionalRgb('inferno', 'inferno', 0.5);
  assert.equal(rgb.length, 3);
  // The ramp already works in 0..255. Dividing it by 255 again (the Points
  // convention used by mapParticleColor) produced channels around 0.003 and an
  // apparently empty globe, so the range itself is asserted here.
  assert.ok(Math.max(...rgb) > 40, `expected a 0..255 ramp, got ${JSON.stringify(rgb)}`);
  assert.equal(mapRegionalRgb('rdbu', 'inferno', 0).join(','), '5,48,97');

  const values = buildRegionalCellSampleValues(
    LAT.map((_, row) => LON.map((__, col) => 200 + row + col)),
    GEO.cellCount,
  );
  const colors = updateRegionalCellColors({
    geometry: GEO,
    values,
    colorRange: { min: 200, max: 271 },
    colorMapper: (t) => mapRegionalRgb('inferno', 'inferno', t),
  });
  const maxChannel = Math.max(...colors);
  const meanChannel = colors.reduce((sum, value) => sum + value, 0) / colors.length;
  assert.ok(maxChannel > 0.5, `expected bright cells, got max ${maxChannel}`);
  assert.ok(meanChannel > 0.1, `expected visible cells, got mean ${meanChannel}`);
  assert.ok(colors.every((value) => Number.isFinite(value) && value >= 0 && value <= 1));
});