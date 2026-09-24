# 火星 / 地球共用分析工作台

本文记录已实现的共用分析工作台：Mars 与 Earth 使用同一套三栏布局、模式选择、卡片外壳、
三维场景控制与图表解读入口，各自通过适配器声明自己的时间模型、单位、几何与能力。
Earth 的年度分析接口位于 `/api/analysis/earth/overview/*`，与火星 `/api/analysis/overview/*` 完全分离。

数据包协议见 [地球小数据包](earth-compact-dataset.md)，二维总览协议见 [二维地球数据总览](earth-overview.md)，
实施背景见 [共用分析工作台实施方案](plans/2026-09-23-earth-shared-analysis-workbench.md)。

文档最近核对日期：**2026-09-24**。本次核对范围见文末“验证记录”。

## 已实现范围

| 能力 | 状态 |
| --- | --- |
| 共用工作台外壳 `OverviewShell`（左右可拖动面板、底部时间轴、≤900px 顺序布局） | 已实现 |
| 共用控制器 `useOverviewController`（请求身份、取消、过期回包拒绝、播放、选择状态） | 已实现 |
| 适配器契约 `OverviewAdapter`（`planet/sourceId/sourceFingerprint/time/variables/geometry/capabilities/cards`） | 已实现 |
| `marsOverviewAdapter` / `earthOverviewAdapter` | 已实现 |
| 统一卡片 `OverviewCard`：`loading / ready / unsupported / error / idle` | 已实现 |
| 共用三维场景 `OverviewScene` → `SphericalFieldCanvas`（显式 `planet`/`field`/`geometry`/`selection`/`lighting`） | 已实现 |
| Earth 三维全球球体：v2 真实 5°×5° 单元、±90°/±180°、经度接缝不跨接、两极封盖 | 已实现 |
| Earth 本地海岸线底图（`/earth/ne_110m_coastline.geojson`，无在线瓦片） | 已实现 |
| Earth 日期播放（2020-01-01 ~ 2021-12-31，含 `2020-02-29`） | 已实现 |
| Earth 五变量切换与原始单位显示（DU / m s-1 / K / W m-2） | 已实现 |
| Earth 经纬度点选（最近单元中心）、点位曲线、全球面积加权覆盖均值 | 已实现 |
| 三种分析模式：`temporal` / `drivers` / `dynamics` | 已实现 |
| Earth 年度分析（2020 / 2021 分开计算）：季节结构、年内变化、季节极值、环境因子、相关、耦合、空间距平 | 已实现 |
| Earth 极区统计（`\|latitude\| >= 60°`，返回实际采样纬度） | 已实现 |
| Earth 昼夜卡片：`unsupported` + 能力说明，不请求 Mars 昼夜接口 | 已实现 |
| Earth 图表 AI 解读（只发送统计摘要） | 已实现 |
| 手势交互（旋转/缩放/步进/选点动作接口已预留，未接入摄像头识别） | 未启用（第二阶段） |
| Earth/Mars 数值叠加或跨星球比较 | 未实现（首期不做） |
| Earth 训练页、Earth 预测页 | 未实现（训练请求仍返回 409） |

## 组件与代码入口

