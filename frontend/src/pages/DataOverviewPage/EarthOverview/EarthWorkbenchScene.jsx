/**
 * Earth 三维分析工作台场景（共用工作台壳层 + Earth adapter）。
 *
 * 与 Mars 共用：三栏布局、模式选择、卡片外壳、三维场景控制、图例与 AI 解读入口。
 * Earth 专属：ISO 日期与年度选择、原始单位、v2 全球 5° 单元几何、极区统计，
 * 以及明确声明不可用的昼夜卡片（不请求 Mars 昼夜接口）。
 */

import React, { useCallback, useMemo, useState } from 'react';
import { useT } from '../../../i18n/index.js';
import { useSettings } from '../../../contexts/SettingsContext';
import { makeGradient } from '../../../utils/colormaps';
import C from '../../../constants/colors';
import GlowCard from '../../../components/GlowCard';
import { useOverviewController } from '../workbench/useOverviewController.js';
import { createEarthOverviewAdapter } from '../workbench/earthOverviewAdapter.js';
import OverviewShell from '../workbench/OverviewShell.jsx';
import OverviewAnalysisPanel from '../workbench/OverviewAnalysisPanel.jsx';
import OverviewScene from '../workbench/OverviewScene.jsx';
import AnalysisModePicker, { SectionLabel } from '../workbench/OverviewSidebarParts.jsx';
import { pointInsideGeometry } from '../workbench/OverviewAdapter.js';
import {
  EARTH_VARIABLES,
  EARTH_VARIABLE_LABEL_KEYS,
  earthColormap,
  formatEarthNumber,
} from './earthOverviewModel.js';
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
import EarthTimeline from './EarthTimeline.jsx';
import EarthSeriesPanel from './EarthSeriesPanel.jsx';
import './earthOverview.css';

