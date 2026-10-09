# 共用单模型预测工作台

地球与火星单模型预测由同一套组件装配。`EarthPredictPanel` 保留地球上下文、逐步指标和诊断入口，场图布局、查看模式、时间步、指标卡片、诊断图表外壳及全屏交互使用火星已有组件的共用实现。Earth 与 Mars 继续调用各自服务，不改变训练划分、checkpoint、指标公式或上传模型契约。

## 组件职责

| 入口或组件 | 共用职责与保留差异 |
| --- | --- |
| [PredictPage.jsx](../frontend/src/pages/PredictPage.jsx) | 行星/单模型/多模型模式、账号作用域、任务选择、请求取消与结果身份；Earth/Mars 请求状态分别保留 |
| [SingleModelWorkbench.jsx](../frontend/src/pages/PredictPage/SingleModelWorkbench.jsx) | 单模型结果装配、三联图/单图状态、时间步和全屏状态；不决定行星 API 或物理单位 |
| [PredictSidebar.jsx](../frontend/src/pages/PredictPage/PredictSidebar.jsx) | 共用模型下拉、标签筛选、参数摘要、起点/步长区域、运行与错误重试；起点控件由 adapter 提供 |
| [PredictDisplay.jsx](../frontend/src/pages/PredictPage/PredictDisplay.jsx) | 参考/预测/残差顺序、三联图与单图切换、时间步、当前步三联图导出与全屏按钮 |
| [PredictMetrics.jsx](../frontend/src/pages/PredictPage/PredictMetrics.jsx) | 按配置显示指标定义、单位、改善方向、缺项、精度和评价范围 |
| [ErrorDistributionChart.jsx](../frontend/src/pages/PredictPage/ErrorDistributionChart.jsx) | 散点、参考/预测分布及残差直方图的共用卡片与主题；只绘制配置提供的图种和数据 |
| [PermutationImportanceChart.jsx](../frontend/src/pages/PredictPage/PermutationImportanceChart.jsx) | 共用 PFI 卡片、零线、正负值、标签与可用误差条；定义/单位/范围由配置提供 |
| [PredictFullscreenHUD.jsx](../frontend/src/pages/PredictPage/PredictFullscreenHUD.jsx) | 共用全屏外壳、统计读数、真实坐标二维展开和纬向剖面、Escape/焦点/页面滚动恢复 |
| [PredictionChartCard.jsx](../frontend/src/pages/PredictPage/PredictionChartCard.jsx)、[PredictStatus.jsx](../frontend/src/pages/PredictPage/PredictStatus.jsx) | 统一诊断图表标题、范围、操作、加载/错误状态与重试外壳 |
| [EarthPredictPanel.jsx](../frontend/src/pages/PredictPage/EarthPredictPanel.jsx) | Earth 上下文与模型身份、结果适配和专属附加内容；引用共用工作台，不维护第二套场图/指标布局 |
| [EarthDiagnosticPanel.jsx](../frontend/src/pages/PredictPage/EarthDiagnosticPanel.jsx) | Earth 独立手动诊断、抽样参数、实际窗口范围及 PFI 明细；指标和图表引用共用组件 |

样式由 [singleModelWorkbench.css](../frontend/src/pages/PredictPage/singleModelWorkbench.css)、[predictionDisplay.css](../frontend/src/pages/PredictPage/predictionDisplay.css) 和 [predictionCharts.css](../frontend/src/pages/PredictPage/predictionCharts.css) 提供。桌面模型侧栏与结果并排，窄屏上下排列；三联图在空间不足时纵向显示，时间步区和详细指标表分别滚动，全屏在移动端纵向布局。主题、色带、单位偏好和数值精度来自现有设置；Earth 的目标单位始终固定 DU。

尚未选择模型或取得指标数据时，两种行星的指标卡均显示 `--`；Earth 实际指标响应中的缺失项仍显示“未提供”，避免把缺失值当作零。地球参考场与评价口径说明只在已有预测结果时出现。

## 行星适配层

适配边界集中在三个入口，共用展示组件消费配置或回调，不在布局内部逐项判断行星。

- [singleModelAdapters.js](../frontend/src/pages/PredictPage/singleModelAdapters.js)：起点控件描述、请求转换、响应转换与身份核对、时间步标签、真实网格、单位转换和能力声明。
- [PredictionPlanetAdapter.jsx](../frontend/src/pages/PredictPage/PredictionPlanetAdapter.jsx)：装配起点控件和具体场渲染；Earth 使用 `EarthMap2D`，Mars 使用已有 `FieldCanvas` 与明确指定 `planet="mars"` 的 `SphericalFieldCanvas`。
- [predictionPresentation.js](../frontend/src/pages/PredictPage/predictionPresentation.js)：纯展示配置及数据转换，提供指标定义、评价范围、诊断图种、PFI 标签、单位与科研导出能力。原始 API 结果和快照身份不因显示单位改变。