| 任务 | 入口 |
| --- | --- |
| 工作台外壳与卡片 | [OverviewShell.jsx](../frontend/src/pages/DataOverviewPage/workbench/OverviewShell.jsx)、[OverviewAnalysisPanel.jsx](../frontend/src/pages/DataOverviewPage/workbench/OverviewAnalysisPanel.jsx)、[OverviewCard.jsx](../frontend/src/pages/DataOverviewPage/workbench/OverviewCard.jsx) |
| 左栏共用部件 | [OverviewSidebarParts.jsx](../frontend/src/pages/DataOverviewPage/workbench/OverviewSidebarParts.jsx)（`SectionLabel`、`OverviewModeCard`、`AnalysisModePicker`、`modeDefinition`） |
| 状态与请求 | [useOverviewController.js](../frontend/src/pages/DataOverviewPage/workbench/useOverviewController.js)、[overviewRequestCoordinator.js](../frontend/src/pages/DataOverviewPage/workbench/overviewRequestCoordinator.js) |
| 适配器契约 | [OverviewAdapter.js](../frontend/src/pages/DataOverviewPage/workbench/OverviewAdapter.js)、[marsOverviewAdapter.js](../frontend/src/pages/DataOverviewPage/workbench/marsOverviewAdapter.js)、[earthOverviewAdapter.js](../frontend/src/pages/DataOverviewPage/workbench/earthOverviewAdapter.js) |
| 三维场景 | [OverviewScene.jsx](../frontend/src/pages/DataOverviewPage/workbench/OverviewScene.jsx)、[SphericalFieldCanvas.jsx](../frontend/src/components/SphericalFieldCanvas.jsx)、[sphericalRegionalGrid.js](../frontend/src/components/sphericalRegionalGrid.js)、[sphericalEarthBaseMap.js](../frontend/src/components/sphericalEarthBaseMap.js) |
| Earth 场景与卡片 | [EarthWorkbenchScene.jsx](../frontend/src/pages/DataOverviewPage/EarthOverview/EarthWorkbenchScene.jsx)、[EarthResearchViews.jsx](../frontend/src/pages/DataOverviewPage/EarthOverview/EarthResearchViews.jsx)、[earthResearchModel.js](../frontend/src/pages/DataOverviewPage/EarthOverview/earthResearchModel.js)、[earthResearchClient.js](../frontend/src/pages/DataOverviewPage/EarthOverview/earthResearchClient.js)、[EarthInsightPanel.jsx](../frontend/src/pages/DataOverviewPage/EarthOverview/EarthInsightPanel.jsx) |
| Earth 后端接口 | [earth_analysis.py](../AresVision_backend/backend/routers/earth_analysis.py)、[earth_research_service.py](../AresVision_backend/backend/services/earth_research_service.py)、[earth_research.py](../AresVision_backend/backend/schemas/earth_research.py) |
| Mars 兼容入口 | [DataOverviewPage.jsx](../frontend/src/pages/DataOverviewPage.jsx)（`panelMode="external"`）、[SidebarMenu.jsx](../frontend/src/pages/DataOverviewPage/SidebarMenu.jsx)、[DetailPanel.jsx](../frontend/src/pages/DataOverviewPage/DetailPanel.jsx)、[TimelineController.jsx](../frontend/src/pages/DataOverviewPage/TimelineController.jsx) |

`EarthOverview/EarthOverviewScene.jsx`、`EarthMap2D.jsx`、`EarthTimeline.jsx`、`EarthSeriesPanel.jsx`、`useEarthOverview.js`
作为**兼容保留实现**仍在仓库中：二维地图、受控时间轴与序列面板被新工作台直接复用；
`EarthOverviewScene` 本身不再由页面默认挂载，保留以便对照二维基础实现。

### 哪些是真正共用的、哪些是星球专属

两个星球渲染的是**同一份组件**，不是两套外观相似的实现。差异只允许来自 adapter 与星球专属文案。

| 能力 | 共用实现 | 说明 |
| --- | --- | --- |
| 三栏布局、可拖动面板、≤900px 顺序布局 | `OverviewShell` | Mars 走 `panelMode="external"`（面板自持 `position: fixed`），Earth 走外壳提供的固定面板容器 |
| 分析模式选择（1 基础总览 / 2 影响关系 / 3 高级空间诊断） | `AnalysisModePicker` → `OverviewModeCard` | **左栏**渲染，与 Mars 完全相同（radio 单选卡片、图标、标题、说明）。Mars 旧的就地副本 `RadioModeCard` 与 `SectionLabel` 已删除，避免两份实现漂移 |
| 分区标题 | `SectionLabel` | 两侧同一份实现 |
| 模式标题与说明文案 | `overviewChartLayout.MODE_DEFS` | 唯一来源；共用模块不再维护第二份副本 |
| 卡片外壳、折叠、懒挂载、状态渲染 | `OverviewCard` + `OverviewAnalysisPanel` | `idle/loading/ready/unsupported/error` 五种状态；不可用卡片不挂载请求 |
| 卡片正文的图表交互 | `WORKBENCH_PLOT_CONFIG` + `.overview-card-plot` | Plotly 模式栏（导出 PNG/SVG、缩放、框选、自动缩放）、滚轮缩放、右下角模式栏样式 |
| 卡片内变量切换药丸与“当前变量”行 | `VariableTabs` / `CurrentVariableLine` | Earth 的季节结构、季节极值、空间距平卡片与 Mars 季节变化卡片同款 |
| 横向色标（含单位标题） | 各热力图视图 | 与 Mars 季节变化热力图一致 |
| 判定“同距取较小下标”“不夹取、不环绕”的最近单元规则 | `OverviewAdapter.nearestGeometryCell` | 前后端与二维地图使用同一规则 |
| 请求取消、过期回包拒绝、播放步进 | `useOverviewController` / `overviewRequestCoordinator` | Mars 播放仍由既有 `TimelineController` 驱动，共用的是身份与取消语义 |
| 时间模型、单位、几何、能力、卡片目录 | `marsOverviewAdapter` / `earthOverviewAdapter` | **星球专属**：MY/Ls 与 ISO 日期、火星单位与原始单位、火星全球插值几何与 v2 真实单元几何 |
| 左栏数据源区块内容 | SidebarMenu / EarthWorkbenchSidebar | **星球专属**：Mars 提供 MCD/OpenMARS/NOMAD 与上传来源选择；Earth 只有一个已注册发布，因此展示数据集身份、网格与聚合说明 |
| 三维渲染细节 | `SphericalFieldCanvas` 的 planet 分支 | **星球专属**：Mars 保留纹理、粒子层与 `buildSeasonalSunLight(Ls)`；Earth 使用真实单元几何、本地海岸线与固定展示照明 |
| 卡片正文的指标定义 | 各星球视图与后端服务 | **星球专属**：Mars 用 Ls 与火星纬带；Earth 用 ISO 日期、单元面积权重与 5 条纬带 |

