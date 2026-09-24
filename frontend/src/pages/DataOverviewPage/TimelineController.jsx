import React from 'react';
import PauseRoundedIcon from '@mui/icons-material/PauseRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import RestartAltRoundedIcon from '@mui/icons-material/RestartAltRounded';
import GlowCard from '../../components/GlowCard';
import C from '../../constants/colors';
import { useT } from '../../i18n';
import { useSettings } from '../../contexts/SettingsContext';
import { useDataOverview } from '../../contexts/DataOverviewContext';
import {
  buildCoverageSegments,
  getActiveOzoneSources,
  getOzoneAvailabilityLabel,
} from './timelineCoverage.js';
import { formatTimelineLs } from './timelineFormatting.js';

export default function TimelineController({ embedded = true }) {
  const t = useT();
  const { settings } = useSettings();
  const isLight = settings?.theme === 'light';
  const isZh = settings?.language !== 'en';
  const {
    globalTimeLs,
    setGlobalTimeLs,
    isPlayingTimeline,
    setIsPlayingTimeline,
    overviewTimeline,
    overviewOzoneCapabilities,
    marsYear,
  } = useDataOverview();

  const playerWidth = 'clamp(380px, calc(100vw - var(--overview-scene-left) - var(--overview-scene-right) - 180px), 680px)';

  const seasonName =
    globalTimeLs < 90 ? t('common.season.spring') :
    globalTimeLs < 180 ? t('common.season.summer') :
    globalTimeLs < 270 ? t('common.season.autumn') :
    t('common.season.winter');

  const onTogglePlay = () => setIsPlayingTimeline((p) => !p);
  const timelineMin = Number.isFinite(overviewTimeline?.min) ? overviewTimeline.min : 0;
  const timelineMax = Number.isFinite(overviewTimeline?.max) ? overviewTimeline.max : 360;
  const timelineStep = Number.isFinite(overviewTimeline?.step) ? overviewTimeline.step : 5;
  const timelineSpan = timelineMax > timelineMin ? timelineMax - timelineMin : 360;
  const displayedTimelineLs = formatTimelineLs(globalTimeLs);
  const coverage = overviewOzoneCapabilities?.coverage || {};
  const mcdSegments = buildCoverageSegments({ coverage, marsYear, source: 'mcd', min: timelineMin, max: timelineMax });
  const openmarsSegments = buildCoverageSegments({ coverage, marsYear, source: 'openmars', min: timelineMin, max: timelineMax });
  const nomadSegments = buildCoverageSegments({ coverage, marsYear, source: 'nomad', min: timelineMin, max: timelineMax });
  const visibleMcdSegments = mcdSegments.length
    ? mcdSegments
    : [{ start: timelineMin, end: timelineMax, left: 0, width: 100 }];
  const activeSources = getActiveOzoneSources({ coverage, marsYear, ls: globalTimeLs });
  const availabilityLabel = getOzoneAvailabilityLabel(activeSources, isZh);
  const thumbLeft = Math.max(0, Math.min(100, ((globalTimeLs - timelineMin) / timelineSpan) * 100));
  const hasOpenMarsAtCurrentLs = activeSources.includes('openmars');
  const hasNomadAtCurrentLs = activeSources.includes('nomad');
  const hasMultiSourceAtCurrentLs = hasOpenMarsAtCurrentLs || hasNomadAtCurrentLs;
  const statusAccent = hasOpenMarsAtCurrentLs && hasNomadAtCurrentLs
    ? `linear-gradient(135deg, ${C.blue}, ${C.green})`
    : hasNomadAtCurrentLs
      ? C.green
      : hasOpenMarsAtCurrentLs
        ? C.blue
        : C.mars;
  const sourceIndicators = [
    { key: 'mcd', label: 'MCD', color: C.mars, active: true },
    { key: 'openmars', label: 'OpenMARS', color: C.blue, active: openmarsSegments.length > 0 },
    { key: 'nomad', label: 'NOMAD', color: C.green, active: nomadSegments.length > 0 },
  ];

  return (
    <div
      className="overview-timeline-anchor"
      data-embedded={embedded ? 'true' : 'false'}
      style={{
        position: 'fixed',
        bottom: 'var(--overview-timeline-bottom)',
        left: 'calc(var(--overview-scene-left) + (100vw - var(--overview-scene-left) - var(--overview-scene-right)) / 2)',
        transform: 'translateX(-50%)',
        width: playerWidth,
        zIndex: 1500,
        transition: 'none',
      }}
    >
      <GlowCard style={{ padding: '7px 10px 6px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <button
            onClick={onTogglePlay}
            title={isPlayingTimeline ? t('common.pause') : t('common.play')}
            aria-label={isPlayingTimeline ? t('common.pause') : t('common.play')}
            style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              background: isPlayingTimeline ? 'rgba(199,91,57,0.14)' : `linear-gradient(135deg, ${C.mars}, ${C.marsLight})`,
              border: `1px solid ${isPlayingTimeline ? C.mars : 'transparent'}`,
              color: isPlayingTimeline ? C.mars : '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              transition: 'all 0.3s ease',
              boxShadow: isPlayingTimeline ? 'none' : '0 7px 16px rgba(199,91,57,0.22)',
              flexShrink: 0,
            }}
          >
            {isPlayingTimeline ? <PauseRoundedIcon sx={{ fontSize: 17 }} /> : <PlayArrowRoundedIcon sx={{ fontSize: 19 }} />}
          </button>

          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              className="timeline-meta-strip"
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 4,
                gap: 8,
                minWidth: 0,
                lineHeight: 1,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0, overflow: 'hidden' }}>
                <div
                  style={{
                    fontSize: 'calc(9px * var(--font-scale, 1))',
                    color: C.ice50,
                    fontWeight: 700,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {isZh ? '太阳黄经' : 'Solar longitude'}
                </div>
                <div
                  title={isZh ? '当前 Ls 可用臭氧来源' : 'Available ozone sources at current Ls'}
                  style={{
                    padding: '2px 6px',
                    borderRadius: 999,
                    background: hasMultiSourceAtCurrentLs
                      ? isLight ? 'rgba(15,23,42,0.05)' : 'rgba(255,255,255,0.06)'
                      : 'transparent',
                    border: `1px solid ${hasMultiSourceAtCurrentLs ? C.borderHover : C.border}`,
                    color: hasMultiSourceAtCurrentLs ? C.ice70 : C.ice40,
                    fontSize: 'calc(8px * var(--font-scale, 1))',
                    fontWeight: 700,
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                    boxShadow: hasMultiSourceAtCurrentLs ? '0 8px 22px rgba(0,0,0,0.14)' : 'none',
                  }}
                >
                  {availabilityLabel}
                </div>
                <div
                  aria-label={isZh ? '数据源覆盖' : 'Data source coverage'}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    minWidth: 0,
                    overflow: 'hidden',
                  }}
                >
                  {sourceIndicators.map((item) => (
                    <span
                      key={item.key}
                      title={item.label}
                      className="timeline-source-dot"
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: 999,
                        background: item.color,
                        boxShadow: item.active ? `0 0 7px ${item.color}` : 'none',
                        opacity: item.active ? 1 : 0.35,
                        flexShrink: 0,
                      }}
                    />
                  ))}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0, flexShrink: 0 }}>
                <div style={{ fontSize: 'calc(11px * var(--font-scale, 1))', color: C.mars, fontWeight: 800, fontFamily: 'var(--font-display)', lineHeight: 1 }}>
                  {displayedTimelineLs}°
                </div>
                <div
                  title={seasonName}
                  style={{
                    maxWidth: 118,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    color: C.ice50,
                    fontSize: 'calc(9px * var(--font-scale, 1))',
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {seasonName}
                </div>
              </div>
            </div>

            <div style={{ position: 'relative', height: 18 }}>
              <div
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  top: 5,
                  height: 7,
                  borderRadius: 999,
                  overflow: 'hidden',
                  background: isLight ? 'rgba(15,23,42,0.08)' : 'rgba(255,255,255,0.08)',
                  border: `1px solid ${C.border}`,
                  boxShadow: 'inset 0 0 10px rgba(0,0,0,0.18)',
                  pointerEvents: 'none',
                }}
              >
                {visibleMcdSegments.map((segment, index) => (
                  <div
                    key={`mcd-${index}`}
                    style={{
                      position: 'absolute',
                      left: `${segment.left}%`,
                      top: 0,
                      width: `${segment.width}%`,
                      height: '100%',
                      background: 'linear-gradient(90deg, rgba(255,143,104,0.22), rgba(255,176,142,0.34))',
                    }}
                  />
                ))}
                {openmarsSegments.map((segment, index) => (
                  <div
                    key={`openmars-${index}`}
                    title={`OpenMARS Ls ${segment.start}-${segment.end}`}
                    style={{
                      position: 'absolute',
                      left: `${segment.left}%`,
                      top: 2,
                      width: `${segment.width}%`,
                      height: 3,
                      borderRadius: 999,
                      background: C.blue,
                      boxShadow: `0 0 10px ${C.blueGlow}`,
                    }}
                  />
                ))}
                {nomadSegments.map((segment, index) => (
                  <div
                    key={`nomad-${index}`}
                    title={`NOMAD Ls ${segment.start}-${segment.end}`}
                    style={{
                      position: 'absolute',
                      left: `${segment.left}%`,
                      bottom: 2,
                      width: `${segment.width}%`,
                      height: 3,
                      borderRadius: 999,
                      background: C.green,
                      boxShadow: '0 0 10px rgba(99,232,191,0.34)',
                    }}
                  />
                ))}
                <div
                  style={{
                    position: 'absolute',
                    left: `${thumbLeft}%`,
                    top: -1,
                    width: 2,
                    height: 9,
                    transform: 'translateX(-50%)',
                    borderRadius: 999,
                    background: statusAccent,
                    boxShadow: '0 0 12px rgba(255,255,255,0.25)',
                  }}
                />
              </div>
              <input
                className="coverage-range-input"
                type="range"
                min={timelineMin}
                max={timelineMax}
                step={timelineStep}
                value={globalTimeLs}
                aria-label={isZh ? '太阳黄经时间轴' : 'Solar longitude timeline'}
                onChange={(e) => setGlobalTimeLs(Number(e.target.value))}
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  margin: 0,
                  accentColor: C.mars,
                  cursor: 'pointer',
                  background: 'transparent',
                }}
              />
            </div>
          </div>

          <button
            onClick={() => setGlobalTimeLs(timelineMin)}
            title={isZh ? '重置 Ls' : 'Reset Ls'}
            aria-label={isZh ? '重置 Ls' : 'Reset Ls'}
            style={{
              background: isLight ? 'rgba(15,23,42,0.06)' : 'rgba(255,255,255,0.05)',
              border: `1px solid ${C.border}`,
              borderRadius: 999,
              width: 26,
              height: 26,
              color: C.ice60,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <RestartAltRoundedIcon sx={{ fontSize: 16 }} />
          </button>
        </div>
      </GlowCard>
    </div>
  );
}
