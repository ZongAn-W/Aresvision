/**
 * Mars 观测台控件：顶部条件栏、分析年份与 Ls 选择 + 四个设置面板内容。
 *
 * 所有业务状态仍来自 `DataOverviewContext`（官方/个人 MCD、OpenMARS、NOMAD、
 * 多源 / 验证 / 差值、手势、自动旋转、贴图、经纬标注），因此改版只是把这些
 * 控件从常驻左栏搬到顶部条件栏与临时面板，请求身份与来源筛选逻辑没有第二份实现。
 */

import React, { useCallback, useEffect, useMemo } from 'react';
import C from '../../constants/colors';
import { useT } from '../../i18n';
import { useAuth } from '../../contexts/AuthContext';
import { useDataOverview } from '../../contexts/DataOverviewContext';
import { useSettings } from '../../contexts/SettingsContext';
import { GLOBE_VARIABLE_OPTIONS } from '../../constants/globeVariables';
import { getMyUploads } from '../../services/api';
import { buildOverviewUploadOptions, buildUploadYearOptions } from './uploadedSourceOptions';
import {
  FieldRow, InlineSwitch, PanelCard, PanelSectionLabel, SegmentedToggle,
} from './workbench/ObservatoryToolParts.jsx';
import ObservatoryToolbar, { ToolbarStatus } from './workbench/ObservatoryToolbar.jsx';
import { ObservatorySourceButton } from './workbench/ObservatoryTools.jsx';
import { OzoneSourceModePicker, SourceScopePicker } from './MarsSourceControls.jsx';
import { formatTimelineLs } from './timelineFormatting.js';
import { useMarsChartSetting } from './workbench/MarsAnalysisSettings.jsx';
import { getMarsAnalysisFields, MARS_ANALYSIS_BANDS } from './workbench/marsAnalysisSettings.js';

function marsVariableOptions(isZh) {
  return GLOBE_VARIABLE_OPTIONS.map((option) => ({
    value: option.id,
    label: isZh ? option.zh : option.en,
  }));
}

function toolbarSelectStyle(isLight) {
  return {
    minWidth: 0,
    maxWidth: 170,
    padding: '7px 10px',
    borderRadius: 'var(--overview-control-radius)',
    border: `1px solid ${C.borderStrong}`,
    background: isLight ? 'rgba(255,255,255,0.94)' : C.bgCardStrong,
    color: C.ice,
    fontSize: 'calc(12px * var(--font-scale, 1))',
    fontWeight: 600,
    cursor: 'pointer',
  };
}

/** 两档复用同一个年份控件：观测时位于顶部，分析时位于左侧条件栏。 */
export function MarsYearSelect({ showLabel = false }) {
  const { settings } = useSettings();
  const isZh = settings?.language !== 'en';
  const isLight = settings?.theme === 'light';
  const { marsYear, setMarsYear, availableMarsYears, isSwitchingSource } = useDataOverview();
  const label = isZh ? '火星年' : 'Mars year';

  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0, flexShrink: 0 }}>
      {showLabel ? <span>{label}</span> : null}
      <select
        value={String(marsYear)}
        onChange={(event) => setMarsYear(Number(event.target.value))}
        disabled={isSwitchingSource}
        aria-label={label}
        title={label}
        style={toolbarSelectStyle(isLight)}
      >
        {(availableMarsYears || []).map((year) => (
          <option key={year} value={String(year)}>{`MY ${year}`}</option>
        ))}
      </select>
    </label>
  );
}

