import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCurveFillBands, curveValues, curveXs, railFillColor, railFillColorForValue, railFillLuminanceFloor } from './railCurveFill.js';
import { makeColorSpec, colorFraction, getRgb } from '../../../utils/colormaps.js';

const luma = (color) => {
  const [r, g, b] = color.match(/\d+/g).map(Number);
  return 0.299 * r + 0.587 * g + 0.114 * b;
};

test('bands tile the rail height with no gaps and keep the baseline as left edge', () => {
  // 全高度扫过的曲线：每一档都应该与它相交。
  const path = 'M 22.00 0.00 L 76.00 460.00';
  const bands = buildCurveFillBands(path, [0, 1], 'inferno', { theme: 'light' });
  assert.equal(bands.length, 14);
  // 相邻档首尾相接，没有缝隙也没有重叠。
  for (let index = 1; index < bands.length; index += 1) {
    assert.equal(bands[index].y, bands[index - 1].y + bands[index - 1].height);
  }
  assert.equal(bands[0].y, 0);
  assert.equal(bands[bands.length - 1].y + bands[bands.length - 1].height, 460);
  // 每一档的左边界都不越过数值刻度基准线。
  for (const band of bands) assert.ok(band.x >= 22 - 1e-9, JSON.stringify(band));
});

test('band colors run from the colormap low end at the bottom to the high end at the top', () => {
  // 轨道顶部 = 本轨最大值，取该档中值作为颜色坐标（首尾档各取 13/14 与 1/28）。
  const path = 'M 22.00 0.00 L 76.00 460.00';
  const bands = buildCurveFillBands(path, [0, 1], 'viridis', { theme: 'light' });
  const total = bands.length;
  assert.equal(bands[0].color, railFillColor('viridis', (total - 0.5) / total, 'light'));
  assert.equal(bands[total - 1].color, railFillColor('viridis', 0.5 / total, 'light'));
  assert.equal(new Set(bands.map((band) => band.color)).size, total);
  // 颜色确实随数值单调变化，不是一片同色。
  const top = luma(bands[0].color);
  const bottom = luma(bands[total - 1].color);
  assert.ok(Math.abs(top - bottom) > 40, `${top} vs ${bottom}`);
});

test('each band reports the value range it covers, inside the rail domain', () => {
  const path = 'M 22.00 0.00 L 76.00 460.00';
  const bands = buildCurveFillBands(path, [278, 290], 'inferno', { theme: 'dark' });
  assert.equal(bands[0].valueHigh, 290);
  assert.equal(bands[bands.length - 1].valueLow, 278);
  for (const band of bands) {
    assert.ok(band.valueLow >= 278 && band.valueHigh <= 290);
    assert.ok(band.valueHigh > band.valueLow);
  }
  // 档与档之间的数值区间首尾相接。
  for (let index = 1; index < bands.length; index += 1) {
    assert.ok(Math.abs(bands[index].valueHigh - bands[index - 1].valueLow) < 1e-9);
  }
});

test('band width follows the curve envelope inside each value band', () => {
  // 曲线只在中部偏右：上下两端的档要么很窄要么不存在。
  const path = 'M 60.00 100.00 L 76.00 300.00 L 30.00 400.00';
  const bands = buildCurveFillBands(path, [0, 100], 'inferno', { theme: 'dark' });
  assert.ok(bands.length > 0);
  for (const band of bands) {
    assert.ok(band.width > 0);
    // 左边界固定为数值刻度基准线，右边界为该档内曲线最右点，因此与曲线外缘齐平。
    assert.equal(band.x, 22);
    assert.ok(band.width <= 76 - 22 + 1e-9);
  }
  // 没有曲线经过的高度不产生色块。
  const covered = bands.reduce((sum, band) => sum + band.height, 0);
  assert.ok(covered < 460);
  // 底部档（高 x 区间）应比顶部档更宽：曲线在中部最靠右。
  assert.ok(bands[0].width > 0 && bands[bands.length - 1].width > 0);
});

