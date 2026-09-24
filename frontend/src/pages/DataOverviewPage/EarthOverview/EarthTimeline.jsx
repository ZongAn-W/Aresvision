import React, { useMemo } from 'react';
import { useT } from '../../../i18n/index.js';
import {
  dateAtIndex,
  dateIndexWithin,
  isoDayNumber,
  isValidIsoDate,
} from './earthOverviewModel.js';

/**
 * 受控日期/播放控件。
 *
 * 滑块索引 0..count-1 始终显示真实日期；上一天、下一天、日期输入和滑块走同一个
 * 选择函数，暂停与校验逻辑不分叉。
 */
export default function EarthTimeline({
  start,
  end,
  requestedDate,
  displayedDate,
  playing,
  loading,
  disabled = false,
  onDateChange,
  onPlayChange,
  onRestart,
}) {
  const t = useT();

  const total = useMemo(() => {
    if (!isValidIsoDate(start) || !isValidIsoDate(end)) return 0;
    return isoDayNumber(end) - isoDayNumber(start);
  }, [start, end]);

  const currentIndex = dateIndexWithin(start, end, requestedDate);
  const displayedIndex = dateIndexWithin(start, end, displayedDate);
  const dateInputValid = isValidIsoDate(requestedDate)
    && dateIndexWithin(start, end, requestedDate) !== null;
  const atStart = currentIndex === 0;
  const atEnd = currentIndex !== null && currentIndex >= total;
  const pendingDifferentDate = Boolean(
    displayedDate && requestedDate && displayedDate !== requestedDate,
  );

  const handleIndex = (value) => {
    const index = Number(value);
    if (!Number.isInteger(index)) return;
    onDateChange(dateAtIndex(start, index));
  };

  return (
    <section className="earth-timeline" aria-label={t('earthOverview.timeline.label')}>
      <div className="earth-timeline__row">
        <button
          type="button"
          className="earth-btn"
          onClick={() => onDateChange(dateAtIndex(start, (currentIndex ?? 0) - 1))}
          disabled={disabled || atStart}
        >
          {t('earthOverview.timeline.previousDay')}
        </button>

        <label className="earth-timeline__field">
          <span>{t('earthOverview.timeline.dataDate')}</span>
          <input
            type="date"
            min={start || undefined}
            max={end || undefined}
            value={requestedDate && isValidIsoDate(requestedDate) ? requestedDate : ''}
            disabled={disabled}
            aria-invalid={!dateInputValid}
            onChange={(event) => onDateChange(event.target.value)}
          />
        </label>

        <button
          type="button"
          className="earth-btn"
          onClick={() => onDateChange(dateAtIndex(start, (currentIndex ?? 0) + 1))}
          disabled={disabled || atEnd}
        >
          {t('earthOverview.timeline.nextDay')}
        </button>
      </div>

      <div className="earth-timeline__row">
        <input
          type="range"
          min={0}
          max={Math.max(0, total)}
          step={1}
          value={currentIndex ?? 0}
          disabled={disabled}
          aria-label={t('earthOverview.timeline.dataDate')}
          onChange={(event) => handleIndex(event.target.value)}
        />
        <span className="earth-timeline__index">
          {currentIndex !== null ? `${currentIndex + 1} / ${total + 1}` : '--'}
        </span>
      </div>

      <div className="earth-timeline__row earth-timeline__row--actions">
        <button
          type="button"
          className="earth-btn earth-btn--primary"
          onClick={() => onPlayChange(!playing)}
          disabled={disabled}
          aria-pressed={playing}
        >
          {playing ? t('earthOverview.timeline.pause') : t('earthOverview.timeline.play')}
        </button>
        <button
          type="button"
          className="earth-btn"
          onClick={onRestart}
          disabled={disabled || playing}
        >
          {t('earthOverview.timeline.replayFromFirst')}
        </button>
        {loading ? (
          <span className="earth-timeline__status" role="status">
            {t('earthOverview.timeline.loadingSelectedDate')}
          </span>
        ) : null}
        {!loading && pendingDifferentDate ? (
          <span className="earth-timeline__status" role="status">
            {t('earthOverview.timeline.loadingSelectedDate')}
          </span>
        ) : null}
        {displayedIndex !== null && displayedDate ? (
          <span className="earth-timeline__displayed">
            {t('earthOverview.timeline.showing')}: <strong>{displayedDate}</strong>
          </span>
        ) : null}
      </div>
    </section>
  );
}