/** 昼夜图的时间条件：沿用当前数据源的 Ls 范围，不提供自动播放。 */
export function MarsAnalysisLsControl() {
  const { settings } = useSettings();
  const isZh = settings?.language !== 'en';
  const { globalTimeLs, setGlobalTimeLs, overviewTimeline, isSwitchingSource } = useDataOverview();
  const min = Number.isFinite(overviewTimeline?.min) ? overviewTimeline.min : 0;
  const max = Number.isFinite(overviewTimeline?.max) ? overviewTimeline.max : 360;
  const step = Number.isFinite(overviewTimeline?.step) && overviewTimeline.step > 0 ? overviewTimeline.step : 5;
  const label = isZh ? '太阳黄经 Ls' : 'Solar longitude Ls';
  const displayedLs = `${formatTimelineLs(globalTimeLs)}°`;

  return (
    <label className="mars-analysis-ls">
      <span className="mars-analysis-ls__heading">
        <span>{label}</span>
        <span className="mars-analysis-ls__value">{displayedLs}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={globalTimeLs}
        onChange={(event) => setGlobalTimeLs(Number(event.target.value))}
        disabled={isSwitchingSource || max <= min}
        aria-label={label}
        aria-valuetext={displayedLs}
      />
    </label>
  );
}

export function MarsAnalysisConditions({ cardKey }) {
  const { settings } = useSettings();
  const isZh = settings?.language !== 'en';
  const isLight = settings?.theme === 'light';
  const { isSwitchingSource } = useDataOverview();
  const fields = getMarsAnalysisFields(cardKey);
  const driverOnly = cardKey === 'correlation' || cardKey === 'board-drivers';
  const [variable, setVariable] = useMarsChartSetting(cardKey, 'variable', driverOnly ? 'Temperature' : 'o3col');
  const [band, setBand] = useMarsChartSetting(cardKey, 'band', 'Equatorial (30S-30N)');
  const variables = marsVariableOptions(isZh).filter(option => !driverOnly || option.value !== 'o3col');
  return (
    <>
      <MarsYearSelect showLabel />
      {fields.includes('variable') ? (
        <label>
          <span>{isZh ? '分析变量' : 'Variable'}</span>
          <select aria-label={isZh ? '分析变量' : 'Variable'} value={variable}
            onChange={event => setVariable(event.target.value)} disabled={isSwitchingSource} style={toolbarSelectStyle(isLight)}>
            {variables.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
      ) : null}
      {fields.includes('band') ? (
        <label>
          <span>{isZh ? '分析范围' : 'Area'}</span>
          <select aria-label={isZh ? '分析范围' : 'Area'} value={band}
            onChange={event => setBand(event.target.value)} disabled={isSwitchingSource} style={toolbarSelectStyle(isLight)}>
            {MARS_ANALYSIS_BANDS.map(option => <option key={option.id} value={option.id}>{isZh ? option.zh : option.en}</option>)}
          </select>
        </label>
      ) : null}
      {fields.includes('ls') ? <MarsAnalysisLsControl /> : null}
    </>
  );
}

/** 顶部条件栏的槽位：星球 + 数据源 + 变量 + 观测火星年。 */
export function MarsObservatoryToolbarSlots({ sceneSwitch, onOpenPanel, openPanel }) {
  const t = useT();
  const { settings } = useSettings();
  const isZh = settings?.language !== 'en';
  const isLight = settings?.theme === 'light';
  const {
    globeVariable,
    setGlobeVariable,
  } = useDataOverview();

  return {
    planetSlot: sceneSwitch,
    sourceSlot: (
      <ObservatorySourceButton label={t('observatory.dataSource.title')}
        openPanel={openPanel} onOpenPanelChange={onOpenPanel} />
    ),
    variableSlot: (
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0, flexShrink: 0 }}>
        <select
          value={globeVariable}
          onChange={(event) => setGlobeVariable(event.target.value)}
          aria-label={t('observatory.dataSource.variable')}
          title={t('observatory.dataSource.variable')}
          style={toolbarSelectStyle(isLight)}
        >
          {marsVariableOptions(isZh).map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>
    ),
    timeSlot: <MarsYearSelect />,
  };
}

