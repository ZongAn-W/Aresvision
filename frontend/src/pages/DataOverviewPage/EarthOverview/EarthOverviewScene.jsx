import React, { useState } from 'react';
import { useT } from '../../../i18n/index.js';
import { useSettings } from '../../../contexts/SettingsContext';
import { makeGradient } from '../../../utils/colormaps';
import EarthMap2D from './EarthMap2D.jsx';
import EarthTimeline from './EarthTimeline.jsx';
import EarthSeriesPanel from './EarthSeriesPanel.jsx';
import { useEarthOverview } from './useEarthOverview.js';
import {
  EARTH_VARIABLE_LABEL_KEYS,
  EARTH_VARIABLES,
  earthColormap,
  formatEarthNumber,
} from './earthOverviewModel.js';
import './earthOverview.css';

/** 数据说明卡：来源、日期范围、网格与限制全部来自 descriptor。 */
function EarthInfoCard({ descriptor }) {
  const t = useT();
  const grid = descriptor?.grid;
  const time = descriptor?.time;
  const coverage = grid
    ? `${grid.latitude_range?.[0]}° ~ ${grid.latitude_range?.[1]}°, ${grid.longitude_range?.[0]}° ~ ${grid.longitude_range?.[1]}°`
    : '--';
  const shape = grid?.shape ? `${grid.shape[0]} × ${grid.shape[1]}` : '--';
  const resolution = grid
    ? `${grid.latitude_step}° × ${grid.longitude_step}°`
    : '--';

  return (
    <section className="earth-info" aria-label={t('earthOverview.info.title')}>
      <h3>{t('earthOverview.info.title')}</h3>
      <ul>
        <li>{t('earthOverview.info.source')}</li>
        <li>{t('earthOverview.info.dateRange')}: {time?.start || '--'} ~ {time?.end || '--'} ({time?.count ?? '--'})</li>
        <li>{t('earthOverview.info.grid')}: {shape} · {resolution}</li>
        <li>{t('earthOverview.info.coverage')}: {coverage}</li>
        <li>{t('earthOverview.info.units')}: {EARTH_VARIABLES.map((id) => `${id} ${descriptor?.variables?.find((v) => v.id === id)?.units || ''}`.trim()).join(' · ')}</li>
        <li>{t('earthOverview.info.dailyMean')}</li>
        <li>{grid?.coverage === 'global'
          ? t('earthOverview.info.areaWeighted')
          : t('earthOverview.info.pointSampled')}</li>
        <li>{grid?.coverage === 'global'
          ? t('earthOverview.info.globalCoverage')
          : t('earthOverview.info.notGlobal')}</li>
      </ul>
      <details>
        <summary>{t('earthOverview.info.details')}</summary>
        <dl>
          <div><dt>{t('earthOverview.info.datasetId')}</dt><dd>{descriptor?.dataset_id || '--'}</dd></div>
          <div><dt>{t('earthOverview.info.version')}</dt><dd>{descriptor?.dataset_version || '--'}</dd></div>
          <div><dt>{t('earthOverview.info.calendar')}</dt><dd>{time?.calendar || '--'}</dd></div>
        </dl>
      </details>
    </section>
  );
}

/**
 * 二维地球总览场景。
 *
 * 不挂载火星三维背景、摄像头或 Mars 查询组件；选择和日期完全基于真实日期。
 */
