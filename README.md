# AstraAtmos 行星大气实验室

<div align="center">
  <img src="./frontend/public/favicon.svg" width="96" alt="AstraAtmos 行星图标" />
  <p><strong>Planetary Atmosphere Prediction & Experiment Platform</strong><br />面向多行星大气数据分析、模型训练与时空预测实验的平台</p>
</div>

[项目仓库](https://github.com/Kafuu7No/AresVision) · [自定义模型接入](docs/uploaded-model-training.md) · [Linux 部署](scripts/deploy/README_DEPLOY_CN.md) · [Windows 分发](scripts/release/README_CN.md)

## 项目简介

AstraAtmos（行星大气实验室）定位为行星大气预测实验平台，从火星臭氧研究起步，以 OpenMARS 再分析数据、MCD 气候模拟数据和地球 MERRA-2 数据为当前数据基础，将数据管理、模型训练、预测、模型对比和三维可视化整合到同一个 Web 平台。当前已开放火星臭氧训练与预测、地球数据分析；地球网页训练与预测，以及更多行星和变量预测任务仍属后续扩展。

产品原名为 AresVision（智绘赤星）。目录、仓库地址、启动脚本、`ARESVISION_*` 环境变量、数据库与浏览器存储键、数据格式标识沿用原名称以兼容已有部署；改名无需迁移数据或配置。

平台提供 PredRNNv2、ConvLSTM、SimVP 及多种时间序列模型，也支持接入自定义 PyTorch 模型。预测结果可与数据集参考值进行对比，结合残差、误差分布和逐步指标评估模型表现。实际预测效果取决于数据质量、训练配置和模型权重。

## 快速接手：先读这一节

文档最近核对日期：**2026-09-24**。本次核对 Earth v2 原始数据预处理、全球网格、独立原始单元抽查、DLinear CPU 冒烟，以及火星/地球共用分析工作台的前后端实现；历史功能的测试范围见对应专题文档。Earth 网页训练与预测仍未开放。分支、未提交修改、运行进程和数据是否齐备属于实时状态，每次接手都应重新检查。

| 需要先知道的事 | 当前约定 |
| --- | --- |
| 项目形态 | React 单页前端 + FastAPI 后端 + Python 训练子进程；开发时前后端分别启动，构建后可由后端托管页面 |
| 前端页面 | 使用 hash 路由，入口为 `frontend/src/App.jsx`，并非 React Router 路由表 |
| 当前预测入口 | UI 只开放 `trained` 和 `trained_compare`；后端仍保留默认 PredRNNv2 推理链路 |
| 数据边界 | 上传数据主要用于数据总览；训练、预测使用服务器管理的数据，不能把上传成功等同于加入训练集 |
| 模型边界 | `model_source=official/uploaded` 表示模型实现来源；`training_dataset` 表示训练数据集，两者不同 |
| 持久化 | SQLite 保存用户、任务与缓存索引，文件系统保存数据、模型、日志和缓存载荷 |
| 运行前提 | 仓库代码不含完整运行数据和权重；缺失文件需查日志及路径配置 |
| 修改顺序 | 页面 → API 封装 → 路由/Schema → 服务 → 数据或模型实现 → 对应测试 |

推荐接手顺序：

1. 阅读本节、下方“模块与代码入口”“关键业务链路”“当前功能边界”。
2. 执行 `git status --short`、`git branch --show-current` 和 `git log -5 --oneline`，识别既有修改与近期变更。
3. 根据任务只深入相关模块；用代码、测试与实际日志验证 README 中涉及该任务的描述。
4. 修改完成后按“README 维护约定”同步文档，并报告实际执行的验证。

快速导航：[功能](#主要功能) · [模块入口](#模块与代码入口) · [业务链路](#关键业务链路) · [功能边界](#当前功能边界) · [启动](#本地启动) · [测试](#测试与构建) · [排查](#常见问题与排查入口) · [维护约定](#readme-维护约定)

## 主要功能

### 数据总览与三维交互

- 在三维火星球面上展示臭氧及气象变量，支持 Ls（太阳黄经）时间轴播放、色带与单位设置。
- 提供球面点位探查、季节变化、极区动力学、变量相关性及波动诊断等分析视图。
- 支持手势交互、全屏展示及中英文界面。
- 地球三维底球使用随项目提供的 NASA Blue Marble 彩色影像，呈现海洋、陆地与冰雪，并可通过海岸线开关控制轮廓叠加；影像仅作地理参考，来源与许可见 [地球底图资源](frontend/public/earth/README.md)。
- 数据总览顶部可切换“火星 / 地球”，两者**互斥挂载**并共用同一套三栏分析工作台：左侧控件栏、中央三维球体与时间轴、右侧分析卡片与 AI 解读。Earth 使用三维全球球体、ISO 日期、原始物理单位与 v2 全球 5°×5° 单元，Mars 继续使用 MY/Ls、火星纹理与太阳光照。共用适配器、卡片状态与能力声明见 [共用分析工作台](docs/earth-analysis-workbench.md)。

### 数据管理

- 读取、对齐 OpenMARS 与 MCD 数据，管理原始 NetCDF 文件、上传记录及派生缓存。
- 支持 `.nc`、`.nc4`、`.netcdf` 文件上传、校验，以及数据贡献审核。
- 区分默认数据、用户上传数据与管理员数据治理入口；训练使用服务器管理的数据集。
- 包含 MCD 总览数据、NOMAD 网格数据和 MOLA 地形资源的构建脚本。
- 提供 MERRA-2 地球臭氧日数据的小包构建、独立读取、预览和训练冒烟脚本；见 [地球小数据包](docs/earth-compact-dataset.md)。
- 已注册服务器数据集目录：`GET /api/datasets` 与 `GET /api/datasets/{dataset_id}` 返回四个固定数据集（`openmars_mcd`、`mcd_overview`、`earth_merra2_daily_v1`、`earth_merra2_daily_v2`）的元数据、版本、发布指纹、可用状态与能力声明。约定与状态解释见 [数据集注册表](docs/dataset-registry.md)。
- 数据总览支持“火星 / 地球”切换：地球场景按真实日期查看 MERRA-2 五个变量的三维全球球体、逐日播放、点位时间序列与全球单元面积加权均值，见 [二维地球数据总览](docs/earth-overview.md) 与 [共用分析工作台](docs/earth-analysis-workbench.md)。
- 地球年度分析按 2020、2021 分开计算，覆盖季节结构、年内变化、季节极值、环境因子、辐射/温度与臭氧关系、变量相关、空间距平与极区统计；昼夜变化卡片固定显示“日平均数据没有日内采样”的能力说明，不请求火星昼夜接口。
- 后续扩展见 [火星 / 地球共用分析工作台方案](docs/plans/2026-09-23-earth-shared-analysis-workbench.md)；其首期范围（共用工作台、三维地球、年度分析、极区、图表 AI 解读）已实现，手势交互与跨星球数值比较仍属后续计划。

### 模型训练

- 内置 PredRNNv2、PredRNN++、ConvLSTM、SimVP、DLinear、PatchTST、TimeMixer、Earthformer 等模型及实验变体，完整注册表见 [model_zoo.py](AresVision_backend/backend/training_backbones/model_zoo.py)。
- 按模型配置输入窗口、输出步长、气象通道和超参数，查看训练进度、Loss 曲线、日志与测试指标。
- 支持迁移学习、权重加载、冻结策略和训练结果重命名；训练失败时提供通知，包括 CUDA 显存不足提示。
- 支持上传单文件 PyTorch 模型，由平台统一负责数据加载、训练循环、评估和权重保存。
- 支持账号私有的多标签分组：启动训练时选择标签，历史记录中搜索、按标签交集筛选，单条或批量添加、移除标签；标签可新建、重命名与删除。操作说明与接口见 [训练模型标签](docs/training-model-tags.md)。
- 训练历史默认以摘要卡片展示关键参数；完整超参数按记录展开查看，长的自定义参数以键值列表呈现，避免单条记录占满页面。
- Earth 训练的下一步见 [DLinear 地球训练接入实施方案](docs/plans/2026-09-23-earth-dlinear-training.md)：过去 7 天预测未来 3 天、训练任务复用及完整 checkpoint 契约；这是待实施计划，不代表地球训练已开放。

### 预测与模型对比

- 提供参考值、预测场和残差展示，以及误差分布、置换重要性、逐步指标等分析。
- 支持选择已训练模型进行预测，也可比较多个训练结果；预测页包含可视化工作流配置。
- 单模型选择与多模型对比支持按标签筛选，筛选保留已有选择；对比的“全选当前结果”追加当前可见模型，并显示筛选外的已选数量。
- 已训练模型的请求步长范围为 `1–30`，且不能超过该模型训练时的输出步长。多模型对比采用所选模型输出步长的最小值作为上限。
- 默认 PredRNNv2 配置仍为历史 3 步输入、未来 3 步输出。完整基础输入为 **6 通道**：臭氧、纬向风、经向风、温度、沙尘光学厚度和太阳下行辐射通量；具体通道组合由模型配置决定。
- 提供预测请求协调、用户会话缓存隔离和预测分析持久化缓存。

### AI 助手与用户功能

- 提供 AI 对话及结合当前数据视图的 Copilot 解读，通过可配置的外部模型接口生成回答。
- 未配置 `AI_API_KEY` 时，AI 对话服务使用内置兜底回答。
- 包含账号认证、邮件验证码、站内通知、反馈和管理员审核功能。

## 技术栈

| 层级 | 技术 |
| --- | --- |
| 前端 | React 19、Vite 6、MUI 7、Tailwind CSS、Three.js、Plotly、MediaPipe |
| 后端 | FastAPI、Uvicorn、Pydantic、SQLAlchemy 异步会话 |
| 模型 | PyTorch 2.5.1、多模型训练与推理 |
| 数据处理 | NumPy、SciPy、xarray、netCDF4、scikit-learn |
| 数据存储 | SQLite / aiosqlite，NetCDF 数据与文件缓存 |
| 测试 | Node.js 内置测试运行器、pytest |

前端依赖见 [package.json](frontend/package.json)，后端依赖见 [requirements.txt](AresVision_backend/backend/requirements.txt)。

## 项目结构

```text
AresVision/
├── AresVision_backend/backend/
│   ├── main.py                # FastAPI 入口、生命周期、服务装配
│   ├── config.py              # 路径、数据、模型及环境配置
│   ├── auth/                  # 认证与访问依赖
│   ├── core/                  # 数据变换、预测模型与评估指标
│   ├── routers/               # 数据、预测、训练、数据集目录、AI、用户等 API
│   ├── schemas/               # 请求与响应结构
│   ├── services/              # 业务编排、任务、数据集注册、缓存和数据治理
│   ├── training_backbones/    # 模型注册、自定义模型执行器和实验架构
│   ├── database/              # 数据模型、初始化与增量迁移
│   ├── scripts/               # 数据导入与资源构建
│   ├── tests/                 # 后端回归测试
│   ├── data/                  # 运行时数据、上传文件与缓存
│   └── models/                # 训练脚本、模型权重与训练产物
├── frontend/
│   ├── src/
│   │   ├── App.jsx            # 页面路由和应用框架
│   │   ├── pages/             # 总览、数据管理、预测、训练、AI 等页面
│   │   ├── components/        # 三维渲染、图表与公共组件
│   │   ├── contexts/          # 认证、训练、设置等状态
│   │   ├── services/          # 后端 API 调用
│   │   ├── stores/            # 预测缓存与会话状态
│   │   └── i18n/              # 中英文文案
│   └── vite.config.js         # 开发服务及 API 代理
├── docs/                      # 模型接入、资源及设计说明
├── scripts/deploy/            # Linux 部署
├── scripts/release/           # Windows 分发
└── assets/                    # 项目标识与静态资源
```

## 模块与代码入口

下表是按任务定位的入口索引，文件链接相对仓库根目录；完整接口结构以启动后的 `/docs` 为准。

| 任务 | 前端入口 | 后端入口 |
| --- | --- | --- |
| 页面路由、导航 | [App.jsx](frontend/src/App.jsx)、[Navbar.jsx](frontend/src/components/Navbar.jsx) | [main.py](AresVision_backend/backend/main.py) 注册 API 与静态文件服务 |
| 数据总览、球面与时间轴 | [DataOverviewPage.jsx](frontend/src/pages/DataOverviewPage.jsx)、[SphericalFieldCanvas.jsx](frontend/src/components/SphericalFieldCanvas.jsx) | [analysis.py](AresVision_backend/backend/routers/analysis.py)、[mcd_overview_data_service.py](AresVision_backend/backend/services/mcd_overview_data_service.py) |
| 二维地球总览 | [EarthOverviewScene.jsx](frontend/src/pages/DataOverviewPage/EarthOverview/EarthOverviewScene.jsx)、[EarthMap2D.jsx](frontend/src/pages/DataOverviewPage/EarthOverview/EarthMap2D.jsx)、[PlanetSceneSwitch.jsx](frontend/src/pages/DataOverviewPage/PlanetSceneSwitch.jsx) | [earth_overview.py](AresVision_backend/backend/routers/earth_overview.py)、[earth_overview_service.py](AresVision_backend/backend/services/earth_overview_service.py) |
| 共用分析工作台（Mars 与 Earth） | [workbench/](frontend/src/pages/DataOverviewPage/workbench/OverviewShell.jsx)（`OverviewShell`、`useOverviewController`、`OverviewAdapter`、`OverviewCard`、`OverviewScene`、两个 adapter 与请求协调器） | — |
| 三维地球工作台与年度分析 | [EarthWorkbenchScene.jsx](frontend/src/pages/DataOverviewPage/EarthOverview/EarthWorkbenchScene.jsx)、[EarthResearchViews.jsx](frontend/src/pages/DataOverviewPage/EarthOverview/EarthResearchViews.jsx)、[earthResearchModel.js](frontend/src/pages/DataOverviewPage/EarthOverview/earthResearchModel.js)、[sphericalRegionalGrid.js](frontend/src/components/sphericalRegionalGrid.js) | [earth_analysis.py](AresVision_backend/backend/routers/earth_analysis.py)、[earth_research_service.py](AresVision_backend/backend/services/earth_research_service.py)、[earth_research.py](AresVision_backend/backend/schemas/earth_research.py) |
| 数据集注册与查询 | — | [datasets.py](AresVision_backend/backend/routers/datasets.py)、[dataset_registry.py](AresVision_backend/backend/services/dataset_registry.py)、[dataset_identity.py](AresVision_backend/backend/services/dataset_identity.py)、[earth_dataset_metadata.py](AresVision_backend/backend/services/earth_dataset_metadata.py) |
| 上传数据、来源切换、治理 | [ExplorePage.jsx](frontend/src/pages/ExplorePage.jsx)、[rawDatasetUsage.js](frontend/src/pages/ExplorePage/rawDatasetUsage.js) | [upload.py](AresVision_backend/backend/routers/upload.py)、[user_overview_source_service.py](AresVision_backend/backend/services/user_overview_source_service.py)、[data_governance_service.py](AresVision_backend/backend/services/data_governance_service.py) |
| 模型训练与任务管理 | [ModelTrainingPage.jsx](frontend/src/pages/ModelTrainingPage.jsx)、[TrainingContext.jsx](frontend/src/contexts/TrainingContext.jsx) | [training.py](AresVision_backend/backend/routers/training.py)、[training_service.py](AresVision_backend/backend/services/training_service.py) |
| 模型架构、训练参数 | [DynamicModelParamsForm.jsx](frontend/src/pages/ModelTrainingPage/DynamicModelParamsForm.jsx) | [model_zoo.py](AresVision_backend/backend/training_backbones/model_zoo.py)、[training_channels.py](AresVision_backend/backend/services/training_channels.py) |
| 自定义模型接入 | [UploadedModelPanel.jsx](frontend/src/pages/ModelTrainingPage/UploadedModelPanel.jsx) | [user_models.py](AresVision_backend/backend/routers/user_models.py)、[uploaded_model_contract.py](AresVision_backend/backend/training_backbones/uploaded_model_contract.py)、[user_model_runner.py](AresVision_backend/backend/training_backbones/user_model_runner.py) |
| 预测与模型比较 | [PredictPage.jsx](frontend/src/pages/PredictPage.jsx)、[CompareTrainingModelsPanel.jsx](frontend/src/pages/PredictPage/CompareTrainingModels/CompareTrainingModelsPanel.jsx) | [predict.py](AresVision_backend/backend/routers/predict.py)、[inference_service.py](AresVision_backend/backend/services/inference_service.py) |
| 预测请求与缓存 | [predictRequestCoordinator.js](frontend/src/pages/PredictPage/predictRequestCoordinator.js)、[predictCache.js](frontend/src/stores/predictCache.js) | [prediction_analysis_cache.py](AresVision_backend/backend/services/prediction_analysis_cache.py) |
| AI 对话、总览 Copilot | [AIPage.jsx](frontend/src/pages/AIPage.jsx)、[AICopilotWidget.jsx](frontend/src/pages/DataOverviewPage/AICopilotWidget.jsx) | [ai_service.py](AresVision_backend/backend/services/ai_service.py)、[copilot_service.py](AresVision_backend/backend/services/copilot_service.py) |
| 登录、会话和权限 | [AuthContext.jsx](frontend/src/contexts/AuthContext.jsx)、[api.js](frontend/src/services/api.js) | [auth.py](AresVision_backend/backend/routers/auth.py)、[dependencies.py](AresVision_backend/backend/auth/dependencies.py) |
| 持久化和初始化 | — | [models.py](AresVision_backend/backend/database/models.py)、[init_db.py](AresVision_backend/backend/database/init_db.py)、[engine.py](AresVision_backend/backend/database/engine.py) |

页面地址为 `#/`、`#/overview`、`#/explore`、`#/predict`、`#/training`、`#/ai` 和 `#/about`。全局设置与翻译分别位于 `frontend/src/contexts/SettingsContext.jsx` 和 `frontend/src/i18n/`。

## 关键业务链路

### 应用启动与服务装配

`main.py` 的 lifespan 初始化数据库、数据服务、上传与缓存服务、分析和推理服务，并通过 `app.state` 提供给路由。MCD 缓存和个人缓存预热存在后台任务；退出时清理任务及 AI 客户端。排查启动慢或数据不可用时，先看初始化阶段日志，再定位对应服务。

```mermaid
flowchart LR
    UI[React 页面] --> API[api.js]
    API --> R[FastAPI 路由与 Schema]
    R --> S[业务服务]
    S --> DB[(SQLite 元数据)]
    S --> F[NetCDF / 权重 / 文件缓存]
    S --> T[训练子进程]
    S --> AI[外部 AI 接口]
    T --> F
```

### 数据总览与上传数据

1. `ExplorePage` 管理上传文件；后端对文件类型、字段与总览数据契约进行校验。
2. 总览请求经 `api.js` 传递 `mcd_upload_id`、`openmars_upload_id`、`nomad_upload_id` 等来源选择。
3. `/api/explore/overview/*` 路由解析来源，由总览服务提供球面、点位与图表数据。
4. 三维球面、时间轴覆盖范围、图表和 AI 快照按当前选择更新。

上传 MCD 可驱动总览整页；上传 OpenMARS 与 NOMAD 主要作为三维臭氧图层。NOMAD 网格数据还包含观测计数。详细校验入口为 [overview_upload_contract.py](AresVision_backend/backend/services/overview_upload_contract.py)，不要只凭文件扩展名判断用途。

时间与单位是跨模块约定：MY 表示火星年，Ls 表示太阳黄经，跨年会从接近 360° 回到 0°；处理时要保留年份与样本关系。臭氧换算集中在 [ozone_units.py](AresVision_backend/backend/services/ozone_units.py)，其目标单位为 `um-atm`。修改排序、坐标或单位时，应同时核对球面、时间轴、图表和预测输入。

### 训练与模型产物

1. 页面提交模型名称、`model_source`、超参数与服务器数据源；`training_channels.py` 规范化参数。
2. 官方模型使用统一训练入口 `models/training_scripts/demo3.py`；上传模型使用 `training_backbones/user_model_runner.py`。
3. `TrainingService` 创建 `ModelTrainingTask` 并启动训练子进程；解释器由 `TRAINING_PYTHON_PATH` 决定。
4. 任务进度、Loss、日志及产物路径写入任务记录；前端 `TrainingContext` 通过轮询与 WebSocket 接收更新。
5. 训练完成后还需存在有效权重文件才会标记模型可用；预测使用任务元数据还原模型配置。

`training_dataset` 当前区分 `openmars_mcd` 与 `mcd_overview`。请求可用顶层 `dataset_id` 或旧字段 `hyperparameters.training_dataset` 指定；两处冲突、未知 ID 和非字符串值在创建任务前拒绝，Earth 训练返回 409。迁移学习来源可为已有任务或上传权重，冻结策略为 `none`、`backbone`、`head`。参数兼容性以规范化逻辑和加载器为准，不能仅替换权重路径。

### 数据集注册表与训练任务身份

1. `main.py` 在 lifespan 中装配 `DatasetRegistry`；构造不读取文件，`GET /api/datasets` 首次查询时才校验已注册小包。
2. Earth 描述符由 manifest 与 NetCDF 实际内容计算，并与固定发布指纹比对；不匹配时返回 `invalid` 状态而不是报错。
3. 训练请求先解析并校验数据集身份，再执行数据库写入、上传模型加载和子进程调度；被拒绝的请求没有副作用。
4. 任务身份写入 `model_training_tasks` 的五个独立列，不并入超参数，因此不会进入训练 CLI 参数。
5. 旧任务在启动迁移中一次性回填来源与状态，已有绑定与旧 JSON 不被改写。

固定 ID、状态含义、错误码与迁移规则见 [数据集注册表](docs/dataset-registry.md)。

### 共用分析工作台与场景切换

1. `#/overview` 顶部持有 `planet` 选择，按钮按“地球 / 火星”排列，首次进入或刷新默认地球；火星与地球**互斥挂载**，地球不加载火星三维背景、纹理、摄像头或查询组件。
2. 两个星球都经 `OverviewShell` 布局、`OverviewAnalysisPanel` 渲染卡片目录；差异全部由 adapter 声明（时间模型、单位、几何、能力、卡片），共用组件不读取任何星球数据。
3. 地球由 `earthOverviewAdapter` 先查 `GET /api/datasets/earth_merra2_daily_v2` 取发布指纹与日期范围，再查 `/api/analysis/earth/overview/context` 取几何、能力与极区范围；区域场、区域序列与点位序列继续使用已实现的 `/overview/*` 接口。
4. 年度分析走 Earth 专用接口 `/api/analysis/earth/overview/*`：`useEarthResearch`/`earthResearchClient` 按 `(fingerprint, year[, variable])` 去重缓存，多张卡片共享一次请求，逐日播放不重发年度数据。
5. `SphericalFieldCanvas` 接收显式 `planet`/`field`/`geometry`/`selection`/`lighting` 与共享粒子视觉参数：地球用 v2 真实单元边界采样 2592 个单元粒子（不跨经度接缝、封盖两极），默认自动旋转，并按当前场值更新粒子径向高度；火星保持原有纹理、粒子与太阳光照；两者共享相机、粒子密度/尺寸、面板锚点与暗/亮 surface 语义。
6. 切星球时按固定顺序重置：取消旧星球请求 → 清空场/曲线/播放/选点 → 载入新星球默认变量与时间 → 重置相机与几何；回包需同时通过 epoch、通道 token 与请求身份检查。
7. 日期、变量与点位选择保存在页面层，Earth → Mars → Earth 保留各自选择。

接口、年度统计公式、极区范围与能力限制见 [共用分析工作台](docs/earth-analysis-workbench.md)；二维基础协议见 [二维地球数据总览](docs/earth-overview.md)。

### 已训练模型预测与缓存

1. 用户选择任务及预测条件；前端从任务元数据读取输出步长，并协调并发请求。
2. `/api/predict/run` 收到 `training_task_id` 后要求认证，将请求交给 `InferenceService.predict_task`。
3. 推理服务读取任务配置与权重、准备数据、执行推理并返回预测场、参考场、残差及指标。
4. 多模型比较通过 `/api/predict/training-models/compare` 等专用接口执行；各面板是否显示由 `predictAnalysisVisibility.js` 决定。

前端内存缓存与后端持久化缓存是两层机制。前者通过用户会话作用域隔离，退出登录或 API 返回 401 时清理；后者结合任务、分析类型、请求参数及产物指纹定位结果。产物指纹包含模型文件、超参数与数据文件信息，缓存实现支持 `prediction`、`metrics`、`error_distribution`、`pfi`。

调整模型、数据选择或分析参数时，必须检查缓存键、指纹和请求过期判断。否则可能出现切换模型后显示旧结果，或先发出的慢请求覆盖新结果。

### 数据库中的主要对象

| 对象 | 作用 |
| --- | --- |
| `User`、`Notification`、`Feedback` | 用户、站内消息和反馈 |
| `UploadRecord` | 上传文件与审核状态 |
| `McdCacheJob`、`McdCacheArtifact` | MCD 缓存构建任务和产物索引 |
| `DatasetLineageEvent`、`DatasetQualitySnapshot` | 数据血缘与质量记录 |
| `UserModelPackage`、`TrainingWeightFile` | 自定义模型包与上传权重 |
| `ModelTrainingTask` | 训练配置、状态、指标、日志、权重路径及数据集身份五列（`dataset_id`、`dataset_version`、`dataset_fingerprint`、`dataset_identity_status`、`dataset_snapshot`） |
| `TrainingModelTag`、`TrainingTaskTag` | 账号私有标签及其与训练任务的多对多关联，不属于模型超参数或预测缓存身份 |
| `PredictionAnalysisCache` | 预测分析缓存索引与计算状态 |
| `PersonalSourceBuildState` | 个人数据源构建状态 |

数据库记录和实际文件共同构成运行状态。备份、迁移或排查模型不可用时，应一起检查数据库、权重、上传数据与相关路径。

## 当前功能边界

- **UI 开放范围与保留 API 不完全相同。** [predictModelModes.js](frontend/src/pages/PredictPage/predictModelModes.js) 当前只定义已训练模型与多模型对比；默认预测服务仍保留在后端，不能据此描述成三个前端模式。
- **个人上传不是训练入口。** 当前训练请求固定使用服务器管理的数据源；预测的数据源校验也拒绝 `personal`。总览可使用上传来源，不代表同一来源可直接用于训练或预测。
- **地球已开放三维日数据分析工作台，但训练与预测仍未接通。** 数据总览可切换地球，按 ISO 日期使用与火星共用的三栏工作台查看全球 36 × 72 三维球体、逐日播放（2020-01-01 ~ 2021-12-31）、五变量原始单位、经纬度点选与点位曲线、全球单元面积加权均值，以及 2020/2021 年度分析、极区统计（`|latitude| >= 60°`）和图表 AI 解读。**没有**的是：地球昼夜变化（数据是 UTC 日平均，卡片固定显示能力说明）、地球训练入口、地球预测入口、Earth/Mars 数值叠加或跨星球比较、自选多边形区域、重网格、平滑/插值、臭氧单位换算与导出。首期手势交互未接入摄像头识别，仅预留动作接口。默认 v2 的全球均值按球面单元面积加权，旧 v1 仍保留区域抽样语义。地球日历、真实网格坐标和 DU 单位须保留，不能直接套用 MY/Ls 与火星单位。边界详情见 [共用分析工作台](docs/earth-analysis-workbench.md) 与 [二维地球数据总览](docs/earth-overview.md)。
- **标签按账号私有。** 管理员可用自己的标签整理可访问任务，其他用户看不到这些标记。删除标签只移除该标签及关联，保留训练记录、参数、日志和权重；标签功能不提供参数预设、多级文件夹或共享标签。
- **官方数据发布尚未启用。** 当前装配的是 `DisabledOfficialMcdSourcePublisher`；上传、审核与发布为官方 MCD 数据是不同阶段。
- **以实际渲染为准。** 多模型比较的显示范围由可见性配置控制，存在比较接口或图表文件不代表所有面板均已在 UI 开放。
- **解释分析以当前实现为准。** 当前相关解释分析为置换重要性（PFI），不要将旧设计或历史文字中的其他归因方法当作现有能力。
- **数据库实现按 SQLite 配置。** `DATABASE_URL` 可配置不代表 PostgreSQL 已完成适配；当前引擎仍包含 SQLite 专用连接参数。
- **AI 能力依赖接口配置。** 当前文档不承诺 RAG 知识库、实时卫星接入、VR 或特定预测精度；若新增这些能力，需同时提供实现入口和验证依据。

## 本地启动

### 1. 准备环境与数据

建议使用 Python 3.11 和 Node.js 22 LTS。后端启动需要安装 PyTorch；训练可使用 CPU，也可按显卡驱动选择适配的 CUDA 版本。

**克隆代码不会自动获得运行数据和预训练权重。** 主要数据目录、权重及训练产物已被 `.gitignore` 排除，需要另行准备与加载器兼容的文件：

| 内容 | 默认位置（相对后端目录） | 说明 |
| --- | --- | --- |
| OpenMARS | `data/openmars/` | 默认加载 MY27、MY28；分析加载器匹配 `*my27*ls*.nc` 等文件名，读取 `o3col`、`Ls`、`lat`、`lon` 等字段 |
| MCD | `data/mcd/` | 兼容已有 `data/MCD/`；NetCDF 文件名需包含可识别的火星年标记，如 `MY27` |
| MCD 原始数据 | `data/MCD_Output_global_10m_ls_lst/` | 可通过 `MCD_RAW_3H_DIR` 指向外部目录 |
| 默认预测权重 | `models/predrnnv2/` | 使用默认预测链路时需准备与通道组合匹配的权重 |
| 预处理张量 | `data/processed_tensors.pt` | 可选；预测数据服务在未找到该文件时回退读取原始 NetCDF |
| 训练产物 | `models/training_results/` | 训练任务生成；已训练模型预测依赖有效权重和任务元数据 |
| 地球臭氧小包 | `data/earth/merra2_daily_v2/` | 默认 Earth 发布；从 MERRA-2 原始 SLV/RAD 全量计算 UTC 日均与球面单元面积聚合。旧 `merra2_daily_v1/` 原样保留，Earth 训练与预测尚未接通；数据文件不在 Git 中 |

具体字段与读取规则见 [数据服务](AresVision_backend/backend/services/data_service.py) 和 [预测数据服务](AresVision_backend/backend/services/predict_data_service.py)。文件名符合规则不代表数据结构一定兼容。

默认 Earth v2 保留 2020–2021 年 731 天、36 × 72 全球 5° 网格的臭氧、风、温度与短波辐射，使用真实日期与原始物理单位。构建命令、范围限制、训练划分和校验入口见 [地球小数据包](docs/earth-compact-dataset.md)。

### 2. 启动后端

从仓库根目录进入后端，创建虚拟环境：

```bash
cd AresVision_backend/backend
python -m venv .venv
```

Windows PowerShell 激活：

```powershell
.\.venv\Scripts\Activate.ps1
```

Linux / macOS 激活：

```bash
source .venv/bin/activate
```

安装依赖：

```bash
python -m pip install -r requirements.txt
```

将后端目录中的 `.env.example` 复制为 `.env`（已有配置时保留原文件）：

```powershell
# Windows PowerShell
Copy-Item .env.example .env
```

```bash
# Linux / macOS
cp .env.example .env
```

按下文填写配置，然后在该目录启动：

```bash
python -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

- API 文档：<http://localhost:8000/docs>
- 健康检查：<http://localhost:8000/health>

`/health` 仅返回服务健康标记，不验证数据、权重或外部 AI 接口是否可用；相关状态需结合启动日志和具体功能请求检查。

### 3. 启动前端

另开一个终端，从仓库根目录执行：

```bash
cd frontend
npm ci
npm run dev
```

访问 <http://localhost:5173>。Vite 将 `/api` 请求代理到 `http://localhost:8000`，开发时需同时运行前后端。

### Windows 一键启动

工作区根目录提供 `start-aresvision.cmd` / `start-aresvision.ps1`，可一次启动后端和前端并打开浏览器。默认使用生产前端服务：它从 `frontend/dist` 提供静态文件，并将 `/api` 转发到后端 `8000` 端口；修改前端源码后先在 `frontend/` 执行 `npm run build`。需要热更新时使用：

```powershell
.\start-aresvision.ps1 -FrontendMode Dev
```

生产模式使用 `frontend/dist`，开发模式使用 Vite 源码服务；两种模式的访问地址都是 `http://127.0.0.1:5173`。

## 环境配置

配置文件位于 `AresVision_backend/backend/.env`，实际读取规则以 [config.py](AresVision_backend/backend/config.py) 为准。

| 变量 | 用途 |
| --- | --- |
| `JWT_SECRET_KEY` | JWT 签名密钥；固定设置可避免重启时随机密钥变化导致原令牌失效 |
| `DEFAULT_ADMIN_EMAIL`、`DEFAULT_ADMIN_PASSWORD` | 初始化默认管理员账号时使用，首次部署前设置 |
| `DATABASE_URL` | 默认指向 `data/aresvision.db` 的 SQLite 异步连接 |
| `AI_API_KEY` | 外部 AI 接口密钥 |
| `AI_API_URL`、`AI_MODEL_NAME` | AI 聊天接口完整地址及模型名称，需与服务商配置一致 |
| `SMTP_HOST`、`SMTP_PORT`、`SMTP_USER`、`SMTP_PASSWORD` | 邮件验证码服务配置 |
| `ARESVISION_MCD_DIR` | 覆盖常规 MCD 数据目录 |
| `MCD_RAW_3H_DIR` | MCD 原始数据目录 |
| `ARESVISION_EARTH_MERRA2_V1_DIR` | 旧 v1 兼容包目录，默认 `data/earth/merra2_daily_v1`；不会重定向到 v2 |
| `ARESVISION_EARTH_MERRA2_DIR` | 覆盖已注册的 Earth MERRA-2 小包目录，默认 `data/earth/merra2_daily_v2`；相对路径相对后端启动目录 |
| `TRAINING_PYTHON_PATH` | 训练子进程使用的 Python，默认使用后端当前解释器 |
| `ARESVISION_MOLA_TOPOGRAPHY_PATH` | MOLA 地形 NetCDF 路径，默认使用平台地形资源 |
| `ARESVISION_MAX_UPLOAD_SIZE_MB` | 数据上传大小上限，默认 512 MB |
| `ARESVISION_FRONTEND_DIST` | 指定后端托管的前端构建目录 |

## 自定义模型

自定义模型文件需导出 `MODEL_SPEC` 和 `build_model(config)`。基本张量约定为：

```text
输入：[batch, window, channels, height, width]
输出：[batch, horizon, 1, height, width]
```

平台负责数据预处理、训练、指标、日志和检查点；模型文件负责网络结构及参数声明。需要历史 Ls 等辅助输入时，按接入协议显式声明。

- [自定义模型接入说明](docs/uploaded-model-training.md)
- [模型模板](docs/uploaded-model-template.py)
- [MOLA 地形资源来源与构建](docs/mola-topography-asset.md)

## 测试与构建

前端使用 Node.js 内置测试运行器。从 `frontend/` 执行：

```bash
node --test
npm run build
```

后端使用 pytest。在已安装后端依赖的虚拟环境中，从 `AresVision_backend/backend/` 执行：

```bash
python -m pip install pytest
python -m pytest tests
```

测试覆盖数据读取与对齐、模型接入、训练配置、预测步长、缓存隔离、请求一致性及前端交互逻辑。运行所需数据或依赖以各测试为准。

数据集注册相关测试为 `tests/test_dataset_identity.py`、`tests/test_dataset_registry.py`、`tests/test_dataset_routes.py`、`tests/test_training_dataset_identity_migration.py` 和 `tests/test_training_dataset_identity.py`；地球总览与分析为 `tests/test_earth_overview_service.py`、`tests/test_earth_overview_routes.py`、`tests/test_earth_research_service.py` 与 `tests/test_earth_research_routes.py`。共用工作台前端测试位于 `frontend/src/pages/DataOverviewPage/workbench/` 与 `frontend/src/pages/DataOverviewPage/EarthOverview/`。`tests/conftest.py` 提供显式引用的临时 Earth 发布 fixture（`earth_release`、`earth_spatial_release`、`earth_global_release`），不读取生产数据；该文件在 Windows 上把 `tempfile` 临时目录的 POSIX 权限位从 `0o700` 放宽到 `0o777`（POSIX 行为不变），否则受限文件策略会拒绝写入 `tmp_path`。这些测试需要新的纯英文临时目录（`--basetemp`），并应避免在同一 pytest 会话中一次性收集全部测试文件。

## 部署与分发

- **单服务部署**：执行前端 `npm run build` 后，重新启动后端。后端可检测 `frontend/dist` 并托管静态页面，此时通过 `8000` 端口访问完整应用。
- **Linux 服务器**：提供安装、更新、日志、健康检查与备份脚本，详见 [Linux 部署说明](scripts/deploy/README_DEPLOY_CN.md)。
- **Windows 分发**：提供便携包构建、运行环境修复和启动脚本，详见 [Windows 分发说明](scripts/release/README_CN.md)。

## 参与开发

新增功能时同步维护中英文文案、API 数据结构和相关回归测试。数据、权重、缓存、真实 `.env` 与本地运行产物按 `.gitignore` 管理；提交前检查变更范围，并运行与修改相关的测试。

## 常见问题与排查入口

| 现象 | 优先检查 |
| --- | --- |
| 页面能打开，但没有数据 | 后端启动日志、MY 与文件命名、`config.py` 路径、总览来源及可用覆盖范围；`/health` 不能代替数据验证 |
| 上传成功但训练看不到文件 | 核对用途边界；上传用于总览，训练数据由服务器管理 |
| 已完成训练的模型不可选 | 任务状态、`output_model_path` 文件是否有效、当前用户访问权限及任务超参数 |
| 请求预测步长报错 | `services/prediction_horizon.py` 与前端 `predictionHorizon.js`；请求不得超过训练输出长度 |
| 切换模型后仍显示旧结果 | 请求协调器、任务选择、登录作用域、前后端缓存键与产物指纹 |
| 跨年时间轴或球面样本不一致 | MY/Ls 的对应关系、数据源覆盖区间、排序与跨 360° 回绕逻辑 |
| 训练立即失败或显存不足 | 训练日志、训练解释器与 PyTorch 环境、输入尺寸和 batch size；失败分类在 `training_failures.py` |
| 训练请求返回 400/409 且提示数据集 | 顶层 `dataset_id` 与 `hyperparameters.training_dataset` 是否冲突、ID 是否已注册、是否请求了尚未开放的 Earth 训练；见 [数据集注册表](docs/dataset-registry.md) |
| `/api/datasets` 中 Earth 不是 `available` | 检查默认 v2 的 `ARESVISION_EARTH_MERRA2_DIR`（旧 v1 为 `ARESVISION_EARTH_MERRA2_V1_DIR`）、目录内的 `manifest.json` 与 `earth_merra2_daily.nc`，以及 `availability_reason` 错误码 |
| 地球地图只有区域一块着色 | 默认 v2 应覆盖全球；若仍显示 ±60°/±120°，检查是否访问旧 v1 或未重建前端。v1 区域边界保持原义 |
| 地球三维球体空白或只有底球 | WebGL 是否可用（不可用会自动切二维并给出说明）、`/api/analysis/earth/overview/context` 是否返回 200、`geometry` 是否含 36/72 个单元中心 |
| 地球年度卡片一直加载 | `/api/analysis/earth/overview/research-suite`（或 `spatial-diagnostics`、`polar-dynamics`）的年份是否在发布范围内、`dataset_id` 与 `expected_fingerprint` 是否与当前描述符一致 |
| 地球昼夜卡片显示不可用 | 预期行为：日平均数据没有日内采样，原因码为 `daily_data_has_no_diurnal_samples`，不会回退到火星昼夜接口 |
| 地球请求出现火星接口或火星纹理 | 场景切换未清理旧请求或页面未重建；核对 `planet` 与 `useOverviewController` 的取消流程，以及 `SphericalFieldCanvas` 的 `planet` 参数 |
| 地球页面提示版本已变化 | 数据包被替换过；刷新页面重新读取元信息与指纹，不要手工拼接旧链接 |
| 地球日期播放不前进 | 场仍在加载或已到最后一天；确认 `/api/datasets/earth_merra2_daily_v2/overview/field` 是否返回 200 |
| 地球底图缺失但数据仍在 | 本地 `frontend/public/earth/ne_110m_coastline.geojson` 是否可访问；底图失败不影响日期与数据查询 |
| 旧训练任务缺少数据集身份 | 启动日志中的身份迁移记录；迁移失败会中止启动，修复数据库后可重试 |
| 登录重启后失效、验证码失败 | 固定 `JWT_SECRET_KEY`，核对 SMTP 配置及具体接口错误 |
| AI 仅返回固定回答 | `AI_API_KEY`、`AI_API_URL`、`AI_MODEL_NAME` 与外部接口响应 |
| 部署后仍是旧页面 | 是否重新构建 `frontend/dist`、重启后端，以及 `ARESVISION_FRONTEND_DIST` 是否指向另一目录 |

选择测试时优先定位受影响模块，而不是只运行结构检查：预测变更参考 `test_trained_model_predict_contract.py`、`test_prediction_horizon_contract.py` 与 `predictRequestCoordinator.test.js`；总览变更参考 `test_analysis_overview_uploaded_sources.py`、`test_mcd_overview_service.py`；模型接入变更参考 `test_uploaded_model_runner.py`、`test_uploaded_model_ls_inference.py`。这些测试分别位于后端 `tests/` 和对应前端模块目录，完整测试命令见上文。

## README 维护约定

README 是项目当前行为的接手入口，设计稿记录方案背景，源码与测试用于核实实现。三者冲突时先核对实际代码与运行证据，再修正文档；未完成的计划不能写成已实现功能。

| 发生的变更 | 同步维护的位置 |
| --- | --- |
| 新增、移除或限制用户功能 | “主要功能”“当前功能边界”及必要的页面入口 |
| 页面、服务或目录职责变化 | “项目结构”“模块与代码入口”“关键业务链路” |
| 模型架构、输入输出、预测步长变化 | 模型训练、预测、自定义模型章节及对应协议文档 |
| 数据来源、字段、单位、年份或缓存约定变化 | 业务链路、数据准备、功能边界与排查表 |
| 环境变量、依赖、启动、测试或部署变化 | 技术栈、启动、配置、测试及部署说明 |
| 仅局部实现修复，外部行为和接手信息不变 | 检查 README 是否仍准确；无需为了留痕添加无关说明 |

每次相关代码变更应在**同一任务、同一提交或 PR** 中同步文档，无需等待单独的文档更新请求。完成前检查：

1. 阅读实际 diff，按上表识别受影响章节，同时删除已失效的旧说法。
2. 核对新增链接、参数名、命令执行目录和示例；保持细节有代码或专题文档入口可追溯。
3. 若重新核实了接手摘要，更新顶部核对日期，并准确说明验证范围；不得把文档检查写成测试或联调通过。
4. 执行 `git diff --check`，运行与实现变化相关的检查；纯文档变更检查链接和内容即可。
5. 在交付说明中简述文档同步内容；若无需更新，简述原因。

避免把分支名、未提交文件清单、运行端口占用、临时日志或一次性测试数量长期写入 README。详细实验记录与长篇设计放入专题文档，README 保留稳定结论和入口。

本地工作区 `D:\_Aresvision` 的智能体接手与维护规则放在父目录 `AGENTS.md`，该文件不随此 Git 仓库克隆分发。在其他工作区使用本仓库时，应将本节纳入该工作区的智能体指令。此约定要求执行代码变更的开发者或智能体同步维护，不是已经安装的文件监控器或定时自动化。
