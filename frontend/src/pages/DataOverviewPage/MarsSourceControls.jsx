/**
 * Mars 数据源选择控件（官方 / 个人 MCD、OpenMARS、NOMAD）。
 *
 * 本模块是观测台里的唯一实现：从旧左栏 `SidebarMenu` 原样提取，业务回调仍由
 * `DataOverviewContext` 提供，组件本身不持有来源状态。登录限制、加载状态、
 * 不可用来源的悬浮说明与年份范围全部保留。
 *
 * `SidebarMenu.jsx` 继续重新导出这两个组件，保持既有导入路径可用。
 */

import React from 'react';
import C from '../../constants/colors';
import {
  PanelCard,
  PanelSelect,
  SegmentedToggle,
} from './workbench/ObservatoryToolParts.jsx';
import { buildUploadYearOptions } from './uploadedSourceOptions';

function formatLsStatus(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '--';
  return number.toFixed(number % 1 === 0 ? 0 : 1);
}

function countUploadsForYear(uploads = [], marsYear) {
  const year = Number(marsYear);
  if (!Number.isFinite(year)) return 0;
  return (uploads || []).filter((upload) => Number(upload?.marsYear) === year || Number(upload?.mars_year) === year).length;
}

export function SourceScopePicker({
  title,
  desc,
  sourceName,
  selectedUploadId,
  onSelectUpload,
  personalOptions,
  officialOptions,
  officialValue,
  onOfficialChange,
  disabled = false,
  loading = false,
  showEmptyPersonalHint = true,
  isSignedIn = false,
  isLight = false,
  isZh = false,
  accent = C.blue,
}) {
  const hasPersonalOptions = personalOptions.length > 0;
  const scope = selectedUploadId ? 'personal' : 'official';
  const selectOptions = scope === 'personal' ? personalOptions : officialOptions;
  const officialValueString = String(officialValue);
  const resolvedOfficialValue = officialOptions.some((option) => option.value === officialValueString)
    ? officialValueString
    : officialOptions[0]?.value || '';
  const selectValue = scope === 'personal'
    ? (selectedUploadId ? String(selectedUploadId) : personalOptions[0]?.value || '')
    : resolvedOfficialValue;
  const selectLabel = isZh ? '火星年' : 'Mars year';
  const disabledReason = !hasPersonalOptions && isZh
    ? '暂无可用于数据总览的个人上传源'
    : 'No usable personal upload for Data Overview yet';
  // 未登录时先说清“登录后可用”，再说“暂无个人数据”，避免把权限问题说成数据缺失。
  const personalDisabledTitle = !isSignedIn
    ? (isZh ? '登录后可使用个人数据源。' : 'Sign in to use personal data sources.')
    : (isZh
      ? '暂无个人 MCD 数据，请先在数据管理中上传可用于数据总览的 MCD 原始数据。'
      : 'No personal MCD data available. Upload a Data Overview MCD raw dataset first.');

  const handleScopeChange = (value) => {
    if (value === 'official') {
      onSelectUpload(null);
      return;
    }
    const nextUploadId = Number(personalOptions[0]?.value);
    if (Number.isFinite(nextUploadId)) onSelectUpload(nextUploadId);
  };

  const handleSelectChange = (value) => {
    if (scope === 'personal') {
      onSelectUpload(Number(value));
      return;
    }
    onOfficialChange(value);
  };

  return (
    <PanelCard>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: C.ice, fontSize: 'calc(12px * var(--font-scale, 1))', fontWeight: 800, letterSpacing: '-0.01em' }}>
            {title}
          </div>
          {desc ? (
            <div style={{ color: C.ice45, fontSize: 'calc(10px * var(--font-scale, 1))', lineHeight: 1.5, marginTop: 3 }}>
              {desc}
            </div>
          ) : null}
        </div>
        <span
          style={{
            flexShrink: 0,
            padding: '3px 7px',
            borderRadius: 999,
            background: `${accent}18`,
            color: accent,
            fontSize: 'calc(9px * var(--font-scale, 1))',
            fontWeight: 800,
            letterSpacing: '0.04em',
          }}
        >
          {sourceName}
        </span>
      </div>

      <SegmentedToggle
        value={scope}
        onChange={handleScopeChange}
        disabled={disabled || loading}
        isLight={isLight}
        options={[
          {
            value: 'official',
            label: isZh ? '官方' : 'Official',
            activeBg: `${accent}18`,
            activeColor: accent,
          },
          {
            value: 'personal',
            label: isZh ? '个人' : 'Personal',
            activeBg: 'rgba(52,211,153,0.14)',
            activeColor: '#34d399',
            disabled: !hasPersonalOptions,
            disabledTitle: personalDisabledTitle,
          },
        ]}
      />

      <PanelSelect
        label={selectLabel}
        value={selectValue}
        onChange={handleSelectChange}
        options={selectOptions}
        disabled={disabled || loading || selectOptions.length === 0}
        isLight={isLight}
      />

      {!hasPersonalOptions && showEmptyPersonalHint ? (
        <div style={{ color: C.ice40, fontSize: 'calc(10px * var(--font-scale, 1))', lineHeight: 1.5 }}>
          {disabledReason}
        </div>
      ) : null}
    </PanelCard>
  );
}

