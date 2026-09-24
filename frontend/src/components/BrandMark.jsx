import './brand.css';

/**
 * AstraAtmos「大气之 A / Atmospheric A」品牌图形。
 *
 * 几何与 `assets/brand/astraatmos/astraatmos-mark-*.svg` 完全一致（256 画板）：
 * A 字母骨架 + 上扬的弧形大气流线 + 橙色观测点。
 * 颜色由 brand.css 的主题变量（`--brand-primary` / `--brand-accent`）给出，
 * 深浅主题自动切换；`mono` 形态整体继承 `currentColor`。
 *
 * 着色统一交给 CSS 类，不在元素上写 fill / stroke 呈现属性：呈现属性的优先级
 * 低于样式表规则，写了会让 `.brand-mark--mono { fill: currentColor }` 失效。
 *
 * 图形旁已有品牌文字时保持装饰图语义，独立使用时传入 `label`。
 *
 * @param {number}  size    画板边长（CSS px），完整图形建议不小于 32
 * @param {boolean} mono    单色形态（页脚等受限色彩场景），继承 currentColor
 * @param {boolean} compact 小尺寸简化形态，省略观测点并加粗流线
 * @param {string}  label   独立使用时的可访问名称；省略时对读屏隐藏
 */
export default function BrandMark({ size = 40, mono = false, compact = false, label }) {
  return (
    <svg
      className={`brand-mark${mono ? ' brand-mark--mono' : ''}`}
      width={size}
      height={size}
      viewBox="0 0 256 256"
      xmlns="http://www.w3.org/2000/svg"
      role={label ? 'img' : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <path className="brand-mark__letter" d="M51 211 L112 59 Q128 26 144 59 L205 211 H170 L128 102 L86 211 Z" />
      <path
        className="brand-mark__flow"
        d="M35 185 C91 196 161 158 203 124"
        strokeWidth={compact ? 16 : 13}
        strokeLinecap="round"
      />
      {!compact && <circle className="brand-mark__accent" cx="221" cy="105" r="9" />}
    </svg>
  );
}
