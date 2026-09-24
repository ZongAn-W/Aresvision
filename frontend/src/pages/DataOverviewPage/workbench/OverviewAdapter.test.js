import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CAPABILITY_REASONS,
  CARD_STATUS,
  MODE_IDS,
  cardError,
  cardLoading,
  cardReady,
  cardUnsupported,
  createCardState,
  dateInSelectedYear,
  findVariable,
  formatTimeValue,
  geometryKey,
  isCardRenderable,
  isGeometryUsable,
  isMarsTimeModel,
  isIsoTimeModel,
  isValidIsoDate,
  nearestGeometryCell,
  nextPlaybackValue,
  normalizeSelection,
  playbackFinished,
  pointInsideGeometry,
  requestIdentity,
  resolveModeCards,
  sceneIdentity,
  shouldRequestCard,
  timeValues,
  validateOverviewAdapter,
  variableIdentity,
  yearOfIsoDate,
} from './OverviewAdapter.js';

const EARTH_GEOMETRY = {
  planet: 'earth',
  latCenters: [-87.5, -82.5, 0, 82.5, 87.5],
  lonCenters: [-177.5, 0, 177.5],
  latBounds: [-90, 90],
  lonBounds: [-180, 180],
  wrapLongitude: true,
};

function minimalAdapter(overrides = {}) {
  return {
    planet: 'earth',
    sourceId: 'earth_merra2_daily_v2',
    resolve: async () => ({ status: 'ready' }),
    loadField: async () => ({}),
    loadPointSeries: async () => ({}),
    loadRegionalSeries: async () => ({}),
    validateField: () => true,
    validatePointSeries: () => true,
    validateRegionalSeries: () => true,
    ...overrides,
  };
}

test('card states cover loading / ready / unsupported / error and never expose stale data', () => {
  assert.equal(createCardState(CARD_STATUS.IDLE).status, 'idle');
  assert.equal(cardLoading(cardReady({ a: 1 })).data, null, 'loading must drop the previous payload');
  assert.equal(isCardRenderable(cardReady({ a: 1 })), true);
  assert.equal(isCardRenderable(cardLoading()), false);
  assert.equal(isCardRenderable(cardUnsupported('x')), false);
  assert.equal(isCardRenderable(cardError('dataset_unavailable')), false);
  assert.throws(() => createCardState('something_else'), /Unknown card status/);
  assert.throws(() => cardUnsupported(''), /stable reason code/);
  assert.equal(cardError().errorCode, 'invalid_request');
});

test('unsupported cards are never requested even when the capability flag is missing', () => {
  const cards = resolveModeCards({
    cards: {
      temporal: [
        { key: 'seasonal', title: { zh: '季节结构', en: 'Seasonal' } },
        {
          key: 'diurnal',
          title: { zh: '昼夜变化', en: 'Diurnal' },
          status: CARD_STATUS.UNSUPPORTED,
          reason: CAPABILITY_REASONS.DIURNAL_DAILY_MEAN,
          capability: 'diurnal',
        },
      ],
    },
  }, 'temporal');

  assert.equal(cards.length, 2);
  const [seasonal, diurnal] = cards;
  assert.equal(shouldRequestCard(seasonal, { diurnal: false, researchSuite: true }), true);
  assert.equal(shouldRequestCard(diurnal, { diurnal: false }), false);
  assert.equal(diurnal.reason, 'daily_data_has_no_diurnal_samples');
  assert.equal(shouldRequestCard({ key: 'x', capability: 'polar' }, { polar: false }), false);
  assert.equal(shouldRequestCard({ key: 'x', capability: 'polar' }, { polar: true }), true);
});

test('mode card resolution ignores malformed catalogs instead of throwing', () => {
  assert.deepEqual(resolveModeCards(null, 'temporal'), []);
  assert.deepEqual(resolveModeCards({ cards: { temporal: 'nope' } }, 'temporal'), []);
  const cards = resolveModeCards({ cards: { temporal: [{ key: '' }, { key: 'ok' }] } }, 'temporal');
  assert.deepEqual(cards.map((card) => card.key), ['ok']);
  assert.deepEqual(MODE_IDS, ['temporal', 'drivers', 'dynamics']);
});

test('adapter validation rejects incomplete adapters', () => {
  assert.equal(validateOverviewAdapter(minimalAdapter()).ok, true);
  const bad = validateOverviewAdapter(minimalAdapter({ planet: 'venus', sourceId: '', loadField: null }));
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((error) => error.includes('planet')));
  assert.ok(bad.errors.some((error) => error.includes('sourceId')));
  assert.ok(bad.errors.some((error) => error.includes('loadField')));
  assert.equal(validateOverviewAdapter(null).ok, false);
});

