import { useEffect, useMemo, useState } from 'react';
import { useSettings } from '../../../contexts/SettingsContext';
import { useDataOverview } from '../../../contexts/DataOverviewContext';
import { getGlobeVariableMeta } from '../../../constants/globeVariables';
import { fetchOverviewPointProbe } from '../../../services/api';
import { formatTimelineLs } from '../timelineFormatting.js';
import { buildCoverageSegments } from '../timelineCoverage.js';
import { lsBounds, lsTicks, railSeries, railDomain, railPath, railUnit, nearestLsSample } from './marsObservationRail.js';
import { buildCurveFillBands } from './railCurveFill.js';
import './observatoryTimelineRail.css';
import './marsObservationRail.css';

/** Reuse the probe endpoint's exact global grid mean; fetching does not select a point. */
export function useMarsGlobalSeries(enabled) {
  const { marsYear, globeVariable, overviewSourceParams, overviewTimeline } = useDataOverview();
  const [state, setState] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const min = lsBounds(overviewTimeline).min;
  const identity = `${marsYear}:${globeVariable}:${overviewSourceParams.mcdUploadId ?? 'official'}:${min}`;
  useEffect(() => {
    if (!enabled) return undefined;
    const controller = new AbortController();
    setState({ identity, loading: true });
    fetchOverviewPointProbe(marsYear, 0, 0, min, globeVariable, { ...overviewSourceParams, signal: controller.signal })
      .then(payload => {
        if (!controller.signal.aborted) setState({ identity, series: payload.series });
      })
      .catch(error => {
        if (!controller.signal.aborted) setState({ identity, error });
      });
    return () => controller.abort();
  }, [enabled, identity, marsYear, globeVariable, overviewSourceParams, min, attempt]);
  return { ...(state?.identity === identity ? state : { loading: true }), retry: () => setAttempt(value => value + 1) };
}

