# AstraAtmos「大气之 A」品牌接入 Implementation Plan

> **For agentic workers:** 使用 `executing-plans` 技能按任务执行；步骤使用复选框跟踪。

**状态：已实施并完成浏览器验收（2026-09-24）**，验收记录与实际偏差见文末第 7 节。

**Goal:** 将用户图片明确选定的初版 **「大气之 A / Atmospheric A」** 接入全站导航、浏览器图标、关于页、页脚与 README，使 AstraAtmos 在深浅主题下呈现一致品牌。

**Architecture:** React 页面统一使用一个无状态 `BrandMark` SVG 组件，颜色继承现有 `data-theme` 主题。浏览器与文档使用独立静态 SVG / PNG 资产。只在品牌与首页强调区域应用新色彩，保留科学数据色带、星球纹理和业务状态色的原有语义。

**Tech Stack:** React 19、现有 CSS 主题变量、SVG、Vite 6；无新增运行时依赖。

---

## 1. 选定方向与实施边界

本方案采用用户图片明确选定的初版「大气之 A」。源稿为[深色背景标志](../../assets/brand/astraatmos/astraatmos-mark-dark.svg)、[浅色背景标志](../../assets/brand/astraatmos/astraatmos-mark-light.svg)，完整效果见[设计展示图](../../assets/brand/astraatmos/astraatmos-brand-preview.png)。

A 字母作为主体，弧形横笔表达大气环流，独立橙色观测点呼应火星研究起点。完整标志保留这三个元素及原有比例。图形不随火星 / 地球切换改变，避免品牌标识与当前数据场景混淆。

### 视觉约定

| 项目 | 决定 |
| --- | --- |
| 英文品牌字标 | `AstraAtmos`，采用当前系统字体栈和 700 字重，保留可选择文本 |
| 导航副标题 | 复用 `t('nav.subtitle')`，跟随中英文切换 |
| 深色主题图形 | 冰蓝主色 `#9AD9EF`，橙色观测点 `#F19A78` |
| 浅色主题图形 | 深蓝主色 `#236387`，深赤陶观测点 `#C76543` |
| 导航尺寸 | 图形画板 40 × 40 CSS px，文字间距 10 px；窄屏图形可降为 36 px |
| 关于页尺寸 | 标题上方 72 × 72 px，留出 16 px 间距 |
| 页脚尺寸 | 24 × 24 px 单色简化图形，省略观测点，配合现有版权文字 |
| 动效 | 静态图形，不添加自转、呼吸或发光效果 |
| 首页融合 | 标题第二行、主按钮及已有装饰线使用品牌主色；保留地球 / 火星三维预览 |
| 小图标 | 复用已有简化 A：省略观测点、加粗弧线，提供 SVG、32 px PNG 与 ICO |

导航尺寸指完整 `viewBox` 画板，含观测点的图形约占宽度的 79%，40 px 画板的可见宽度约为 32 px。32 px 及以上使用完整标志；16–24 px 使用简化版。不要移动观测点、改变弧线角度或非等比拉伸。

### 本期范围

完成导航、首页强调色、关于页品牌图形、页脚单色图形、favicon 与 README。现有设计探索资产保留。仓库名、目录名、API、环境变量、存储键、启动脚本、科学图表色带均不属于本次品牌接入范围。无需调整后端或安装新字体。

## 2. 已核对的现状

- `frontend/src/components/Navbar.jsx` 定义并使用 `MarsLogoIcon`，以渐变圆球绘制火星；品牌容器是带点击处理的 `div`，正文是 `ASTRAATMOS`。
- 导航已复用到各页面；更换此处即可覆盖首页与业务工作台。
- `frontend/index.html` 引用 `/favicon.svg`，该文件仍是旧火星图形。
- `frontend/src/index.css` 与 `SettingsContext.jsx` 通过 `data-theme="light"` 切换主题，主题可在 React 挂载前恢复。
- 首页强调色集中在 `frontend/src/pages/HomePage/homePage.css` 的 `--home-accent` / `--home-accent-ink`。
- `frontend/src/pages/AboutPage.jsx` 以 `SectionTitle` 开头，没有独立品牌图形。
- `frontend/src/App.jsx` 页脚只有版权与技术文案。
- README 顶部引用现有 favicon；品牌说明仍为探索资产，尚未接入。
- 本次搜索范围 `frontend`、`scripts`、`assets` 未发现产品代码对 `assets/images/logo.png` 的引用，不因其文件名而覆盖它。