/** Mars 顶部条件栏：内部组装各槽位，调用方只提供视图状态、工具入口与状态摘要。 */
export function MarsObservatoryToolbar({
  sceneSwitch,
  openPanel,
  onOpenPanelChange,
  view,
  onViewChange,
  isZh = true,
  statusItems = [],
  toolsSlot = null,
}) {
  const slots = MarsObservatoryToolbarSlots({
    sceneSwitch,
    onOpenPanel: onOpenPanelChange,
    openPanel,
  });
  return (
    <ObservatoryToolbar
      planetSlot={slots.planetSlot}
      sourceSlot={slots.sourceSlot}
      variableSlot={view === 'analyze' ? null : slots.variableSlot}
      timeSlot={view === 'analyze' ? null : slots.timeSlot}
      toolsSlot={toolsSlot}
      statusSlot={<ToolbarStatus items={statusItems} />}
      view={view}
      onViewChange={onViewChange}
      isZh={isZh}
    />
  );
}

/**
 * 数据源面板统一读取 MCD、OpenMARS 与 NOMAD 的个人上传及来源状态。
 */
export function useMarsUploadOptions() {
  const { user } = useAuth();
  const {
    overviewUploadOptions,
    setOverviewUploadOptions,
    selectedMcdUploadId,
    setSelectedMcdUploadId,
    setOpenMarsSourceMode,
    setNomadSourceMode,
  } = useDataOverview();
  const [loading, setLoading] = React.useState(false);

  useEffect(() => {
    if (!user?.id) {
      setOverviewUploadOptions({ mcd: [], openmars: [], nomad: [] });
      setSelectedMcdUploadId(null);
      setOpenMarsSourceMode('official');
      setNomadSourceMode('official');
      return undefined;
    }

    let active = true;
    setLoading(true);
    getMyUploads()
      .then((uploads) => {
        if (!active) return;
        const nextOptions = buildOverviewUploadOptions(uploads);
        setOverviewUploadOptions(nextOptions);
        setSelectedMcdUploadId((current) => (nextOptions.mcd.some((item) => item.id === current) ? current : null));
        setOpenMarsSourceMode((current) => (nextOptions.openmars.length > 0 ? current : 'official'));
        setNomadSourceMode((current) => (nextOptions.nomad.length > 0 ? current : 'official'));
      })
      .catch(() => {
        if (active) setOverviewUploadOptions({ mcd: [], openmars: [], nomad: [] });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [
    setNomadSourceMode, setOpenMarsSourceMode, setOverviewUploadOptions, setSelectedMcdUploadId, user?.id,
  ]);

  return { user, uploadOptions: overviewUploadOptions, loading };
}

/** Mars 观测台的四个设置面板内容：数据源 / 图层 / 显示 / 点位。 */
export function useMarsObservatoryPanels() {
  const t = useT();
  const { settings } = useSettings();
  const isZh = settings?.language !== 'en';
  const isLight = settings?.theme === 'light';
  const {
    marsYear,
    setMarsYear,
    availableMarsYears,
    selectedMcdUploadId,
    setSelectedMcdUploadId,
    openMarsSourceMode,
    setOpenMarsSourceMode,
    nomadSourceMode,
    setNomadSourceMode,
    ozoneLayerSourceSelection,
    globalTimeLs,
    isSwitchingSource,
    sourceMeta,
    globeVariable,
    ozoneDisplayMode,
    setOzoneDisplayMode,
    overviewOzoneCapabilities,
    autoRotate,
    setAutoRotate,
    gestureEnabled,
    setGestureEnabled,
    showConcentration3D,
    setShowConcentration3D,
    showGeoAnnotations,
    setShowGeoAnnotations,
    showMarsTexture,
    setShowMarsTexture,
    selectedCoordinate,
  } = useDataOverview();
  const { user, uploadOptions, loading } = useMarsUploadOptions();

  const yearOptions = useMemo(
    () => (availableMarsYears || []).map((year) => ({ value: String(year), label: `MY ${year}` })),
    [availableMarsYears],
  );

  const mcdUploadYearOptions = useMemo(
    () => buildUploadYearOptions(uploadOptions.mcd),
    [uploadOptions.mcd],
  );

  const sourceMessage = useMemo(() => {
    const rawMessage = sourceMeta?.message;
    if (isZh) return rawMessage || '';
    return /[a-zA-Z]/.test(rawMessage || '') && !/[\u4e00-\u9fff]/.test(rawMessage || '') ? rawMessage : '';
  }, [isZh, sourceMeta]);

  const handleOfficialYearChange = useCallback((value) => setMarsYear(Number(value)), [setMarsYear]);

  const panels = {
    // 数据源：MCD 主源、臭氧对照方式与 OpenMARS / NOMAD 来源选择。
    source: (
      <>
        <PanelSectionLabel>{t('observatory.dataSource.title')}</PanelSectionLabel>
        <SourceScopePicker
          title={t('observatory.dataSource.title')}
          sourceName="MCD"
          selectedUploadId={selectedMcdUploadId}
          onSelectUpload={setSelectedMcdUploadId}
          personalOptions={mcdUploadYearOptions}
          officialOptions={yearOptions}
          officialValue={marsYear}
          onOfficialChange={handleOfficialYearChange}
          disabled={isSwitchingSource}
          loading={loading}
          showEmptyPersonalHint={Boolean(user)}
          isSignedIn={Boolean(user)}
          isLight={isLight}
          isZh={isZh}
          accent="#f97316"
        />
        {loading || isSwitchingSource ? (
          <div style={{ color: C.ice50, fontSize: 'calc(10px * var(--font-scale, 1))', lineHeight: 1.5 }}>
            {t('observatory.dataSource.loading')}
          </div>
        ) : null}
        {!loading && sourceMessage ? (
          <div style={{ color: C.ice50, fontSize: 'calc(10px * var(--font-scale, 1))', lineHeight: 1.55 }}>
            {sourceMessage}
          </div>
        ) : null}
        <PanelCard>
          <FieldRow
            label={t('observatory.dataSource.fingerprint')}
            value={sourceMeta?.dataset_fingerprint || sourceMeta?.fingerprint || '--'}
          />
          <FieldRow
            label={t('observatory.dataSource.effectiveSource')}
            value={sourceMeta?.effective_source || '--'}
          />
        </PanelCard>
        {globeVariable === 'o3col' ? (
          <>
            <PanelSectionLabel>{t('observatory.dataSource.ozoneDisplay')}</PanelSectionLabel>
            <SegmentedToggle
              value={ozoneDisplayMode}
              onChange={setOzoneDisplayMode}
              disabled={isSwitchingSource}
              isLight={isLight}
              options={[
                { value: 'mcd', label: 'MCD', activeBg: 'rgba(249,115,22,0.14)', activeColor: '#f97316' },
                {
                  value: 'multi-source',
                  label: isZh ? '多源' : 'Sources',
                  activeBg: 'rgba(56,189,248,0.14)',
                  activeColor: '#38bdf8',
                  disabled: !overviewOzoneCapabilities?.openmars && !overviewOzoneCapabilities?.nomad,
                  disabledTitle: t('observatory.layerPanel.multiSourceDisabled'),
                },
                {
                  value: 'validation',
                  label: isZh ? '验证' : 'Validate',
                  activeBg: 'rgba(52,211,153,0.14)',
                  activeColor: '#34d399',
                  disabled: !overviewOzoneCapabilities?.nomad,
                  disabledTitle: t('observatory.layerPanel.validationDisabled'),
                },
                {
                  value: 'diff',
                  label: isZh ? '差值' : 'Diff',
                  activeBg: 'rgba(74,158,255,0.14)',
                  activeColor: C.blue,
                  disabled: !(overviewOzoneCapabilities?.diff_pairs || []).length,
                  disabledTitle: t('observatory.layerPanel.diffDisabled'),
                },
              ]}
            />

            <OzoneSourceModePicker
              title={t('observatory.dataSource.openMarsOzone')}
              sourceName="OpenMARS"
              mode={openMarsSourceMode}
              onModeChange={setOpenMarsSourceMode}
              personalUploads={uploadOptions.openmars}
              selectedSource={ozoneLayerSourceSelection?.sources?.openmars}
              marsYear={marsYear}
              ls={globalTimeLs}
              disabled={isSwitchingSource}
              loading={loading}
              isSignedIn={Boolean(user)}
              isLight={isLight}
              isZh={isZh}
              accent="#38bdf8"
            />
            <OzoneSourceModePicker
              title={t('observatory.dataSource.nomadOzone')}
              sourceName="NOMAD"
              mode={nomadSourceMode}
              onModeChange={setNomadSourceMode}
              personalUploads={uploadOptions.nomad}
              selectedSource={ozoneLayerSourceSelection?.sources?.nomad}
              marsYear={marsYear}
              ls={globalTimeLs}
              disabled={isSwitchingSource}
              loading={loading}
              isSignedIn={Boolean(user)}
              isLight={isLight}
              isZh={isZh}
              accent="#34d399"
            />
          </>
        ) : null}
      </>
    ),

    // 图层：与地球一致，只控制球体数据场和地理参考的可见性。
    layers: (
      <>
        <PanelSectionLabel>{t('observatory.layerPanel.globeLayers')}</PanelSectionLabel>
        <PanelCard>
          <InlineSwitch
            label={t('observatory.layerPanel.showField')}
            checked={showConcentration3D}
            onChange={() => setShowConcentration3D((value) => !value)}
            isLight={isLight}
          />
          <InlineSwitch
            label={t('observatory.layerPanel.graticule')}
            checked={showGeoAnnotations}
            onChange={() => setShowGeoAnnotations((value) => !value)}
            isLight={isLight}
          />
          <InlineSwitch
            label={t('observatory.layerPanel.showMarsTexture')}
            checked={showMarsTexture}
            onChange={() => setShowMarsTexture((value) => !value)}
            isLight={isLight}
          />
        </PanelCard>
      </>
    ),

    // 显示：旋转与手势交互。
    display: (
      <>
        <PanelSectionLabel>{t('observatory.displayPanel.rotationAndGesture')}</PanelSectionLabel>
        <PanelCard>
          <InlineSwitch
            label={t('observatory.displayPanel.autoRotateGlobe')}
            checked={autoRotate}
            onChange={() => setAutoRotate((value) => !value)}
            isLight={isLight}
          />
          <InlineSwitch
            label={t('observatory.displayPanel.enableGesture')}
            checked={gestureEnabled}
            onChange={() => setGestureEnabled((value) => !value)}
            accent={C.mars}
            isLight={isLight}
          />
        </PanelCard>
      </>
    ),

    // 点位：Mars 点位由球面点击或手势触发，这里说明交互方式并显示当前点位。
    point: (
      <>
        <PanelSectionLabel>{t('observatory.tools.pointTitle')}</PanelSectionLabel>
        <PanelCard>
          <p style={{ margin: 0, color: C.ice60, fontSize: 'calc(11px * var(--font-scale, 1))', lineHeight: 1.65 }}>
            {isZh
              ? '点击球面会暂停播放，右侧显示最近网格点的全年曲线，与左侧全球均值共用 Ls 时间轴，但数值刻度各用本轨极值（两轨形状可直接比起伏，不能比绝对高度）。点位详细对比仍可在单项分析中查看。'
              : 'Click the globe to pause playback and show the nearest grid point’s annual curve on the right. It shares the Ls axis with the global mean on the left, while each rail scales to its own value range, so compare shape rather than absolute height. Detailed comparisons remain available in individual analysis.'}
          </p>
          <FieldRow
            label={isZh ? '当前点位视图' : 'Point view'}
            value={selectedCoordinate
              ? `LAT ${Number(selectedCoordinate.lat).toFixed(1)}° / LNG ${Number(selectedCoordinate.lng).toFixed(1)}°`
              : (isZh ? '未选择' : 'None')}
          />
        </PanelCard>
      </>
    ),
  };

  return { panels };
}
