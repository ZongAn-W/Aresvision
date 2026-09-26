/**
 * 点位年变化竖轨：画布右侧的竖向参考。
 *
 * 与左侧观测刻度轨「镜像」并共用同一条时间轴语义（上 = 年初，下 = 年末），
 * 但画的是别的东西：左轨是「全球面积加权均值」的年内形状，右轨是**所选点位**
 * 在这一年的逐日序列，两者并排就能直接对照「这一点比全球更平还是更陡」。
 *
 * 数据来源是既有的 `pointSeries`（点选后本来就加载全年序列，不新增请求）；
 * 复用 `observatoryTimelineRail.js` 的归一化与路径函数，保证两条轨的时间轴
 * 与刻度含义完全一致，不会各算一套。
 *
 * 没有点位时不渲染（由调用方决定是否传 `point`），因此观测档默认只有左轨。
 */

import React, { useMemo } from 'react';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import { useSettings } from '../../../contexts/SettingsContext';
import {
  buildBandPath,
  datesInYear,
  dayOfYear,
  monthTicks,
  normalizeYearSeries,
  seriesValueAt,
  yearProgress,
} from './observatoryTimelineRail.js';
import './observatoryTimelineRail.css';

/** 与左轨同一套几何比例，保证两条轨完全对齐。 */
const TRACK_HEIGHT = 460;
const BASELINE = 60;
const MAX_OFFSET = 54;
const SVG_WIDTH = BASELINE + MAX_OFFSET + 2;
const MONTH_LABELS_ZH = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
const MONTH_LABELS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatValue(value, unit) {
  if (!Number.isFinite(value)) return unit ? `-- ${unit}` : '--';
  const digits = Math.abs(value) >= 100 ? 0 : Math.abs(value) >= 10 ? 1 : 2;
  return unit ? `${value.toFixed(digits)} ${unit}` : value.toFixed(digits);
}

function formatCoord(value) {
  return Number.isFinite(value) ? value.toFixed(1) : '--';
}

