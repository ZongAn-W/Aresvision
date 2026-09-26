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
const dockSource = readFileSync(new URL('./AnalysisDock.jsx', import.meta.url), 'utf8');
const toolbarSource = readFileSync(new URL('./ObservatoryToolbar.jsx', import.meta.url), 'utf8');
const layoutSource = readFileSync(new URL('./observatoryLayout.js', import.meta.url), 'utf8');
const marsToolsSource = readFileSync(new URL('../ObservatoryMars.jsx', import.meta.url), 'utf8');

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

test('the shared shell provides toolbar, scene, timeline and analysis slots with no fixed rails', () => {
  assert.match(shellSource, /overview-shell__toolbar/);
  assert.match(shellSource, /overview-shell__scene/);
  assert.match(shellSource, /overview-shell__timeline/);
  assert.match(shellSource, /overview-shell__analysis/);
  // 观测台没有左右固定栏与拖拽改宽。
  assert.doesNotMatch(shellSource, /overview-shell__sidebar/);
  assert.doesNotMatch(shellSource, /overview-resizer/);
  assert.doesNotMatch(shellSource, /role="separator"/);
  assert.match(shellSource, /MIN_SCENE_WIDTH/);
  assert.match(shellSource, /shouldUseCompactOverview/);
  assert.match(shellSource, /getObservatoryLayout/);
  assert.doesNotMatch(shellSource, /panelMode === 'external'/);
  assert.match(shellSource, /overviewVisualContract/);
  // 场景容器尺寸来自真实测量：ResizeObserver + 自身高度，且卸载时清理。
  assert.match(shellSource, /ResizeObserver/);
  assert.match(shellSource, /observer\.disconnect\(\)/);
  assert.match(shellSource, /sceneRef/);
  // 兼容字段 offsetX 固定为 0，禁止再按窗口减栏宽。
  assert.match(shellSource, /offsetX: 0/);
});

test('the observatory shell wires observe/analyze through one shared state', () => {
  // 两档由外部状态驱动；Shell 不自己维护第二套布局状态。
  assert.match(shellSource, /view = 'observe'/);
  assert.match(shellSource, /onViewChange/);
  assert.doesNotMatch(shellSource, /useState\('observe'\)/);
  // 场景容器不随 view 改变 key，模式切换不重建三维实例。
  assert.doesNotMatch(shellSource, /key=\{[^}]*view/);
  assert.match(toolbarSource, /aria-pressed=\{active\}/);
  assert.match(dockSource, /aria-pressed=\{active\}/);
  // 分析区两档共用一个主图身份。
  assert.match(dockSource, /pickActiveCard/);
  assert.match(dockSource, /onCardChange/);
  assert.match(dockSource, /onExpand/);
  assert.match(dockSource, /onCollapse/);
  assert.match(layoutSource, /export function pickActiveCard/);
  assert.match(layoutSource, /export function getObservatoryLayout/);
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
  assert.match(earthSceneSource, /AnalysisDock/);
  assert.match(earthSceneSource, /EarthInsightPanel/);
  assert.match(earthSceneSource, /const \[autoRotate, setAutoRotate\] = useState\(true\)/);
  // Earth 的设置内容按职责拆到图层 / 点位 / 显示三个面板。
  assert.match(earthSceneSource, /layers:/);
  assert.match(earthSceneSource, /point:/);
  assert.match(earthSceneSource, /display:/);
  assert.match(earthSceneSource, /EarthObservationRail/);
  assert.match(earthSceneSource, /EarthMap2D/);
});