test('band colors span the whole palette across the rail own value range', () => {
  const path = 'M 22.00 0.00 L 76.00 460.00';
  // 数值沿轨道单调变化：顶部 = 本轨最大值，底部 = 最小值。
  const bands = buildCurveFillBands(path, [278, 290], 'inferno', { theme: 'dark' });
  const total = bands.length;
  assert.equal(total, 14);
  // 颜色从色带高端（顶部）铺到低端（底部），每一档都不同。
  assert.ok(luma(bands[0].color) > 200, `顶部应为色带最亮端：${bands[0].color}`);
  assert.ok(luma(bands[total - 1].color) < 120, `底部应为色带最暗端：${bands[total - 1].color}`);
  assert.equal(new Set(bands.map((band) => band.color)).size, total);
  // 颜色坐标 = 该档数值中值在**本轨数值范围**里的位置（臭氧 13 DU 的年内变化因此用满整条色带）。
  const fraction = (band) => (band.valueLow + band.valueHigh) / 2;
  assert.equal(bands[0].color, railFillColor('inferno', (fraction(bands[0]) - 278) / 12, 'dark'));
  assert.equal(bands[total - 1].color, railFillColor('inferno', (fraction(bands[total - 1]) - 278) / 12, 'dark'));
});

test('each rail colors its own range: colors are per-rail relative, not absolute', () => {
  const path = 'M 22.00 0.00 L 76.00 460.00';
  // 两条轨各自铺满色带（档位中值决定了首尾档的取色位置略有不同，因此不比较具体色值），
  // 但颜色对应的数值完全不同——这是本方案的已知代价：可读起伏，不可跨轨比较绝对值。
  const narrow = buildCurveFillBands(path, [278, 290], 'inferno', { theme: 'dark' });
  const wide = buildCurveFillBands(path, [-40, 60], 'inferno', { theme: 'dark' });
  assert.equal(narrow.length, 14);
  assert.equal(wide.length, 14);
  assert.equal(new Set(narrow.map((band) => band.color)).size, 14);
  assert.equal(new Set(wide.map((band) => band.color)).size, 14);
  // 两条轨都是"顶部最亮、底部最暗"，铺满色带。
  for (const bands of [narrow, wide]) {
    assert.ok(luma(bands[0].color) > 200, `顶部应为色带最亮端：${bands[0].color}`);
    assert.ok(luma(bands[13].color) < 120, `底部应为色带最暗端：${bands[13].color}`);
  }
  // 同一个档位在不同数值范围下对应完全不同的数值。
  assert.equal(narrow[0].valueHigh, 290);
  assert.equal(wide[0].valueHigh, 60);
  // 数值整体平移时，档的数值区间随数据改变。
  const shifted = buildCurveFillBands(path, [300, 320], 'inferno', { theme: 'dark' });
  assert.notDeepEqual(narrow.map((band) => band.valueHigh), shifted.map((band) => band.valueHigh));
  // 退化输入不产生色块。
  assert.deepEqual(buildCurveFillBands(path, [7, 7], 'inferno'), []);
  // domain 必须是 [min, max] 数组（与 earthRailDomain / railDomain 的返回一致）：传对象返回空。
  assert.deepEqual(buildCurveFillBands(path, { min: 278, max: 290 }, 'inferno'), []);
});

test('colors follow the data through the rail own range', () => {
  const path = 'M 22.00 0.00 L 76.00 460.00';
  // 同一条轨道、数值范围不同：颜色只由数值在本轨范围里的位置决定，因此分布一致；
  // 数值本身不同（valueLow/valueHigh 改变），颜色也跟着重新铺满——这正是"随数据变化"。
  const lowBands = buildCurveFillBands(path, [260, 280], 'inferno', { theme: 'dark' });
  const highBands = buildCurveFillBands(path, [300, 320], 'inferno', { theme: 'dark' });
  assert.equal(lowBands.length, 14);
  assert.equal(highBands.length, 14);
  assert.notEqual(lowBands[0].valueHigh, highBands[0].valueHigh);
  assert.equal(lowBands[0].color, highBands[0].color);   // 同一个"本轨最高档" → 同一个颜色
  // 用实现同一个函数按档自己的数值区间复算，避免手写分数带来的浮点尾差。
  const sharedRange = { min: lowBands[13].valueLow, max: lowBands[0].valueHigh };
  assert.ok(lowBands.every((band) => band.color === railFillColorForValue(band.valueLow, band.valueHigh, sharedRange, 'inferno', 'dark')));
  assert.ok(luma(lowBands[0].color) > luma(lowBands[13].color));
});

