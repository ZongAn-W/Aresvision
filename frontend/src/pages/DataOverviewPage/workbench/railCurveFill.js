/**
 * 观测轨曲线下方的数值填充。
 *
 * 契约（与两条轨的既有几何一致）：
 *  - 横向 `x = 22 + t * 54`（t 由数值决定），纵向 `y` 由时间轴决定（地球是真实日历进度，火星是真实 Ls）。
 *  - 填充从数值刻度基准线 22 一直铺到曲线，**颜色由数值决定**。
 *  - 颜色用「数值分档 + 实色色块」实现：把轨道高度切成 `BAND_COUNT` 条，每条的数值区间
 *    对应色带上的一个颜色，再与曲线求交得到该条要画的横向范围。这样每个可见像素的颜色
 *    只取决于它所在高度（= 数值），既没有渐变解析问题，也比连续渐变更容易读出"哪一段是哪个值"。
 *  - **颜色按本轨自己的数值范围铺满整条色带**（`colorRange` 缺省）。不用球体图例的绝对色标：
 *    那是给全球空间分布开的宽度（臭氧 94–547 DU），而全球面积加权均值的年内变化只有十几 DU，
 *    按绝对色标着色时整条轨只用到色带 3% 的一小段，等于没有颜色信息。按本轨范围铺满之后，
 *    颜色如实反映这一年的起伏（低值 → 色带低端，高值 → 色带高端）。
 *    代价：两条轨/两个变量的颜色不可横向比较——这与"数值刻度各自独立"是同一取舍。
 *  - 传入 `colorRange` 可切换为绝对锚定（同色 = 同值），保留给需要跨轨比较的场景。
 *  - 深色主题对颜色的最低亮度做一次整体抬升（见 `railFillLuminanceFloor`）：色带低端接近纯黑时
 *    在黑色画布上等于没有填充，抬升只改亮度、保留色相顺序。
 *  - 明确不做的事：不插值、不补零，缺测与缺日按曲线自身的断点分段。
 */
import { getRgb } from '../../../utils/colormaps.js';

const BASELINE = 22;
const MAX_OFFSET = 54;
const TRACK_HEIGHT = 460;
/** 数值分档数：每一档一个实色，档内颜色不随数值变化。 */
const BAND_COUNT = 14;
/** 深色主题下颜色的最低亮度（0–255 的感知近似）。 */
const DARK_LUMINANCE_FLOOR = 60;

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/** 从路径字符串里取回每个顶点的 x（横向幅度），用于决定颜色分档的取值边界。 */
export function curveXs(path) {
  if (typeof path !== 'string') return [];
  return [...path.matchAll(/[ML] (-?[\d.]+) -?[\d.]+/g)].map((match) => Number(match[1]));
}

/**
 * 把顶点 x 反解回数值：`x = baseline + (value - min) / (max - min) * maxOffset`。
 *
 * `domain` 必须是 `[最小值, 最大值]` **数组**（与 `railDomain` / `earthRailDomain` 的返回值一致）；
 * 传对象会被判为非法并返回空数组。端点就是本轨极值，因此填充的取值边界与本轨刻度一致。
 */
export function curveValues(path, domain, { baseline = BASELINE, maxOffset = MAX_OFFSET } = {}) {
  const min = domain?.[0];
  const max = domain?.[1];
  if (!finite(min) || !finite(max) || max <= min) return [];
  return curveXs(path).map((x) => min + ((x - baseline) / maxOffset) * (max - min));
}

function luminance([r, g, b]) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * 深色主题下把颜色的亮度抬到下限之上。
 *
 * 用**三个通道加同一个偏移量**：色相差（通道之间的差）完全不变，只把最暗的那几档抬离纯黑。
 * 试过按比例做幂变换，结果是把 rgb(0,0,4) 变成 rgb(0,0,231) 的电光蓝（亮度仍只有 26），
 * 既没解决可见性又毁掉了色相。浅色主题不处理：色带低端本来就是深色，在白底上看得见。
 */
export function railFillLuminanceFloor(rgb, theme = 'dark') {
  if (theme === 'light') return [...rgb];
  const low = luminance(rgb);
  if (low >= DARK_LUMINANCE_FLOOR) return [...rgb];
  const offset = DARK_LUMINANCE_FLOOR - low;
  return rgb.map((channel) => Math.round(Math.min(255, channel + offset)));
}

/** 数值坐标 fraction∈[0,1] → 该数值使用的颜色。 */
export function railFillColor(colorMode, fraction, theme = 'dark') {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
  const rgb = getRgb(colorMode || 'inferno', clamped);
  const [r, g, b] = railFillLuminanceFloor(rgb, theme);
  return `rgb(${r},${g},${b})`;
}

