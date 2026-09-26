/**
 * 右侧竖栏的占位状态：还没有选择点位时显示。
 *
 * 右栏宽度常驻（与左轨镜像），这样选中点位时页面不会突然横向跳动；
 * 没有点位时这里说明「点球面即可在此查看该点全年变化」，而不是留一片空白。
 */

import React from 'react';
import { useSettings } from '../../../contexts/SettingsContext';
import './observatoryTimelineRail.css';

export default function PointRailPlaceholder({ hint = null }) {
  const { settings } = useSettings();
  const isZh = settings?.language !== 'en';

  return (
    <aside
      className="observatory-rail observatory-rail--point observatory-rail--empty"
      data-rail-curve="none"
      aria-label={isZh ? '点位年变化' : 'Point annual trend'}
    >
      <div className="observatory-rail__header">
        <span className="observatory-rail__rail-title">
          {isZh ? '点位年变化' : 'Point trend'}
        </span>
      </div>
      <div className="observatory-rail__empty-body">
        <span className="observatory-rail__empty-cross" aria-hidden="true">＋</span>
        <p className="observatory-rail__empty-text">
          {hint || (isZh
            ? '在球面或二维地图上点一个单元，这里显示该点全年的变化曲线。'
            : 'Click a cell on the globe or the 2D map to show that point’s annual curve here.')}
        </p>
      </div>
    </aside>
  );
}