[predictionFieldGrid.js](../frontend/src/pages/PredictPage/predictionFieldGrid.js) 校验场与真实经纬度的行列关系，保留源顺序和非均匀轴，不生成猜测坐标；[predictionDisplayModel.js](../frontend/src/pages/PredictPage/predictionDisplayModel.js) 提供共用色阶、时间步、全屏读数和对话框交互纯函数。Mars 原有网格模块保留兼容入口。

| 契约 | Earth | Mars |
| --- | --- | --- |
| 模型与服务 | 已完成且权重有效的三小时官方 DLinear / 独立契约上传任务；`/api/earth/predict/*` | 既有已训练模型；`/api/predict/*` |
| 起点 | UTC `datetime-local`，输入转明确 UTC ISO 时间，须在服务端可选起点中 | Ls 滑块，保留当前可选范围与实际输出 Ls 标签 |
| 运行窗口 | 请求只带任务与起点，每次完整运行任务 horizon | 请求步长 1–30，且不得超过训练 horizon |
| 展示步 | 提前小时 + 对应 UTC 时间；仅改变查看内容 | 步序 + 服务端实际 Ls；仅改变查看内容 |
| 坐标与单位 | `grid.latitude/longitude` 与场行列一致；TO3 原始 DU，无 Mars 换算 | 各帧真实 `lat/lon`；μm-atm / DU 按现有显示偏好换算 |
| 指标 | MSE（DU²）、RMSE/MAE（DU）、R²（无量纲）、MAPE/SMAPE（%）；旧三小时缺项显示未提供 | RMSE/MAE、SSIM、R²，保留现有公式与聚合信息 |
| 诊断触发 | 独立手动测试分区诊断；默认 4 窗口、5,000 对散点、40 分箱、seed 42、PFI 3 次 | 保留现有预测流程中的测试集误差分布与抽样 PFI |
| PFI | 置换后 RMSE − 基线 RMSE，即 ΔRMSE（DU）；保留负值与不可计算原因 | 基线 R² − 置换后 R²，即 ΔR²；保留负值 |
| 全屏主视图 | 地球二维地图；不加载火星纹理、Ls 标签或火星单位 | 既有火星球面；共用真实坐标读数、二维展开与纬向剖面 |
| 科研导出 | 当前步三联图可用；诊断散点/残差直方图/PFI 不开放 | 当前步三联图、当前步普通散点与抽样 PFI 按已有快照可用 |

参考和预测共用当前步物理色阶，残差以零为中心对称；恒定场和全零残差有明确非退化范围。设置中的色带改变仅作用于物理场，残差保留固定发散色带。地球场值、误差与指标不会因全局 Mars 单位偏好再次缩放。

## 评价范围与导出

页面明确区分三种范围：

| 范围 | 数据来源与页面含义 |
| --- | --- |
| 当前预测窗口 | 选定历史起点的一次完整输出；Earth `result.metrics` 是此窗口六项指标，当前步场/普通散点也属于此窗口 |
| 完整测试集 | Earth 读取有效 checkpoint 保存的 `metrics.splits.test`；Mars 使用现有完整测试集指标与误差直方图，不用单次窗口或抽样指标替代 |
| 抽样诊断 | Earth 独立 test 窗口诊断覆盖所选窗口全部 lead/grid，散点再按上限取点；Mars PFI 最多 40 个抽样测试窗口，独立于页面 Ls |

Earth 工作台同时提供本次窗口指标和上下文 checkpoint 的完整 test 指标；诊断结果另列完整 test 与诊断样本指标，缺项保持未提供。Mars 在相同条件重复运行时保留已缓存的完整 test 指标，不用回包中的当前窗口指标替代。窗口数、实际 UTC 范围、格点计数和种子沿用服务器证据；某通道不可计算的 PFI 不能当作零。详情见[地球评价指标](earth-evaluation-metrics.md)与[地球训练后诊断](earth-post-training-diagnostics.md)。

科研导出仍使用账号私有的已有 `export_ref`，不重新训练或推理。当前步选择只更改零基 `step`，不改变原始窗口快照身份；引用缺失或页面正在加载时按钮禁用，服务器继续复核引用、权限、任务、模型/数据身份及有效期。Earth 诊断未开放的图种没有可用导出按钮；多模型图的原有导出范围未扩展。文件格式、资源上限和 MATLAB 包见[科研图导出](research-figure-export.md)。

