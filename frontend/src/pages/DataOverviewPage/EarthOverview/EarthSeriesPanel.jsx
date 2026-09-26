import React, { useMemo } from 'react';
import Plot from 'react-plotly.js';
import { useT } from '../../../i18n/index.js';
import { useSettings } from '../../../contexts/SettingsContext';
import {
  buildPointTrace,
  buildRegionalTrace,
  buildSeriesLayout,
  describeCurrent,
} from './earthSeriesModel.js';
import { EARTH_VARIABLE_LABEL_KEYS, formatEarthNumber } from './earthOverviewModel.js';

const PLOTLY_CONFIG = { displayModeBar: false, responsive: true };

/**
 * dock 变体的曲线高度。
 *
 * 分析区里这一块要和「AI 解读」并排放在主图下面的一行里
 * （见 workbench/observatoryLayout.js 的 `DOCK_BOTTOM_PAIR_HEIGHT`），
 * 所以曲线不能再用 200px：那会把整行撑到第一屏之外，只剩半张卡片露在折叠线下。
 */
const DOCK_PLOT_HEIGHT = 132;

/**
 * 点位曲线与区域均值曲线。
 *
 * 两条线都是原始物理值、同一单位；不做 Z-score、平滑或插值。
 * `dock` 变体用于分析区：不再占满剩余高度，而是按内容高度排在主图下方
 * （两条曲线横排），把纵向空间留给主图。
 */
export default function EarthSeriesPanel({
  variable,
  units,
  displayedDate,
  pointSeries,
  regionalSeries,
  regionCoverage,
  onDateSelect,
}) {
  const t = useT();
  const { settings } = useSettings();
  const isLight = settings?.theme === 'light';

  const described = useMemo(
    () => describeCurrent({ pointSeries, regionalSeries, variable, units, displayedDate }),
    [pointSeries, regionalSeries, variable, units, displayedDate],
  );

  const regionalLayout = useMemo(
    () => buildSeriesLayout({ variable, units, displayedDate, isLight, height: DOCK_PLOT_HEIGHT }),
    [variable, units, displayedDate, isLight],
  );

  const pointLayout = useMemo(
    () => buildSeriesLayout({ variable, units, displayedDate, isLight, height: DOCK_PLOT_HEIGHT }),
    [variable, units, displayedDate, isLight],
  );

  const handleClick = (event) => {
    const date = event?.points?.[0]?.x;
    if (typeof date === 'string') {
      const iso = date.slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) onDateSelect?.(iso);
    }
  };

  const variableLabel = t(EARTH_VARIABLE_LABEL_KEYS[variable] || variable);

  return (
    <div className="earth-series earth-series--dock">
      {/* 摘要压成一行：横排的两个数字本来一眼就能看完，做成卡片会白占一行高度。 */}
      <div className="earth-series__summary earth-series__summary--inline">
        <h3>{variableLabel}</h3>
        <dl>
          <div>
            <dt>{t('earthOverview.series.currentPoint')}</dt>
            <dd>{formatEarthNumber(described.point, 2)} {described.units}</dd>
          </div>
          <div>
            <dt>{t('earthOverview.series.coverageMean')}</dt>
            <dd>{formatEarthNumber(described.regional, 2)} {described.units}</dd>
          </div>
          <div>
            <dt>{t('earthOverview.series.displayedDate')}</dt>
            <dd>{displayedDate || '--'}</dd>
          </div>
        </dl>
      </div>

      <div className="earth-series__panel">
        <h4>{t('earthOverview.series.pointTitle')}</h4>
        {pointSeries ? (
          <Plot
            data={[buildPointTrace(pointSeries, { variable, units, isLight })]}
            layout={pointLayout}
            config={PLOTLY_CONFIG}
            onClick={handleClick}
            style={{ width: '100%' }}
          />
        ) : (
          <p className="earth-series__empty">{t('earthOverview.series.pickPointHint')}</p>
        )}
      </div>

      <div className="earth-series__panel">
        <h4>{t('earthOverview.series.regionalTitle')}</h4>
        <p className="earth-series__note">
          {t('earthOverview.series.regionalNote')}
          {regionCoverage
            ? ` (${regionCoverage.latitude_range[0]}°~${regionCoverage.latitude_range[1]}°, ${regionCoverage.longitude_range[0]}°~${regionCoverage.longitude_range[1]}°)`
            : ''}
        </p>
        {regionalSeries ? (
          <Plot
            data={[buildRegionalTrace(regionalSeries, { variable, units, isLight })]}
            layout={regionalLayout}
            config={PLOTLY_CONFIG}
            onClick={handleClick}
            style={{ width: '100%' }}
          />
        ) : (
          <p className="earth-series__empty">{t('earthOverview.series.loading')}</p>
        )}
      </div>
    </div>
  );
}
