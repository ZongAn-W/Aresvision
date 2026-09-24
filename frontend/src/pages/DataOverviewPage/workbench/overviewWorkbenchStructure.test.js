import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const controllerSource = readFileSync(new URL('./useOverviewController.js', import.meta.url), 'utf8');
const shellSource = readFileSync(new URL('./OverviewShell.jsx', import.meta.url), 'utf8');
const cardSource = readFileSync(new URL('./OverviewCard.jsx', import.meta.url), 'utf8');
const sceneSource = readFileSync(new URL('./OverviewScene.jsx', import.meta.url), 'utf8');
const pageSource = readFileSync(new URL('../../DataOverviewPage.jsx', import.meta.url), 'utf8');
const earthSceneSource = readFileSync(new URL('../EarthOverview/EarthWorkbenchScene.jsx', import.meta.url), 'utf8');
const earthAdapterSource = readFileSync(new URL('./earthOverviewAdapter.js', import.meta.url), 'utf8');
const panelSource = readFileSync(new URL('./OverviewAnalysisPanel.jsx', import.meta.url), 'utf8');

test('planet switch cancels requests, clears the old scene and resets camera and geometry', () => {
  // 1 + 2: cancel every in-flight request and clear field / series / playback / point.
  assert.match(controllerSource, /coordinator\.cancelAll\(\)/);
  assert.match(controllerSource, /setField\(null\)/);
  assert.match(controllerSource, /setRegionalSeries\(null\)/);
  assert.match(controllerSource, /setPointSeries\(null\)/);
  assert.match(controllerSource, /setPlaying\(false\)/);
  assert.match(controllerSource, /setOutOfCoverage\(null\)/);
  // 3: reset to the new planet's defaults.
  assert.match(controllerSource, /normalizeSelection\(/);
  // 4: reset camera and geometry identity.
  assert.match(controllerSource, /setCameraEpoch\(\(value\) => value \+ 1\)/);
  assert.match(controllerSource, /geometryKey\(geometry\)/);
  // The reset effect is keyed on the planet/source identity.
  assert.match(controllerSource, /\}, \[adapter\.planet, adapter\.sourceId\]\);/);
  // 5: stale responses are rejected before any state write.
  assert.match(controllerSource, /epoch !== epochRef\.current/);
  assert.match(controllerSource, /coordinator\.settle\(request\)/);
});

test('the shared shell provides three columns, drag handles and a compact fallback', () => {
  assert.match(shellSource, /overview-shell__sidebar/);
  assert.match(shellSource, /overview-shell__analysis/);
  assert.match(shellSource, /overview-shell__scene/);
  assert.match(shellSource, /role="separator"/);
  assert.match(shellSource, /overview-resizer--left/);
  assert.match(shellSource, /overview-resizer--right/);
  assert.match(shellSource, /MIN_SCENE_WIDTH/);
  assert.match(shellSource, /shouldUseCompactOverview/);
  assert.doesNotMatch(shellSource, /panelMode === 'external'/);
  assert.match(shellSource, /overviewVisualContract/);
});

test('the shared card renders every unified state explicitly', () => {
  for (const status of ['unsupported', 'error', 'loading', 'idle']) {
    assert.match(cardSource, new RegExp(`CARD_STATUS\\.${status.toUpperCase()}`));
  }
  assert.match(cardSource, /daily_data_has_no_diurnal_samples/);
  assert.match(cardSource, /aria-expanded/);
});

test('the shared scene receives planet, field, geometry, selection and lighting explicitly', () => {
  assert.match(sceneSource, /planet="earth"/);
  assert.match(sceneSource, /field=\{showField \? field : null\}/);
  assert.match(sceneSource, /geometry=\{geometry\}/);
  assert.match(sceneSource, /selection=\{selection\}/);
  assert.match(sceneSource, /lighting=\{lighting\}/);
  assert.match(sceneSource, /onGlobeClick=\{onGlobeClick\}/);
  assert.match(sceneSource, /WebGL/);
});