仍然不同的地方（有意保留，不是复用缺口）：

- Mars 的球面是纹理 + 粒子层，Earth 是真实单元色块与海岸线；两者共用相机、控制器、拾取与光照接口。
- Mars 左栏有上传来源与 NOMAD/OpenMARS 叠加开关；Earth 没有第二个来源，因此不显示这些开关。
- Mars 的卡片正文（季节变化、极区动力、波动诊断等）仍由既有 `OverviewCharts/*` 提供并自行请求数据；Earth 的卡片正文由 `EarthResearchViews.jsx` 提供。两者共用卡片外壳、模式头、状态与图表交互配置，但**不共用同一份 Plotly 视图组件**（`TemporalHeatmapView` 等七个共用视图仍属方案 Task 4 的剩余项）。

## 适配器契约

```js
{
  planet: 'earth' | 'mars',
  sourceId,
  sourceFingerprint,
  time: { kind: 'iso-date' | 'mars-year-ls', start, end, values, years, step, stepUnit, calendar },
  variables: [{ id, label, unit, colormap, centeredOnZero, range }],
  geometry: { latCenters, lonCenters, latBounds, lonBounds, wrapLongitude, shape },
  capabilities: { field, playback, pointProbe, polar, diurnal, researchSuite, spatialDiagnostics, aiInsight },
  cards: { temporal: [...], drivers: [...], dynamics: [...] },
  defaults: { variable, value, mode },
  resolve, loadField, loadRegionalSeries, loadPointSeries,
  validateField, validateRegionalSeries, validatePointSeries,
  normalizeField, normalizeRegionalSeries, normalizePointSeries,
  cellForPoint, loadCard,
}
```

统一卡片状态固定为 `idle / loading / ready / unsupported / error`：

- `unsupported` 必须带稳定原因码，只解释限制，**不挂载数据请求**；
- `error` 带 `errorCode` 与重试入口，不把失败渲染成零值；
- `loading` 不携带上一次的 payload，旧图表不会被贴上新标题。

### 星球切换顺序

`useOverviewController` 在 `planet` / `sourceId` 变化时严格按以下顺序执行：

1. `coordinator.cancelAll()` 取消旧星球全部在途请求；
2. 清空旧场、旧区域序列、旧点位曲线、播放状态、悬停提示与已选点；
3. 重新解析数据源并载入新星球的默认变量与时间（`normalizeSelection` 拒绝跨星球选择）；
4. 递增 `cameraEpoch` 并按新的几何身份重建场景键，相机与几何一起重置；
5. 每个回包在写入前同时检查 `epoch`、通道 token 与请求身份，旧响应无法写回新星球状态。

## 三维地球

`SphericalFieldCanvas` 新增显式接口，Mars 旧调用（`fieldData`/`fieldLayers`/`showMars`/`solarLongitudeLs`）行为不变：