test('scene identity separates planets, sources and published versions', () => {
  const base = { planet: 'earth', sourceId: 'earth_merra2_daily_v2', sourceFingerprint: 'a'.repeat(64) };
  assert.equal(sceneIdentity(base), `earth|earth_merra2_daily_v2|${'a'.repeat(64)}`);
  assert.notEqual(sceneIdentity(base), sceneIdentity({ ...base, planet: 'mars' }));
  assert.notEqual(sceneIdentity(base), sceneIdentity({ ...base, sourceFingerprint: 'b'.repeat(64) }));
  assert.equal(sceneIdentity({ ...base, planet: 'venus' }), null);
  assert.equal(sceneIdentity({ ...base, sourceFingerprint: null }), null);
});

test('request identity is stable and distinguishes every request parameter', () => {
  assert.equal(requestIdentity(['earth', 'TO3', '2020-01-01']), 'earth|TO3|2020-01-01');
  assert.notEqual(
    requestIdentity(['earth', 'TO3', '2020-01-01']),
    requestIdentity(['earth', 'T2M', '2020-01-01']),
  );
  assert.equal(requestIdentity([null, undefined]), '-|-');
});

test('time model isolation keeps Earth on ISO dates and Mars on Ls', () => {
  const earth = { kind: 'iso-date', values: ['2020-01-01', 'nope', '2021-12-31'] };
  const mars = { kind: 'mars-year-ls', values: [0, 90.5, 'x'] };

  assert.equal(isIsoTimeModel(earth), true);
  assert.equal(isMarsTimeModel(earth), false);
  assert.equal(isMarsTimeModel(mars), true);
  assert.equal(isIsoTimeModel(mars), false);

  assert.deepEqual(timeValues(earth), ['2020-01-01', '2021-12-31']);
  assert.deepEqual(timeValues(mars), [0, 90.5]);
  // Earth must never be formatted as an Ls value, and vice versa.
  assert.equal(formatTimeValue(earth, '2020-02-29'), '2020-02-29');
  assert.equal(formatTimeValue(mars, 0).startsWith('Ls'), true);
  assert.equal(formatTimeValue(earth, 120), '--');
});

test('ISO date helpers reject impossible dates and never fall through to March 1', () => {
  assert.equal(isValidIsoDate('2020-02-29'), true);
  assert.equal(isValidIsoDate('2021-02-29'), false);
  assert.equal(isValidIsoDate('2021-2-9'), false);
  assert.equal(isValidIsoDate('not-a-date'), false);

  assert.equal(dateInSelectedYear('2020-02-29', 2021), '2021-02-28');
  assert.equal(dateInSelectedYear('2021-02-28', 2020), '2020-02-28');
  assert.equal(dateInSelectedYear('2020-12-31', 2021), '2021-12-31');
  assert.equal(dateInSelectedYear('bad', 2021), null);
  assert.equal(yearOfIsoDate('2021-12-31'), 2021);
  assert.equal(yearOfIsoDate('31-12-2021'), null);
});

test('geometry identity changes when coordinates change even at equal shape', () => {
  const shifted = { ...EARTH_GEOMETRY, latCenters: [-87.5, -82.5, 0, 82.5, 89.5] };
  assert.notEqual(geometryKey(EARTH_GEOMETRY), geometryKey(shifted));
  assert.equal(geometryKey(EARTH_GEOMETRY), geometryKey({ ...EARTH_GEOMETRY }));
  assert.notEqual(
    geometryKey(EARTH_GEOMETRY),
    geometryKey({ ...EARTH_GEOMETRY, wrapLongitude: false }),
  );
  assert.notEqual(
    geometryKey(EARTH_GEOMETRY),
    geometryKey({ ...EARTH_GEOMETRY, lonBounds: [-120, 120] }),
  );
  assert.equal(geometryKey({ ...EARTH_GEOMETRY, planet: 'mars' }).startsWith('mars|'), true);
  assert.equal(isGeometryUsable(EARTH_GEOMETRY), true);
  assert.equal(isGeometryUsable({ latCenters: [0], lonCenters: [0] }), false);
});

test('nearest cell never wraps longitude and never clamps outside coverage', () => {
  const exact = nearestGeometryCell(EARTH_GEOMETRY, 0, 0);
  assert.deepEqual(exact, { row: 2, col: 1, lat: 0, lon: 0 });

  // Longitude 179.9 is inside the global bounds and closer to +177.5 than to 0,
  // but 181 must be rejected instead of wrapping to -179.
  assert.equal(nearestGeometryCell(EARTH_GEOMETRY, 0, 179.9).lon, 177.5);
  assert.equal(nearestGeometryCell(EARTH_GEOMETRY, 0, 181), null);
  assert.equal(nearestGeometryCell(EARTH_GEOMETRY, 0, -181), null);
  assert.equal(nearestGeometryCell(EARTH_GEOMETRY, 91, 0), null);
  assert.equal(nearestGeometryCell(EARTH_GEOMETRY, -91, 0), null);
  // Poles are inside the global coverage and resolve to the real grid rows.
  assert.equal(nearestGeometryCell(EARTH_GEOMETRY, 90, 0).lat, 87.5);
  assert.equal(nearestGeometryCell(EARTH_GEOMETRY, -90, 0).lat, -87.5);
  assert.equal(pointInsideGeometry(EARTH_GEOMETRY, 90, 180), true);
  assert.equal(pointInsideGeometry(EARTH_GEOMETRY, 90.5, 180), false);
});