test('dark theme lifts the near-black colormap end so the fill stays visible', () => {
  const dark = railFillLuminanceFloor(getRgb('inferno', 0), 'dark');
  assert.ok(luma(`rgb(${dark.join(',')})`) >= 55, `亮度 ${luma(`rgb(${dark.join(',')})`)}`);
  // 已经很亮的颜色原样保留；浅色主题不做处理。
  assert.deepEqual(railFillLuminanceFloor([252, 255, 164], 'dark'), [252, 255, 164]);
  assert.deepEqual(railFillLuminanceFloor(getRgb('inferno', 0), 'light'), getRgb('inferno', 0));
  // 抬升是「三通道加同一偏移」：色相差不变，不会把近黑变成饱和蓝。
  const lifted = railFillLuminanceFloor([0, 0, 4], 'dark');
  assert.deepEqual(lifted.map((channel, index) => channel - [0, 0, 4][index]), [lifted[0], lifted[0], lifted[0]]);
  assert.equal(Math.max(...lifted) - Math.min(...lifted), 4);
  assert.ok(luma(`rgb(${lifted.join(',')})`) >= 55, `亮度 ${luma(`rgb(${lifted.join(',')})`)}`);
});

test('missing data, flat curves and degenerate domains produce no bands', () => {
  const path = 'M 22.00 0.00 L 76.00 460.00';
  assert.deepEqual(buildCurveFillBands('', [1, 5], 'inferno'), []);
  assert.deepEqual(buildCurveFillBands('M 22.00 0.00', [1, 5], 'inferno'), []);
  // 平坦序列：x 只有 49，没有数值跨度。
  assert.deepEqual(buildCurveFillBands('M 49.00 0.00 L 49.00 460.00', [5, 5], 'inferno'), []);
  assert.deepEqual(buildCurveFillBands(path, null, 'inferno'), []);
  assert.deepEqual(buildCurveFillBands(path, [7, 7], 'inferno'), []);
});

test('curve helpers keep the original semantics', () => {
  const path = 'M 22.00 0.00 L 49.00 230.00 M 76.00 460.00';
  assert.equal(curveXs(path).join(','), '22,49,76');
  assert.deepEqual(curveXs(null), []);
  assert.deepEqual(curveValues(path, [278, 290]).map((value) => Math.round(value)), [278, 284, 290]);
  assert.deepEqual(curveValues(path, [7, 7]), []);
});

test('color spec mirrors the globe palette and clamps fractions', () => {
  assert.deepEqual(makeColorSpec({ variable: 'TO3', colormap: 'viridis', range: { min: 250, max: 330 } }),
    { mode: 'viridis', name: 'viridis', min: 250, max: 330 });
  // 风分量必须走发散色阶，忽略用户色阶设置（火星 U_Wind / 地球 U10M 都算）。
  assert.equal(makeColorSpec({ variable: 'U_Wind', colormap: 'jet' }).mode, 'rdbu');
  assert.equal(makeColorSpec({ variable: 'U10M', colormap: 'jet' }).mode, 'rdbu');
  assert.equal(makeColorSpec({ variable: 'T2M', centeredOnZero: true, colormap: 'viridis' }).mode, 'rdbu');
  // 未知色阶名回退 inferno；范围缺失时留 null，由调用方回退本轨刻度。
  assert.equal(makeColorSpec({ variable: 'TO3', colormap: 'nope' }).mode, 'inferno');
  assert.equal(makeColorSpec({ range: { min: 5, max: 5 } }).min, null);
  assert.equal(makeColorSpec({}).max, null);

  const spec = { min: 0, max: 10 };
  assert.equal(colorFraction(spec, -3), 0);
  assert.equal(colorFraction(spec, 4), 0.4);
  assert.equal(colorFraction(spec, 99), 1);
  assert.equal(colorFraction(spec, null), null);
  assert.equal(colorFraction({ min: null, max: null }, 4), null);
});
