/**
 * 观测刻度轨：观测档的竖向时间轴。
 *
 * 位置：画布左侧一列（球体在剩余空间里居中），不再占用底部一整行。
 * 交互：轨道用 MUI Slider 的 `orientation="vertical"`（拖拽、键盘、焦点环、
 *       `aria-valuenow` 都由它负责），这里额外补 `aria-valuetext` 与日期语义。
 * 视觉：自己画三样东西 ——
 *   1. 月份刻度与细刻线；
 *   2. 「年内偏离带」：把全球面积加权均值序列按年内均值中心化后横向铺开，
 *      播放头滑过时能看出这一天处在全年的偏高段还是偏低段；
 *   3. 一条缓慢扫描线（`prefers-reduced-motion` 下关闭）。
 *
 * 数值语义不变：带子只是同一条 `regionalSeries` 的形状，不做单位换算、
 * 不新增请求、不显示坐标轴刻度，因此不会被误读成一张分析图表。
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Slider from '@mui/material/Slider';
import PauseRoundedIcon from '@mui/icons-material/PauseRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import RestartAltRoundedIcon from '@mui/icons-material/RestartAltRounded';
import { useSettings } from '../../../contexts/SettingsContext';import {
  buildBandPath,
  datesInYear,
  dayOfYear,
  monthTicks,
  normalizeYearSeries,
  seriesValueAt,
  yearProgress,
} from './observatoryTimelineRail.js';
import './observatoryTimelineRail.css';

/**
 * SVG 坐标：宽度 96，其中刻度基准线在 6px，偏离带向右最多长 76px。
 * 实际渲染宽度由 CSS 决定（preserveAspectRatio="none" 拉伸），因此这些数字
 * 只是比例，不参与任何数值语义。
 */
const TRACK_HEIGHT = 460;
const BASELINE = 6;
const BAND_MAX_OFFSET = 76;
const SVG_WIDTH = BASELINE + BAND_MAX_OFFSET + 2;
const MONTH_LABELS_ZH = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
const MONTH_LABELS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduced(Boolean(query.matches));
    sync();
    query.addEventListener?.('change', sync);
    return () => query.removeEventListener?.('change', sync);
  }, []);
  return reduced;
}

function formatValue(value, unit, isZh) {
  if (!Number.isFinite(value)) return unit ? `-- ${unit}` : '--';
  const digits = Math.abs(value) >= 100 ? 0 : Math.abs(value) >= 10 ? 1 : 2;
  const text = value.toFixed(digits);
  return unit ? `${text} ${unit}` : text;
}

function formatDay(date, isZh) {
  if (typeof date !== 'string' || date.length < 10) return '--';
  const year = date.slice(0, 4);
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  return isZh ? `${year}.${String(month).padStart(2, '0')}.${String(day).padStart(2, '0')}` : date;
}

/** 轨道上的一个角标；只写传入的边，避免出现 `undefined` 边框值。 */
function Corner({ top, bottom, left, right }) {
  const style = { position: 'absolute', width: 5, height: 5 };
  if (top !== undefined) style.top = top;
  if (bottom !== undefined) style.bottom = bottom;
  if (left !== undefined) style.left = left;
  if (right !== undefined) style.right = right;
  if (top !== undefined) style.borderTop = '1px solid var(--overview-rail-line)';
  if (bottom !== undefined) style.borderBottom = '1px solid var(--overview-rail-line)';
  if (left !== undefined) style.borderLeft = '1px solid var(--overview-rail-line)';
  if (right !== undefined) style.borderRight = '1px solid var(--overview-rail-line)';
  return <span aria-hidden="true" style={style} />;
}