test('Earth goes through the Earth adapter and never fetches Mars analysis paths', () => {
  assert.match(earthAdapterSource, /createEarthResearchClient/);
  assert.match(earthAdapterSource, /analysis\/earth\/overview|fetchEarthOverviewContext|fetchEarthResearchSuite/);
  // The Mars analysis prefix must never appear in the Earth adapter.
  assert.doesNotMatch(earthAdapterSource, /analysis\/overview\//);
  assert.doesNotMatch(earthAdapterSource, /marsYear|solarLongitudeLs/);
  // Diurnal is declared unsupported and short-circuits before any request.
  assert.match(earthAdapterSource, /cardKey === 'diurnal'/);
  assert.match(earthAdapterSource, /DIURNAL_DAILY_MEAN/);
  assert.doesNotMatch(earthAdapterSource, /fetchOverviewDiurnal|overview\/diurnal/);
});

test('Earth workbench declares fixed lighting and no Mars Ls handling', () => {
  assert.match(earthSceneSource, /lighting="fixed"/);
  assert.doesNotMatch(earthSceneSource, /solarLongitudeLs/);
  assert.doesNotMatch(earthSceneSource, /marsYear/);
  assert.match(earthSceneSource, /OverviewShell/);
  assert.match(earthSceneSource, /OverviewAnalysisPanel/);
  assert.match(earthSceneSource, /EarthInsightPanel/);
  assert.match(earthSceneSource, /const \[autoRotate, setAutoRotate\] = useState\(true\)/);
});

test('the page routes both planets through the shared workbench shell', () => {
  assert.match(pageSource, /EarthWorkbenchScene/);
  assert.match(pageSource, /OverviewShell/);
  assert.doesNotMatch(pageSource, /panelMode="external"/);
  assert.match(pageSource, /<SidebarMenu embedded sceneSwitch=\{sceneSwitch\} \/>/);
  assert.match(pageSource, /<DetailPanel embedded/);
  assert.match(pageSource, /<TimelineController embedded \/>/);
  // The gesture HUD stays in the page so its structure contract is unchanged.
  assert.match(pageSource, /className="gesture-capture-hud"/);
});

test('Earth is the default overview planet and appears before Mars in the switch', () => {
  const switchSource = readFileSync(new URL('../PlanetSceneSwitch.jsx', import.meta.url), 'utf8');
  assert.match(switchSource, /\{ id: 'earth', label: t\('overviewPlanet\.earth'\) \},\s*\{ id: 'mars', label: t\('overviewPlanet\.mars'\) \}/s);
  assert.match(pageSource, /const \[planet, setPlanet\] = useState\('earth'\)/);
});

test('the analysis panel drives cards from the adapter catalog', () => {
  assert.match(panelSource, /cards\.map/);
  assert.match(panelSource, /card\.state/);
  // 模式选择属于左栏：右栏默认不再重复渲染选择器。
  assert.match(panelSource, /showModePicker = false/);
  assert.match(panelSource, /modeDefinition/);
});

test('both planets render the same mode picker and section labels', () => {
  const sidebarSource = readFileSync(new URL('../SidebarMenu.jsx', import.meta.url), 'utf8');
  assert.match(sidebarSource, /import AnalysisModePicker, \{ SectionLabel \} from '\.\/workbench\/OverviewSidebarParts\.jsx'/);
  assert.match(sidebarSource, /<AnalysisModePicker/);
  // 旧的就地副本必须已经移除，否则外观相同的两份实现会再次漂移。
  assert.doesNotMatch(sidebarSource, /function RadioModeCard/);
  assert.doesNotMatch(sidebarSource, /function SectionLabel/);

  assert.match(earthSceneSource, /import AnalysisModePicker, \{ SectionLabel \} from '\.\.\/workbench\/OverviewSidebarParts\.jsx'/);
  assert.match(earthSceneSource, /<AnalysisModePicker/);
  assert.match(earthSceneSource, /<SectionLabel>/);
  // Earth 左栏分区顺序与 Mars 一致：星球 → 分析模式 → 数据范围 → 显示 → 点位。
  const order = ['数据总览星球', '分析模式', '数据范围', '显示控制', '点位']
    .map((label) => earthSceneSource.indexOf(`'${label}`));
  assert.ok(order.every((index) => index > 0), `missing section label: ${order.join(',')}`);
  assert.deepEqual([...order].sort((a, b) => a - b), order);
});

test('card bodies reuse the shared plot config, variable tabs and colour bars', () => {
  const viewsSource = readFileSync(new URL('../EarthOverview/EarthResearchViews.jsx', import.meta.url), 'utf8');
  assert.match(viewsSource, /export const WORKBENCH_PLOT_CONFIG/);
  assert.match(viewsSource, /export function VariableTabs/);
  assert.match(viewsSource, /export function CurrentVariableLine/);
  assert.match(viewsSource, /WORKBENCH_PLOT_CONFIG/);
  // 变量驱动的卡片必须暴露药丸行，而不是只跟随左栏。
  assert.match(earthSceneSource, /variableOptions=\{variableOptions\}/);
  assert.match(earthSceneSource, /onVariableChange=\{controller\.selectVariable\}/);
  // 横向色标：与火星热力图一致。
  assert.match(viewsSource, /orientation: 'h'/);
  const cssSource = readFileSync(new URL('./overviewWorkbench.css', import.meta.url), 'utf8');
  assert.match(cssSource, /\.overview-card-plot \.modebar/);
});