test('the page routes both planets through the shared observatory shell', () => {
  assert.match(pageSource, /EarthWorkbenchScene/);
  assert.match(pageSource, /OverviewShell/);
  assert.doesNotMatch(pageSource, /panelMode="external"/);
  assert.doesNotMatch(pageSource, /<SidebarMenu/);
  assert.doesNotMatch(pageSource, /<DetailPanel/);
  // 火星条件栏与设置面板走 ObservatoryMars，观测时间轴与曲线位于两侧。
  assert.match(pageSource, /MarsObservatoryToolbar/);
  assert.match(pageSource, /useMarsObservatoryPanels/);
  assert.match(pageSource, /<MarsObservationRail/);
  // 观测档没有常驻分析区：展开入口保留在左轨。
  assert.match(pageSource, /AnalysisEntryButton/);
  assert.match(pageSource, /rail=\{observatoryView === 'observe'/);
  assert.match(pageSource, /railEnd=\{observatoryView === 'observe'/);
  assert.match(pageSource, /PointProbeContent/);
  assert.match(pageSource, /AnalysisDock/);
  // 手势 HUD 留在页面里，结构契约不变。
  assert.match(pageSource, /className="gesture-capture-hud"/);
  // 手势坐标按画布真实矩形映射，不再按窗口减栏宽。
  assert.match(pageSource, /getBoundingClientRect/);
  assert.doesNotMatch(pageSource, /leftPanelWidth \+ 28/);
  // 点位结果嵌进分析区，弹窗保留给独立场景。
  assert.match(marsToolsSource, /panels/);
});

test('Earth is the default overview planet and appears before Mars in the switch', () => {
  const switchSource = readFileSync(new URL('../PlanetSceneSwitch.jsx', import.meta.url), 'utf8');
  assert.match(switchSource, /\{ id: 'earth', label: t\('overviewPlanet\.earth'\) \},\s*\{ id: 'mars', label: t\('overviewPlanet\.mars'\) \}/s);
  assert.match(pageSource, /const \[planet, setPlanet\] = useState\('earth'\)/);
});

test('the analysis dock drives the main chart from the adapter catalog', () => {
  assert.match(dockSource, /cards\.map/);
  assert.match(dockSource, /card\.state/);
  assert.match(dockSource, /renderCard/);
  // 非活动图表不渲染：避免隐藏图表继续发请求或占着 Plotly 尺寸。
  assert.match(dockSource, /showFullChart/);
  assert.match(dockSource, /CARD_STATUS\.READY/);
});

test('both planets expose the same mode picker and the same panel primitives', () => {
  const partsSource = readFileSync(new URL('./OverviewSidebarParts.jsx', import.meta.url), 'utf8');
  assert.match(partsSource, /export default function AnalysisModePicker/);
  assert.match(partsSource, /MODE_DEFS\.map/);

  // 两个星球都渲染同一份模式选择器与同一份设置面板控件。
  // 分析分类只有 AnalysisDock 一处入口，不再重复藏在图层设置里。
  assert.doesNotMatch(earthSceneSource, /<AnalysisModePicker/);
  assert.match(earthSceneSource, /<AnalysisDock/);
  assert.match(earthSceneSource, /ObservatoryToolParts/);
  assert.match(marsToolsSource, /MarsSourceControls/);
  assert.match(marsToolsSource, /ObservatoryToolParts/);
  assert.match(marsToolsSource, /panels = \{/);
  // 四个面板键：数据源 + 图层 + 显示 + 点位。
  for (const key of ['source:', 'layers:', 'display:', 'point:']) {
    assert.ok(marsToolsSource.includes(key), `missing Mars panel: ${key}`);
  }
  // 数据源与图层两个面板共用同一份个人上传读取逻辑，不重复请求 getMyUploads。
  assert.equal(
    (marsToolsSource.match(/getMyUploads\(\)/g) || []).length,
    1,
    'getMyUploads must be called from a single shared hook',
  );
});

test('card bodies reuse the shared plot config, variable tabs and colour bars', () => {
  const viewsSource = readFileSync(new URL('../EarthOverview/EarthResearchViews.jsx', import.meta.url), 'utf8');
  assert.match(viewsSource, /export const WORKBENCH_PLOT_CONFIG/);
  assert.match(viewsSource, /export function VariableTabs/);
  // 变量只在药丸行里出现一次：卡片内不再重复写一行「当前变量: X (单位)」。
  assert.doesNotMatch(viewsSource, /CurrentVariableLine/);
  assert.doesNotMatch(viewsSource, /'当前变量'/);
  assert.doesNotMatch(viewsSource, /'Current variable'/);
  assert.match(viewsSource, /WORKBENCH_PLOT_CONFIG/);
  // 当前图适用的变量与范围在同一个条件区域中调整。
  assert.match(earthSceneSource, /conditionsSlot=\{analysisConditions\}/);
  assert.match(earthSceneSource, /onChange=\{controller\.selectVariable\}/);
  // 横向色标：与火星热力图一致。
  assert.match(viewsSource, /orientation: 'h'/);
  const cssSource = readFileSync(new URL('./overviewWorkbench.css', import.meta.url), 'utf8');
  assert.match(cssSource, /\.overview-card-plot \.modebar/);
});