/**
 * 一个数值区间的颜色：取区间中值在绝对范围里的坐标。
 * 分档与测试共用这一处算术，避免两边各算一遍、结果差 1 个色阶单位。
 */
export function railFillColorForValue(valueLow, valueHigh, colorRange, colorMode, theme = 'dark') {
  const middle = (valueLow + valueHigh) / 2;
  const min = colorRange?.min;
  const max = colorRange?.max;
  const span = Number.isFinite(min) && Number.isFinite(max) ? max - min : 0;
  const fraction = span > 0 ? (middle - min) / span : 0.5;
  return railFillColor(colorMode, fraction, theme);
}

/**
 * 曲线在给定 y 处的横向范围（同一条高度上可能有多段，取最小与最大即填充的真实跨度）。
 */
function spanAt(ys, xs, top, bottom) {
  let low = Infinity;
  let high = -Infinity;
  for (let index = 1; index < ys.length; index += 1) {
    const y0 = ys[index - 1];
    const y1 = ys[index];
    if (!(y0 <= bottom && y1 >= top) && !(y1 <= bottom && y0 >= top)) continue;
    const dy = y1 - y0;
    const t0 = dy === 0 ? 0 : Math.max(0, Math.min(1, (top - y0) / dy));
    const t1 = dy === 0 ? 0 : Math.max(0, Math.min(1, (bottom - y0) / dy));
    const xa = xs[index - 1] + (xs[index] - xs[index - 1]) * t0;
    const xb = xs[index - 1] + (xs[index] - xs[index - 1]) * t1;
    low = Math.min(low, xa, xb);
    high = Math.max(high, xa, xb);
  }
  return low <= high ? { low, high } : null;
}

/**
 * 数值分档 → 实色横向色块。
 *
 * 每档颜色由 f 决定：f = (该档数值 − colorRange.min) / (colorRange.max − colorRange.min)，
 * `colorRange` 缺省时回退到本轨数值范围。每个色块只覆盖该档与曲线相交的范围，因此
 * 色块高度 = 该数值区间的轨道高度，宽度 = 该档内曲线的横向包络。
 * 刻度退化、顶点少于两个或数值全平时返回 `[]`。
 */
export function buildCurveFillBands(path, domain, colorMode, {
  baseline = BASELINE, maxOffset = MAX_OFFSET, height = TRACK_HEIGHT, bands = BAND_COUNT, theme = 'dark',
  colorRange = null,
} = {}) {
  const xs = curveXs(path);
  if (xs.length < 2 || !finite(height) || height <= 0) return [];
  const values = curveValues(path, domain, { baseline, maxOffset });
  if (values.length < 2) return [];
  const valueMin = Math.min(...values);
  const valueMax = Math.max(...values);
  if (!(valueMax > valueMin)) return [];

  // 颜色锚定绝对数值范围：没有就退回本轨范围（此时颜色只表示"在本轨里的相对高低"）。
  const colorMin = finite(colorRange?.min) ? colorRange.min : valueMin;
  const colorMax = finite(colorRange?.max) && colorRange.max > colorMin ? colorRange.max : valueMax;

  const total = Math.max(2, Math.round(bands));
  const step = height / total;
  // 用整数像素边界切档，避免相邻色块之间出现半像素缝隙。
  const edges = Array.from({ length: total + 1 }, (_, index) => Math.round(index * step));
  const ys = xs.map((x) => height - ((x - baseline) / maxOffset) * height);

  const rows = [];
  for (let index = 0; index < total; index += 1) {
    const top = edges[index];
    const bottom = edges[index + 1];
    if (bottom - top < 1) continue;
    const span = spanAt(ys, xs, top, bottom);
    if (!span) continue;
    // 右边界取该档内曲线的最右点：填充因此与曲线外缘齐平，不会在图线左侧留一条缝。
    const width = Math.max(0, span.high - baseline);
    if (width <= 0) continue;
    // 轨道顶部 = 本轨最大值，因此顶部那一档的数值最高。
    const valueHigh = valueMin + ((total - index) / total) * (valueMax - valueMin);
    const valueLow = valueMin + ((total - 1 - index) / total) * (valueMax - valueMin);
    rows.push({
      key: index,
      color: railFillColorForValue(valueLow, valueHigh, { min: colorMin, max: colorMax }, colorMode, theme),
      x: baseline,
      width: Number(width.toFixed(2)),
      y: top,
      height: bottom - top,
      valueLow,
      valueHigh,
    });
  }
  return rows;
}