```jsx
<SphericalFieldCanvas
  planet="earth"
  field={field}            // { values, colorRange, unit, variable, date }
  geometry={geometry}      // { latCenters, lonCenters, latBounds, lonBounds, wrapLongitude }
  selection={selection}    // { point: { lat, lon } | null }
  lighting="fixed"         // Earth 固定展示照明
  showBaseMap
  onGlobeClick={onGlobeClick}
/>
```

- Earth 走 `buildRegionalCellGeometry()`：v2 全球 36×72 = **2592 个单元**，每格按 2×3 子面贴合球体，
  三角形从球外看为逆时针；顶点经纬度只做角度插值，格内颜色取该单元采样值，不做数值插值。
- **不跨越经度接缝**：最后一列在 +180 收口、第一列从 −180 开始，两者是不同顶点，不生成 `j=71 → j=0` 的接缝面。
- **两极封盖**：第 0 行覆盖 −90°…−85°，第 35 行覆盖 85°…90°，极点处顶点退化但仍有面，
  不会出现 NaN 或空洞；单元格坐标仍是 −87.5° 与 87.5°。
- 半径分层：底球 0.86、数据单元 0.872、海岸线 0.878、拾取球 0.90，避免 z-fighting。
- 颜色只编码数值，不使用球壳高度；未着色区域表示没有数据。
- `geometry` 身份包含坐标与覆盖边界，形状相同但坐标不同会重建几何；切日只更新颜色缓冲。
- Earth 光照是固定展示照明，**不调用** `buildSeasonalSunLight(Ls)`，不画晨昏线，日期不被当作某一时刻的太阳位置。
- WebGL 不可用时自动切到二维地图并说明原因，日期、变量与点位选择保留。

球面坐标转换 `geographicToCartesian(lat, lon, radius)` 与拾取用的 `localPointToLng/LatLng` 是同一套约定，
可在 [sphericalRegionalGrid.test.js](../frontend/src/components/sphericalRegionalGrid.test.js) 中互相验证。

## Earth 分析接口

前缀 `/api/analysis/earth/overview`，公开只读。全部为同步 `def` 处理函数，由框架线程池执行 NumPy 计算。

| 方法 | 路径 | 必传参数 | 用途 |
| --- | --- | --- | --- |
| GET | `/context` | — | 数据源、时间模型、变量与单位、几何、能力、极区范围 |
| GET | `/research-suite` | `dataset_id`、`year` | 选年五变量日期×纬度场、区域/纬带曲线、极值、Z-score、相关与滞后 |
| GET | `/spatial-diagnostics` | `dataset_id`、`year`、`variable` | 选年选变量年平均空间距平与纬带 RMS/峰谷跨度 |
| GET | `/polar-dynamics` | `dataset_id`、`year` | 南北极区日平均统计与南北极对比 |
| POST | `/insight` | JSON body | 图表 AI 解读，只接受统计摘要 |

`expected_fingerprint` 为可选参数（64 位小写 SHA）；缺省时使用注册表当前已验证指纹。
传入过期指纹返回 409 `dataset_version_changed`，不会把新数据配旧元信息。

### 公共响应字段

```text
planet: "earth", dataset_id, dataset_version, dataset_fingerprint, dataset_schema
```

`/context` 额外返回 `source_meta`（来源、日平均节奏、文件数、处理说明、日历；**不含服务器路径**）、
`time`（`kind: "iso-date"`、真实首末日、天数、`years`）、`variables`（五项 id/label/units/色带范围）、
`geometry`（单元中心、单元边界、`wrap_longitude: true`）、`capabilities`、`unavailable`、
`polar_scope`（`min_abs_latitude: 60`、`sampling: "daily_mean"`、`note`）与 `limitations`。

Earth 的能力声明中 `diurnal` 固定为 `false`，原因码为 `daily_data_has_no_diurnal_samples`。

### 年度统计定义

设 `F[t,i,j]` 为该年 `T` 天的原始场，`φ[i]` 为纬度单元中心，纬度为升序。

- **季节结构** `z[i][t] = mean_j F[t,i,j]`：固定纬度上的等面积经度均值（72 个 5° 单元等权），
  标记为 `equal_longitude_mean`；横轴为真实 UTC 日期。
- **年内变化**：`np.diff(np.sin(deg2rad(edges)))` 面积权重下的全球均值，标记为 `spherical_cell_area_mean`，
  与 `/overview/regional-series` 同日同值。
