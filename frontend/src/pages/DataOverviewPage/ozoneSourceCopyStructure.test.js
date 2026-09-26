import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// 数据源控件已从旧左栏拆到 MarsSourceControls，复制文案的约束随之迁移。
const sourceControlsSource = readFileSync(new URL('./MarsSourceControls.jsx', import.meta.url), 'utf8');
const toolPartsSource = readFileSync(new URL('./workbench/ObservatoryToolParts.jsx', import.meta.url), 'utf8');

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `${startMarker} should exist`);
  assert.notEqual(end, -1, `${endMarker} should exist after ${startMarker}`);
  return source.slice(start, end);
}

test('ozone source controls do not show the redundant MCD analysis explanation', () => {
  assert.equal(sourceControlsSource.includes('右侧分析始终使用 MCD'), false);
  assert.equal(sourceControlsSource.includes('Right-side analysis stays on MCD'), false);
});

test('source control panel keeps dataset source copy concise', () => {
  [
    '先选择分析视角',
    'Choose an analysis lens first',
    '驱动数据总览全部二维图表与主球体',
    'Drives all Data Overview charts and the main globe',
    '登录后可使用自己上传的 MCD 主数据',
    'Sign in to use uploaded MCD page data',
    '只影响 3D 多源与差值图层',
    'Only affects 3D multi-source and diff layers',
    '只影响 3D 观测验证与差值对比',
    'Only affects 3D validation and diff checks',
    '官方源跟随',
    'Official source follows',
  ].forEach((text) => {
    assert.equal(sourceControlsSource.includes(text), false, `${text} should not be rendered in the source panel`);
  });
});

test('disabled personal ozone source buttons expose hover explanations', () => {
  // 分段控件的禁用原因说明由共用原子控件统一提供。
  assert.match(toolPartsSource, /const optionTitle = optionDisabled \? option\.disabledTitle : option\.title/);
  assert.match(toolPartsSource, /title=\{optionTitle\}/);
  assert.match(toolPartsSource, /<button[\s\S]*disabled=\{optionDisabled\}[\s\S]*title=\{optionTitle\}/);
  assert.match(sourceControlsSource, /disabledTitle: personalDisabledTitle/);
  assert.match(sourceControlsSource, /No personal/);
  assert.match(sourceControlsSource, /sourceName/);
});

test('MCD personal source explains sign-in before reporting missing data', () => {
  const mcdPickerSource = sourceBetween(sourceControlsSource, 'export function SourceScopePicker', 'export function OzoneSourceModePicker');
  assert.match(mcdPickerSource, /isSignedIn = false/);
  assert.match(mcdPickerSource, /const personalDisabledTitle = !isSignedIn/);
  assert.match(mcdPickerSource, /登录后可使用个人数据源。/);
  assert.match(mcdPickerSource, /isSignedIn=\{Boolean\(user\)\}|isSignedIn = false/);

  // 面板调用点必须把登录状态传下去，否则禁用原因会退化成“暂无数据”。
  const panelsSource = readFileSync(new URL('./ObservatoryMars.jsx', import.meta.url), 'utf8');
  assert.match(panelsSource, /isSignedIn=\{Boolean\(user\)\}/);
});