function number(value) {
  if (!Number.isFinite(value)) return '—';
  if (value !== 0 && Math.abs(value) < 0.01) return value.toExponential(1);
  return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/** Both sides share one Ls axis, header and footer budget; each rail scales its own value domain. */
export default function MarsObservationRail({ side = 'global', globalState, probe, fieldLoading, pointLoading, pointError, onClear, onRetryPoint, actions, colorMode = 'inferno' }) {
  const { settings } = useSettings();
  const isZh = settings?.language !== 'en';
  const { marsYear, globeVariable, overviewTimeline, globalTimeLs, setGlobalTimeLs,
    isPlayingTimeline, setIsPlayingTimeline, isSwitchingSource, overviewOzoneCapabilities } = useDataOverview();
  const pointSide = side === 'point';
  const bounds = lsBounds(overviewTimeline);
  const ticks = lsTicks(bounds);
  const global = useMemo(() => railSeries(globalState?.series?.ls, globalState?.series?.globalMean, globeVariable, settings.units), [globalState?.series, globeVariable, settings.units]);
  const point = useMemo(() => railSeries(probe?.series?.ls, probe?.series?.point, globeVariable, settings.units), [probe?.series, globeVariable, settings.units]);
  const rows = pointSide ? point : global;
  // 每条轨用自己的极值当刻度，曲线的形状不随对侧取点变化；垂直 Ls 轴仍严格共用。
  const domain = useMemo(() => railDomain(rows), [rows]);
  const path = railPath(rows, bounds, domain);
  // 曲线下方的填充：按数值分档的实色色块，颜色由本轨数值范围铺满该变量的色带。
  const fillBands = useMemo(
    () => buildCurveFillBands(path, domain, colorMode, { theme: settings?.theme === 'light' ? 'light' : 'dark' }),
    [path, domain, colorMode, settings?.theme],
  );
  const sample = nearestLsSample(rows, globalTimeLs);
  const meta = getGlobeVariableMeta(globeVariable);
  const unit = railUnit(globeVariable, settings.units);
  const title = pointSide ? (isZh ? '单点年变化' : 'Point trend') : (isZh ? '全球均值' : 'Global mean');
  const loading = pointSide ? pointLoading : globalState?.loading;
  const error = pointSide ? pointError : globalState?.error;
  const disabled = isSwitchingSource || bounds.max <= bounds.min;
  const progress = bounds.max > bounds.min ? Math.max(0, Math.min(1, (globalTimeLs - bounds.min) / (bounds.max - bounds.min))) : 0;
  const seek = (ls) => {
    setIsPlayingTimeline(false);
    setGlobalTimeLs(Math.max(bounds.min, Math.min(bounds.max, ls)));
  };
  const coordinate = probe?.gridPoint || probe?.requested;
  const coverage = overviewOzoneCapabilities?.coverage;
  const sourceSegments = ['openmars', 'nomad'].flatMap(source =>
    buildCoverageSegments({ coverage, marsYear, source, ...bounds }).map(segment => ({ source, ...segment })));

  return (
    <aside className={`observatory-rail mars-observation-rail${pointSide ? ' mars-observation-rail--point' : ''}`}
      aria-label={title} data-rail-curve={path ? 'ready' : 'none'} data-rail-ls={globalTimeLs}>
      <div className="mars-observation-rail__heading">
        <strong>{title}</strong>
        {pointSide && probe ? <button type="button" className="observatory-rail__close" onClick={onClear}
          aria-label={isZh ? '清除点位' : 'Clear point'}>×</button> : <span>MY {marsYear}</span>}
      </div>
      <div className="observatory-rail__readout mars-observation-rail__readout">
        <div className="mars-observation-rail__time">Ls {formatTimelineLs(globalTimeLs)}°</div>
        <span className="mars-observation-rail__label" title={isZh ? meta.zh : meta.en}>{isZh ? meta.zh : meta.en}</span>
        <strong data-rail-value={sample?.value ?? ''}>{number(sample?.value)} <small>{unit}</small></strong>
        <span className="mars-observation-rail__label">{pointSide
          ? coordinate ? `${number(coordinate.lat)}°, ${number(coordinate.lng)}°` : (isZh ? '尚未选择点位' : 'No point selected')
          : (isZh ? 'MCD · 网格等权均值' : 'MCD · equal grid weights')}</span>
        <span className="mars-observation-rail__sample">{!pointSide && fieldLoading ? (isZh ? '正在加载数据场…' : 'Loading field…')
          : sample ? `${isZh ? '采样' : 'Sample'} Ls ${formatTimelineLs(sample.ls)}°` : '—'}</span>
      </div>
      <div className="mars-observation-rail__plot">
        <svg viewBox="0 0 100 460" preserveAspectRatio="none" aria-hidden="true">
          <line x1="8" x2="8" y1="0" y2="460" className="observatory-rail__axis" />
          {!pointSide && globeVariable === 'o3col' ? sourceSegments.map(({ source, start, end }, index) => {
            if (end < start || bounds.max <= bounds.min) return null;
            return <line key={`${source}-${index}`} x1={source === 'nomad' ? 16 : 12} x2={source === 'nomad' ? 16 : 12}
              y1={(start - bounds.min) / (bounds.max - bounds.min) * 460} y2={(end - bounds.min) / (bounds.max - bounds.min) * 460}
              stroke={source === 'nomad' ? '#34d399' : '#38bdf8'} strokeWidth="2" opacity="0.6"><title>{`${source === 'nomad' ? 'NOMAD' : 'OpenMARS'} Ls ${formatTimelineLs(start)}–${formatTimelineLs(end)}°`}</title></line>;
          }) : null}
          {fillBands.length ? (
            <g className="observatory-rail__fill">
              {fillBands.map((band) => (
                <rect key={band.key} x={band.x} y={band.y} width={band.width} height={band.height} fill={band.color} />
              ))}
            </g>
          ) : null}
          {path ? <path d={path} className={pointSide ? 'observatory-rail__point-curve' : 'observatory-rail__band'} /> : null}
          <line x1="0" x2="80" y1={progress * 460} y2={progress * 460} className="observatory-rail__point-marker" />
        </svg>
        {!pointSide ? <input className="mars-observation-rail__slider" type="range" min={bounds.min} max={bounds.max}
          step="any" value={globalTimeLs} disabled={disabled} aria-orientation="vertical"
          aria-label={isZh ? '太阳黄经时间轴' : 'Solar longitude timeline'} aria-valuetext={`Ls ${formatTimelineLs(globalTimeLs)}°`}
          onChange={event => seek(bounds.min + Math.round((Number(event.target.value) - bounds.min) / bounds.step) * bounds.step)} onKeyDown={event => {
            const delta = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -1, ArrowRight: 1, PageUp: -10, PageDown: 10 }[event.key];
            if (delta) { event.preventDefault(); seek(globalTimeLs + delta * bounds.step); }
            if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); seek(event.key === 'Home' ? bounds.min : bounds.max); }
          }} /> : null}
        {ticks.map((ls, index) => {
          // Keep partial-coverage endpoints readable when close to a quarter tick.
          const adjacentEnd = index > 0 && index < ticks.length - 1
            && Math.min(ls - bounds.min, bounds.max - ls) / Math.max(1, bounds.max - bounds.min) < 0.06;
          return adjacentEnd ? null : <button key={ls} type="button" className="mars-observation-rail__tick"
            style={{ top: `${bounds.max > bounds.min ? (ls - bounds.min) / (bounds.max - bounds.min) * 100 : 0}%` }}
            disabled={disabled} onClick={() => seek(ls)} aria-label={`${isZh ? '跳到' : 'Jump to'} Ls ${formatTimelineLs(ls)}°`}>
            {formatTimelineLs(ls)}°
          </button>;
        })}
        {!path ? <div className="mars-observation-rail__empty" role="status">{pointSide && !probe
          ? (isZh ? '点击球面，查看该点全年曲线' : 'Click the globe to see its annual curve')
          : loading ? (isZh ? '正在读取曲线…' : 'Loading curve…')
            : error ? (isZh ? '曲线读取失败' : 'Curve failed to load')
              : (isZh ? '暂无全年序列' : 'No annual series')}
          {error ? <button type="button" className="observatory-rail__btn" onClick={pointSide ? onRetryPoint : globalState.retry}>{isZh ? '重试' : 'Retry'}</button> : null}
        </div> : null}
      </div>
      <div className="mars-observation-rail__footer">
        {/* 刻度是每条轨各自的极值，读数写明单位，避免两轨被当成同一把尺子。 */}
        <div className="mars-observation-rail__scale" title={isZh
          ? `本轨数值范围（${unit || '原始单位'}）；两轨共用 Ls，数值刻度各自独立`
          : `This rail's own value range (${unit || 'native units'}); Ls is shared, value scales are independent`}>
          <span>{number(domain?.[0])}</span><span>↔</span><span>{number(domain?.[1])}</span>
          <small>{unit || (isZh ? '原始单位' : 'native units')}</small>
        </div>
        {pointSide ? <p>{isZh ? '垂直轴共用 Ls；数值刻度为本轨独立' : 'Shared Ls axis; own value scale'}</p> : <>
          <div className="mars-observation-rail__controls">
            <button type="button" className="observatory-rail__btn" disabled={disabled || globalTimeLs <= bounds.min} onClick={() => seek(globalTimeLs - bounds.step)} aria-label={isZh ? '上一个 Ls' : 'Previous Ls'}>▲</button>
            <button type="button" className="observatory-rail__btn observatory-rail__btn--play" disabled={disabled} onClick={() => setIsPlayingTimeline(value => !value)}
              aria-pressed={isPlayingTimeline} aria-label={isPlayingTimeline ? (isZh ? '暂停' : 'Pause') : (isZh ? '播放' : 'Play')}>{isPlayingTimeline ? 'Ⅱ' : '▶'}</button>
            <button type="button" className="observatory-rail__btn" disabled={disabled || globalTimeLs >= bounds.max} onClick={() => seek(globalTimeLs + bounds.step)} aria-label={isZh ? '下一个 Ls' : 'Next Ls'}>▼</button>
            <button type="button" className="observatory-rail__btn" disabled={disabled} onClick={() => seek(bounds.min)} aria-label={isZh ? '重置 Ls' : 'Reset Ls'}>↺</button>
          </div>
          <div className="observatory-rail__actions">{actions}</div>
        </>}
      </div>
    </aside>
  );
}