## 身份、取消与缓存

Earth/Mars API、数据准备与服务端缓存保持各自业务路径；组件共用不让 Earth 请求进入 Mars 推理。Earth 仍使用独立进程内预测缓存及诊断缓存，Mars 仍使用既有账号作用域内存缓存和服务端分析缓存。

切换行星、任务、起点或账号会取消旧请求、清空旧结果及全屏。Mars 请求协调器校验通道 token、当前条件与账号 scope；Earth 预测回包同时匹配冻结任务、起点、完整 window/horizon、数据版本/指纹、模型身份及真实坐标，诊断使用独立请求 guard。即使底层请求忽略 abort，晚到结果也不能覆盖当前身份。服务器缓存命中前继续检查实际权重、数据及任务契约，权限不依赖浏览器缓存。

## 验证入口与边界

前端从 `frontend/` 执行 `node --test` 和 `npm run build`。适配与交互纯函数入口为 `singleModelAdapters.test.js`、`predictionPresentation.test.js`、`predictionDisplayModel.test.js`，并保留 `earthPredictModel.test.js`、`earthDiagnosticsModel.test.js`、`predictRequestCoordinator.test.js` 和既有账号/缓存隔离回归。

合成浏览器入口为 [browser-check.js](../scripts/audit/shared-prediction/browser-check.js)。该脚本只在隔离浏览器页面中替换 API，模型和数据均标为合成；不创建训练任务或启动真实推理。从仓库根目录、已有独立 Playwright CLI 会话中执行：

```powershell
npx --package @playwright/cli playwright-cli -s=shared-prediction run-code --filename scripts/audit/shared-prediction/browser-check.js
```

页面加载生产构建，通过真实组件检查 1440px 桌面和 390px 移动端、深浅主题、4/6 位精度、色带、三联图/单图、时间步、地球地图/火星球面全屏、PFI 与评价范围、任务/行星切换、过期响应拒绝、错误重试及退出登录清理；还检查支持的三联图导出入口、实时语言切换保留 Earth 场且不重跑、Mars 重复运行保留完整测试集指标。脚本中的小网格只验证数据配对和交互，不模拟完整 240×480 长 horizon 的传输、解析与绘图成本。

后端从 `AresVision_backend/backend/` 使用工作区规定的 AresVision conda 解释器逐文件执行 `-m pytest`，每次指定仓库外新的英文 `--basetemp`；未标记 async 的已训练模型契约加 `--asyncio-mode=auto`。本轮实际结果如下：

| 文件 | 实际结果 |
| --- | --- |
| `test_earth_3hourly_prediction_time.py` | 34 passed |
| `test_earth_3hourly_prediction_service.py` | 55 passed |
| `test_earth_3hourly_prediction_routes.py` | 27 passed |
| `test_earth_diagnostics.py` | 7 passed |
| `test_earth_diagnostics_routes.py` | 13 passed |
| `test_prediction_horizon_contract.py` | 15 passed |
| `test_trained_model_predict_contract.py`（asyncio auto） | 11 passed |
| `test_earth_diagnostics_integration.py` | 15 passed、2 skipped（官方模型分支不适用上传源码检查） |
| `test_prediction_analysis_cache_identity.py` | 3 passed |
| `test_mars_prediction_coordinates.py` | 49 passed、7 failed |

2026-10-09 本轮后端共 229 passed、2 skipped、7 failed。七项 Mars 坐标失败属于已记录范围：旧官方裸权重两项数值差异，NaN 坐标四项错误消息正则不符，masked 坐标一项提前被完整有限数据校验拒绝；不计入通过结论。重构前端全量回归 **807 passed**；后续空态占位修正运行相关展示/适配测试 **17 passed**，`npm run build` 成功；使用最新生产构建的合成浏览器 **42 项检查通过、无页面运行时错误**，包括无模型时 Earth/Mars 同为 `--` 和未运行时隐藏参考场说明。HTTP 409 的合成错误用于验证重试，浏览器网络错误日志属于预期。生产静态服务已更新并重启，后端 `/health`、前端页面和数据代理复验均为 200。

本轮未执行真实模型训练或真实预测精度验收，未验收完整分辨率长 horizon 的浏览器性能，未执行 MATLAB 重建脚本。全分辨率 Earth JSON 传输/内存和进程内缓存、多 worker 等既有边界仍适用。生产更新须先构建，再由 `scripts/serve-prod.mjs` 使用 `ROOT=frontend/dist`、`PORT=5173`、`API_PORT=8000` 运行；按工作区约定复核后端 `/health`、前端根页面和 `/api/datasets` 代理，三项 HTTP 200 才算运行验证。