/** 左侧控件栏：与 Mars 相同的分区顺序（星球 → 分析模式 → 数据源 → 变量/时间 → 显示 → 点位）。 */
function EarthWorkbenchSidebar({
  controller, sceneSwitch, isZh, isLight, viewMode, onViewModeChange,
  showField, onShowFieldChange, showGeo, onShowGeoChange,
  showBaseMap, onShowBaseMapChange, autoRotate, onAutoRotateChange,
  onResetCamera,
}) {
  const t = useT();
  const [latInput, setLatInput] = useState('');
  const [lonInput, setLonInput] = useState('');
  const [inputError, setInputError] = useState('');

  const geometry = controller.geometry;
  const descriptorText = geometry
    ? `${geometry.shape[0]} x ${geometry.shape[1]} · ${geometry.latBounds[0]}°~${geometry.latBounds[1]}° / ${geometry.lonBounds[0]}°~${geometry.lonBounds[1]}°`
    : '--';

  const submitCoordinates = (event) => {
    event.preventDefault();
    const lat = Number(latInput);
    const lon = Number(lonInput);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      setInputError(t('earthOverview.errors.invalidCoordinates'));
      return;
    }
    if (!pointInsideGeometry(geometry, lat, lon)) {
      setInputError(t('earthOverview.errors.outsideCoverage'));
      controller.markOutOfCoverage({ code: 'point_outside_coverage', lat, lon });
      return;
    }
    setInputError('');
    controller.selectPoint({ lat, lon });
  };

  const currentValue = (() => {
    const series = controller.pointSeries;
    const field = controller.field;
    if (!series?.dates?.length || !field?.value) return '--';
    const index = series.dates.indexOf(field.value);
    if (index < 0) return '--';
    const value = series.values[index];
    return Number.isFinite(value) ? `${formatEarthNumber(value, 2)} ${series.unit || ''}` : '--';
  })();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 20, padding: 20, overflowY: 'auto' }}>
      <div>
        <h1 style={{ margin: 0, color: C.ice, fontFamily: 'var(--font-display)', fontSize: 'calc(17px * var(--font-scale, 1))', fontWeight: 800 }}>
          {isZh ? '分析工作台' : 'Analysis workbench'}
        </h1>
        <p style={{ margin: '4px 0 0', color: C.ice50, fontFamily: 'var(--font-body)', fontSize: 'calc(11px * var(--font-scale, 1))', lineHeight: 1.6 }}>
          {isZh
            ? '与火星共用同一套分析工作台；日期、单位与网格保持地球语义。'
            : 'Shares one analysis workbench with Mars while keeping Earth date, unit and grid semantics.'}
        </p>
      </div>

      {sceneSwitch ? (
        <section data-testid="planet-scene-switch-slot">
          <SectionLabel>{isZh ? '数据总览星球' : 'Overview planet'}</SectionLabel>
          {sceneSwitch}
        </section>
      ) : null}

      <section>
        <SectionLabel>{isZh ? '分析模式' : 'Analysis mode'}</SectionLabel>
        <AnalysisModePicker
          mode={controller.mode}
          onSelect={controller.selectMode}
          isZh={isZh}
          isLight={isLight}
          name="overview-mode-earth"
        />
      </section>

      <section>
        <SectionLabel>{isZh ? '数据范围' : 'Data scope'}</SectionLabel>
        <div style={{ display: 'grid', gap: 12 }}>
          <GlowCard style={{ padding: '14px 16px', display: 'grid', gap: 10 }}>
            <FieldRow label={isZh ? '数据源' : 'Data source'} value={controller.sourceLabel} />
            <FieldRow
              label={isZh ? '发布指纹' : 'Release fingerprint'}
              value={controller.sourceFingerprint ? `${controller.sourceFingerprint.slice(0, 12)}...` : '--'}
            />
            <FieldRow label={isZh ? '网格与覆盖' : 'Grid and coverage'} value={descriptorText} />
            <FieldRow
              label={isZh ? '时间模型' : 'Time model'}
              value={`ISO ${controller.time?.start || '--'} ~ ${controller.time?.end || '--'} (${controller.timeAxis.length} ${isZh ? '天' : 'days'})`}
            />
            <FieldRow
              label={isZh ? '聚合' : 'Aggregation'}
              value={isZh ? '全球 5° 单元球面面积加权均值' : 'Global 5° cell spherical area-weighted mean'}
            />
          </GlowCard>

          <GlowCard style={{ padding: '14px 16px', display: 'grid', gap: 12 }}>
            <label className="earth-field">
              <span>{isZh ? '球体变量' : 'Globe variable'}</span>
              <select
                value={controller.variable || ''}
                onChange={(event) => controller.selectVariable(event.target.value)}
                disabled={!controller.ready}
              >
                {EARTH_VARIABLES.map((id) => (
                  <option key={id} value={id}>
                    {`${t(EARTH_VARIABLE_LABEL_KEYS[id])} (${controller.variables.find((item) => item.id === id)?.unit || ''})`}
                  </option>
                ))}
              </select>
            </label>

            <FieldRow label={isZh ? '原始单位' : 'Physical unit'} value={controller.units || '--'} />

            <label className="earth-field">
              <span>{isZh ? '年度分析年份' : 'Analysis year'}</span>
              <select
                value={controller.year ?? ''}
                onChange={(event) => controller.selectYear(Number(event.target.value))}
                disabled={!controller.ready}
              >
                {controller.years.map((year) => (
                  <option key={year} value={year}>{year}</option>
                ))}
              </select>
            </label>

            <form className="earth-coord" onSubmit={submitCoordinates}>
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
              <button type="submit" className="earth-btn" disabled={!controller.ready}>
                {t('earthOverview.actions.viewPoint')}
              </button>
            </form>
            {inputError ? <p className="earth-inline-error" role="alert">{inputError}</p> : null}
          </GlowCard>
        </div>
      </section>

      <section>
        <SectionLabel>{isZh ? '显示控制' : 'Display controls'}</SectionLabel>
        <GlowCard style={{ padding: '14px 16px', display: 'grid', gap: 10 }}>
          <ToggleRow
            label={isZh ? '三维球体' : '3D globe'}
            value={viewMode === '3d'}
            onChange={(next) => onViewModeChange(next ? '3d' : '2d')}
          />
          <ToggleRow label={isZh ? '数据场' : 'Data field'} value={showField} onChange={onShowFieldChange} />
          <ToggleRow label={isZh ? '经纬网' : 'Graticule'} value={showGeo} onChange={onShowGeoChange} />
          <ToggleRow label={isZh ? '海岸线底图' : 'Coastline base map'} value={showBaseMap} onChange={onShowBaseMapChange} />
          <ToggleRow label={isZh ? '自动旋转' : 'Auto rotate'} value={autoRotate} onChange={onAutoRotateChange} />
          <button type="button" className="earth-btn" onClick={onResetCamera}>
            {isZh ? '重置视角' : 'Reset camera'}
          </button>
        </GlowCard>
      </section>

      <section>
        <SectionLabel>{isZh ? '点位' : 'Point'}</SectionLabel>
        <GlowCard style={{ padding: '14px 16px', display: 'grid', gap: 8 }}>
          {controller.point ? (
            <div style={{ display: 'grid', gap: 4 }}>
              <FieldRow
                label={isZh ? '请求坐标' : 'Requested'}
                value={`${controller.point.requested?.lat ?? controller.point.lat}, ${controller.point.requested?.lon ?? controller.point.lon}`}
              />
              <FieldRow
                label={isZh ? '实际单元中心' : 'Sampled cell centre'}
                value={`${controller.point.lat}, ${controller.point.lon}`}
              />
              <FieldRow label={isZh ? '当前值' : 'Current value'} value={currentValue} />
              <button type="button" className="earth-btn" onClick={() => controller.clearPoint()}>
                {isZh ? '清除点位' : 'Clear point'}
              </button>
            </div>
          ) : (
            <p style={{ margin: 0, color: C.ice45, fontSize: 'calc(11px * var(--font-scale, 1))', lineHeight: 1.6 }}>
              {isZh
                ? '在球体或二维地图上点击一个单元以查看点位曲线。区域外点击只提示，不移动已有点位。'
                : 'Click a cell on the globe or the 2D map to see the point series. Clicking outside the coverage only shows a notice and does not move the existing point.'}
            </p>
          )}
        </GlowCard>
      </section>
    </div>
  );
}