## 3. 文件职责

| 文件 | 操作与职责 |
| --- | --- |
| `frontend/src/components/BrandMark.jsx` | 新增：唯一的主题感知图形组件 |
| `frontend/src/components/brand.css` | 新增：品牌色、尺寸、导航品牌按钮和焦点样式 |
| `frontend/src/components/Navbar.jsx` | 替换旧火星图形，使用语义按钮与新版字标 |
| `frontend/src/pages/HomePage/homePage.css` | 首页强调色继承品牌变量 |
| `frontend/src/pages/AboutPage.jsx` | 增加标题上方的品牌图形 |
| `frontend/src/App.jsx` | 页脚增加单色图形 |
| `frontend/public/brand/astraatmos-mark.svg` | 新增：浅色文档、README 用静态彩色源文件 |
| `frontend/public/brand/astraatmos-mark-dark.svg` | 新增：深色背景用静态源文件 |
| `frontend/public/favicon.svg` | 复用带深色固定底的简化 A，适应浏览器标签栏背景 |
| `frontend/public/favicon.ico` | 新增：复用已有 16 / 32 / 48 / 64 px ICO |
| `frontend/public/favicon-32.png` | 新增：从新 favicon 渲染的 PNG 兼容图标 |
| `frontend/index.html` | 声明 SVG 与 PNG 图标，更新缓存版本 |
| `README.md` | 替换顶部展示、更新品牌现状及组件入口 |
| `assets/brand/astraatmos/README.md` | 区分已采用方案与历史探索方案，链接运行时资产 |

## 4. 执行任务

### Task 1：收敛品牌组件与静态资产

- [x] **确认实时工作区。** 在仓库根目录执行 `git status --short`、`git diff -- frontend/src/components/Navbar.jsx frontend/src/App.jsx frontend/index.html README.md`，保留已有改动，避免按旧快照覆盖文件。
- [x] **新增 `BrandMark.jsx`，完整内容如下。** 图形旁已有品牌文字时默认为装饰图；独立使用时传入准确的 `label`。

```jsx
import './brand.css';

export default function BrandMark({ size = 40, mono = false, compact = false, label }) {
  return (
    <svg
      className={`brand-mark${mono ? ' brand-mark--mono' : ''}`}
      width={size} height={size} viewBox="0 0 256 256"
      xmlns="http://www.w3.org/2000/svg"
      role={label ? 'img' : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <path d="M51 211 L112 59 Q128 26 144 59 L205 211 H170 L128 102 L86 211 Z" />
      <path className="brand-mark__flow"
        d="M35 185 C91 196 161 158 203 124"
        strokeWidth={compact ? 16 : 13} strokeLinecap="round" />
      {!compact && <circle className="brand-mark__accent" cx="221" cy="105" r="9" />}
    </svg>
  );
}
```

- [x] **新增 `brand.css`，完整内容如下。** 变量仅定义在品牌命名空间，不替换 `C.blue`、`C.mars` 或状态颜色。

```css
:root {
  --brand-primary: #9ad9ef;
  --brand-accent: #f19a78;
  --brand-on-primary: #081c29;
}
[data-theme="light"] {
  --brand-primary: #236387;
  --brand-accent: #c76543;
  --brand-on-primary: #ffffff;
}
.brand-mark { display: block; flex-shrink: 0; fill: var(--brand-primary); }
.brand-mark__flow { fill: none; stroke: var(--brand-primary); }
.brand-mark__accent { fill: var(--brand-accent); }
.brand-mark--mono, .brand-mark--mono .brand-mark__accent { fill: currentColor; }
.brand-mark--mono .brand-mark__flow { stroke: currentColor; }
.brand-home-button {
  display: inline-flex; align-items: center; gap: 10px; flex-shrink: 0;
  min-height: 44px; padding: 0; border: 0; border-radius: 6px;
  background: transparent; color: var(--text); font: inherit;
  text-align: left; cursor: pointer;
}
.brand-home-button:focus-visible { outline: 2px solid var(--brand-primary); outline-offset: 4px; }
@media (max-width: 430px) {
  .brand-home-button .brand-mark { width: 36px; height: 36px; }
}
```