- **纬带**：`south_polar` / `south_mid` / `tropics` / `north_mid` / `north_polar`，
  按**单元边界**严格划分且互不重叠；36 行分配为 6/6/12/6/6。
  响应返回每一个带**实际采样的**纬度极值与网格点数，阈值本身不是网格点。
- **季节极值**：各纬带日均曲线的 `max/min/peak_to_peak` 与日期；相同极值取最早日期。
- **相关**：同一天的区域或纬带均值组成成对序列（每天一个样本，不混入空间样本）。
  `n < 3` 记 `insufficient_samples`，零方差序列记 `constant_series` 且 `r = null`，
  不伪造 `r = 1`，也不给 p 值或因果结论。
- **滞后**：固定 −30…30 天，`r(k) = corr(driver(t), TO3(t+k))`；正 `k` 表示驱动领先臭氧 `k` 天。
  只用重叠样本，不环绕、不跨年补点；UI 不把最大 `|r|` 的滞后描述为物理响应时间。
- **空间距平** `A[i][j] = annual_mean[i][j] - mean_j annual_mean[i]`：年平均场相对同纬度经度均值的距平，
  不是多年气候距平；纬带 RMS 为 `sqrt(sum(w·A²)/sum(w))`，`w` 为该行单元面积权重。
- **极区**：`|latitude| >= 60°` 的日平均统计（均值、最低/最高与日期、峰谷差、逐日序列）
  以及南北极同变量序列的对比；纬度带没有网格点时返回 `null` 与 `grid_point_count: 0`，不填零。

所有响应禁止 `NaN`/`Infinity`；无定义的统计用 `null` 加原因码表达，原始物理值不因前端不支持而变成 0。
缺测不会被 `nan_to_num` 填零，也不会静默跳过日期。

同一公历年内保留 `2020-02-29`，不折成 360 点；两年样本只用于“年内变化”，不推断长期趋势或气候态。

### 错误协议

与二维总览一致：`{"detail": {"code": ..., "message": ...}}`。

| 场景 | HTTP / code |
| --- | --- |
| 未注册 ID | 404 `unknown_dataset` |
| 请求火星数据集 | 409 `dataset_overview_not_supported` |
| `expected_fingerprint` 过期 | 409 `dataset_version_changed` |
| 缺包/坏包/不可读 | 503 `dataset_unavailable`（含安全 `availability_reason`） |
| 年份不在发布范围 | 422 `year_out_of_range` |
| 未支持变量 | 422 `unsupported_variable` |
| `/insight` 传入 `planet != "earth"` | 422 `planet_not_supported` |
| `/insight` 摘要过大（>4000 元素或嵌套 >6 层） | 422 `insight_payload_too_large` |
| 缺必需参数、SHA 格式错误 | Pydantic 422 |

### AI 解读

`POST /insight` 的请求模型为 `extra="forbid"`，只接受
`planet / dataset_id / expected_fingerprint / year / variable / date / scope / question / locale / summary`；
`summary` 只允许 `units` 与 `cards[{card, notes, values}]`。
请求里的数字不会被采信：服务端按同一身份从已验证发布**重新计算**摘要，客户端内容只作为补充说明。
原始 36×72 场不会被接受。

返回内容固定携带 `source`、`planet`、`date_range`、`variable`、`units`、`scope`、`scope_label`、
`time_kind: "iso-date"`、`model` 与 `limitations`。未配置 `copilot_service`、缺少 `AI_API_KEY`
或外部接口失败时，返回内置的确定性摘要回答（`model: "builtin-digest"`），接口仍为 200。
解读文本只描述地球日平均数据，不出现 MY/Ls、火星沙尘或昼夜循环。

## 前端行为

- **时间**：Earth 使用 ISO 日期；日期输入、滑块、上/下一天、播放走同一个选择函数。
  播放等当前帧确实展示成功后才前进（不跳日），到 2021-12-31 停止，不循环；“从首日重播”显式回到首日。
  切换变量、手动选点、页面隐藏时暂停。
- **年度**：年度选择与当前日期联动——日期跨年时年度分析自动跟随；切换年度把日期平移到目标年同月同日
  （`2020-02-29 → 2021-02-28`，不会落到 3 月 1 日）。