function FieldRow({ label, value }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 8, alignItems: 'baseline' }}>
      <span style={{ color: C.ice45, fontSize: 'calc(10px * var(--font-scale, 1))' }}>{label}</span>
      <span
        data-field-label={label}
        style={{ color: C.ice80, fontSize: 'calc(11px * var(--font-scale, 1))', lineHeight: 1.6, wordBreak: 'break-word' }}
      >
        {value || '--'}
      </span>
    </div>
  );
}

function ToggleRow({ label, value, onChange }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, cursor: 'pointer' }}>
      <span style={{ color: C.ice80, fontSize: 'calc(11px * var(--font-scale, 1))' }}>{label}</span>
      <input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

export default function EarthWorkbenchScene({ selection, onSelectionChange, sceneSwitch }) {
  const t = useT();
  const { settings } = useSettings();
  const isLight = settings?.theme === 'light';
  const isZh = settings?.language !== 'en';

  const adapter = useMemo(() => createEarthOverviewAdapter(), []);
  const controller = useOverviewController({
    adapter,
    initialSelection: selection
      ? { value: selection.date, variable: selection.variable, point: selection.point }
      : null,
    onSelectionChange,
  });

  const [viewMode, setViewMode] = useState('3d');
  const [showField, setShowField] = useState(true);
  const [showGeo, setShowGeo] = useState(true);
  const [showBaseMap, setShowBaseMap] = useState(true);
  const [autoRotate, setAutoRotate] = useState(false);
  const [bandId, setBandId] = useState('global');
  const [normalized, setNormalized] = useState(false);

  const variable = controller.variable;
  const scope = bandId;
  const colormap = controller.field
    ? earthColormap(controller.field.variable, settings?.colormap)
    : earthColormap(variable, settings?.colormap);

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

  // 卡片内的变量药丸与火星“季节变化”卡片一致：切换后联动整页变量、场与曲线。
  const variableOptions = useMemo(() => EARTH_VARIABLES.map((id) => ({
    id,
    zh: t(EARTH_VARIABLE_LABEL_KEYS[id]),
    en: t(EARTH_VARIABLE_LABEL_KEYS[id]),
  })), [t]);

  const renderCard = useCallback((card) => {
    const data = card.state?.data;
    switch (card.key) {
      case 'seasonal':
        return (
          <SeasonalHeatmapView
            model={buildSeasonalHeatmap(data, variable, { isZh })}
            variable={variable}
            variableOptions={variableOptions}
            onVariableChange={controller.selectVariable}
            units={controller.units}
          />
        );
      case 'globalTrend':
        return (
          <RegionalTrendView
            model={buildRegionalTrend(data, { isZh, normalized })}
            normalized={normalized}
            onToggleNormalized={setNormalized}
          />
        );
      case 'seasonalExtremes':
        return (
          <ExtremesView
            rows={buildExtremesTable(data, variable)}
            variableId={variable}
            variableOptions={variableOptions}
            onVariableChange={controller.selectVariable}
          />
        );
      case 'environment':
        return (
          <EnvironmentView
            model={buildEnvironmentSeries(data, { bandId, isZh })}
            bandId={bandId}
            onBandChange={setBandId}
            bandIds={['global', ...((data?.bands || []).map((band) => band.id))]}
          />
        );
      case 'polar':
        return <PolarView polar={buildPolarSummary(data)} isZh={isZh} />;
      case 'solarsens':
        return <RelationshipView model={buildRelationship(data, scope, 'solar_ozone')} />;
      case 'correlation':
        return <CorrelationView model={buildCorrelationMatrix(data, scope)} />;
      case 'coupling':
        return <RelationshipView model={buildRelationship(data, scope, 'temperature_ozone')} />;
      case 'wave':
        return (
          <SpatialAnomalyView
            anomaly={buildSpatialAnomaly(data)}
            rows={buildBandDiagnostics(data)}
            variableId={variable}
            variableOptions={variableOptions}
            onVariableChange={controller.selectVariable}
          />
        );
      default:
        return null;
    }
  }, [bandId, controller, isZh, normalized, scope, t, variable, variableOptions]);

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

  const timeline = (
    <div
      style={{
        // 底部时间轴只占中央区域，避免盖住右侧分析栏里的按钮。
        position: 'fixed',
        left: 330,
        right: 540,
        bottom: 0,
        zIndex: 1150,
        padding: '0 8px 14px',
        pointerEvents: 'none',
      }}
    >
      <div style={{ pointerEvents: 'auto', display: 'grid', gap: 8 }}>
        {controller.outOfCoverage ? (
          <div className="earth-notice earth-notice--warning" role="status">
            {t('earthOverview.map.noDataOutside')}
            <button type="button" className="earth-btn" onClick={() => controller.dismissOutOfCoverage()}>
              {t('earthOverview.actions.dismiss')}
            </button>
          </div>
        ) : null}
        <EarthTimeline
          start={controller.time?.start || null}
          end={controller.time?.end || null}
          requestedDate={controller.date}
          displayedDate={controller.displayedValue}
          playing={controller.playing}
          loading={controller.fieldStatus === 'loading'}
          disabled={!controller.ready}
          onDateChange={controller.selectValue}
          onPlayChange={controller.setPlaying}
          onRestart={controller.restart}
        />
      </div>
    </div>
  );

  const legend = controller.field ? (
    <div
      style={{
        position: 'fixed',
        right: 552,
        bottom: 150,
        zIndex: 1150,
        width: 232,
        padding: '10px 12px',
        borderRadius: 12,
        border: `1px solid ${C.border}`,
        background: isLight ? 'rgba(255,255,255,0.86)' : 'rgba(10,12,18,0.72)',
        backdropFilter: 'blur(12px)',
        color: C.ice70,
        fontSize: 'calc(10px * var(--font-scale, 1))',
        lineHeight: 1.6,
        pointerEvents: 'none',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', color: C.ice }}>
        <span data-earth-legend="variable">{variableLabel(controller.field.variable, isZh)}</span>
        <span data-earth-legend="units">{controller.field.unit}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
        <span>{formatEarthNumber(controller.field.colorRange.min, 1)}</span>
        <span
          aria-hidden="true"
          style={{ flex: 1, height: 8, borderRadius: 999, background: makeGradient(colormap) }}
        />
        <span>{formatEarthNumber(controller.field.colorRange.max, 1)}</span>
      </div>
      <div style={{ marginTop: 6 }}>
        {isZh ? '展示日期' : 'Displayed date'}: <strong>{controller.field.value}</strong>
        {controller.requestedValue && controller.requestedValue !== controller.field.value
          ? ` · ${t('earthOverview.timeline.loadingSelectedDate')}: ${controller.requestedValue}`
          : ''}
      </div>
      <div style={{ marginTop: 4, color: C.ice45 }}>
        {isZh
          ? '未着色区域没有数据；颜色只表示数值，不表示高度。'
          : 'Uncoloured areas have no data; colour encodes value, not altitude.'}
      </div>
    </div>
  ) : null;

  const fallback2d = mapField ? (
    <EarthMap2D
      field={mapField}
      selectedPoint={controller.point}
      colormap={colormap}
      onPointSelect={handleMapPointSelect}
      onOutOfCoverage={() => controller.markOutOfCoverage()}
    />
  ) : null;

  const scene = viewMode === '3d' ? (
    <OverviewScene
      planet="earth"
      field={controller.field}
      geometry={controller.geometry}
      selection={{ point: controller.point }}
      lighting="fixed"
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

  const map2d = viewMode === '2d' && mapField ? (
    <div style={{ position: 'absolute', inset: '0 0 170px 0', padding: 16, overflow: 'auto' }}>
      {fallback2d}
    </div>
  ) : null;

  const analysis = (
    // 单一滚动列：卡片、点位/覆盖曲线与 AI 解读在同一个滚动容器里顺序排列，
    // 避免嵌套滚动与百分比高度让 Plotly 量到 NaN 尺寸。
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        gap: 16,
        padding: 24,
        overflowY: 'auto',
        overflowX: 'hidden',
      }}
    >
      <OverviewAnalysisPanel
        mode={controller.mode}
        cards={controller.cards}
        expandedCard={controller.expandedCard}
        onExpandedCardChange={controller.setExpandedCard}
        renderCard={renderCard}
        isZh={isZh}
        isLight={isLight}
        listScroll={false}
        onRetryCard={() => controller.retryCards()}
      />
      <EarthSeriesPanel
        variable={variable}
        units={controller.units}
        displayedDate={controller.displayedValue}
        pointSeries={controller.pointSeries ? {
          dates: controller.pointSeries.dates,
          values: controller.pointSeries.values,
          grid_point: controller.pointSeries.gridPoint,
        } : null}
        regionalSeries={controller.regionalSeries}
        regionCoverage={controller.field?.coverage || controller.regionalSeries?.coverage || null}
        onDateSelect={controller.selectValue}
      />
      <EarthInsightPanel
        datasetId={controller.sourceId}
        fingerprint={controller.sourceFingerprint}
        year={controller.year}
        date={controller.displayedValue || controller.date}
        variable={variable}
        units={controller.units}
        scope={scope}
        scopeLabel={bandLabel(scope, isZh)}
        cards={insightCards}
        ready={controller.ready && controller.fieldStatus === 'ready'}
        isZh={isZh}
      />
    </div>
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
      scene={(
        <>
          {scene}
          {map2d}
          {legend}
        </>
      )}
      timeline={timeline}
      sidebar={(
        <EarthWorkbenchSidebar
          controller={controller}
          sceneSwitch={sceneSwitch}
          isZh={isZh}
          isLight={isLight}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          showField={showField}
          onShowFieldChange={setShowField}
          showGeo={showGeo}
          onShowGeoChange={setShowGeo}
          showBaseMap={showBaseMap}
          onShowBaseMapChange={setShowBaseMap}
          autoRotate={autoRotate}
          onAutoRotateChange={setAutoRotate}
          onResetCamera={controller.resetCamera}
        />
      )}
      analysis={analysis}
      leftWidth={330}
      rightWidth={540}
    />
  );
}