- [x] **生成静态文档资产。** 将初版 `astraatmos-mark-light.svg`、`astraatmos-mark-dark.svg` 分别复制为上述 `public/brand` 下的两个文件；保持 A 字母、流线、观测点的几何和色值一致，标题改为正式的 `AstraAtmos 大气之 A 标志`。
- [x] **生成 favicon。** 将 `assets/brand/astraatmos/astraatmos-app-icon.svg` 复制为 `frontend/public/favicon.svg`，保留 64 × 64 画板、`#0A1B29` 圆角底和简化 A（无观测点、弧线宽 16）。从该 SVG 渲染 32 × 32 PNG；将已有 `astraatmos-favicon.ico` 复制为 `frontend/public/favicon.ico`。实际检查 16 px 时 A 的内侧负空间与流线仍可辨，不重新设计图形。

### Task 2：导航与首页接入

- [x] **导航导入组件。** 在 `Navbar.jsx` 的 import 区新增 `import BrandMark from './BrandMark';`，移除完整 `MarsLogoIcon` 函数，用 `<BrandMark />` 替换 `<MarsLogoIcon />`。
- [x] **品牌入口语义化。** 原品牌外层改为以下按钮，内部现有字标、副标题容器保留；将对应结束标签改为 `</button>`。英文正文改成 `AstraAtmos`，原字号、字重与字体栈保留，字间距改为 `0`。

```jsx
<button
  type="button"
  className="home-nav__brand brand-home-button"
  onClick={() => onChange('home')}
  aria-label={`AstraAtmos · ${t('nav.home')}`}
>
```

- [x] **首页颜色对齐。** `homePage.css` 中 `.atmos-home` 的两个色值声明改为：

```css
--home-accent: var(--brand-primary);
--home-accent-ink: var(--brand-on-primary);
```

删除 `[data-theme="light"] .atmos-home` 中原来对这两个变量的硬编码覆盖；它们现在自动继承浅色品牌变量。其余布局与装饰规则保持原意。

### Task 3：关于页与页脚形成呼应

- [x] **关于页导入组件。** 新增 `import BrandMark from '../components/BrandMark';`，在 `SectionTitle` 前加入：

```jsx
<div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
  <BrandMark size={72} label="AstraAtmos" />
</div>
```

- [x] **页脚导入组件。** `App.jsx` 新增 `import BrandMark from './components/BrandMark';`，将原版权文案 `div` 替换为：

```jsx
<div style={{ display: 'flex', alignItems: 'center', gap: 8,
  fontSize: 'calc(11px * var(--font-scale, 1))', color: C.ice60 }}>
  <BrandMark size={24} mono compact />
  <span>{t('footer.copyright')}</span>
</div>
```

保持另一侧技术文案以及 `.home-footer` 的响应式规则。品牌图形不作为可点击元素。

### Task 4：浏览器图标与文档

- [x] **替换 `index.html` 的原图标声明。** 使用明确的新版本参数避免沿用旧火星图标缓存：

```html
<link rel="icon" type="image/x-icon" href="/favicon.ico?v=atmospheric-a-1" />
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png?v=atmospheric-a-1" />
<link rel="icon" type="image/svg+xml" href="/favicon.svg?v=atmospheric-a-1" />
```

- [x] **README 顶部使用主题适配图形。** 原 `img` 替换为：

```html
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./frontend/public/brand/astraatmos-mark-dark.svg" />
  <img src="./frontend/public/brand/astraatmos-mark.svg" width="96" alt="AstraAtmos 大气之 A 标志" />
</picture>
```

- [x] **同步真实状态。** 接入并验证后，README 品牌段落改为「AstraAtmos 使用『大气之 A』标志，导航、关于页、页脚及浏览器图标已统一；深浅主题使用对应配色。品牌组件见 `BrandMark.jsx`，资产规范见品牌说明」。为这两个入口补相对链接。品牌资产 README 标注「大气之 A 已接入」，另外六套设计保留为历史探索，列出静态文件与组件之间的同步约定。

## 5. 验收与证据