export default function ObservatoryTimelineRail({
  year = null,
  years = [],
  onYearChange = null,
  timeValues = [],
  requestedDate = null,
  displayedDate = null,
  loading = false,
  disabled = false,
  playing = false,
  series = null,
  units = '',
  variableLabel = null,
  onDateChange = null,
  onPlayChange = null,
  onRestart = null,
  onStep = null,
  actions = null,
}) {
  const { settings } = useSettings();
  const isLight = settings?.theme === 'light';
  const isZh = settings?.language !== 'en';
  const reducedMotion = useReducedMotion();
  const trackRef = useRef(null);

  const axis = useMemo(() => datesInYear(timeValues, year), [timeValues, year]);
  const ticks = useMemo(
    () => monthTicks(year, isZh ? MONTH_LABELS_ZH : MONTH_LABELS_EN),
    [isZh, year],
  );
  const band = useMemo(
    () => normalizeYearSeries({ dates: series?.dates, values: series?.values, year }),
    [series?.dates, series?.values, year],
  );
  const bandPath = useMemo(() => (
    band && band.span > 0
      ? buildBandPath({ series: band, baseline: BASELINE, maxOffset: BAND_MAX_OFFSET, height: TRACK_HEIGHT })
      : ''
  ), [band]);

  const index = requestedDate ? axis.indexOf(requestedDate) : -1;
  const sliderValue = index >= 0 ? index : 0;
  const maxIndex = Math.max(0, axis.length - 1);
  const progress = yearProgress(requestedDate, year) ?? 0;
  const doy = dayOfYear(requestedDate, year);
  const total = year ? (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365 : 365;
  const seriesValue = band ? seriesValueAt(band, displayedDate || requestedDate) : null;
  const pending = Boolean(displayedDate && requestedDate && displayedDate !== requestedDate);
  const railDisabled = disabled || axis.length === 0;

  const handleSlider = (_event, next) => {
    const value = Array.isArray(next) ? next[0] : next;
    const date = axis[value];
    if (typeof date === 'string') onDateChange?.(date);
  };

  // Slider 把垂直方向报成水平的浏览器（Chrome < 124）里，方向键语义会反过来；
  // 这里按「上 = 更早」显式接管，保证跨浏览器一致。
  const handleKeyDown = (event) => {
    if (!onDateChange || railDisabled) return;
    const step = (delta) => {
      event.preventDefault();
      if (typeof onStep === 'function') onStep(delta);
      else if (axis.length) {
        const next = Math.max(0, Math.min(maxIndex, sliderValue + delta));
        onDateChange(axis[next]);
      }
    };
    if (event.key === 'ArrowUp') step(-1);
    else if (event.key === 'ArrowDown') step(1);
    else if (event.key === 'PageUp') step(-7);
    else if (event.key === 'PageDown') step(7);
  };

  // 竖轨吃掉整个画布高度，指针事件默认会被浏览器当成页面滚动。
  useEffect(() => {
    const node = trackRef.current;
    if (!node) return undefined;
    const stop = (event) => event.stopPropagation();
    node.addEventListener('pointerdown', stop);
    node.addEventListener('dblclick', stop);
    return () => {
      node.removeEventListener('pointerdown', stop);
      node.removeEventListener('dblclick', stop);
    };
  }, []);

  const sliderSx = useMemo(() => ({
    color: isLight ? '#236387' : '#9ad9ef',
    width: '100%',
    height: '100%',
    padding: 0,
    '& .MuiSlider-rail': {
      width: 2,
      opacity: 1,
      backgroundColor: isLight ? 'rgba(15,23,42,0.18)' : 'rgba(255,255,255,0.16)',
    },
    '& .MuiSlider-track': {
      width: 2,
      border: 0,
      backgroundColor: isLight ? 'rgba(35,99,135,0.55)' : 'rgba(154,217,239,0.60)',
    },
    '& .MuiSlider-thumb': {
      width: 15,
      height: 15,
      // 垂直模式下 thumb 的位移是相对自身宽度算的，左移半个宽度才能压在基准线上。
      marginLeft: -8,
      border: `1px solid ${isLight ? '#236387' : '#9ad9ef'}`,
      backgroundColor: isLight ? 'rgba(255,255,255,0.96)' : 'rgba(11,17,26,0.94)',
      boxShadow: isLight
        ? '0 0 0 4px rgba(35,99,135,0.10), 0 4px 10px rgba(15,23,42,0.18)'
        : '0 0 0 4px rgba(154,217,239,0.10), 0 0 16px rgba(154,217,239,0.35)',
    },
    '& .MuiSlider-thumb:hover, & .MuiSlider-thumb.Mui-focusVisible': {
      boxShadow: isLight
        ? '0 0 0 6px rgba(35,99,135,0.16), 0 4px 10px rgba(15,23,42,0.20)'
        : '0 0 0 6px rgba(154,217,239,0.16), 0 0 20px rgba(154,217,239,0.50)',
    },
    '& .MuiSlider-thumb.Mui-disabled': { display: 'none' },
  }), [isLight]);

  return (
    <aside
      className="observatory-rail"
      data-rail-year={year ?? ''}
      data-rail-days={axis.length}
      data-rail-band={bandPath ? 'ready' : 'none'}
      aria-label={isZh ? '观测时间刻度轨' : 'Observation time rail'}
    >
      {/* 年份：观测档里它只是「当前数据集年份」，不再是分析入口 */}
      <div className="observatory-rail__header">
        {onYearChange && years.length ? (
          <label className="observatory-rail__year">
            <span className="observatory-rail__year-label">{isZh ? '年份' : 'Year'}</span>
            <select
              value={String(year ?? '')}
              onChange={(event) => onYearChange(Number(event.target.value))}
              disabled={railDisabled}
              aria-label={isZh ? '数据集年份' : 'Dataset year'}
            >
              {years.map((item) => (
                <option key={item} value={String(item)}>{item}</option>
              ))}
            </select>
          </label>
        ) : (
          <span className="observatory-rail__year-static">{year ?? '--'}</span>
        )}
        <span className="observatory-rail__progress" aria-hidden="true">
          <span
            className="observatory-rail__progress-fill"
            style={{ transform: `scaleX(${Math.max(0.004, progress)})` }}
          />
        </span>
      </div>

      {/* 读数区：展示日期 + 年内位置 + 当天全球均值 */}
      <div className="observatory-rail__readout">
        <div className="observatory-rail__date" data-rail-date={requestedDate || ''}>
          {formatDay(requestedDate, isZh)}
        </div>
        <div className="observatory-rail__dayline">
          <span>{isZh ? `第 ${doy ?? '--'} 天` : `Day ${doy ?? '--'}`}</span>
          <span className="observatory-rail__dayline-sep">/</span>
          <span>{total}</span>
        </div>
        <div className="observatory-rail__global">
          <span className="observatory-rail__global-label">
            {variableLabel || (isZh ? '全球均值' : 'Global mean')}
          </span>
          <span className="observatory-rail__global-value" data-rail-value={Number.isFinite(seriesValue) ? seriesValue : ''}>
            {formatValue(seriesValue, units, isZh)}
          </span>
        </div>
        {loading || pending ? (
          <div className="observatory-rail__status" role="status">
            {isZh ? '加载中' : 'Loading'}
          </div>
        ) : null}
      </div>

      {/* 轨道本体 */}
      <div className="observatory-rail__track-wrap">
        <div
          ref={trackRef}
          className="observatory-rail__track"
          data-reduced-motion={reducedMotion ? 'true' : 'false'}
        >
          <svg
            className="observatory-rail__canvas"
            viewBox={`0 0 ${SVG_WIDTH} ${TRACK_HEIGHT}`}
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            {/* 刻度基准线 */}
            <line
              x1={BASELINE + 0.5}
              x2={BASELINE + 0.5}
              y1={0}
              y2={TRACK_HEIGHT}
              className="observatory-rail__axis"
            />
            {/* 年内偏离带 */}
            {bandPath ? <path d={bandPath} className="observatory-rail__band" /> : null}
            {/* 月份刻线 */}
            {ticks.map((tick) => (
              <line
                key={`tick-${tick.month}`}
                x1={BASELINE - 4}
                x2={BASELINE + (tick.month % 3 === 1 ? 9 : 5)}
                y1={tick.progress * TRACK_HEIGHT}
                y2={tick.progress * TRACK_HEIGHT}
                className="observatory-rail__tick"
                data-major={tick.month % 3 === 1 ? 'true' : 'false'}
              />
            ))}
            {/* 扫描线：沿轨道缓慢往复，仅作仪器感提示 */}
            {!reducedMotion ? (
              <line
                x1={BASELINE - 5}
                x2={SVG_WIDTH - 1}
                y1={0}
                y2={0}
                className="observatory-rail__scan"
              />
            ) : null}
          </svg>

          <Slider
            orientation="vertical"
            min={0}
            max={maxIndex}
            step={1}
            value={sliderValue}
            onChange={handleSlider}
            onKeyDown={handleKeyDown}
            disabled={railDisabled}
            aria-label={isZh ? '数据日期' : 'Data date'}
            getAriaValueText={() => {
              if (!requestedDate) return isZh ? '未选择日期' : 'No date selected';
              const parts = [requestedDate];
              if (doy !== null) parts.push(isZh ? `第 ${doy} 天` : `day ${doy}`);
              if (Number.isFinite(seriesValue)) {
                parts.push(`${variableLabel || (isZh ? '全球均值' : 'global mean')} ${formatValue(seriesValue, units, isZh)}`);
              }
              return parts.join('，');
            }}
            sx={sliderSx}
          />
        </div>

        {/* 月份标签列：只显示季度首月，点击可跳到该月 1 日 */}
        {ticks.map((tick) => (
          <button
            key={`label-${tick.month}`}
            type="button"
            className="observatory-rail__month observatory-rail__month--button"
            data-major={tick.month % 3 === 1 ? 'true' : 'false'}
            style={{ top: `${tick.progress * 100}%` }}
            onClick={() => {
              const date = axis.find((item) => item.endsWith(`-${String(tick.month).padStart(2, '0')}-01`));
              if (date) onDateChange?.(date);
            }}
            disabled={railDisabled || !onDateChange}
            aria-label={isZh ? `跳到 ${tick.month} 月` : `Jump to month ${tick.month}`}
            title={isZh ? `跳到 ${tick.month} 月` : `Jump to month ${tick.month}`}
          >
            {tick.month % 3 === 1 ? tick.label : ''}
          </button>
        ))}

        <Corner top={-1} left={-1} />
        <Corner top={-1} right={-1} />
        <Corner bottom={-1} left={-1} />
        <Corner bottom={-1} right={-1} />
      </div>

      {/* 播放控制 */}
      <div className="observatory-rail__controls">
        <button
          type="button"
          className="observatory-rail__btn observatory-rail__btn--step"
          onClick={() => onStep?.(-1)}
          disabled={railDisabled || index <= 0}
          aria-label={isZh ? '前一天' : 'Previous day'}
          title={isZh ? '前一天' : 'Previous day'}
        >
          ▲
        </button>
        <button
          type="button"
          className="observatory-rail__btn observatory-rail__btn--play"
          onClick={() => onPlayChange?.(!playing)}
          disabled={railDisabled}
          aria-pressed={playing}
          aria-label={playing ? (isZh ? '暂停' : 'Pause') : (isZh ? '播放' : 'Play')}
          title={playing ? (isZh ? '暂停' : 'Pause') : (isZh ? '播放' : 'Play')}
        >
          {playing ? <PauseRoundedIcon sx={{ fontSize: 18 }} /> : <PlayArrowRoundedIcon sx={{ fontSize: 20 }} />}
        </button>
        <button
          type="button"
          className="observatory-rail__btn observatory-rail__btn--step"
          onClick={() => onStep?.(1)}
          disabled={railDisabled || index >= maxIndex}
          aria-label={isZh ? '后一天' : 'Next day'}
          title={isZh ? '后一天' : 'Next day'}
        >
          ▼
        </button>
        <button
          type="button"
          className="observatory-rail__btn"
          onClick={onRestart}
          disabled={railDisabled || playing}
          aria-label={isZh ? '从首日重播' : 'Replay from first day'}
          title={isZh ? '从首日重播' : 'Replay from first day'}
        >
          <RestartAltRoundedIcon sx={{ fontSize: 16 }} />
        </button>
      </div>

      {actions ? <div className="observatory-rail__actions">{actions}</div> : null}
    </aside>
  );
}