- **单位**：地球固定使用原始单位，全局设置中的火星臭氧/温度单位不作用于地球，地球也不做单位换算。
- **点选**：三维与二维点击都先判断覆盖范围，再用最近单元中心作为最终位置；区域外只提示、不发点位请求、不移动旧点位。
  全球网格上 ±180° 是同一子午线的等价写法，只做坐标规范化；区域发布（`wrap_longitude=false`）保持原样。
- **覆盖均值**：显示服务端返回的全球单元面积加权均值，不称“全球平均”以外的含义（不是大气总质量）。
- **卡片文案**：Earth 极区卡片为“极区统计”（不是“极区动力”），昼夜卡片显示日平均能力说明。
  旧二维文案“区域数据”“空间点抽样”“不是全球平均”已不再用于 v2 全球网格。
- **错峰请求**：`useEarthResearch` / `earthResearchClient` 按 `(fingerprint, year[, variable])` 去重缓存，
  多张卡片共享一次年度请求；逐日播放不会重发年度数据；失败不缓存，可重试。
- **左栏分区**：与 Mars 相同的顺序与标题——分析工作台 → 数据总览星球 → 分析模式 → 数据范围 → 显示控制 → 点位；
  Mars 与 Earth 现在渲染同一份 `AnalysisModePicker`。

## 场景切换的开销与“无缝”程度

两个星球**互斥挂载**（不做 hidden 双挂载），因此切换必然经过“卸载旧场景 → 挂载新场景 → 取新数据”三步。
2026-09-24 用系统 Edge + `playwright-core`（1440×900，headless，后端托管 `frontend/dist`）实测点击到新场景可用的耗时：

| 切换方向 | 首次 | 再次 | 切换时发出的 API 数 |
| --- | --- | --- | --- |
| 火星 → 地球 | 1151 ms → **991 ms** | 906 ms → **763 ms** | 6 → **5** |
| 地球 → 火星 | 980 ms → **851 ms** | — | 3（火星自有接口，未改） |

（数值含 Playwright 点击的可操作性等待，真实感知时间约为其中的一半。）

### 已实现的三项改动

1. **后端启动预热 Earth 发布**：`main.py` 的 lifespan 在后台线程调用一次
   `registry.get_dataset("earth_merra2_daily_v2")`，把 NetCDF（约 29 MB）的校验从“首次点击地球”
   挪到启动阶段，并在关闭时取消该任务。实测 `/analysis/earth/overview/context` 的首次响应
   从约 8.3 s（冷启动后第一次请求触发校验）降到 **9 ms**；日志会打印
   `Earth dataset prewarmed: id=... availability=available`。
2. **卡片数据按需加载 + 身份不含日期**：折叠卡片不发请求，展开才拉取；卡片请求身份是
   `(planet, source, fingerprint, cardKey, variable, year)`，**不含当前日期**。因此逐日播放时右侧
   不会再每帧闪一次“正在加载”，切地球的并发请求从 6 个降到 5 个（极区统计等展开时才请求）。
   `research-suite` 仍只在第一张卡片展开时请求一次。
3. **视角记忆**：`SphericalFieldCanvas` 新增 `poseKey`，卸载时把相机位置/四元数与球体组四元数
   存进模块级有界缓存（最多 8 条），同一 `poseKey` 重新挂载时恢复。Mars 与 Earth 各自一个键，
   切走再切回保持上次的旋转与缩放；点击“重置视角”调用 `dropCameraPose()` 删除该键并抑制随之
   而来的那一次保存（重置会重建画布，否则旧画布的卸载清理会把重置前的视角写回来）。

已用真实浏览器验证：火星拖拽后相机 `[0.20,-0.10,-3.74]`，切到地球再切回为 `[0.25,-0.12,-3.74]`（一致）；
地球拖拽后 `[0.39,0.20,-4.18]`，点“重置视角”回到 `[0,0,4.2]` 且切走再切回仍是 `[0,0,4.2]`。

### 仍不“无缝”的地方与可行建议

按“预计收益 / 改动成本”排序。以下均**尚未实现**，是可选后续项。