export default function PointTrendRail({
  point = null,
  pointSeries = null,
  pointStatus = 'idle',
  pointError = null,
  year = null,
  timeValues = [],
  requestedDate = null,
  displayedDate = null,
  units = '',
  variableLabel = null,
  onDateChange = null,
  onClearPoint = null,
}) {
  const { settings } = useSettings();
  const isLight = settings?.theme === 'light';
  const isZh = settings?.language !== 'en';

  const axis = useMemo(() => datesInYear(timeValues, year), [timeValues, year]);
  const ticks = useMemo(
    () => monthTicks(year, isZh ? MONTH_LABELS_ZH : MONTH_LABELS_EN),
    [isZh, year],
  );
  const series = useMemo(
    () => normalizeYearSeries({ dates: pointSeries?.dates, values: pointSeries?.values, year }),
    [pointSeries?.dates, pointSeries?.values, year],
  );
  const curvePath = useMemo(() => (
    series ? buildBandPath({ series, baseline: BASELINE, maxOffset: MAX_OFFSET, height: TRACK_HEIGHT }) : ''
  ), [series]);

  const requestedProgress = yearProgress(requestedDate, year);
  const value = seriesValueAt(series, displayedDate || requestedDate);
  const currentValue = value !== null
    ? value
    : (() => {
      // 序列还没到或该日缺值时，退回页面上已有的当前值（不臆造，只回填已知数）。
      const dates = pointSeries?.dates;
      const values = pointSeries?.values;
      if (!Array.isArray(dates) || !Array.isArray(values)) return null;
      const index = dates.indexOf(displayedDate || requestedDate);
      const raw = index >= 0 ? values[index] : null;
      return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
    })();

  const loading = pointStatus === 'loading';
  const statusLabel = loading
    ? (isZh ? '正在读取全年序列…' : 'Loading annual series…')
    : pointError
      ? (isZh ? '点位序列读取失败' : 'Point series failed')
      : !series
        ? (isZh ? '暂无全年序列' : 'No annual series')
        : null;

  return (
    <aside
      className="observatory-rail observatory-rail--point"
      data-rail-year={year ?? ''}
      data-rail-point={point ? `${formatCoord(point.lat)},${formatCoord(point.lon)}` : ''}
      data-rail-curve={curvePath ? 'ready' : 'none'}
      aria-label={isZh ? '点位年变化' : 'Point annual trend'}
    >
      <div className="observatory-rail__header">
        <span className="observatory-rail__rail-title">
          {isZh ? '点位年变化' : 'Point trend'}
        </span>
        {onClearPoint ? (
          <button
            type="button"
            className="observatory-rail__close"
            onClick={onClearPoint}
            aria-label={isZh ? '清除点位' : 'Clear point'}
            title={isZh ? '清除点位' : 'Clear point'}
          >
            <CloseRoundedIcon sx={{ fontSize: 14 }} />
          </button>
        ) : null}
      </div>

      <div className="observatory-rail__readout">
        <div className="observatory-rail__date" data-rail-date={requestedDate || ''}>
          {`${formatCoord(point?.lat)}°, ${formatCoord(point?.lon)}°`}
        </div>
        <div className="observatory-rail__dayline">
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {variableLabel || (isZh ? '点位值' : 'Point value')}
          </span>
        </div>
        <div className="observatory-rail__global">
          <span className="observatory-rail__global-label">
            {isZh ? '当前值' : 'Current value'}
          </span>
          <span
            className="observatory-rail__global-value"
            data-rail-value={Number.isFinite(currentValue) ? currentValue : ''}
          >
            {formatValue(currentValue, units)}
          </span>
        </div>
        {series ? (
          <div className="observatory-rail__range">
            <span>{formatValue(series.min, '')}</span>
            <span className="observatory-rail__range-sep">~</span>
            <span>{formatValue(series.max, '')}</span>
            <span className="observatory-rail__range-note">{isZh ? '年内' : 'in year'}</span>
          </div>
        ) : null}
        {statusLabel ? (
          <div
            className="observatory-rail__status"
            role="status"
            data-point-rail-status={loading ? 'loading' : 'unavailable'}
          >
            {statusLabel}
          </div>
        ) : null}
      </div>

      <div className="observatory-rail__track-wrap">
        <div className="observatory-rail__track">
          <svg
            className="observatory-rail__canvas"
            viewBox={`0 0 ${SVG_WIDTH} ${TRACK_HEIGHT}`}
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            {/* 与左轨同样的刻度基准线 */}
            <line
              x1={BASELINE + 0.5}
              x2={BASELINE + 0.5}
              y1={0}
              y2={TRACK_HEIGHT}
              className="observatory-rail__axis"
            />
            {/* 点位年内曲线：与左轨同一套归一化，形状可直接对照 */}
            {curvePath ? <path d={curvePath} className="observatory-rail__point-curve" /> : null}
            {/* 当前展示日期的横标 */}
            {requestedProgress !== null ? (
              <line
                x1={0}
                x2={SVG_WIDTH}
                y1={requestedProgress * TRACK_HEIGHT}
                y2={requestedProgress * TRACK_HEIGHT}
                className="observatory-rail__point-marker"
              />
            ) : null}
            {ticks.map((tick) => (
              <line
                key={`tick-${tick.month}`}
                x1={BASELINE - (tick.month % 3 === 1 ? 9 : 5)}
                x2={BASELINE + 4}
                y1={tick.progress * TRACK_HEIGHT}
                y2={tick.progress * TRACK_HEIGHT}
                className="observatory-rail__tick"
                data-major={tick.month % 3 === 1 ? 'true' : 'false'}
              />
            ))}
          </svg>
        </div>

        {/* 月份刻度与左轨一致；点击某月可跳到该月 1 日 */}
        {ticks.map((tick) => (
          <button
            key={`jump-${tick.month}`}
            type="button"
            className="observatory-rail__month observatory-rail__month--button"
            data-major={tick.month % 3 === 1 ? 'true' : 'false'}
            style={{ top: `${tick.progress * 100}%` }}
            onClick={() => {
              const date = axis.find((item) => item.endsWith(`-${String(tick.month).padStart(2, '0')}-01`));
              if (date) onDateChange?.(date);
            }}
            disabled={!onDateChange}
            aria-label={isZh ? `跳到 ${tick.month} 月` : `Jump to month ${tick.month}`}
            title={isZh ? `跳到 ${tick.month} 月` : `Jump to month ${tick.month}`}
          >
            {tick.month % 3 === 1 ? tick.label : ''}
          </button>
        ))}
      </div>

      <div className="observatory-rail__footnote">
        {isZh ? '与左侧全球均值同一条时间轴' : 'Same time axis as the global mean on the left'}
      </div>
    </aside>
  );
}
