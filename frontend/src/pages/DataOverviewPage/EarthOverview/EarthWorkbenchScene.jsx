/**
 * Earth 三维分析观测台（共用观测台外壳 + Earth adapter）。
 *
 * 观测档展示球体与观测轨；分析档依次选择分析、调整条件、阅读主图，
 * AI 解读按需展开。逐日数据与点位操作统一留在观测档。Earth 专属语义保持不变：ISO 日期与年度选择、原始物理
 * 单位、v2 全球 5° 单元几何、球面面积加权均值，以及明确声明不可用的昼夜卡片
 * （不请求火星昼夜接口）。
 *
 * 设置内容按职责拆分：数据源（数据集身份）、图层（球体图层能力）、点位（坐标与
 * 采样单元）、显示（三维/二维、数据场、经纬网、海岸线、自动旋转、视角重置）。
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useT } from '../../../i18n/index.js';
import { useSettings } from '../../../contexts/SettingsContext';
import GlowCard from '../../../components/GlowCard';
import C from '../../../constants/colors';
import { getRgb } from '../../../utils/colormaps';
import { useOverviewController } from '../workbench/useOverviewController.js';
import { createEarthOverviewAdapter } from '../workbench/earthOverviewAdapter.js';
import OverviewShell from '../workbench/OverviewShell.jsx';
import OverviewScene from '../workbench/OverviewScene.jsx';
import ObservatoryToolbar, { AnalysisEntryButton, ToolbarSelect } from '../workbench/ObservatoryToolbar.jsx';
import EarthObservationRail from '../workbench/EarthObservationRail.jsx';
import { earthRailDomain, earthRailSeries } from '../workbench/earthObservationRail.js';
import ObservatoryTools, { ObservatorySourceButton } from '../workbench/ObservatoryTools.jsx';
import AnalysisDock from '../workbench/AnalysisDock.jsx';
import EarthAnalysisBoard from './EarthAnalysisBoard.jsx';
import {
  FieldRow,
  InlineSwitch,
  PanelButton,
  PanelCard,
  PanelSectionLabel,
  PanelSelect,
} from '../workbench/ObservatoryToolParts.jsx';
import { earthAnalysisControls } from '../workbench/analysisGuidance.js';
import { buildObservatoryGroups } from '../workbench/observatoryLayout.js';
import { pointInsideGeometry } from '../workbench/OverviewAdapter.js';
import {
  EARTH_VARIABLES,
  EARTH_VARIABLE_LABEL_KEYS,
  earthColormap,
  formatEarthNumber,
} from './earthOverviewModel.js';
import { MODE_DEFS } from '../overviewChartLayout.js';
import { normalizeLongitudeDegrees } from './earthMapGeometry.js';
import {
  buildBandDiagnostics,
  buildCorrelationMatrix,
  buildEnvironmentSeries,
  buildExtremesTable,
  buildPolarSummary,
  buildRegionalTrend,
  buildRelationship,
  buildSeasonalHeatmap,
  buildSpatialAnomaly,
  bandLabel,
  summarizeCorrelationForInsight,
  summarizeExtremesForInsight,
  summarizePolarForInsight,
  summarizeRelationshipForInsight,
  summarizeSpatialForInsight,
  variableLabel,
} from './earthResearchModel.js';
import {
  CorrelationView,
  EnvironmentView,
  ExtremesView,
  PolarView,
  RegionalTrendView,
  RelationshipView,
  SeasonalHeatmapView,
  SpatialAnomalyView,
} from './EarthResearchViews.jsx';
import EarthInsightPanel from './EarthInsightPanel.jsx';
import EarthMap2D from './EarthMap2D.jsx';
import './earthOverview.css';

/**
 * 紧凑预览只画「有真实序列、且缩到 120px 仍然可读」的图。
 * 表格（季节极值）、多子图（环境因子、空间诊断）、热力图（季节结构）在角落里
 * 会退化成不可读的窄条，因此预览位给出说明与展开入口，不硬压完整图表。
 */
const COMPACT_PREVIEW_KEYS = new Set(['globalTrend']);