| # | 问题 | 可行做法 | 预计效果 | 成本 | 风险 |
| --- | --- | --- | --- | --- | --- |
| 1 | `research-suite` 太大：2020 年响应 **1.55 MiB**，其中 **79.7% 是 `seasonal`**（五变量 ×36×366），而卡片一次只显示一个变量 | 给 `/research-suite` 加 `variable=` 参数（或拆出 `/seasonal` 端点），只返回当前变量的季节矩阵；切换变量时再请求该变量 | 单次响应 **1.55 MiB → 约 0.56 MiB**，序列化与传输时间按比例下降 | 中（后端 schema + 前端请求键） | 低：只影响新参数，旧调用不传时行为不变 |
| 2 | 切换瞬间旧场景立即卸载，新场景要等首帧数据，中间是空面板 | 切换时先挂载新场景（`opacity:0`、`pointer-events:none`），等它报告 `ready` 后再交换可见性并卸载旧场景，用 200 ms `opacity` 过渡做交叉淡入；两场景同时存在的时间窗口内内存峰值 +1 个 WebGL 上下文 | 消除空白闪烁，感知上接近瞬时 | 中（页面层双缓冲状态机） | 中：需要保证窗口期结束后旧场景的 GPU 资源确实释放，并在低内存设备上可回退 |
| 3 | 每次回到地球都要重新取 `descriptor`（暖态约 100 ms）与 `context` | 后端给 `GET /api/datasets/{id}` 与 `/context` 返回 `ETag: <fingerprint>`，前端带 `If-None-Match`；命中返回 304 | 省掉重复序列化与传输 | 低 | 低 |
| 4 | 火星侧栏与右栏每次挂载重播入场动画（`SidebarMenu` 100 ms 延迟 + `DetailPanel` 0.6 s 滑入） | 由 `OverviewShell` 传 `instant`，切回来时跳过过渡 | 切换不再有“抽屉滑入”的等待感 | 低 | 低（只改过渡触发条件） |
| 5 | 切换瞬间图例/时间轴日期/球体颜色全空（控制器主动 `setField(null)`） | 每个星球在页面层保留最后一次成功的 field + geometry，切回来先渲染旧帧并标注“正在更新”，新帧到达再替换 | 新场景第一帧就有内容 | 中 | 中：必须沿用现有 `requestedValue`/`displayedValue` 区分，绝不能把旧帧标成新日期 |
| 6 | 切回后不恢复播放状态（`setPlaying(false)`） | 记住每星球离开时是否在播放，回来可选恢复 | 长时对比时少一次点击 | 低 | 低 |

不建议做的事：把两个星球改成 hidden 双挂载“常驻”。省下的 0.5–1 s 换来第二套 WebGL 上下文、
火星纹理与粒子层常驻内存，以及两套 requestAnimationFrame 同时跑——与“地球不加载火星资源”的既有边界冲突。

## 测试

后端（从 `AresVision_backend/backend/` 执行，使用全新的纯英文 `--basetemp` 目录）：

```powershell
python -m pytest tests/test_earth_research_service.py tests/test_earth_research_routes.py -q --basetemp "$(Join-Path 'D:\_Aresvision' ('.earth-research-' + [guid]::NewGuid().ToString('N')))"
```

前端（从 `frontend/` 执行）：

```powershell
node --test src/pages/DataOverviewPage/workbench/OverviewAdapter.test.js src/pages/DataOverviewPage/workbench/overviewRequestCoordinator.test.js src/pages/DataOverviewPage/workbench/overviewWorkbenchStructure.test.js
node --test src/pages/DataOverviewPage/EarthOverview/earthResearchModel.test.js src/pages/DataOverviewPage/EarthOverview/earthResearchClient.test.js src/pages/DataOverviewPage/EarthOverview/earthMapGeometry.test.js
node --test src/components/sphericalRegionalGrid.test.js src/components/sphericalEarthBaseMap.test.js src/components/sphericalPicking.test.js
npm run build
```

覆盖重点：星球切换取消与过期回包拒绝、Earth/Mars 时间模型与单位隔离、Earth 不使用 Mars 光照/Ls、
全球地图不再裁成旧区域、卡片 `unsupported`/`error` 状态、经度接缝与两极拾取、普通点选与播放步进、
2592 个单元几何与 `key` 身份、AI 摘要字段与 `extra="forbid"` 契约。

## 验证记录

2026-09-24 在本地实际执行，使用 conda 环境 `AresVision` 的解释器与系统 Edge（`playwright-core`，headless）。

- **后端测试**：`tests/test_earth_research_service.py` + `tests/test_earth_research_routes.py` **92 passed**；
  `tests/test_earth_overview_service.py` + `tests/test_earth_overview_routes.py` + `tests/test_dataset_registry.py` + `tests/test_dataset_routes.py` **152 passed**（合计 244）。