test('variable identity carries the unit so a variable switch cannot reuse values', () => {
  const adapter = {
    sourceId: 'earth_merra2_daily_v2',
    variables: [
      { id: 'TO3', unit: 'DU' },
      { id: 'T2M', unit: 'K' },
    ],
  };
  assert.equal(findVariable(adapter, 'TO3').unit, 'DU');
  assert.equal(findVariable(adapter, 'missing'), null);
  assert.notEqual(variableIdentity(adapter, 'TO3'), variableIdentity(adapter, 'T2M'));
  assert.match(variableIdentity(adapter, 'TO3'), /DU$/);
});

test('selection defaults never mix a Mars variable or an out-of-range date into Earth', () => {
  const adapter = {
    variables: [{ id: 'TO3', unit: 'DU' }, { id: 'T2M', unit: 'K' }],
    time: { kind: 'iso-date', values: ['2020-01-01', '2020-01-02'] },
    defaults: { variable: 'TO3', value: '2020-01-01', mode: 'temporal' },
  };

  const fresh = normalizeSelection(adapter, null);
  assert.equal(fresh.variable, 'TO3');
  assert.equal(fresh.value, '2020-01-01');
  assert.equal(fresh.mode, 'temporal');

  // A stale Mars selection (Ls 120, variable o3col) must not survive.
  const stale = normalizeSelection(adapter, { variable: 'o3col', value: 120, mode: 'nonsense' });
  assert.equal(stale.variable, 'TO3');
  assert.equal(stale.value, '2020-01-01');
  assert.equal(stale.mode, 'temporal');

  const kept = normalizeSelection(adapter, { variable: 'T2M', value: '2020-01-02', mode: 'drivers' });
  assert.equal(kept.variable, 'T2M');
  assert.equal(kept.value, '2020-01-02');
  assert.equal(kept.mode, 'drivers');
});

test('playback advances only after the requested frame is displayed and stops at the last frame', () => {
  const time = { kind: 'iso-date', values: ['2020-02-28', '2020-02-29', '2020-03-01'] };
  const values = timeValues(time);

  // The field for the requested date is still loading: never skip a day.
  assert.equal(nextPlaybackValue({
    time, values, displayedValue: '2020-02-28', requestedValue: '2020-02-29', playing: true, ready: true,
  }), null);

  assert.equal(nextPlaybackValue({
    time, values, displayedValue: '2020-02-28', requestedValue: '2020-02-28', playing: true, ready: true,
  }), '2020-02-29');

  // Leap day is preserved and the last frame stops playback.
  assert.equal(nextPlaybackValue({
    time, values, displayedValue: '2020-02-29', requestedValue: '2020-02-29', playing: true, ready: true,
  }), '2020-03-01');
  assert.equal(nextPlaybackValue({
    time, values, displayedValue: '2020-03-01', requestedValue: '2020-03-01', playing: true, ready: true,
  }), null);
  assert.equal(playbackFinished({ values, displayedValue: '2020-03-01' }), true);
  assert.equal(playbackFinished({ values, displayedValue: '2020-02-29' }), false);

  // Paused or not ready never advances.
  assert.equal(nextPlaybackValue({
    time, values, displayedValue: '2020-02-28', requestedValue: '2020-02-28', playing: false, ready: true,
  }), null);
  assert.equal(nextPlaybackValue({
    time, values, displayedValue: '2020-02-28', requestedValue: '2020-02-28', playing: true, ready: false,
  }), null);
});

test('seam, pole and ordinary picks resolve to the same nearest cell as the 2D map', () => {
  const geometry = {
    planet: 'earth',
    latCenters: [-87.5, 0, 87.5],
    lonCenters: [-177.5, -2.5, 2.5, 177.5],
    latBounds: [-90, 90],
    lonBounds: [-180, 180],
    wrapLongitude: true,
  };
  // 经度接缝：+179.9 属于最后一列，-179.9 属于第一列，二者不互相环绕。
  assert.deepEqual(nearestGeometryCell(geometry, 0, 179.9), { row: 1, col: 3, lat: 0, lon: 177.5 });
  assert.deepEqual(nearestGeometryCell(geometry, 0, -179.9), { row: 1, col: 0, lat: 0, lon: -177.5 });
  // 两极：±90 落在最外行，不夹到赤道。
  assert.equal(nearestGeometryCell(geometry, 90, 0).row, 2);
  assert.equal(nearestGeometryCell(geometry, -90, 0).row, 0);
  // 普通点：取最近单元中心。
  assert.deepEqual(nearestGeometryCell(geometry, 1.2, -1.1), { row: 1, col: 1, lat: 0, lon: -2.5 });
});