export default function EarthWorkbenchScene({
  selection,
  onSelectionChange,
  sceneSwitch,
  observatoryView = 'observe',
  onObservatoryViewChange = null,
  openPanel = null,
  onOpenPanelChange = null,
  selectedCard = '',
  onSelectedCardChange = null,
}) {
  const t = useT();
  const { settings } = useSettings();
  const isLight = settings?.theme === 'light';
  const isZh = settings?.language !== 'en';

  const adapter = useMemo(() => createEarthOverviewAdapter(), []);
  const [analysisPresentation, setAnalysisPresentation] = useState('board');
  const [boardDriver, setBoardDriver] = useState('T2M');
  const controller = useOverviewController({
    adapter,
    initialSelection: selection
      ? { value: selection.date, variable: selection.variable, point: selection.point }
      : null,
    onSelectionChange,
    selectedCard,
    onSelectedCardChange,
    analysisBoard: observatoryView === 'analyze' && analysisPresentation === 'board',
  });

  const [viewMode, setViewMode] = useState('3d');
  const [showField, setShowField] = useState(true);
  const [showGeo, setShowGeo] = useState(true);
  const [showBaseMap, setShowBaseMap] = useState(true);
  const [autoRotate, setAutoRotate] = useState(true);
  const [bandId, setBandId] = useState('global');
  const [normalized, setNormalized] = useState(true);
  const [latInput, setLatInput] = useState('');
  const [lonInput, setLonInput] = useState('');
  const [inputError, setInputError] = useState('');

  const variable = controller.variable;
  const scope = bandId;
  const colormap = controller.field
    ? earthColormap(controller.field.variable, settings?.colormap)
    : earthColormap(variable, settings?.colormap);

  // 观测轨填充色：与球体、图例共用同一份色带；颜色按本轨数值范围铺满（见 railCurveFill.js）。
  const railColorMode = variable === 'U10M' || variable === 'V10M'
    ? 'rdbu'
    : (settings?.colormap || 'inferno');

  const cardByKey = useMemo(() => {
    const map = new Map();
    for (const card of controller.cards) map.set(card.key, card);
    return map;
  }, [controller.cards]);

  const insightCards = useMemo(() => {
    const ids = [
      'seasonal', 'globalTrend', 'seasonalExtremes', 'environment', 'polar',
      'solarsens', 'correlation', 'coupling', 'wave',
    ];
    const rows = [];
    for (const key of ids) {
      const card = cardByKey.get(key);
      if (!card) continue;
      const data = card.state?.data;
      let values = null;
      if (key === 'seasonalExtremes') values = summarizeExtremesForInsight(buildExtremesTable(data, variable));
      else if (key === 'correlation') values = summarizeCorrelationForInsight(buildCorrelationMatrix(data, scope));
      else if (key === 'solarsens') values = summarizeRelationshipForInsight(buildRelationship(data, scope, 'solar_ozone'));
      else if (key === 'coupling') values = summarizeRelationshipForInsight(buildRelationship(data, scope, 'temperature_ozone'));
      else if (key === 'polar') values = summarizePolarForInsight(buildPolarSummary(data));
      else if (key === 'wave') values = summarizeSpatialForInsight(data);
      else if (key === 'globalTrend' && data?.regional_series) {
        values = {
          sample_counts: Object.fromEntries(
            Object.entries(data.regional_series).map(([id, series]) => [id, series.length]),
          ),
        };
      }
      rows.push({ key, state: card.state, values, notes: [] });
    }
    return rows;
  }, [cardByKey, scope, variable]);

  const handleGlobeClick = useCallback((coord) => {
    if (!coord) return;
    const lat = coord.lat;
    const rawLon = Number.isFinite(coord.lon) ? coord.lon : coord.lng;
    if (!Number.isFinite(lat) || !Number.isFinite(rawLon)) return;
    if (!controller.geometry) return;
    // 全球网格上 ±180 是同一条子午线的等价写法，只做坐标规范化；
    // 区域发布（wrap_longitude=false）保持原样，交由 coverage 判断。
    const lon = controller.geometry.wrapLongitude
      ? normalizeLongitudeDegrees(rawLon)
      : rawLon;
    // 先判断覆盖范围，再用最近单元中心作为最终位置；区域外只提示，不移动旧点。
    if (!pointInsideGeometry(controller.geometry, lat, lon)) {
      controller.markOutOfCoverage({ code: 'point_outside_coverage', lat, lon: rawLon });
      return;
    }
    controller.selectPoint({ lat, lon });
  }, [controller]);

  const handleMapPointSelect = useCallback((picked) => {
    if (!picked?.preview) return;
    controller.selectPoint({ lat: picked.preview.lat, lon: picked.preview.lon });
  }, [controller]);

  const submitCoordinates = useCallback((event) => {
    event.preventDefault();
    const lat = Number(latInput);
    const lon = Number(lonInput);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      setInputError(t('earthOverview.errors.invalidCoordinates'));
      return;
    }
    if (!pointInsideGeometry(controller.geometry, lat, lon)) {
      setInputError(t('earthOverview.errors.outsideCoverage'));
      controller.markOutOfCoverage({ code: 'point_outside_coverage', lat, lon });
      return;
    }
    setInputError('');
    controller.selectPoint({ lat, lon });
  }, [controller, latInput, lonInput, t]);

  // 卡片内的变量药丸与火星“季节变化”卡片一致：切换后联动整页变量、场与曲线。
  const variableOptions = useMemo(() => EARTH_VARIABLES.map((id) => ({
    id,
    zh: t(EARTH_VARIABLE_LABEL_KEYS[id]),
    en: t(EARTH_VARIABLE_LABEL_KEYS[id]),
  })), [t]);

  const renderCard = useCallback((card, { compact = false, height: heightOverride = null } = {}) => {
    const data = card.state?.data;
    const mini = compact === true;
    // 观测档紧凑预览用固定像素；分析档主图用分析区算出的确定高度，
    // 未给时退回 100%（由父容器决定）。
    const height = mini ? 84 : (heightOverride ?? '100%');
    switch (card.key) {
      case 'seasonal':
        return (
          <SeasonalHeatmapView
            model={buildSeasonalHeatmap(data, variable, { isZh })}
            variable={variable}
            units={controller.units}
            compact={mini}
            height={height}
          />
        );
      case 'globalTrend':
        return (
          <RegionalTrendView
            model={buildRegionalTrend(data, { isZh, normalized })}
            normalized={normalized}
            compact={mini}
            height={height}
          />
        );
      case 'seasonalExtremes':
        return (
          <ExtremesView
            rows={buildExtremesTable(data, variable)}
            variableId={variable}
            height={height}
          />
        );
      case 'environment':
        return (
          <EnvironmentView
            model={buildEnvironmentSeries(data, { bandId, isZh })}
            bandId={bandId}
            height={height}
          />
        );
      case 'polar':
        return <PolarView polar={buildPolarSummary(data)} isZh={isZh} height={height} />;
      case 'solarsens':
        return <RelationshipView model={buildRelationship(data, scope, 'solar_ozone')} height={height} />;
      case 'correlation':
        return <CorrelationView model={buildCorrelationMatrix(data, scope)} height={height} />;
      case 'coupling':
        return <RelationshipView model={buildRelationship(data, scope, 'temperature_ozone')} height={height} />;
      case 'wave':
        return (
          <SpatialAnomalyView
            anomaly={buildSpatialAnomaly(data)}
            rows={buildBandDiagnostics(data)}
            variableId={variable}
            height={height}
          />
        );
      default:
        return null;
    }
  }, [bandId, controller, isZh, normalized, scope, variable, variableOptions]);

  // 紧凑预览只画真的有序列、且高度可压缩的图；其余图在预览位给出文字说明，
  // 不把完整复杂图硬压进很矮的区域。预览忽略 heightOverride（那是主图用的）。
  const renderPreviewCard = useCallback((card) => {
    if (!COMPACT_PREVIEW_KEYS.has(card.key)) {
      return (
        <div style={{
          display: 'grid',
          alignContent: 'center',
          justifyItems: 'center',
          gap: 4,
          height: '100%',
          color: C.ice50,
          fontSize: 'calc(11px * var(--font-scale, 1))',
          textAlign: 'center',
          padding: '0 12px',
        }}
        >
          <span>{isZh
            ? '该分析需要较大画布（表格或多子图），展开分析后查看。'
            : 'This analysis needs a larger canvas (table or multiple subplots); open the dock to view it.'}</span>
          <span style={{ color: C.ice40 }}>
            {isZh ? '数据不会在这里被裁剪或重采样。' : 'Data is never cropped or resampled here.'}
          </span>
        </div>
      );
    }
    return renderCard(card, { compact: true });
  }, [isZh, renderCard]);

  const mapField = controller.field ? {
    field: controller.field.values,
    lat: controller.field.latCenters,
    lon: controller.field.lonCenters,
    coverage: controller.field.coverage,
    color_range: {
      min: controller.field.colorRange.min,
      max: controller.field.colorRange.max,
      centered_on_zero: controller.field.colorRange.centeredOnZero,
    },
    units: controller.field.unit,
    date: controller.field.value,
  } : null;

  const fallback2d = mapField ? (
    <EarthMap2D
      field={mapField}
      selectedPoint={controller.point}
      colormap={colormap}
      onPointSelect={handleMapPointSelect}
      onOutOfCoverage={() => controller.markOutOfCoverage()}
    />
  ) : null;

  const threeD = viewMode === '3d' ? (
    <OverviewScene
      planet="earth"
      field={controller.field}
      geometry={controller.geometry}
      selection={{ point: controller.point }}
      lighting="fixed"
      colormap={colormap}
      showField={showField}
      showGeoAnnotations={showGeo}
      showBaseMap={showBaseMap}
      autoRotate={autoRotate}
      sceneKey={controller.sceneKey}
      poseKey={controller.poseKey}
      onGlobeClick={handleGlobeClick}
      isLight={isLight}
      isZh={isZh}
      fallback={fallback2d}
    />
  ) : null;

  const twoD = viewMode === '2d' && mapField ? (
    <div style={{ position: 'absolute', inset: 0, padding: 12, overflow: 'auto' }}>
      {fallback2d}
    </div>
  ) : null;

  const fieldCellCount = useMemo(() => {
    let count = 0;
    for (const row of controller.field?.values || []) {
      for (const value of row) {
        if (Number.isFinite(value)) count += 1;
      }
    }
    return count;
  }, [controller.field?.values]);

  const dataFieldLegend = controller.field ? (
    <div
      className="overview-overlay-anchor overview-earth-legend"
      role="group"
      aria-label={`${variableLabel(controller.field.variable, isZh)} (${controller.field.unit}) · ${controller.field.value}. ${isZh
        ? '未着色区域没有数据；颜色只表示数值，不表示高度。'
        : 'Uncoloured areas have no data; colour encodes value, not altitude.'}`}
      style={{
        position: 'absolute',
        right: 'var(--overview-overlay-gap)',
        bottom: 'var(--overview-overlay-gap)',
        zIndex: 1150,
        width: 'max-content',
        minWidth: 158,
        pointerEvents: 'none',
      }}
    >
      <GlowCard style={{ padding: '8px', background: 'var(--overview-panel-bg-strong)', border: '1px solid var(--overview-panel-border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <div style={{ color: C.ice60, fontSize: 'calc(9px * var(--font-scale, 1))', fontWeight: 800, whiteSpace: 'nowrap' }}>
            <span data-earth-legend="variable">{variableLabel(controller.field.variable, isZh)}</span>
            {' ('}<span data-earth-legend="units">{controller.field.unit}</span>{')'}
          </div>
          <span
            data-earth-legend="count"
            title={isZh ? `${fieldCellCount} 个有效格点` : `${fieldCellCount} valid cells`}
            aria-label={isZh ? `${fieldCellCount} 个有效格点` : `${fieldCellCount} valid cells`}
            style={{
              padding: '2px 5px',
              borderRadius: 999,
              border: `1px solid ${C.border}`,
              color: C.mars,
              fontSize: 'calc(8px * var(--font-scale, 1))',
              fontWeight: 800,
              fontFamily: 'var(--font-display)',
              flexShrink: 0,
              lineHeight: 1,
            }}
          >
            {fieldCellCount}
          </span>
        </div>
        <div
          aria-hidden="true"
          style={{
            height: 7,
            borderRadius: 999,
            border: `1px solid ${C.border}`,
            background: legendGradient(controller.field.variable, settings?.colormap),
            marginBottom: 5,
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, fontSize: 'calc(8px * var(--font-scale, 1))', color: C.ice, fontWeight: 700 }}>
          <span>{formatEarthNumber(controller.field.colorRange.min, 3)}</span>
          <span style={{ color: C.ice60 }}>{formatEarthNumber((controller.field.colorRange.min + controller.field.colorRange.max) / 2, 3)}</span>
          <span>{formatEarthNumber(controller.field.colorRange.max, 3)}</span>
        </div>
      </GlowCard>
    </div>
  ) : null;

  // 观测档才渲染三维球体：分析档把整块高度让给主图（两条竖轨也只在观测档出现）。
  // 注意场景元素身份保持稳定 —— 观测档内部切换变量/日期只改 props，不重建三维实例。
  const useRail = observatoryView === 'observe';

  // 每条轨用自己的极值当刻度：对侧取点只重画右侧，左轨形状保持稳定；
  // 垂直日期轴仍严格共用，两条轨都按同一份真实日历定位。
  const railDomain = useMemo(
    () => earthRailDomain(earthRailSeries(controller.regionalSeries, controller.year)),
    [controller.regionalSeries, controller.year],
  );

  const pointRailDomain = useMemo(
    () => earthRailDomain(earthRailSeries(controller.pointSeries, controller.year)),
    [controller.pointSeries, controller.year],
  );

  const scene = useRail ? (
    <>
      {threeD}
      {twoD}
    </>
  ) : null;

  const rail = useRail ? (
    <EarthObservationRail
      year={controller.year}
      years={controller.years}
      onYearChange={controller.selectYear}
      timeValues={controller.timeAxis}
      requestedDate={controller.date}
      displayedDate={controller.displayedValue}
      loading={controller.fieldStatus === 'loading'}
      disabled={!controller.ready}
      playing={controller.playing}
      series={controller.regionalSeries}
      seriesStatus={controller.regionalStatus}
      seriesError={controller.regionalError}
      units={controller.units || controller.field?.unit || ''}
      variableLabel={variableLabel(variable, isZh)}
      onDateChange={controller.selectValue}
      onPlayChange={controller.setPlaying}
      onRestart={controller.restart}
      onStep={controller.stepValue}
      domain={railDomain}
      colorMode={railColorMode}
      actions={(
        <AnalysisEntryButton
          label={t('observatory.view.expand')}
          onClick={() => onObservatoryViewChange?.('analyze')}
        />
      )}
    />
  ) : null;

  // 右侧竖栏：与左轨共用日期轴（上=年初、下=年末），数值刻度用本轨自己的极值，
  // 因此选点只改右轨的形状，不会把左轨的全球均值压缩变形。
  // 没有点位时显示占位说明，栏宽常驻，避免选中点位时页面横向跳动。
  const railEnd = useRail ? (
    <EarthObservationRail
      pointSide
      point={controller.pointCell || controller.point}
      pointSeries={controller.pointSeries}
      pointStatus={controller.pointStatus}
      pointError={controller.pointError}
      year={controller.year}
      timeValues={controller.timeAxis}
      requestedDate={controller.date}
      displayedDate={controller.displayedValue}
      units={controller.units || controller.field?.unit || ''}
      variableLabel={variableLabel(variable, isZh)}
      onDateChange={controller.selectValue}
      onClearPoint={controller.clearPoint}
      domain={pointRailDomain}
      colorMode={railColorMode}
      disabled={!controller.ready}
    />
  ) : null;

  // 面向用户的分析分组名称：保留内部 temporal / drivers / dynamics ID 不变。
  const groups = useMemo(() => buildObservatoryGroups(MODE_DEFS), []);


  const geometry = controller.geometry;
  const descriptorText = geometry
    ? `${geometry.shape[0]} x ${geometry.shape[1]} · ${geometry.latBounds[0]}°~${geometry.latBounds[1]}° / ${geometry.lonBounds[0]}°~${geometry.lonBounds[1]}°`
    : '--';

  const currentValue = (() => {
    const series = controller.pointSeries;
    const field = controller.field;
    if (!series?.dates?.length || !field?.value) return '--';
    const index = series.dates.indexOf(field.value);
    if (index < 0) return '--';
    const value = series.values[index];
    return Number.isFinite(value) ? `${formatEarthNumber(value, 2)} ${series.unit || ''}` : '--';
  })();

  const toolContent = {
    source: (
      <>
        <PanelSectionLabel>{t('observatory.dataSource.title')}</PanelSectionLabel>
        <PanelCard>
          <FieldRow label={t('observatory.dataSource.current')} value={controller.sourceLabel} />
          <FieldRow
            label={t('observatory.dataSource.fingerprint')}
            value={controller.sourceFingerprint ? `${controller.sourceFingerprint.slice(0, 12)}...` : '--'}
          />
          <FieldRow label={t('observatory.dataSource.grid')} value={descriptorText} />
          <FieldRow
            label={t('observatory.dataSource.timeModel')}
            value={`ISO ${controller.time?.start || '--'} ~ ${controller.time?.end || '--'} (${controller.timeAxis.length} ${isZh ? '天' : 'days'})`}
          />
          <FieldRow
            label={t('observatory.dataSource.aggregation')}
            value={isZh ? '全球 5° 单元球面面积加权均值' : 'Global 5° cell spherical area-weighted mean'}
          />
        </PanelCard>

      </>
    ),
    layers: (
      <>
        <PanelSectionLabel>{t('observatory.layerPanel.globeLayers')}</PanelSectionLabel>
        <PanelCard>
          <InlineSwitch
            label={t('observatory.layerPanel.showField')}
            checked={showField}
            onChange={() => setShowField((value) => !value)}
            isLight={isLight}
          />
          <InlineSwitch
            label={t('observatory.layerPanel.graticule')}
            checked={showGeo}
            onChange={() => setShowGeo((value) => !value)}
            isLight={isLight}
          />
          <InlineSwitch
            label={t('observatory.layerPanel.coastline')}
            checked={showBaseMap}
            onChange={() => setShowBaseMap((value) => !value)}
            isLight={isLight}
          />
        </PanelCard>
      </>
    ),

    point: (
      <>
        <PanelSectionLabel>{t('observatory.tools.pointTitle')}</PanelSectionLabel>
        <PanelCard>
          <form className="earth-coord" onSubmit={submitCoordinates} style={{ display: 'grid', gap: 8 }}>
            <label className="earth-field">
              <span>{t('earthOverview.controls.latitude')}</span>
              <input
                type="number" step="0.1" min="-90" max="90"
                value={latInput}
                disabled={!controller.ready}
                onChange={(event) => setLatInput(event.target.value)}
              />
            </label>
            <label className="earth-field">
              <span>{t('earthOverview.controls.longitude')}</span>
              <input
                type="number" step="0.1" min="-180" max="180"
                value={lonInput}
                disabled={!controller.ready}
                onChange={(event) => setLonInput(event.target.value)}
              />
            </label>
            <PanelButton type="submit" primary disabled={!controller.ready}>
              {t('earthOverview.actions.viewPoint')}
            </PanelButton>
          </form>
          {inputError ? <p className="earth-inline-error" role="alert">{inputError}</p> : null}
        </PanelCard>

        <PanelCard>
          {controller.point ? (
            <>
              <FieldRow
                label={t('observatory.point.requested')}
                value={`${controller.point.requested?.lat ?? controller.point.lat}, ${controller.point.requested?.lon ?? controller.point.lon}`}
              />
              <FieldRow
                label={t('observatory.point.cell')}
                value={`${controller.point.lat}, ${controller.point.lon}`}
              />
              <FieldRow label={t('observatory.point.current')} value={currentValue} />
              <PanelButton onClick={() => controller.clearPoint()}>
                {t('observatory.point.clear')}
              </PanelButton>
            </>
          ) : (
            <p style={{ margin: 0, color: C.ice45, fontSize: 'calc(11px * var(--font-scale, 1))', lineHeight: 1.6 }}>
              {t('observatory.point.empty')}
            </p>
          )}
        </PanelCard>
      </>
    ),

    display: (
      <>
        <PanelSectionLabel>{t('observatory.tools.displayTitle')}</PanelSectionLabel>
        <PanelCard>
          <PanelSelect
            label={t('observatory.displayPanel.globeView')}
            value={viewMode}
            onChange={setViewMode}
            isLight={isLight}
            options={[
              { value: '3d', label: t('observatory.displayPanel.view3d') },
              { value: '2d', label: t('observatory.displayPanel.view2d') },
            ]}
          />
          <InlineSwitch
            label={t('observatory.displayPanel.autoRotate')}
            checked={autoRotate}
            onChange={() => setAutoRotate((value) => !value)}
            isLight={isLight}
          />
          <PanelButton onClick={controller.resetCamera}>
            {t('observatory.displayPanel.resetCamera')}
          </PanelButton>
        </PanelCard>
      </>
    ),
  };

  const analysisControls = earthAnalysisControls(selectedCard);
  const boardCardKey = { temporal: 'seasonal', drivers: 'correlation', dynamics: 'wave' }[controller.mode];
  const boardConditions = (
    <>
      <ToolbarSelect label={isZh ? '年份' : 'Year'} value={String(controller.year ?? '')}
        onChange={next => controller.selectYear(Number(next))} disabled={!controller.ready} isLight={isLight}
        options={controller.years.map(year => ({ value: String(year), label: String(year) }))} />
      <ToolbarSelect label={isZh ? '分析变量' : 'Variable'}
        value={controller.mode === 'drivers' ? boardDriver : variable}
        onChange={controller.mode === 'drivers' ? setBoardDriver : controller.selectVariable}
        disabled={!controller.ready} isLight={isLight}
        options={variableOptions.filter(item => controller.mode !== 'drivers' || ['T2M', 'SWGDN'].includes(item.id))
          .map(item => ({ value: item.id, label: isZh ? item.zh : item.en }))} />
      {controller.mode === 'drivers' ? (
        <ToolbarSelect label={isZh ? '分析范围' : 'Area'} value={scope} onChange={setBandId}
          disabled={!controller.ready} isLight={isLight}
          options={['global', 'south_polar', 'south_mid', 'tropics', 'north_mid', 'north_polar']
            .map(id => ({ value: id, label: bandLabel(id, isZh) }))} />
      ) : null}
    </>
  );
  const analysisConditions = (
    <>
      <ToolbarSelect label={isZh ? '年份' : 'Year'} value={String(controller.year ?? '')}
        onChange={(next) => controller.selectYear(Number(next))} disabled={!controller.ready} isLight={isLight}
        options={controller.years.map((year) => ({ value: String(year), label: String(year) }))} />
      {analysisControls.variable ? (
        <ToolbarSelect label={isZh ? '分析变量' : 'Variable'} value={variable}
          onChange={controller.selectVariable} disabled={!controller.ready} isLight={isLight}
          options={variableOptions.map((item) => ({ value: item.id, label: isZh ? item.zh : item.en }))} />
      ) : null}
      {analysisControls.scope ? (
        <ToolbarSelect label={isZh ? '分析范围' : 'Area'} value={scope}
          onChange={setBandId} disabled={!controller.ready} isLight={isLight}
          options={['global', 'south_polar', 'south_mid', 'tropics', 'north_mid', 'north_polar']
            .map((id) => ({ value: id, label: bandLabel(id, isZh) }))} />
      ) : null}
      {analysisControls.normalized ? (
        <ToolbarSelect label={isZh ? '比较方式' : 'Comparison'} value={normalized ? 'zscore' : 'raw'}
          onChange={(next) => setNormalized(next === 'zscore')} isLight={isLight}
          options={[
            { value: 'zscore', label: isZh ? '标准化趋势（Z-score）' : 'Standardized trends (Z-score)' },
            { value: 'raw', label: isZh ? '原始数值（各自单位）' : 'Original values (individual units)' },
          ]} />
      ) : null}
    </>
  );

  const allToolDefinitions = useMemo(() => ([
    {
      key: 'layers',
      label: t('observatory.tools.layers'),
      title: t('observatory.tools.layersTitle'),
      hint: t('observatory.tools.layersHint'),
    },
    {
      key: 'point',
      label: t('observatory.tools.point'),
      title: t('observatory.tools.pointTitle'),
      hint: t('observatory.tools.pointHint'),
    },
    {
      key: 'display',
      label: t('observatory.tools.display'),
      title: t('observatory.tools.displayTitle'),
      hint: t('observatory.tools.displayHint'),
    },
  ]), [t]);

  // 图层、点位与视角都属于观测操作，年度分析只保留分析条件。
  const toolDefinitions = useMemo(
    () => (observatoryView === 'observe' ? allToolDefinitions : []),
    [allToolDefinitions, observatoryView],
  );

  // 切换档位时关闭没有对应入口的工具面板。
  useEffect(() => {
    if (openPanel && openPanel !== 'source' && !toolDefinitions.some((tool) => tool.key === openPanel)) {
      onOpenPanelChange?.(null);
    }
  }, [toolDefinitions, openPanel, onOpenPanelChange]);

  // 隐藏逐日操作时暂停观测播放，年度图不会随某一天的日期更新。
  useEffect(() => {
    if (observatoryView === 'analyze') controller.setPlaying(false);
  }, [observatoryView, controller.setPlaying]);

  // 条件栏不再放「展示时间 / 单位」摘要：观测档的刻度轨已经给出日期与当天全球均值
  // （含单位），舞台右下角图例也标了变量与单位，重复一次只会在球体上方多挂两个 chip。
  const toolbar = (
    <ObservatoryToolbar
      planetSlot={sceneSwitch}
      isZh={isZh}
      toolsSlot={(
        // 「图层 / 点位 / 显示」入口与对应面板由共用外壳提供，两星球共用同一份实现。
        // toolContent 必须在上面先建好：JSX 在求值这里时就会读取它。
        <ObservatoryTools
          tools={toolDefinitions}
          openPanel={openPanel}
          onOpenPanelChange={onOpenPanelChange}
          content={toolContent}
          closeLabel={t('observatory.tools.close')}
          sourceTitle={t('observatory.dataSource.title')}
        />
      )}
      sourceSlot={(
        <ObservatorySourceButton label={t('observatory.dataSource.title')}
          openPanel={openPanel} onOpenPanelChange={onOpenPanelChange} />
      )}
      variableSlot={observatoryView === 'observe' ? (
        <ToolbarSelect
          label=""
          title={t('observatory.dataSource.variable')}
          value={controller.variable || ''}
          onChange={(next) => controller.selectVariable(next)}
          disabled={!controller.ready}
          isLight={isLight}
          options={EARTH_VARIABLES.map((id) => ({
            value: id,
            label: `${t(EARTH_VARIABLE_LABEL_KEYS[id])} (${controller.variables.find((item) => item.id === id)?.unit || ''})`,
          }))}
        />
      ) : null}
      view={observatoryView}
      onViewChange={onObservatoryViewChange}
    />
  );

  const insightSlot = (
    <EarthInsightPanel
      datasetId={controller.sourceId}
      fingerprint={controller.sourceFingerprint}
      year={controller.year}
      date={controller.displayedValue || controller.date}
      variable={variable}
      units={controller.units}
      scope={analysisControls.scope ? scope : 'global'}
      scopeLabel={bandLabel(analysisControls.scope ? scope : 'global', isZh)}
      cards={insightCards}
      ready={controller.ready && controller.fieldStatus === 'ready'}
      isZh={isZh}
      chartId={selectedCard || null}
    />
  );

  if (controller.sourceStatus === 'unsupported' || controller.sourceStatus === 'error') {
    return (
      <div className={`earth-scene${isLight ? ' is-light' : ''}`}>
        <div className="earth-scene__inner">
          <header className="earth-scene__header">
            <div>
              <h1>{t('earthOverview.title')}</h1>
              <p className="earth-scene__subtitle">{t('earthOverview.subtitle')}</p>
            </div>
            {sceneSwitch}
          </header>
          <div className="earth-notice earth-notice--error" role="alert">
            <strong>{t('earthOverview.errors.datasetUnavailable')}</strong>
            {controller.statusDetail || controller.sourceError?.availabilityReason
              ? <code>{controller.statusDetail || controller.sourceError.availabilityReason}</code>
              : null}
            <button type="button" className="earth-btn" onClick={() => controller.retrySource()}>
              {t('earthOverview.actions.retry')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <OverviewShell
      planet="earth"
      isLight={isLight}
      view={observatoryView}
      onViewChange={onObservatoryViewChange}
      openPanel={openPanel}
      onOpenPanelChange={onOpenPanelChange}
      toolbar={toolbar}
      rail={rail}
      railEnd={railEnd}
      scene={scene}
      overlay={dataFieldLegend}
      analysis={(
        <AnalysisDock
          view={observatoryView}
          groups={groups}
          mode={controller.mode}
          onModeChange={controller.selectMode}
          cards={controller.cards}
          activeCard={selectedCard}
          onCardChange={onSelectedCardChange}
          onExpand={() => onObservatoryViewChange?.('analyze')}
          onCollapse={() => onObservatoryViewChange?.('observe')}
          renderCard={observatoryView === 'analyze' ? renderCard : renderPreviewCard}
          isZh={isZh}
          isLight={isLight}
          conditionsSlot={analysisConditions}
          presentation={analysisPresentation}
          onPresentationChange={setAnalysisPresentation}
          boardConditionsSlot={boardConditions}
          boardSlot={<EarthAnalysisBoard state={cardByKey.get(boardCardKey)?.state} mode={controller.mode}
            variable={variable} driver={boardDriver} scope={scope} isZh={isZh} onRetry={controller.retryCards} />}
          contextNote={isZh
            ? '按所选年份统计全年数据；调整条件后自动更新。'
            : 'Charts summarize the selected year and update automatically.'}
          onRetryCard={controller.retryCards}
          aiSlot={observatoryView === 'analyze' ? insightSlot : null}
        />
      )}
      notification={null}
    />
  );
}

/** 图例色带：与数据场使用同一个色带函数，避免图例与球体配色不一致。 */
function legendGradient(variable, colormap) {
  const palette = earthColormap(variable, colormap);
  const stops = Array.from({ length: 10 }, (_, index) => {
    const fraction = index / 9;
    return `rgb(${getRgb(palette, fraction).join(',')}) ${fraction * 100}%`;
  });
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}
