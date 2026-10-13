import React, { useEffect, useMemo, useRef } from 'react';
import { useSettings } from '../../../contexts/SettingsContext';
import { datesInYear, daysInYear, monthTicks, seriesValueAt } from './observatoryTimelineRail.js';
import { earthRailDay, earthRailProgress, earthRailPath, earthRailSeries, nearestEarthRailDate, TRACK_HEIGHT } from './earthObservationRail.js';
import { formatEarthTime, isValidUtcTimestamp } from '../EarthOverview/earthOverviewModel.js';
import { buildCurveFillBands } from './railCurveFill.js';
import './observatoryTimelineRail.css';
import './marsObservationRail.css';
import './earthObservationRail.css';

const MONTH_LABELS_ZH = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
const MONTH_LABELS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatValue(value, unit = '') {
  if (!Number.isFinite(value)) return unit ? `-- ${unit}` : '--';
  const digits = Math.abs(value) >= 100 ? 0 : Math.abs(value) >= 10 ? 1 : 2;
  return unit ? `${value.toFixed(digits)} ${unit}` : value.toFixed(digits);
}

function formatDate(date, isZh) {
  if (typeof date !== 'string') return '--';
  return isValidUtcTimestamp(date) ? formatEarthTime(date) : isZh ? date.replaceAll('-', '.') : date;
}

function formatCoord(value) {
  return Number.isFinite(value) ? value.toFixed(1) : '--';
}

