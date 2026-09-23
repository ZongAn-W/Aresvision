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
 * 点位曲线与区域均值曲线。
 *
 * 两条线都是原始物理值、同一单位；不做 Z-score、平滑或插值。
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
    () => buildSeriesLayout({ variable, units, displayedDate, isLight }),
    [variable, units, displayedDate, isLight],
  );

  const pointLayout = useMemo(
    () => buildSeriesLayout({ variable, units, displayedDate, isLight }),
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
    <div className="earth-series">
      <div className="earth-series__summary">
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
