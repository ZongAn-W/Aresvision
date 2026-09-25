# AstraAtmos 标识设计

本目录保存「Atmospheric A / 大气之 A」设计方案及可复用资产。**该标志已正式接入产品**：全站导航、首页强调色、关于页、页脚与浏览器图标（SVG / PNG / ICO）均已使用本方案，深浅主题使用对应配色。接入范围与验收方式见[品牌接入方案](../../../docs/plans/2026-09-24-atmospheric-a-brand-integration.md)。

产品代码中的品牌图形统一由 [`frontend/src/components/BrandMark.jsx`](../../../frontend/src/components/BrandMark.jsx) 绘制，配色变量在 [`brand.css`](../../../frontend/src/components/brand.css)。浏览器与文档使用 `frontend/public/` 下的静态副本，两者几何必须保持一致。

> 历史说明：本目录曾保存「层流星球、观测之眼、预测场、双 A 构型、环流之核、星穹徽记」六个探索方向的对照资产（原 `directions/` 子目录）。这些方案未被采用，也已不再保留在仓库中；如需重新生成，可在工作区根目录执行历史渲染脚本 `render_astraatmos_directions.py`。本目录现在只维护正式品牌资产。

## 设计

「大气之 A」为项目正式品牌标志。

- **A 字母骨架**：对应 AstraAtmos，使用简洁、可缩放的几何轮廓。
- **大气流线**：上扬的弧形横笔表达行星环流与观测轨迹，不对应具体数据或科学图示。
- **橙色观测点**：呼应火星研究起点；主标志不限定为某一颗行星。
- **配色**：深色背景使用冰蓝 `#9AD9EF` 与赤陶橙 `#F19A78`；浅色背景使用深蓝 `#236387` 与深赤陶 `#C76543`。建议深色背景为 `#081824`。

## 文件

文件名中的 `dark` / `light` 指**图形自身的适用主题**：`-dark` 后缀为深色背景使用的冰蓝版本，无后缀的 `-light` 版本为浅色背景使用的深蓝版本。

| 文件 | 用途 |
| --- | --- |
| [设计展示图 PNG](astraatmos-brand-preview.png) / [SVG](astraatmos-brand-preview.svg) | 查看主方案、浅色应用、单色版和应用图标 |
| [深背景图形 SVG](astraatmos-mark-dark.svg) / [透明 PNG](astraatmos-mark-dark.png) | 深色界面、演示文稿；PNG 为 1024 × 1024 |
| [浅背景图形 SVG](astraatmos-mark-light.svg) / [透明 PNG](astraatmos-mark-light.png) | 浅色界面、文档；PNG 为 1024 × 1024 |
| [深背景组合 SVG](astraatmos-lockup-dark.svg) / [透明 PNG](astraatmos-lockup-dark.png) | 图形与 AstraAtmos 英文名称横向组合 |
| [浅背景组合 SVG](astraatmos-lockup-light.svg) / [透明 PNG](astraatmos-lockup-light.png) | 浅色背景横向组合 |
| [白色单色 SVG](astraatmos-mark-mono-dark.svg) / [深色单色 SVG](astraatmos-mark-mono-light.svg) | 单色印刷、浮雕或其他受限色彩场景 |
| [应用图标 SVG](astraatmos-app-icon.svg) / [PNG](astraatmos-app-icon.png) | 带深色圆角底的简化版；PNG 为 512 × 512 |
| [浏览器图标 ICO](astraatmos-favicon.ico) | 包含 16、32、48、64 像素尺寸 |

## 产品中的运行时副本

| 运行时文件 | 来源 | 说明 |
| --- | --- | --- |
| `frontend/src/components/BrandMark.jsx` | 本目录图形矢量 | 导航 40 px 完整标志、关于页 72 px 完整标志、页脚 24 px 单色简化标志；颜色改用 `--brand-*` 主题变量 |
| `frontend/public/brand/astraatmos-mark.svg` | [浅背景图形](astraatmos-mark-light.svg) | 浅色主题与文档用彩色图形，供 README 等直接打开 |
| `frontend/public/brand/astraatmos-mark-dark.svg` | [深背景图形](astraatmos-mark-dark.svg) | 深色主题与文档用彩色图形 |
| `frontend/public/favicon.svg` | [应用图标 SVG](astraatmos-app-icon.svg) | 浏览器标签图标，64 画板、`#0A1B29` 圆角底、简化 A |
| `frontend/public/favicon.ico` | [浏览器图标 ICO](astraatmos-favicon.ico) | 原样复用 16 / 32 / 48 / 64 多尺寸 ICO |
| `frontend/public/favicon-32.png` | 应用图标矢量渲染 | 32 × 32 透明 PNG，兼容仅支持位图图标的浏览器 |

同步约定：修改本目录中的图形几何或色值后，必须同步 `BrandMark.jsx` 的路径数据、`brand.css` 的 `--brand-*` 变量以及 `frontend/public/` 下的静态副本，并重新生成 `favicon-32.png`；图形比例、观测点位置与流线角度不随尺寸变化。

## 使用约定

- SVG 是矢量交付源，英文名称与展示图文字已转换为路径，打开时无需安装对应字体。
- 透明 PNG 可直接叠加到对应明暗背景；应用图标带有固定底色。
- 标志周围至少保留图形画板宽度的 1/8 作为留白，不拉伸或单独移动观测点。
- 完整图形建议不小于 32 CSS px；16–24 px 使用简化应用图标。简化版去掉橙色小点并加粗流线。
- 展示图用于方案沟通；网页接入时应使用单独图形或横向组合文件，并复用 `BrandMark` 组件而非重新绘制。
- 本方案为手工几何矢量设计，未进行商标检索。
- 六个历史探索方向已于 2026-09-24 清理，不再随品牌维护；正式品牌只以本目录资产为准。

本次交付已检查 SVG 的 XML 结构、文字路径、PNG 透明通道、ICO 内嵌尺寸和展示图渲染；产品侧接入的构建与浏览器验证结果记录在品牌接入方案的验收章节与交付说明中，不涉及训练或模型推理验证。