export function OzoneSourceModePicker({
  title,
  desc,
  sourceName,
  mode,
  onModeChange,
  personalUploads = [],
  selectedSource,
  marsYear,
  ls,
  disabled = false,
  loading = false,
  isLight = false,
  isZh = false,
  isSignedIn = false,
  accent = C.blue,
}) {
  const personalCount = personalUploads.length;
  const sameYearCount = countUploadsForYear(personalUploads, marsYear);
  const hasPersonalOptions = isSignedIn && personalCount > 0;
  const personalDisabledTitle = !isSignedIn
    ? (isZh ? '登录后可使用个人数据源。' : 'Sign in to use personal data sources.')
    : (isZh
      ? `暂无个人 ${sourceName} 数据，请先在数据管理中上传对应原始数据。`
      : `No personal ${sourceName} data available. Upload a matching raw dataset first.`);
  const isPersonal = mode === 'personal';
  const personalAvailableNow = isPersonal && selectedSource?.available && selectedSource?.uploadId;
  const statusText = (() => {
    if (loading) return isZh ? '正在刷新个人源...' : 'Refreshing personal sources...';
    if (!isSignedIn) return isZh ? '登录后可切换个人源' : 'Sign in to switch personal source mode.';
    if (!isPersonal) return `${isZh ? '官方' : 'Official'} · MY ${marsYear} / Ls ${formatLsStatus(ls)}`;
    if (personalAvailableNow) {
      return `${isZh ? '个人' : 'Personal'} · MY ${marsYear} / Ls ${formatLsStatus(ls)}`;
    }
    if (sameYearCount > 0) {
      return isZh ? `MY ${marsYear} · 当前 Ls 无覆盖` : `MY ${marsYear} · No coverage at current Ls`;
    }
    return isZh ? `暂无 MY ${marsYear} 个人源` : `No personal MY ${marsYear} source yet.`;
  })();
  const statusAccent = personalAvailableNow
    ? '#34d399'
    : isPersonal
      ? C.mars
      : accent;

  return (
    <PanelCard>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: C.ice, fontSize: 'calc(12px * var(--font-scale, 1))', fontWeight: 800, letterSpacing: '-0.01em' }}>
            {title}
          </div>
          {desc ? (
            <div style={{ color: C.ice45, fontSize: 'calc(10px * var(--font-scale, 1))', lineHeight: 1.5, marginTop: 3 }}>
              {desc}
            </div>
          ) : null}
        </div>
        <span
          style={{
            flexShrink: 0,
            padding: '3px 7px',
            borderRadius: 999,
            background: `${accent}18`,
            color: accent,
            fontSize: 'calc(9px * var(--font-scale, 1))',
            fontWeight: 800,
            letterSpacing: '0.04em',
          }}
        >
          {sourceName}
        </span>
      </div>

      <SegmentedToggle
        value={mode}
        onChange={onModeChange}
        disabled={disabled || loading}
        isLight={isLight}
        options={[
          {
            value: 'official',
            label: isZh ? '官方' : 'Official',
            activeBg: `${accent}18`,
            activeColor: accent,
          },
          {
            value: 'personal',
            label: isZh ? '个人' : 'Personal',
            activeBg: 'rgba(52,211,153,0.14)',
            activeColor: '#34d399',
            disabled: !hasPersonalOptions,
            disabledTitle: personalDisabledTitle,
          },
        ]}
      />

      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 8,
          color: C.ice45,
          fontSize: 'calc(10px * var(--font-scale, 1))',
          lineHeight: 1.5,
        }}
      >
        <span
          style={{
            width: 7,
            height: 7,
            marginTop: 4,
            borderRadius: 999,
            background: statusAccent,
            boxShadow: `0 0 8px ${statusAccent}`,
            flexShrink: 0,
          }}
        />
        <span>{statusText}</span>
      </div>
    </PanelCard>
  );
}

/** 个人上传年份范围（与 MCD 选择共用同一实现）。 */
export function marsUploadYearOptions(uploads = []) {
  return buildUploadYearOptions(uploads);
}