/** Earth date rail with the Mars observation-rail visual language. */
export default function EarthObservationRail({
  pointSide = false,
  point = null,
  pointSeries = null,
  pointStatus = 'idle',
  pointError = null,
  year = null,
  years = [],
  onYearChange = null,
  timeValues = [],
  requestedDate = null,
  displayedDate = null,
  loading = false,
  seriesStatus = 'idle',
  seriesError = null,
  disabled = false,
  playing = false,
  series = null,
  units = '',
  variableLabel = null,
  onDateChange = null,
  onPlayChange = null,
  onRestart = null,
  onStep = null,
  onClearPoint = null,
  actions = null,
  domain = null,
  colorMode = 'inferno',
  frequencyHours = 24,
}) {
  const { settings } = useSettings();
  const railRef = useRef(null);
  const isZh = settings?.language !== 'en';
  const source = pointSide ? pointSeries : series;
  const rows = useMemo(() => earthRailSeries(source, year), [source, year]);
  const threeHourly = frequencyHours === 3;
  const axis = useMemo(() => threeHourly ? timeValues.filter((value) => isValidUtcTimestamp(value) && Number(value.slice(0, 4)) === year) : datesInYear(timeValues, year), [timeValues, year, threeHourly]);
  const ticks = useMemo(() => monthTicks(year, isZh ? MONTH_LABELS_ZH : MONTH_LABELS_EN), [isZh, year]);
  const path = useMemo(() => earthRailPath(rows, domain), [rows, domain]);
  // 曲线下方的填充：按数值分档的实色色块，颜色由本轨数值范围铺满该变量的色带。
  const fillBands = useMemo(
    () => buildCurveFillBands(path, domain, colorMode, { theme: settings?.theme === 'light' ? 'light' : 'dark' }),
    [path, domain, colorMode, settings?.theme],
  );
  const index = requestedDate ? axis.indexOf(requestedDate) : -1;
  const sliderValue = index >= 0 ? index : 0;
  const maxIndex = Math.max(0, axis.length - 1);
  const currentDate = displayedDate || requestedDate;
  const currentValue = seriesValueAt({ points: rows }, currentDate);
  const dateProgress = earthRailProgress(requestedDate, year) ?? 0;
  const doy = earthRailDay(requestedDate, year);
  const total = daysInYear(year);
  const coordinate = point?.lat !== undefined ? `${formatCoord(point.lat)}°, ${formatCoord(point.lon ?? point.lng)}°` : (isZh ? '尚未选择点位' : 'No point selected');
  const title = pointSide ? (isZh ? '单点年变化' : 'Point trend') : (isZh ? '全球均值' : 'Global mean');
  const curveLoading = (pointSide ? pointStatus : seriesStatus) === 'loading';
  const curveError = pointSide ? pointError : seriesError;
  const railDisabled = disabled || axis.length === 0;
  const seek = (nextIndex) => {
    const date = axis[Math.max(0, Math.min(maxIndex, nextIndex))];
    if (date) onDateChange?.(date);
  };
  const step = (delta) => {
    if (typeof onStep === 'function' && !pointSide && sliderValue + delta >= 0 && sliderValue + delta <= maxIndex) onStep(delta);
    else seek(sliderValue + delta);
  };

  useEffect(() => {
    const host = railRef.current?.parentElement;
    const shell = host?.closest('.overview-shell');
    if (!host || !shell) return undefined;
    const syncScroll = () => {
      for (const peer of shell.querySelectorAll('.overview-shell__rail, .overview-shell__rail-end')) {
        if (peer !== host && peer.scrollTop !== host.scrollTop) peer.scrollTop = host.scrollTop;
      }
    };
    host.addEventListener('scroll', syncScroll, { passive: true });
    return () => host.removeEventListener('scroll', syncScroll);
  }, []);

  return (
    <aside ref={railRef} className={`observatory-rail mars-observation-rail earth-observation-rail${pointSide ? ' mars-observation-rail--point' : ''}`}
      data-rail-year={year ?? ''} data-rail-date={requestedDate || ''} data-rail-curve={path ? 'ready' : 'none'}
      data-rail-frequency={frequencyHours}
      aria-label={title}>
      <div className="mars-observation-rail__heading">
        <strong>{title}</strong>
        {pointSide ? (point ? <button type="button" className="observatory-rail__close" onClick={onClearPoint}
          aria-label={isZh ? '清除点位' : 'Clear point'}>×</button> : null)
          : (onYearChange && years.length ? <label className="observatory-rail__year">
            <select value={String(year ?? '')} disabled={disabled} aria-label={isZh ? '数据集年份' : 'Dataset year'}
              onChange={(event) => { onPlayChange?.(false); onYearChange(Number(event.target.value)); }}>
              {years.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label> : <span>{year ?? '--'}</span>)}
      </div>
      <div className="observatory-rail__readout mars-observation-rail__readout">
        {threeHourly && !pointSide ? <div className="earth-observation-rail__time-controls">
          <label><span>{isZh ? 'UTC 日期' : 'UTC date'}</span><input type="date" value={requestedDate?.slice(0, 10) || ''}
            min={axis[0]?.slice(0, 10)} max={axis.at(-1)?.slice(0, 10)} disabled={railDisabled}
            onChange={(event) => { const next = `${event.target.value}T${requestedDate?.slice(11, 19) || '01:30:00'}Z`; if (axis.includes(next)) onDateChange?.(next); }} /></label>
          <label><span>{isZh ? 'UTC 时间' : 'UTC time'}</span><select value={requestedDate?.slice(11, 16) || '01:30'} disabled={railDisabled}
            onChange={(event) => { const next = `${requestedDate.slice(0, 10)}T${event.target.value}:00Z`; if (axis.includes(next)) onDateChange?.(next); }}>
            {Array.from({ length: 8 }, (_, i) => `${String(1 + 3 * i).padStart(2, '0')}:30`).map((value) => <option key={value} value={value}>{value}</option>)}
          </select></label>
        </div> : <div className="mars-observation-rail__time">
          {threeHourly ? <><span>{requestedDate?.slice(0, 10) || '--'}</span><span>{requestedDate?.slice(11, 16) || '--'} UTC</span></> : formatDate(requestedDate, isZh)}
        </div>}
        <span className="mars-observation-rail__label" title={variableLabel || ''}>{variableLabel || (isZh ? '全球均值' : 'Global mean')}</span>
        <strong data-rail-value={Number.isFinite(currentValue) ? currentValue : ''}>{formatValue(currentValue)} <small>{units}</small></strong>
        <span className="mars-observation-rail__label" title={pointSide ? coordinate : (isZh ? 'MERRA-2 · 面积加权全球均值' : 'MERRA-2 · area-weighted global mean')}>
          {pointSide ? coordinate : (isZh ? 'MERRA-2 · 面积加权均值' : 'MERRA-2 · area-weighted mean')}
        </span>
        <span className="mars-observation-rail__sample">{currentDate && currentDate !== requestedDate
          ? `${isZh ? '读数' : 'Value at'} ${currentDate}`
          : loading ? (isZh ? '正在加载数据场…' : 'Loading field…')
            : (isZh ? `第 ${doy === null ? '--' : Math.floor(doy)} 天 / ${total}${threeHourly ? ' · 每 3 小时' : ''}` : `Day ${doy === null ? '--' : Math.floor(doy)} / ${total}${threeHourly ? ' · 3 hours' : ''}`)}</span>
      </div>
      <div className="mars-observation-rail__plot">
        <svg viewBox="0 0 100 460" preserveAspectRatio="none" aria-hidden="true">
          <line x1="8" x2="8" y1="0" y2="460" className="observatory-rail__axis" />
          {fillBands.length ? (
            <g className="observatory-rail__fill">
              {fillBands.map((band) => (
                <rect key={band.key} x={band.x} y={band.y} width={band.width} height={band.height} fill={band.color} />
              ))}
            </g>
          ) : null}
          {path ? <path d={path} className={pointSide ? 'observatory-rail__point-curve' : 'observatory-rail__band'} /> : null}
          <line x1="0" x2="80" y1={dateProgress * TRACK_HEIGHT} y2={dateProgress * TRACK_HEIGHT} className="observatory-rail__point-marker" />
        </svg>
        {!pointSide ? <input className="mars-observation-rail__slider" type="range" min="1" max={threeHourly ? total + 1 : total} step={threeHourly ? 0.125 : 1} value={doy ?? 1} disabled={railDisabled} aria-orientation="vertical" aria-label={isZh ? '数据日期' : 'Data date'} aria-valuetext={requestedDate || (isZh ? '未选择日期' : 'No date selected')} onChange={(event) => {
          const date = nearestEarthRailDate(axis, Number(event.target.value), year);
          if (date) onDateChange?.(date);
        }} onKeyDown={(event) => {
          const delta = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -1, ArrowRight: 1, PageUp: -7, PageDown: 7 }[event.key];
          if (delta) { event.preventDefault(); step(delta); }
          if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); seek(event.key === 'Home' ? 0 : maxIndex); }
        }} /> : null}
        {ticks.filter((tick) => tick.month % 3 === 1 || tick.month === 12).map((tick) => {
          const date = axis.find((item) => item.slice(5, 7) === String(tick.month).padStart(2, '0'));
          return <button key={tick.month} type="button" className="mars-observation-rail__tick" style={{ top: `${tick.progress * 100}%` }} disabled={railDisabled || !date} onClick={() => date && onDateChange?.(date)} aria-label={isZh ? `跳到 ${tick.month} 月` : `Jump to month ${tick.month}`}>{tick.label}</button>;
        })}
        {!path ? <div className="mars-observation-rail__empty" role="status">{pointSide && !point
          ? (isZh ? '点击球面，查看该点全年曲线' : 'Click the globe to see its annual curve')
          : curveLoading ? (isZh ? '正在读取曲线…' : 'Loading curve…')
            : curveError ? (isZh ? '曲线读取失败' : 'Curve failed to load')
              : (isZh ? '暂无全年序列' : 'No annual series')}</div> : null}
      </div>
      <div className="mars-observation-rail__footer">
        {/* 刻度是每条轨各自的极值，读数写明单位，避免两轨被当成同一把尺子。 */}
        <div className="mars-observation-rail__scale" title={isZh
          ? `本轨数值范围（${units || '原始单位'}）；两轨共用日期轴，数值刻度各自独立`
          : `This rail's own value range (${units || 'native units'}); the date axis is shared, value scales are independent`}>
          <span>{formatValue(domain?.[0])}</span><span>↔</span><span>{formatValue(domain?.[1])}</span>
          <small>{units || (isZh ? '原始单位' : 'native units')}</small>
        </div>
        {pointSide ? <p>{isZh ? '垂直轴共用日期；数值刻度为本轨独立' : 'Shared date axis; own value scale'}</p> : <>
          <div className="mars-observation-rail__controls">
            <button type="button" className="observatory-rail__btn" disabled={railDisabled || sliderValue <= 0} onClick={() => step(-1)} aria-label={threeHourly ? (isZh ? '前 3 小时' : 'Previous 3 hours') : (isZh ? '前一天' : 'Previous day')}>▲</button>
            <button type="button" className="observatory-rail__btn observatory-rail__btn--play" disabled={railDisabled} onClick={() => onPlayChange?.(!playing)} aria-pressed={playing} aria-label={playing ? (isZh ? '暂停' : 'Pause') : (isZh ? '播放' : 'Play')}>{playing ? 'Ⅱ' : '▶'}</button>
            <button type="button" className="observatory-rail__btn" disabled={railDisabled || sliderValue >= maxIndex} onClick={() => step(1)} aria-label={threeHourly ? (isZh ? '后 3 小时' : 'Next 3 hours') : (isZh ? '后一天' : 'Next day')}>▼</button>
            <button type="button" className="observatory-rail__btn" disabled={railDisabled || playing} onClick={onRestart} aria-label={isZh ? '从首日重播' : 'Replay from first day'}>↺</button>
          </div>
          <div className="observatory-rail__actions">{actions}</div>
        </>}
      </div>
    </aside>
  );
}
