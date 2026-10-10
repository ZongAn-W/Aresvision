import React from 'react';
import { useT } from '../../i18n';
import { useSettings } from '../../contexts/SettingsContext';
import { useDataOverview } from '../../contexts/DataOverviewContext';
import { formatTimelineLs } from './timelineFormatting.js';

function StatusItem({ label, value, valueColor = 'var(--text-secondary)' }) {
  return (
    <div className="overview-status-item" title={`${label}: ${value}`}>
      <span className="overview-status-item__label">
        {label}
      </span>
      <span className="overview-status-item__value" style={{ color: valueColor }}>
        {value}
      </span>
    </div>
  );
}

export default function TopStatusBar({ embedded = false }) {
  const t = useT();
  const { settings } = useSettings();
  const isZh = settings?.language !== 'en';
  const { globalTimeLs, selectedCoordinate, sourceMeta } = useDataOverview();

  const seasonName =
    globalTimeLs < 90 ? t('common.season.spring') || (isZh ? '北半球春季' : 'Northern spring')
      : globalTimeLs < 180 ? t('common.season.summer') || (isZh ? '北半球夏季' : 'Northern summer')
        : globalTimeLs < 270 ? t('common.season.autumn') || (isZh ? '北半球秋季' : 'Northern autumn')
          : t('common.season.winter') || (isZh ? '北半球冬季' : 'Northern winter');

  const sourceLabel = (() => {
    const mode = sourceMeta?.effective_source;
    if (mode === 'user_mcd') {
      return sourceMeta?.upload_filename || (isZh ? '上传 MCD' : 'Uploaded MCD');
    }
    return isZh ? '官方默认 MCD' : 'Official MCD';
  })();

  const isUserMcd = sourceMeta?.effective_source === 'user_mcd';

  const focusValue = selectedCoordinate
    ? `${selectedCoordinate.lat.toFixed(1)}°, ${selectedCoordinate.lng.toFixed(1)}°`
    : (isZh ? '全球视图' : 'Global view');
  const displayedTimelineLs = formatTimelineLs(globalTimeLs);

  return (
    <div
      className="overview-status-strip"
      data-embedded={embedded ? 'true' : 'false'}
      style={embedded ? {
        // 观测台画布内：相对画布顶部定位，不再覆盖全站导航。
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        minHeight: 40,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '6px 10px',
        borderRadius: 10,
        background: 'color-mix(in srgb, var(--surface-1) 92%, transparent)',
        borderBottom: '1px solid var(--line-subtle)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        zIndex: 1200,
        pointerEvents: 'none',
      } : {
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: '56px',
        background: 'color-mix(in srgb, var(--surface-1) 92%, transparent)',
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
        zIndex: 2000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        padding: '0 20px',
        borderBottom: '1px solid var(--line-subtle)',
        pointerEvents: 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
        <div className="overview-status-brand">
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: 'var(--brand-accent)',
              flexShrink: 0,
            }}
          />
          <span
            style={{
              color: 'var(--text-primary)',
              fontSize: 'calc(12px * var(--font-scale, 1))',
              fontWeight: 800,
              fontFamily: 'var(--font-display)',
              letterSpacing: 0,
            }}
          >
            AstraAtmos
          </span>
        </div>

        <StatusItem
          label={isZh ? '太阳黄经' : 'Solar longitude'}
          value={`${displayedTimelineLs}°`}
          valueColor="var(--brand-ice)"
        />

        <StatusItem
          label={isZh ? '季节' : 'Season'}
          value={seasonName}
        />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <StatusItem
          label={isZh ? '焦点' : 'Focus'}
          value={focusValue}
          valueColor={selectedCoordinate ? 'var(--brand-ice)' : 'var(--text-secondary)'}
        />

        <StatusItem
          label={isZh ? '高度' : 'Altitude'}
          value={isZh ? '柱平均' : 'Column average'}
        />

        <StatusItem
          label={isZh ? '数据源' : 'Source'}
          value={sourceLabel}
          valueColor={isUserMcd ? 'var(--brand-ice)' : 'var(--text-secondary)'}
        />
      </div>
    </div>
  );
}