- **真实 v2 数据只读核对**（`earth_merra2_daily_v2`，发布指纹 `8871f7ef865c…`）：
  `/research-suite` 2020 返回 366 天、纬度 36 行、季节矩阵 36×366、纬带行数 6/6/12/6/6、作用域 global+5 带；
  2021 返回 365 天；`/spatial-diagnostics` 返回 36×72 距平且色带以 0 对称；`/polar-dynamics` 返回南北极各 6 行。
  单个年度 suite 的 JSON 约 **1.5 MiB**（服务端实测 1 529 493 字节，低于 4 MiB 目标）。
- **HTTP 协议核对**：`/context`、`/research-suite`、`/spatial-diagnostics`、`/polar-dynamics` 均返回 200；
  `/insight` 在未配置外部 AI 时返回 200 且 `model=builtin-digest`，回答包含星球、数据源、真实日期范围、变量与单位，且不含 MY/Ls 或沙箱字样；
  `planet=mars` → 422 `planet_not_supported`，`year=2019` → 422 `year_out_of_range`，
  过期指纹 → 409 `dataset_version_changed`，火星数据集 ID → 409 `dataset_overview_not_supported`。
- **前端测试与构建**：`node --test` 全量 **415 项通过**；`npm run build` 成功。
- **真实浏览器验收**（Edge + `playwright-core`，1440×900，headless，后端托管 `frontend/dist`）：**15/15 项通过**，
  覆盖默认火星、Mars→Earth→Mars 连续切换（互斥挂载）、Earth 三栏工作台、五个变量与原始单位、
  2020-01-01→2021-12-31 播放（含跨年）、赤道/经度接缝 ±179.9°/南北极点选返回最近单元中心（同距取较小下标）、
  三维球体点击选点、三种分析模式、2020 与 2021 年度分析各渲染图表、极区统计范围与日平均限制、
  昼夜卡片能力说明、AI 解读、Earth 阶段不请求 Mars 分析接口/火星纹理/在线底图、切回火星无回归、
  地球阶段控制台无新增错误。
- **切换计时与视角记忆**：`switch-timing.mjs`（点击到新场景可用）与 `pose-debug.mjs`
  （相机位置在切走切回前后一致、重置视角后不再复活旧视角），见上文“场景切换的开销与无缝程度”。
- **真实 v2 数据规模**：`probe_suite_size.py` 实测 `/research-suite` 2020 响应 1.55 MiB，
  `seasonal` 占 79.7%，服务端计算仅 63 ms —— 瓶颈是序列化与传输，不是 NumPy。
- 验收脚本与截图保存在工作区 `D:\_Aresvision\.workbench-verification\`（`workbench-verify.mjs`、`report.json`、`screenshots/`），运行产物不属于仓库内容。
- 本轮验收发现并修复的真实缺陷：共用控制器缺少 `cardUnsupported` 导入导致地球场景崩溃；
  分析栏 flex `min-height:auto` 导致卡片列表覆盖下方面板；底部时间轴跨满视口遮挡右侧按钮；
  重复选择同一变量会清空场景；Plotly 以日期字符串作为散点颜色导致 `<rect height="NaN">`；
  **单元顶点色被重复归一化（0..1 又除以 255）导致三维地球只有近黑底色**；
  AI 摘要嵌套超过服务端 6 层限制被 422 拒绝。

### 未在此环境验证的部分

- 真实摄像头手势交互（首期未接入识别，仅预留 `gestureActions`）。
- 外部 AI 服务的真实回答质量与可用性（本环境未配置 `AI_API_KEY`，验证的是内置摘要回答与协议）。
- 390px / 900px 窄屏与浅色主题的地球三维工作台布局（本轮浏览器验收仅覆盖 1440×900 深色主题；二维页面的窄屏与主题验收见 [二维地球数据总览](earth-overview.md)）。

## 后续计划

- 手势交互接入摄像头识别，复用控制器已预留的 `gestureActions`（旋转/缩放/播放/步进/选点/重置）。
- 窄屏（≤900px）与浅色主题的共用工作台浏览器验收。
- Earth 训练与预测页（独立交付项，见 [DLinear 地球训练方案](plans/2026-09-23-earth-dlinear-training.md)）。
- 若后续提供真实地球影像纹理，作为独立资源增强并单独记录来源与许可。