本次为静态视觉及轻量组件接入，不添加仅验证路径字符串的单元测试；使用构建、交互与截图验收。

- [x] 从 `frontend/` 执行 `npm run build`，预期退出码 0，构建目录包含 `favicon.svg`、`favicon-32.png`、`favicon.ico` 和 `brand/`。记录实际警告，不将已有警告归因于 logo。
- [x] 从 `frontend/` 执行 `npm run dev -- --host 127.0.0.1`，访问终端给出的本地地址；如果已存在开发服务，复用服务。无需启动训练或请求模型推理。
- [x] 深浅主题各验证 `#/`、`#/overview`、`#/training`、`#/about`：导航图形相同、主题色正确、单色页脚可见。数据缺失提示不等于品牌接入失败，记录验证限制。
- [x] 用 1440 px、900 px、390 px 视口检查导航品牌区；中英文均检查，至少在 390 px 下再测最大字体设置。新图形和字标不造成额外遮挡、裁切或横向溢出。
- [x] Tab 可聚焦品牌按钮，Enter / Space 能返回首页，焦点可见；读屏读出品牌和首页语义，装饰图形不重复朗读。
- [x] 切换浅色主题后刷新，确认品牌不短暂出现错误配色；SVG 没有依赖远程字体、图片或重复 DOM ID。
- [x] 查看浏览器标签图标，直接访问三个 favicon URL 确认正常返回；检查 16 / 32 px 渲染及 A 字母、流线的辨识度。
- [x] 保存首页深浅主题、移动导航、关于页与图标的实际截图作为交付证据；效果示意与真实截图明确区分。
- [x] 从仓库根目录执行 `git diff --check`；核对 README 新链接与静态资产存在。审阅实际 diff，确保只包含本方案所需增量。

## 6. 完成定义与回退

以上验收通过后，才能将文档状态由「计划」改为「已接入」。交付附实际截图、改动文件与构建结果；无需进行后端测试或训练验证。

如需回退，仅撤销本次品牌组件、样式、资产引用及对应文档增量，恢复旧 favicon 和导航图形；不使用 `git reset --hard`，不覆盖并行修改，不批量删除文件。已有探索资产可以继续保留。

## 7. 实施记录与验收结果（2026-09-24）

### 实际改动

- 新增 `frontend/src/components/BrandMark.jsx`、`frontend/src/components/brand.css`。
- 新增 `frontend/public/brand/astraatmos-mark.svg`、`astraatmos-mark-dark.svg`、`favicon-32.png`、`favicon.ico`；`favicon.svg` 替换为应用图标矢量。
- 修改 `frontend/src/components/Navbar.jsx`（移除 `MarsLogoIcon`，品牌入口语义化）、`frontend/src/pages/HomePage/homePage.css`、`frontend/src/pages/AboutPage.jsx`、`frontend/src/App.jsx`、`frontend/index.html`、`README.md`、`assets/brand/astraatmos/README.md`；`assets/brand/astraatmos/directions/README.md` 曾纳入本次改动，该子目录连同六套探索资产已于 2026-09-24 按用户要求删除（未跟踪文件、逐个删除、无 git 删除记录），`astraatmos/README.md` 已改为只描述正式品牌并保留重新生成说明。

### 与方案正文的偏差（均为实施中发现的必要修正）

1. **组件着色方式调整。** 方案示例在 `<path>` 上直接写 `fill` / `stroke` 呈现属性，实测会压过 `.brand-mark--mono { fill: currentColor }`，导致页脚单色标志仍为品牌色（浏览器实测 `pathFill` 为 `rgb(154,217,239)`）。改为只用 CSS 类着色，新增 `.brand-mark__letter` 选择器；几何与色值不变。
2. **删去重复的 `fill`。** 单色规则合并为 `.brand-mark--mono .brand-mark__letter, .brand-mark--mono .brand-mark__accent { fill: currentColor }`。
3. **README 顶部改用已交付 PNG。** `<picture>` 指向 `assets/brand/astraatmos/astraatmos-mark-{light,dark}.png`（1024 × 1024，已交付资产）而非 `frontend/public/brand/*.svg`：GitHub 对 README 内联 SVG 支持不稳定，且 `-dark` / `-light` 后缀描述的是适用主题，用 PNG 可避免“深色主题下加载浅背景图形”的歧义。`frontend/public/brand/` 下的 SVG 仍是运行时静态副本，供文档与浏览器直接打开。
4. **页脚版权文字颜色** 由 `C.ice30` 调整为 `C.ice60`，使 24 px 单色标志与文字同色且保持足够对比度（浅色主题下 `--text-30` 对比度偏低）。
5. **`favicon-32.png` 的生成方式。** 由应用图标矢量几何渲染生成（脚本放在工作区根目录 `brand-asset-build/`，不属于产品源码），未引入新的运行时依赖；图形与 `astraatmos-app-icon.svg` 一致。
6. **未新增 apple-touch-icon**：已交付资产中没有对应尺寸位图，不凭 ICO 复制出错误的声明。

