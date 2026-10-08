import { useEffect, useMemo, useState } from 'react';
import EarthMap2D from '../DataOverviewPage/EarthOverview/EarthMap2D';
import {
  EARTH_FIELD_KINDS,
  EARTH_TARGET_UNIT,
  buildEarthFieldPayload,
  describeEarthModelIdentity,
  earthFieldLabel,
  earthLeadLabel,
  earthTimestampList,
  getEarthCadence,
  isOriginSelectable,
  readEarthHorizonMetric,
  readEarthLeadMetric,
  readEarthMetric,
  readEarthResponseModelIdentity,
  resolveEarthColorRanges,
} from './earthPredictModel';
import './earthPredictPanel.css';
import ResearchExportButton from './ResearchExportButton';

const EARTH_COLORMAP = 'inferno';
const EARTH_RESIDUAL_COLORMAP = 'rdbu';

/**
 * Earth 历史预测面板。
 *
 * 只消费 `/api/earth/predict/*` 的返回值：不再做单位换算（地球 TO3 本身就是
 * DU），也不复用火星的 MY/Ls 控件与场组件，避免把火星口径带到地球数据上。
 * 三张场图沿用数据总览的二维地球地图组件，保持同一套经纬网格与色带习惯。
 */
export default function EarthPredictPanel({
  copy,
  context,
  contextLoading,
  contextError,
  result,
  resultError,
  loading,
  origin,
  onOriginChange,
  onRun,
  onReloadContext,
  selectedDay,
  onSelectDay,
  taskOptions,
  selectedTaskId,
  onSelectTask,
  showTaskSelector = true,
}) {
  const [kindViews] = useState({ prediction: 'physical', reference: 'physical', residual: 'residual' });
  const cadence = useMemo(() => getEarthCadence(context || result), [context, result]);
  const isThreeHourly = cadence.threeHourly;

  const dayIndex = Number.isInteger(selectedDay) ? selectedDay : 0;
  const ranges = useMemo(() => resolveEarthColorRanges(result, dayIndex), [result, dayIndex]);
  const activeDates = earthTimestampList(result);

  useEffect(() => {
    // 重新取数后回到第一天，避免停留在已不存在的第三天。
    if (selectedDay > activeDates.length - 1 && activeDates.length > 0) onSelectDay(0);
  }, [activeDates.length, selectedDay, onSelectDay]);

  const origins = context?.origins;
  const originSelectable = isOriginSelectable(origins, origin);
  const canRun = Boolean(context) && originSelectable && !loading;

  const fields = EARTH_FIELD_KINDS.map((kind) => {
    const colorRange = kind === 'residual' ? ranges.residual : ranges.physical;
    const payload = result
      ? buildEarthFieldPayload({
          response: result,
          dayIndex,
          kind,
          colormap: kind === 'residual' ? EARTH_RESIDUAL_COLORMAP : EARTH_COLORMAP,
          colorRange,
        })
      : null;
    return { kind, payload };
  });

  const metrics = result?.metrics;
  // 模型身份优先取本次预测结果（服务端固定返回），回退到上下文，保证切换任务后
  // 展示的仍是这次预测真正使用的模型。
  const contextModelIdentity = useMemo(
    () => readEarthResponseModelIdentity(result) || readEarthResponseModelIdentity(context),
    [context, result],
  );
  const contextWarnings = useMemo(() => {
    const warnings = result?.warnings?.length ? result.warnings : context?.warnings;
    return Array.isArray(warnings) ? warnings.filter(Boolean) : [];
  }, [context, result]);

  return (
    <div className="earth-predict-panel" data-earth-predict-panel="true">
      <header className="earth-predict-head">
        <div>
          <h2>{copy.title}</h2>
          <p className="earth-predict-note">{isThreeHourly ? (copy.threeHourlyNote || copy.note) : copy.note}</p>
        </div>
        <span className="earth-predict-unit" data-earth-unit={EARTH_TARGET_UNIT}>{EARTH_TARGET_UNIT}</span>
      </header>
      <ResearchExportButton sources={[result?.task_id === Number(selectedTaskId) && result?.forecast_origin === origin ? result.export_ref : null]}
        kind="triptych" step={dayIndex} disabled={loading || contextLoading} />

      <div className="earth-predict-controls">
        {showTaskSelector ? <label className="earth-predict-field">
          <span>{copy.taskLabel}</span>
          <select
            value={selectedTaskId || ''}
            onChange={(event) => onSelectTask(event.target.value)}
            data-earth-task-select="true"
          >
            <option value="">{copy.taskPlaceholder}</option>
            {taskOptions.map((option) => (
              <option key={option.id} value={option.id}>{`#${option.id} ${option.label}`}</option>
            ))}
          </select>
        </label> : null}

        <label className="earth-predict-field">
          <span>{copy.originLabel}</span>
          <input
            type={isThreeHourly ? 'datetime-local' : 'date'}
            value={isThreeHourly ? toDateTimeLocal(origin) : (origin || '')}
            min={isThreeHourly ? toDateTimeLocal(origins?.start) : (origins?.start || undefined)}
            max={isThreeHourly ? toDateTimeLocal(origins?.end) : (origins?.end || undefined)}
            step={isThreeHourly ? 10800 : undefined}
            disabled={!context}
            onChange={(event) => onOriginChange(isThreeHourly ? fromDateTimeLocal(event.target.value) : event.target.value)}
            data-earth-origin-input="true"
          />
        </label>

        <div className="earth-predict-range" data-earth-origin-range="true">
          {origins
            ? copy.originRange(origins.start, origins.end, origins.count)
            : copy.originRangeUnknown}
        </div>

        <button
          type="button"
          className="earth-predict-run"
          disabled={!canRun}
          onClick={onRun}
          data-earth-run-button="true"
        >
          {loading ? copy.running : copy.run}
        </button>
        <button type="button" className="earth-predict-secondary" onClick={onReloadContext}>
          {copy.reload}
        </button>
      </div>

      {contextLoading ? <div className="earth-predict-status" role="status">{copy.loadingContext}</div> : null}
      {contextError ? (
        <div className="earth-predict-status" data-tone="error" role="alert" data-earth-context-error="true">
          {contextError}
        </div>
      ) : null}
      {resultError ? (
        <div className="earth-predict-status" data-tone="error" role="alert" data-earth-result-error="true">
          {resultError}
        </div>
      ) : null}
      {origin && !originSelectable && context ? (
        <div className="earth-predict-status" data-tone="warning" role="status" data-earth-origin-invalid="true">
          {copy.originOutOfRange}
        </div>
      ) : null}

      {context ? (
        <dl className="earth-predict-facts" data-earth-context-facts="true">
          <div><dt>{copy.factDataset}</dt><dd>{`${context.dataset_id} · ${context.dataset_version}`}</dd></div>
          {/* 模型身份：训练用的是官方 DLinear 还是用户上传模型，必须一眼可见。 */}
          <div>
            <dt>{copy.factModel}</dt>
            <dd data-earth-context-model="true" data-model-source={contextModelIdentity.modelSource}>
              {describeEarthModelIdentity(contextModelIdentity, copy)}
            </dd>
          </div>
          <div><dt>{copy.factGrid}</dt><dd>{`${context.grid.shape[0]} × ${context.grid.shape[1]}`}</dd></div>
          <div><dt>{copy.factWindow}</dt><dd>{`${context.window} → ${context.horizon} ${isThreeHourly ? copy.stepUnit : copy.dayUnit}`}</dd></div>
          <div><dt>{copy.factFrequency}</dt><dd>{isThreeHourly ? `${cadence.frequencyHours}h UTC` : copy.dailyFrequency}</dd></div>
          <div><dt>{copy.factChannels}</dt><dd>{context.input_channel_order.join(', ')}</dd></div>
          <div><dt>{copy.factBestEpoch}</dt><dd>{context.run?.best_epoch ?? '—'}</dd></div>
          <div><dt>{copy.factTestRmse}</dt><dd>{formatValue(context.metrics?.splits?.test?.overall?.rmse)}</dd></div>
        </dl>
      ) : null}

      {/* 原始模型文件缺失或被改动时，服务端会说明它改用了 checkpoint 内的副本。 */}
      {contextWarnings.length ? (
        <div className="earth-predict-status" data-tone="warning" role="status" data-earth-model-warnings="true">
          {contextWarnings.map((warning) => <p key={warning}>{warning}</p>)}
        </div>
      ) : null}
      {result ? (
        <>
          <div className="earth-predict-days" role="tablist" aria-label={copy.dayTabsLabel} data-earth-day-tabs="true">
            {activeDates.map((date, index) => (
              <button
                key={date}
                type="button"
                role="tab"
                aria-selected={index === dayIndex}
                className="earth-predict-day"
                data-earth-day={date}
                onClick={() => onSelectDay(index)}
              >
                <b>{earthLeadLabel(index, context || result, { daySuffix: copy.daySuffix })}</b>
                <span>{date}</span>
                <small>{`RMSE ${formatValue(readEarthLeadMetric(metrics, index + 1, 'rmse'))}`}</small>
              </button>
            ))}
          </div>

          <p className="earth-predict-origin-line" data-earth-origin-line="true">
            {copy.originLine(result.forecast_origin, (result.input_timestamps || result.input_dates || [])[0], (result.input_timestamps || result.input_dates || []).slice(-1)[0], isThreeHourly, result.window, result.horizon)}
            {result.origin_split ? ` · ${copy.originSplit(result.origin_split)}` : ''}
          </p>

          <div className="earth-predict-fields" data-earth-fields="true">
            {fields.map(({ kind, payload }) => (
              <section className="earth-predict-field-card" key={kind} data-earth-field={kind}>
                <header>
                  <strong>{earthFieldLabel(kind, copy.fieldLabels)}</strong>
                  <span>{kind === 'residual' ? copy.residualUnit : EARTH_TARGET_UNIT}</span>
                  <em>{kindViews[kind] === 'residual' ? copy.residualMode : copy.physicalMode}</em>
                </header>
                {payload ? (
                  <EarthMap2D
                    field={payload}
                    colormap={payload.colormap}
                    selectedPoint={null}
                    onPointSelect={undefined}
                    onOutOfCoverage={undefined}
                  />
                ) : (
                  <div className="earth-predict-empty">{copy.fieldEmpty}</div>
                )}
                {payload ? (
                  <footer className="earth-predict-field-foot">
                    <span>{`${copy.rangeLabel} ${formatValue(payload.color_range.min)} ~ ${formatValue(payload.color_range.max)}`}</span>
                    <span>{`${copy.validCellsLabel} ${payload.valid_cells ?? '—'}`}</span>
                  </footer>
                ) : null}
              </section>
            ))}
          </div>

          <div className="earth-predict-metrics" data-earth-metrics="true">
            {['rmse', 'mae'].map((key) => (
              <div className="earth-predict-metric" key={key} data-earth-metric={key}>
                <span>{key.toUpperCase()}</span>
                <b>{formatValue(readEarthMetric(metrics, key))}</b>
                <small>{EARTH_TARGET_UNIT}</small>
              </div>
            ))}
          </div>

          <table className="earth-predict-lead-table" data-earth-lead-table="true">
            <thead>
              <tr>
                <th>{copy.leadHeader}</th>
                <th>{isThreeHourly ? copy.timestampHeader : copy.dateHeader}</th>
                <th>RMSE ({EARTH_TARGET_UNIT})</th>
                <th>MAE ({EARTH_TARGET_UNIT})</th>
              </tr>
            </thead>
            <tbody>
              {activeDates.map((date, index) => (
                <tr key={date}>
                  <td>{earthLeadLabel(index, context || result, { daySuffix: copy.daySuffix })}</td>
                  <td>{date}</td>
                  <td>{formatValue(readEarthLeadMetric(metrics, index + 1, 'rmse'))}</td>
                  <td>{formatValue(readEarthLeadMetric(metrics, index + 1, 'mae'))}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {isThreeHourly && metrics?.by_horizon?.length ? (
            <div className="earth-predict-horizons" data-earth-horizon-metrics="true">
              {metrics.by_horizon.map(({ horizon_hours: hours }) => (
                <div className="earth-predict-metric" key={hours} data-earth-horizon={hours}>
                  <span>{`+${hours}h`}</span>
                  <b>{`RMSE ${formatValue(readEarthHorizonMetric(metrics, hours, 'rmse'))}`}</b>
                  <b>{`MAE ${formatValue(readEarthHorizonMetric(metrics, hours, 'mae'))}`}</b>
                  <small>{EARTH_TARGET_UNIT}</small>
                </div>
              ))}
            </div>
          ) : null}
          <p className="earth-predict-note" data-earth-reference-note="true">{copy.referenceNote}</p>
        </>
      ) : (
        <div className="earth-predict-empty" data-earth-empty="true">
          {context ? copy.emptyReady : copy.emptyNoTask}
        </div>
      )}
    </div>
  );
}

function formatValue(value) {
  return Number.isFinite(value) ? Number(value).toFixed(2) : '—';
}

function toDateTimeLocal(value) {
  if (!value) return '';
  const text = String(value);
  return text.endsWith('Z') ? text.slice(0, -1).slice(0, 16) : text.slice(0, 16);
}

function fromDateTimeLocal(value) {
  if (!value) return '';
  const local = value.length === 16 ? `${value}:00` : value;
  return `${local}Z`;
}