export default function EarthOverviewScene({ selection, onSelectionChange, sceneSwitch }) {
  const t = useT();
  const { settings } = useSettings();
  const isLight = settings?.theme === 'light';
  const [latInput, setLatInput] = useState('');
  const [lonInput, setLonInput] = useState('');
  const [inputError, setInputError] = useState('');

  const overview = useEarthOverview(selection);
  const {
    descriptor, descriptorLoading, descriptorError, ready, start, end,
    field, displayedDate, fieldRequestedDate, fieldLoading, fieldError,
    regionalSeries, pointSeries, seriesError, pointGrid, playing, outOfCoverage,
    setPlaying, chooseDate, chooseVariable, choosePoint, stepDate, restart,
    markOutOfCoverage, dismissOutOfCoverage,
    retryDescriptor,
  } = overview;

  // Keep the parent selection in sync so leaving and returning to Earth is stable.
  React.useEffect(() => {
    if (!onSelectionChange) return;
    onSelectionChange({
      date: overview.selection.date,
      variable: overview.selection.variable,
      point: overview.selection.point,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overview.selection.date, overview.selection.variable, overview.selection.point]);

  const colormap = earthColormap(overview.selection.variable, settings?.colormap);
  const unavailable = descriptorError || (descriptor && !ready);
  const units = field?.units
    || descriptor?.variables?.find((v) => v.id === overview.selection.variable)?.units
    || '';

  const submitCoordinates = (event) => {
    event.preventDefault();
    const lat = Number(latInput);
    const lon = Number(lonInput);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      setInputError(t('earthOverview.errors.invalidCoordinates'));
      return;
    }
    const coverage = field?.coverage || (descriptor?.grid ? {
      latitude_range: descriptor.grid.latitude_range,
      longitude_range: descriptor.grid.longitude_range,
      wrap_longitude: descriptor.grid.wrap_longitude,
    } : null);
    if (!coverage) {
      setInputError(t('earthOverview.errors.datasetUnavailable'));
      return;
    }
    if (lat < coverage.latitude_range[0] || lat > coverage.latitude_range[1]
      || lon < coverage.longitude_range[0] || lon > coverage.longitude_range[1]) {
      setInputError(t('earthOverview.errors.outsideCoverage'));
      return;
    }
    setInputError('');
    choosePoint({ lat, lon });
  };

  const handlePointSelect = (picked) => {
    choosePoint({ lat: picked.preview.lat, lon: picked.preview.lon });
  };

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

        {unavailable ? (
          <div className="earth-notice earth-notice--error" role="alert">
            <strong>{t('earthOverview.errors.datasetUnavailable')}</strong>
            {descriptorError?.availabilityReason || descriptor?.availability_reason ? (
              <code>{descriptorError?.availabilityReason || descriptor.availability_reason}</code>
            ) : null}
            <button type="button" className="earth-btn" onClick={() => retryDescriptor()}>
              {t('earthOverview.actions.retry')}
            </button>
          </div>
        ) : null}

        {descriptorLoading && !descriptor ? (
          <div className="earth-notice" role="status">{t('earthOverview.loading')}</div>
        ) : null}

        <div className="earth-scene__controls">
          <label className="earth-field">
            <span>{t('earthOverview.controls.variable')}</span>
            <select
              value={overview.selection.variable}
              onChange={(event) => chooseVariable(event.target.value)}
              disabled={!ready}
            >
              {EARTH_VARIABLES.map((id) => (
                <option key={id} value={id}>{t(EARTH_VARIABLE_LABEL_KEYS[id])}</option>
              ))}
            </select>
          </label>

          <div className="earth-field">
            <span>{t('earthOverview.controls.units')}</span>
            <p className="earth-field__static">{units || '--'}</p>
          </div>

          <form className="earth-coord" onSubmit={submitCoordinates}>
            <label className="earth-field">
              <span>{t('earthOverview.controls.latitude')}</span>
              <input
                type="number" step="0.1" min="-90" max="90"
                value={latInput}
                disabled={!ready}
                onChange={(event) => setLatInput(event.target.value)}
              />
            </label>
            <label className="earth-field">
              <span>{t('earthOverview.controls.longitude')}</span>
              <input
                type="number" step="0.1" min="-180" max="180"
                value={lonInput}
                disabled={!ready}
                onChange={(event) => setLonInput(event.target.value)}
              />
            </label>
            <button type="submit" className="earth-btn" disabled={!ready}>
              {t('earthOverview.actions.viewPoint')}
            </button>
          </form>
        </div>

        {inputError ? <p className="earth-inline-error" role="alert">{inputError}</p> : null}

        {outOfCoverage ? (
          <div className="earth-notice earth-notice--warning" role="status">
            {t('earthOverview.map.noDataOutside')}
            <button type="button" className="earth-btn" onClick={() => dismissOutOfCoverage()}>
              {t('earthOverview.actions.dismiss')}
            </button>
          </div>
        ) : null}

        <EarthTimeline
          start={start}
          end={end}
          requestedDate={overview.selection.date}
          displayedDate={displayedDate}
          playing={playing}
          loading={fieldLoading}
          disabled={!ready}
          onDateChange={chooseDate}
          onPlayChange={setPlaying}
          onRestart={restart}
        />

        {fieldError ? (
          <div className="earth-notice earth-notice--error" role="alert">
            <strong>{t(`earthOverview.errors.${fieldError.code}`, {}) !== `earthOverview.errors.${fieldError.code}`
              ? t(`earthOverview.errors.${fieldError.code}`)
              : t('earthOverview.errors.invalidRequest')}</strong>
            {fieldError.availabilityReason ? <code>{fieldError.availabilityReason}</code> : null}
            <button
              type="button"
              className="earth-btn"
              onClick={() => chooseDate(overview.selection.date)}
            >
              {t('earthOverview.actions.retry')}
            </button>
          </div>
        ) : null}

        <div className="earth-scene__body">
          <div className="earth-scene__map">
            {field ? (
              <>
                <p className="earth-scene__caption">
                  {t('earthOverview.map.showingDate')}: <strong>{field.date}</strong>
                  {fieldRequestedDate && fieldRequestedDate !== field.date
                    ? ` · ${t('earthOverview.timeline.loadingSelectedDate')}: ${fieldRequestedDate}`
                    : ''}
                </p>
                <EarthMap2D
                  field={field}
                  selectedPoint={pointGrid}
                  colormap={colormap}
                  onPointSelect={handlePointSelect}
                  onOutOfCoverage={markOutOfCoverage}
                />
                <div className="earth-legend">
                  <span>{formatEarthNumber(field.color_range.min, 2)} {field.units}</span>
                  <span
                    className="earth-legend__ramp"
                    style={{ background: makeGradient(colormap) }}
                    aria-hidden="true"
                  />
                  <span>{formatEarthNumber(field.color_range.max, 2)} {field.units}</span>
                  <span className="earth-legend__note">
                    {field.color_range.centered_on_zero
                      ? `${t('earthOverview.map.centeredOnZero')} · `
                      : ''}
                    {field.coverage.wrap_longitude ? t('earthOverview.info.globalCoverage') : t('earthOverview.map.noDataOutside')}
                  </span>
                </div>
              </>
            ) : (
              <div className="earth-notice" role="status">
                {fieldLoading ? t('earthOverview.loading') : t('earthOverview.map.noField')}
              </div>
            )}
          </div>

          <aside className="earth-scene__side">
            <EarthInfoCard descriptor={descriptor} />
            {seriesError ? (
              <p className="earth-inline-error" role="alert">
                {t('earthOverview.errors.invalidRequest')}
                {seriesError.availabilityReason ? ` (${seriesError.availabilityReason})` : ''}
              </p>
            ) : null}
          </aside>
        </div>

        <EarthSeriesPanel
          variable={field?.variable || overview.selection.variable}
          units={units}
          displayedDate={displayedDate}
          pointSeries={pointSeries}
          regionalSeries={regionalSeries}
          regionCoverage={field?.coverage || regionalSeries?.coverage || null}
          onDateSelect={chooseDate}
        />

        <p className="earth-scene__footnote">{t('earthOverview.scopeNote')}</p>
      </div>
    </div>
  );
}