### 执行的验证

| 项目 | 命令 / 方式 | 结果 |
| --- | --- | --- |
| 前端构建 | `frontend/npm run build` | 退出码 0；`dist/` 含 `favicon.svg`、`favicon-32.png`、`favicon.ico`、`brand/`；仅有既有 chunk 体积警告 |
| 前端单元测试 | `frontend/node --test` | 426 passed / 0 failed |
| 空白字符检查 | `git diff --check` | 退出码 0，无输出 |
| 浏览器验收 | `chromium(headless) + playwright-core`，脚本在工作区根目录 `.brand-verification/brand-verify.mjs` | 37 passed / 0 failed，报告 `.brand-verification/report.json` |

浏览器验收覆盖：深浅主题导航图形色值（深色 `rgb(154,217,239)`+`rgb(241,154,120)`；浅色 `rgb(35,99,135)`+`rgb(199,101,67)`）；导航按钮 `BUTTON` + `aria-label="AstraAtmos · 首页"`；装饰图形 `aria-hidden`；字标 `AstraAtmos` 与中英文副标题；页脚单色标志 `accentCount=0` 且 `fill/stroke` 等于 `currentColor`；首页 `--home-accent` 与主按钮取品牌色；关于页 72 px 标志 `role="img"` + `aria-label`；Tab 首次按 Tab 即到品牌按钮、焦点轮廓 2 px 可见、Enter 与 Space 均返回首页；1440 / 900 / 390 视口（含 1.5 字体缩放）无横向溢出、390 px 图形降为 36 px；浅色主题刷新后配色无闪烁；`/favicon.svg`、`/favicon-32.png`、`/favicon.ico`、两个 `brand/*.svg` 均返回 200 且可解码；16 px 下 A 字母与流线仍有 30 个可辨浅色像素；图标四角透明；除未启动后端的 `/api` 请求外无失败资源请求，无未捕获运行时错误。

### 截图证据（工作区根目录 `.brand-verification/screenshots/`）

`home-dark-zh-1440.png`、`home-light-zh-1440.png`、`about-dark-zh-1440.png`、`about-light-zh-1440.png`、`home-dark-en-900.png`、`home-dark-zh-390.png`、`home-dark-zh-390-font150.png`、`nav-brand-dark-1440.png`、`nav-brand-light-1440.png`、`nav-brand-dark-en-900.png`、`nav-brand-focus-dark.png`、`footer-dark-1440.png`、`footer-light-1440.png`、`training-light-zh-1440.png`、`overview-light-zh-1440.png`、`icon-inspection-tile.png`（favicon 多尺寸放大对照）、以及导出的 `favicon.svg` / `favicon-32.png` / `favicon.ico` / 两个 brand SVG。

### 明确未验证的项目

- 未在 Windows 任务栏 / macOS Dock 等操作系统级图标场景中验证 `.ico`；仅验证了浏览器可解码、内嵌尺寸与页面内渲染。
- 未做读屏软件（NVDA / VoiceOver）实测；可访问性结论来自 DOM 属性与实际焦点行为，不来自读屏器输出。
- 未启动后端、未请求训练或模型推理；业务数据是否可用不在本次品牌接入的验证范围。
- 仓库名、API、环境变量与浏览器存储键均未改动，因此未做对应迁移验证。
- Safari / Firefox 未实测；`color-mix()` 与 CSS 变量内联 SVG 的兼容性沿用项目既有基线。
