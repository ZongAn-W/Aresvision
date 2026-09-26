/**
 * 3D 点位探针弹窗外壳。
 *
 * 内容（点位数值、全球/纬向均值对比、全年序列、单位换算与错误说明）已抽到
 * `PointProbeContent`，与观测台底部分析区共用同一份实现。本文件只负责弹窗
 * 遮罩、点外关闭与紧凑尺寸。
 */

import React from 'react';
import { useSettings } from '../../contexts/SettingsContext';
import PointProbeContent from './PointProbeContent.jsx';

export default function PointProbeModal({ probe, loading = false, error = '', onClose }) {
  const { settings } = useSettings();
  const isLight = settings?.theme === 'light';
  if (!probe) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2500,
        display: 'grid',
        placeItems: 'center',
        padding: 14,
        background: isLight ? 'rgba(235,241,248,0.42)' : 'rgba(2,5,12,0.58)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
      }}
    >
      {/* The compact shell keeps the dialog readable without turning it into a full-width board. */}
      <PointProbeContent
        probe={probe}
        loading={loading}
        error={error}
        onClose={onClose}
        dialog
      />
    </div>
  );
}
