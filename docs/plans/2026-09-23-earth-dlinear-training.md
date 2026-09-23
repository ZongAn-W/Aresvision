# Earth DLinear 训练接入 Implementation Plan

> **2026-09-24 契约更新（优先于下文历史假设）**：默认 Earth 数据已经切换到 `earth_merra2_daily_v2` / `v2`，全球 36×72、5°×5°；中心纬度 −87.5…87.5、经度 −177.5…177.5，单元边界 ±90°/±180°，`coverage=global`、`wrap_longitude=true`，球面单元面积均值标识 `spherical_cell_area_mean`。v1 原包及 API 保留，不可将 v1 请求映射到新网格。
>
> 本计划仍待实施。下文所有 v1 的 31×49、区域限制、无极区、8/15/8 纬带行数和“不周期拼接”假设均已失效，实施前按 [v2 数据契约](../earth-compact-dataset.md) 与实际 descriptor 改写。全球地图按真实 cell bounds 绘制，不按中心裁边；纬带覆盖必须重新分配全部 36 行。训练划分仍为 366/181/184 天、7→3 窗口 357/172/175，归一化仍只拟合训练期。已有三维工作台和 Earth 网页训练/预测没有因数据替换而开放。


> **For agentic workers:** 使用 `executing-plans` 技能逐项实施，并用复选框记录完成状态。本方案交给另一个对话执行；编制本方案不代表功能已实现。默认顺序执行，不自行创建额外对话，不自动提交或推送；用户已有指令优先于技能流程建议。

**Goal:** 在现有训练页选择 `earth_merra2_daily_v1`，以过去 7 天的数据训练预测未来 3 天臭氧的 DLinear，复用任务管理，保存可独立恢复的数据与模型契约，并在历史记录中展示验证、测试结果及 DU 单位。

**Architecture:** 数据集注册表负责发布身份和可用性，地球训练契约负责能力限制；共享 `TrainingService` 的任务生命周期，增加独立 Earth runner，复用已有 DLinear 工厂。训练使用验证集选取最佳权重，产出一个包含权重、归一化、坐标、日期划分和指标的版本化 checkpoint；在下一阶段开放地球预测前，所有火星推理入口明确拒绝地球任务。

**Tech Stack:** FastAPI、Pydantic v2、SQLAlchemy/SQLite、NumPy/xarray/netCDF4、PyTorch；React 19、现有训练上下文及图表组件；pytest、Node 内置测试、Vite build、真实浏览器验收。

---

## 1. 交付范围与前置条件

这是既定顺序的第三步：数据集注册 → 二维地球总览 → **DLinear 地球训练** → 历史预测与比较 → 更多模型与三维效果。

顺序补充：用户随后确认地球应复用整个分析工作台，三维与图表的扩展已单列为[共用分析工作台方案](2026-09-23-earth-shared-analysis-workbench.md)，可提前到训练之前。该扩展不改变本训练方案的7→3数据和模型契约；并行实施时须合并registry/schema/文档的新增能力，不能把对方已完成的功能覆盖回未开放状态。

项目根目录为 `D:\_Aresvision\Aresvision`。下文文件路径相对项目根目录；表格中的后端简称路径均以 `AresVision_backend/backend/` 为前缀。本计划属于项目功能文档，保存在可追踪的 `docs/plans/`；仓库忽略 `docs/superpowers/`，不要把交接文件放在那里。

实施前先阅读父目录 `AGENTS.md`、[README](../../README.md) 的接手与维护章节、[数据集注册协议](../dataset-registry.md)、[Earth 小包](../earth-compact-dataset.md)、[已实现的二维地球总览协议](../earth-overview.md)，以及[第二步方案](2026-09-23-earth-overview-2d.md)。接口接线以最新源码与已实现协议为准。禁止批量删除文件或目录，不通过 Python 等其他语言绕过删除限制。

### 必须交付

- 训练数据集选项与 `model_source=official/uploaded` 分开；Earth 首版仅支持官方 DLinear。
- 固定输入 7 天、输出 3 天；TO3 为必选历史输入与唯一目标。
- 可独立选择 U10M、V10M、T2M、SWGDN，允许只用 TO3。
- 展示真实日期划分、样本数量、区域网格、各输入单位和训练集归一化说明。
- 复用现有启动、进度、日志、停止、历史记录、命名、私有标签和单条任务管理。
- 保存完整 checkpoint，CPU 严格重载后产生一致的预测及 DU 数值。
- 完成一次真实小包训练任务，取得有限的验证与测试指标；刷新页面后记录仍可查询。
- 后端、前端均阻止 Earth 任务进入 Mars 推理、比较、PFI 和迁移来源路径。

### 阶段边界

本阶段不开放地球历史预测日期选择、预测场/残差地图、持久性基线比较、地球预测缓存、SPHERE、ConvLSTM、上传模型、迁移学习或自选日期划分。训练结束后的固定测试集指标属于本阶段，交互式回测属于第四步。不要把一次训练成功或指标降低描述成优于基线。

不改动现有火星数值单位、MY/Ls、数据读取与 checkpoint 格式，不修改全局地图网格，也不为完成训练而下载完整 MERRA-2 或重新生成小包。

### 前置核查与协作边界

交接更新（2026-09-23）：用户已提供第二步完成报告。核对当前源码与专题文档后，二维总览的后端、前端、场景接线和目录客户端均已存在；registry 的 `web_overview=true`、`training=false`、`trained_prediction=false`。本方案现在以第二步已交付为前提，第三步可直接接手，无需继续等待第二步开发。

本次也读取了工作区验收记录 `earth-overview-verification/browser-acceptance.json`，其中 43 项均标记 ok=true；这表示已有验收记录，不表示本次重跑了浏览器、完整回归或训练。交接复核发现两处证据问题：报告摘要的“120 passed”与细项 77+44 不一致，应按原始输出修正；单位设置测试实际比较 `-- DU → -- DU`，只证明占位文本相同，尚不能证明真实数值隔离。后者已列入 Task 10 的数值补测，不阻塞训练模块开发。

执行时重新读取 Git 状态、近期提交与相关文件，保留前两步未提交修改；涉及共享注册表、前端 API、README 时增量修改当前实现。若仍有其他并行工作，仅协调重叠文件，不把已交付的第二步一律视为未完成。若使用 worktree，须确保包含前两步的实际改动；从 HEAD 新建的 worktree 不会自动携带未提交文件。

开工命令，目录为项目根目录：

```powershell
git status --short --branch
git branch --show-current
git log -5 --oneline
rg -n 'get_earth_overview_snapshot|build_training_binding|training_profile' AresVision_backend/backend/services/dataset_registry.py
rg -n 'earth|dataset_id' frontend/src/services/api.js frontend/src/pages/ModelTrainingPage.jsx
```

预期：识别既有修改和是否已出现同名实现。缺少第一步身份与数据校验实现时，应先整合该前置工作；禁止以硬编码假元数据绕过它。

## 2. 已核实的代码事实及实施影响

| 入口 | 当前事实 | 本阶段处理 |
| --- | --- | --- |
| `services/dataset_identity.py` | 三个固定 ID；拒绝客户端自报版本、指纹、snapshot；`require_training_dataset()` 当前仅准许 Mars | 保留旧 runner 的 Mars 限制；Earth 走独立服务分支，不直接全局放开此函数 |
| `services/dataset_registry.py` | 有发布 SHA、文件校验、`build_training_binding()`；第二步增加 `get_earth_overview_snapshot()` | 增加训练身份绑定，抽出中性的只读 Earth snapshot 方法，保留总览兼容入口 |
| `services/earth_dataset_metadata.py` | `VerifiedEarthRelease` 含 dates、latitude、longitude、fields 和 metadata | 训练读取同一轮验证得到的数组，不在验证后另开任意 NetCDF |
| `services/earth_dataset.py` | `EarthOzoneWindows` 已按划分切窗、按训练日期统计归一化；当前总是读取五通道 | 扩展为指定通道、传入保存的统计量和已验证快照，保留原独立读取用法 |
| `services/training_channels.py` | Mars 通道名是 U/V/D/S/T；普通超参数会全部转换为 CLI 参数 | 在地球分支使用明确白名单，不能让 Earth 通道被旧逻辑过滤为空；内部训练契约单独传递 |
| `services/training_service.py` | 创建任务、子进程、日志解析、标签、产物路径已经统一 | 增加服务端 runner 分派与 Earth 完成校验，保留生命周期 |
| `models/training_scripts/demo3.py` | 官方训练仍包含 Mars 数据准备；末尾保存裸 state_dict | Earth 不经过该数据路径，不把新 checkpoint 容器写给旧 Mars 加载器 |
| `training_backbones/model_zoo.py` | DLinear 通过 `ForecasterAdapter` 返回 `[B, horizon, 1, H, W]`；输入通道非 5 时有可训练的 1×1 投影 | 保存完整 adapter 的 state_dict 和构造参数，不能只存 DLinear backbone |
| `ablation/dlinear_phasewarp_compare.py` | 当前为项目已有逐网格 DLinear 变体；无相位模式仍在 forward 中访问第二参数形状 | 继续使用现有实现，传零占位张量并明确其无物理含义；不声称完全复现原始 DLinear 论文 |
| `services/model_artifacts.py` | `is_valid_model_weight_file()` 只检查文件存在且非空 | Earth 完成前增加契约验证和严格模型重载；不能只凭非空文件标记成功 |
| `services/training_weight_service.py` | 上传权重校验目前只确认可由 Torch 加载为 dict | 显式识别并拒绝 Earth checkpoint 容器进入 Mars 迁移，不能把任意 dict 都报告为兼容权重 |
| `schemas/training.py` | `model_available` 目前表示完成且存在非空文件 | 保持“产物可用”和“支持网页预测”的语义分离 |
| `services/inference_service.py` | 存在公共预测上下文入口；旧 `get_test_results()` 另有直接加载路径 | 两处以及 action 路由都需拦截 Earth，且拦截要早于 Mars 数据准备和缓存访问 |
| `frontend/src/pages/ModelTrainingPage.jsx` | 大页面包含模型来源、迁移、通道、任务卡片及测试/去预测动作 | 提取 Earth 配置面板和纯函数，不重写整页 |
| `frontend/src/services/api.js` | `startTrainingTask()` options 尚未传顶层 dataset_id，失败通常仅抛 HTTP 状态 | 增加 datasetId，保留原调用兼容；展示结构化服务端错误 |
| `PredictPage/trainedModelSelection.js` | 已完成且 model_available 就会进入预测选项 | 增加明确的任务场景限制；也检查历史 handoff 与比较页面 |

源码可能被并行工作更新；上述是编制时快照。计划中的新函数和字段是目标契约，实施时如已有等价实现，复用并统一命名，不创建第二套注册表或数据副本。

## 3. 固定的科学与数据契约

### 3.1 数据身份、网格与时间

| 项目 | 首版值 |
| --- | --- |
| dataset_id / version | `earth_merra2_daily_v1` / `v1` |
| 数据格式 schema | `aresvision_earth_daily_v1` |
| 时间 | 2020-01-01 至 2021-12-31，731 个日样本；保持 `proleptic_gregorian` |
| 网格 | `[31, 49]`，维度 `[lat, lon]`；纬度 -60…60、经度 -120…120，均递增 |
| 分辨率 | 纬度 4°、经度 5°，来自小包抽样；不是原始产品分辨率 |
| 空间边界 | `coverage=regional`、`wrap_longitude=false`；禁止补成全球、周期拼接或隐式重网格 |
| 包内通道 | TO3、U10M、V10M、T2M、SWGDN |
| 物理单位 | DU、m s-1、m s-1、K、W m-2 |
| 目标 | TO3，反归一化后为 DU |

发布指纹沿用注册表已有值，不能在训练页维护另一份：

```text
manifest_sha256: 1d346a059aff57964cb726dde7113fc495adb4b8245f533911dc6f3d63e52d7e
data_sha256: c21c4ddcb03a69d2eb504f746c86b3a15cf33a06929044f50da768bdfc45cf74
dataset_fingerprint: 74ce14752cb83932b29b458d9c19a61804861c270e6fec33f55316778ad64d31
```

### 3.2 日期划分和窗口

划分固定来自包的 metadata；页面只读展示，不提供随机划分或百分比滑块。

| 划分 | 日期范围（含首尾） | 天数 | 7→3 窗口数 | 第一个目标区间 | 最后一个目标区间 |
| --- | --- | --- | --- | --- | --- |
| train | 2020-01-01…2020-12-31 | 366 | 357 | 2020-01-08…01-10 | 2020-12-29…12-31 |
| validation | 2021-01-01…2021-06-30 | 181 | 172 | 2021-01-08…01-10 | 2021-06-28…06-30 |
| test | 2021-07-01…2021-12-31 | 184 | 175 | 2021-07-08…07-10 | 2021-12-29…12-31 |

样本数公式：`days - window - horizon + 1`。输入与目标全部位于所属划分内，不能借用前一划分末尾 7 天增加样本。输入截止日为 forecast origin，未来第 1 天为次日。所有辅助变量也只读取过去 7 天，不能使用未来实测温度、风或辐射。

输出维度严格为 `X=[B,7,C,31,49]`、`Y=[B,3,1,31,49]`。三天同时输出，不做递归滚动。DataLoader 可以打乱训练窗口，但日期划分必须先完成；validation/test 不打乱。

### 3.3 通道与归一化

- `hyperparameters.selected_channels` 只包含可选输入，合法值为 U10M、V10M、T2M、SWGDN。
- 缺省选中四个辅助输入；显式 `[]` 表示仅 TO3，不能被缺省逻辑替换。
- 请求顺序不决定模型通道顺序。规范顺序固定为 `TO3` 加按 `U10M,V10M,T2M,SWGDN` 排列的选中变量；重复或未知通道返回 422。
- 例如请求 `["SWGDN", "U10M"]`，有效顺序为 `["TO3", "U10M", "SWGDN"]`；不能把 U10M 映射成 Mars 的 U。
- 每个有效通道在 **366 个训练日的全部 31×49 网格** 上拟合一个均值与标准差；float64 累加，保存 float32 有效数值，`ddof=0`。
- 标准差小于 `1e-6` 时有效缩放值设为 1，记录 `constant_channel_mask`；不要把常量通道除成 NaN。
- validation/test 和 checkpoint 恢复时复用保存值，不重算；目标使用输入 TO3 对应的均值与有效标准差。
- 不做 MinMax、对数、空间插值、缺值补零或预测负值裁剪。数据中有 NaN/Inf/非法填充值时沿用包校验失败行为。
- 保存 `method=per_channel_standard`、`fit_split=train`、`fit_date_start=2020-01-01`、`fit_date_end=2020-12-31`、`ddof=0`、`epsilon=1e-6`、`channel_order`、`mean`、`scale`、`constant_channel_mask`、`target_channel_index=0`。

### 3.4 训练与指标

首版固定 Adam 和标准化空间 MSE，所有网格等权；不把该损失或误差称作面积加权、全球平均。网页默认 epochs=10、batch_size=8、learning_rate=0.001、seed=11、early_stopping_patience=0、linear_hidden_layers=2。0 表示不早停，但仍保存最佳验证权重。

只用 validation MSE 选择 best epoch：严格降低才更新；相同值保留较早 epoch。早停只读取 validation，恢复 best state 后才执行一次最终 test。训练与验证均按误差元素总数聚合，不能对大小不同的 batch 均值直接平均。

训练结果保留 validation/test 的总体与第 1/2/3 天 RMSE、MAE；RMSE/MAE 单位为 DU，MSE 如保留须为 DU²。首版不强制 MAPE/R²，避免近零目标和常量场的特殊解释。指标从反归一化后的预测/参考值计算，float64 聚合。

总体统计每个 `(预测起点, lead_day, lat, lon)`；窗口重叠会让同一自然日以不同起点/提前量出现，这属于明确的评估口径。保存 `aggregation=forecast_origin_lead_grid_uniform`、test 的 `window_count=175`，不要表述为 175 个独立日样本。

## 4. 请求、能力与错误契约

### 4.1 注册表增加训练 profile

在 `schemas/datasets.py` 为描述符增加可空的强类型 `training_profile`。Mars 可保持 null 与既有训练逻辑；Earth 返回以下 profile，前端据此展示限制。`capabilities.training` 表示入口已接通，可用性继续由 `availability` 单独表达。第二步的 `web_overview` 状态必须保留，`trained_prediction` 本阶段仍为 false。

```json
{
  "profile_id": "earth_daily_dlinear_v1",
  "model_architectures": ["dlinear"],
  "model_sources": ["official"],
  "target": "TO3",
  "target_unit": "DU",
  "window": 7,
  "horizon": 3,
  "step_unit": "day",
  "optional_channels": ["U10M", "V10M", "T2M", "SWGDN"],
  "default_selected_channels": ["U10M", "V10M", "T2M", "SWGDN"],
  "supports_sphere": false,
  "supports_transfer_learning": false
}
```

只在任务服务、runner 和验证就绪后启用 `training=true`。客户端按钮还必须检查 `availability=available`；后端每次启动重新确认已验证 release。不可用时维持 profile，但不给伪造的日期、坐标或可训练状态。

### 4.2 沿用现有启动接口

`POST /api/training/start`；以下是全部变量模式的有效请求，模型名称由用户输入，标签沿用既有权限校验。

```json
{
  "model_script": "demo3.py",
  "model_name": "Earth DLinear 7d-3d",
  "model_source": "official",
  "data_source": "default",
  "dataset_id": "earth_merra2_daily_v1",
  "tag_ids": [],
  "hyperparameters": {
    "training_dataset": "earth_merra2_daily_v1",
    "model_architecture": "dlinear",
    "selected_channels": ["U10M", "V10M", "T2M", "SWGDN"],
    "window": 7,
    "horizon": 3,
    "epochs": 10,
    "batch_size": 8,
    "learning_rate": 0.001,
    "seed": 11,
    "early_stopping_patience": 0,
    "linear_hidden_layers": 2,
    "use_sphere": false
  }
}
```

`model_script` 为兼容现有客户端保留；服务端根据 dataset/model_source 选择 `earth_daily.py` 并写入任务，不按客户端脚本名决定 Earth 执行代码。新前端可继续提交兼容值 `demo3.py`。顶层 dataset_id 与 legacy training_dataset 一致；也允许只传其中之一，沿用冲突拒绝规则。

Earth 参数单独用 Pydantic 严格模型或等效校验实现，拒绝 bool 充当 int、非整数、非有限学习率。范围：epochs 1…1000、batch_size 1…64、learning_rate 0＜lr≤1、seed 0…2³²−1、patience 0…200、linear_hidden_layers 1…4。window/horizon 必须为 7/3；不合法值不能悄悄夹到合法范围。

允许字段只含示例超参数、可选 `model_source="official"` 与 `transfer_learning=false`；后两者是兼容字段。未知字段、内部 `_` 字段、上传/迁移路径、设备路径、自定义划分、归一化参数、目标替换全部拒绝。服务端自身的 `_data_source` 在校验后加入，不接受客户端注入。

### 4.3 错误分类

现有 `DatasetRequestError` 沿用结构：`detail={code,message}`，有包可用性原因时附公开 reason，不泄漏路径。

| 情形 | HTTP / code | 副作用 |
| --- | --- | --- |
| 非 DLinear、uploaded、SPHERE=true、transfer_learning=true、uploaded_model_id 非空 | 409 `dataset_training_configuration_not_supported` | 不建任务、不加载用户模型、不启动进程 |
| 错误的窗口、通道、范围、字段类型或额外字段 | 422 `invalid_earth_training_parameters` | 同上 |
| 包缺失、哈希不符、内容非法 | 503 `dataset_unavailable` | 同上；UI 显示原因和刷新入口 |
| 父进程绑定后、子进程启动前包身份改变 | 子进程失败，任务 `failed`，`dataset_version_changed` 或 `dataset_unavailable` | 不生成成功产物，不回退到 Mars |
| Earth 进入尚未开放的预测/比较/action=test | 409 `dataset_prediction_not_supported` | 不读 Mars 数据、不进入旧预测缓存 |
| Mars 迁移选择 Earth 来源任务 | 409 `dataset_transfer_not_supported` | 不加载该权重、不启动训练 |
| checkpoint 不完整、不匹配或不能严格重载 | 任务 `failed`，`invalid_earth_training_artifact` | 不把非空权重当成功 |

未知 dataset、双入口冲突、客户端身份字段、用户认证与标签权限保持第一步契约。不可将所有 ValueError 都改成 422；只转换 Earth 参数异常。

## 5. 数据、进程与产物接口

### 5.1 复用已验证快照

注册表增加 `get_earth_snapshot(dataset_id, expected_fingerprint=None)`：返回 `VerifiedEarthRelease`，只从受控目录与发布哈希读取。省略 expected 时取得当前受校验 release；给定 expected 时严格匹配。未知 ID、非 Earth、不匹配及不可用分别有稳定错误。

现有 `get_earth_overview_snapshot(dataset_id, expected_fingerprint)` 保持签名和错误契约，内部调用通用方法；避免第三步破坏第二步测试。

抽取通用方法仍复用同一把锁、同一份 `_earth_cache_release` 和该次校验确认的 signature；父服务使用 `app.state.dataset_registry`，不得为每个训练请求复制五场原始数组。训练子进程有独立地址空间，可各持有一份本进程的已验证 release。训练归一化不能就地修改原始只读 fields，避免总览开始展示标准化值。同步更新 `docs/earth-overview.md` 中“唯一入口”的表述为“总览通过兼容入口调用 registry 的共享取数核心”。

保持第二步已落地的总览契约：`2021-02-29` 返回 `date_out_of_range`；区域边界为纬度 ±60°、经度 ±120°；能力与可用状态分开判断。训练接入不能借机改变这些已验收行为。开启 training 后，更新 `EARTH_APPLICATION_LIMITATIONS` 的应用限制文案，仅保留“Earth 预测尚未接通”，物理范围说明继续保留。

`build_training_binding()` 在 Earth 分支从同一 release 构造五个现有身份列：

- id/version/fingerprint 来自 registry，status 为 verified。
- dataset_snapshot 为 JSON；包含 planet、schema、两种 SHA、time、grid、variables、channel_order、splits，及 `binding_basis=server_registry`、`version_status=verified`。
- snapshot 表示所用发布版本，不承载会变化的训练进度，不替代 checkpoint 中的训练契约。
- Mars 分支继续旧绑定逻辑。不要让旧的 `require_training_dataset()` 把 Earth 意外放入 `demo3.py` 或 `user_model_runner.py`。

### 5.2 数据窗口 API

扩展现有 `EarthOzoneWindows`，保留 `EarthOzoneWindows(path, split=..., window=..., horizon=...)` 的独立脚本行为。新增契约：

```python
train = EarthOzoneWindows.from_release(
    release, split="train", window=7, horizon=3,
    selected_channels=["U10M", "T2M"], normalization=None,
)
validation = EarthOzoneWindows.from_release(
    release, split="validation", window=7, horizon=3,
    selected_channels=["U10M", "T2M"], normalization=train.normalization,
)
test = EarthOzoneWindows.from_release(
    release, split="test", window=7, horizon=3,
    selected_channels=["U10M", "T2M"], normalization=train.normalization,
)
```

新入口只有 train 且 normalization=None 时拟合统计量；validation/test 无统计量时报错。给定 normalization 时严格验证通道顺序、长度、有限值、正 scale 和拟合范围，只应用，不重新拟合。`train.normalization` 为可 JSON 序列化的独立字典。

类同时提供 `input_channels`（规范顺序）、`dates`（所选划分每日坐标）、`lat`、`lon`、原有 `mean/std` 兼容属性、`denormalize_ozone(values)`。后者保持 Tensor 或 ndarray 的类型，不隐式转 CPU。数据与标签返回 float32，数据切片复制避免调用方修改快照。

只构建所需标准化数据，不预先复制 704 个完整窗口，不将所有网格点预展开成百万条样本。三个划分共享同一已验证 release；文件句柄在 registry 加载后已关闭。

### 5.3 服务端训练 spec 与子进程

新增内部 schema `earth_training_spec_v1`，字段固定为：`schema`、`task_id`、`dataset_binding`（五列，snapshot 在内存中为对象）、`hyperparameters`（规范且无 `_` 字段）。完成任务 flush 后由服务端构造。

用环境变量 `ARESVISION_EARTH_TRAINING_SPEC` 传入该 JSON，避免把长 JSON、路径或私有身份字段塞入现有 hyperparameter CLI。这是父进程内部协议，不添加公共 API 字段。Earth 进程只接收 `--output_path`；不得再无差别 `build_hyperparameter_args()`。

进程沿用服务端受控 `ARESVISION_EARTH_MERRA2_DIR`。父服务所用目录与子进程必须来自同一配置；相对路径要由 backend 根目录解析，不能依赖现有 Popen 的 `cwd=MODELS_DIR`。测试可通过构造函数注入临时 registry，生产不接受客户端指定期望哈希。

runner 解析环境 spec 后新建本进程 registry，校验 task id、规范参数、发布身份，然后取得同次校验快照训练。环境 spec 不包含客户端提供的目录，不允许 runner 缺少 spec 时自行套用默认 Mars 数据。

进程规范：单进程 DataLoader，`num_workers=0`，随机种子覆盖 random/NumPy/Torch，训练 sampler 使用确定的 generator。`device` 为服务端自动选择 CUDA/CPU，记录实际值；自动化测试可在内部 `run_training(..., device="cpu")` 注入 CPU，不向网页开放任意执行参数。

### 5.4 单文件 checkpoint

保持现有 `build_task_output_path(task_id, name)` 的 `.pth` 路径与唯一 task id。一个文件含完整契约，避免新增多个旁文件给重命名、复制、删除带来一致性问题。

容器只保存 tensor 和 weights_only=True 可读取的普通 Python 基本类型；NumPy 数组、datetime、Path、模型对象先转换成列表或字符串。最低字段如下：

| 字段 | 必存内容 |
| --- | --- |
| artifact_schema | `aresvision_earth_forecast_checkpoint_v1` |
| model_state_dict | 完整 ForecasterAdapter，包括 projector 与 backbone 的 CPU tensors |
| model_config | architecture=dlinear、implementation_id=`aresvision_gridpoint_dlinear_v1`、input_channels、selected_channels、hidden_dims、height/width、window/horizon、use_sphere=false、architecture_params |
| dataset_binding | 与任务五列一致的 identity，snapshot 为对象，含发布 SHA、日期和完整经纬数组 |
| training_contract | target=TO3、target_unit=DU、input_channel_order、input_units、tensor_layout=`BTCHW`、step_unit=day、window/horizon、strict_split_windows=true、split_window_counts |
| normalization | 第 3.3 节规定的完整统计量及 fit 日期；TO3 统计值索引明确 |
| run | task_id、seed、optimizer=Adam、loss=`normalized_mse_grid_uniform`、实际 hyperparameters、best_epoch、epochs_completed、best_validation_loss、stopped_early、run_complete=true、UTC 创建时间、Python/Torch 版本、device |
| metrics | schema=`earth_training_metrics_v1`、target/unit、aggregation、validation/test 各自 window_count、overall、by_lead |

`model_config` 必须直接足以调用 model_zoo 工厂：hidden_dims 保存 `[64,64,64]` 以保持完整调用契约，但页面不把它展示为 DLinear 生效参数；DLinear 的结构参数只有 linear_hidden_layers。投影尺寸由实际输入通道数决定，不能把所有任务都硬编码为 5。

`by_lead` 为按 lead_day 1、2、3 排列的列表，每项至少 `{lead_day, rmse, mae}`；overall 至少 `{rmse, mae}`。所有指标有限，标准化 validation loss 与 DU 指标分开标明。

训练期间把最佳 state 深拷贝到 CPU 内存；当前模型更新不能修改 best state 引用。恢复 best state、完成验证/测试后写同目录的明确临时文件，对临时文件做严格重载及同输入输出比对，全部成功才 `os.replace()` 原子替换为最终文件。不提前暴露未完成 checkpoint；检查失败保留任务失败状态，只允许按明确路径处理本任务临时文件。

停止/异常/OOM 不发布最终产物；不要复用以前任务的输出文件。若用户停止已写入标记，完成回调不得覆盖成 completed。当前系统停止使用 failed 状态及 Stopped by user 说明，本阶段保持该约定，不为 Earth 引入另一套任务状态。

新增 `load_earth_training_artifact(path, expected_binding, expected_hyperparameters=None, expected_task_id=None)`：验证上述字段、shape/窗口/通道/坐标与 snapshot 的一致性、归一化与指标合法性，构造模型并 `load_state_dict(..., strict=True)`。函数返回 checkpoint 字典；`create_earth_forecaster(input_channel_order, linear_hidden_layers=2)` 构造已知首版模型，`earth_forward(model, inputs)` 屏蔽零时间占位的旧签名。

`TrainingService` 子进程退出码为 0 后在线程中执行此校验，成功才写 completed；Earth 的数据库 metrics 直接复制 checkpoint.metrics，不能从 Mars 正则日志中凑出一套不同的指标。`model_available` 仍是轻量字段，列表接口不批量加载 Torch；新增 `trained_prediction_supported=false`（Earth）用于明确能力。旧字段本身不保证磁盘文件在训练结束后从未损坏，未来预测加载器仍须再次校验。

## 6. 文件职责与任务划分

以下新文件是目标路径；若执行时已有同职责实现则复用，保持契约一致。

| 动作 | 文件 | 职责 |
| --- | --- | --- |
| 新建 | `services/earth_training_contract.py` | Earth profile、严格参数校验、通道规范、内部 spec 校验 |
| 修改 | `services/dataset_registry.py`、`schemas/datasets.py` | 中性 snapshot、Earth 训练绑定、profile、能力 |
| 修改 | `services/earth_dataset.py` | 快照窗口、通道选择、可重用归一化 |
| 新建 | `training_backbones/earth_daily_model.py` | 现有 DLinear 的统一构造与 Earth forward |
| 新建 | `services/earth_training_artifact.py` | 原子保存、结构验证、严格重载、DU 指标聚合 |
| 新建 | `models/training_scripts/earth_daily.py` | 训练循环和 CLI 入口 |
| 修改 | `services/training_service.py`、`services/training_channels.py` | Earth 分派、子进程 spec、完成校验、停止竞态 |
| 修改 | `routers/training.py`、`schemas/training.py` | 错误透传、任务能力、action 保护 |
| 修改 | `services/inference_service.py`、`routers/predict.py` | Mars 推理、比较、PFI 的 Earth 拒绝分支 |
| 修改 | `services/training_weight_service.py` | 上传 Earth checkpoint 的明确不兼容报告 |
| 修改 | `services/dataset_identity.py` | 仅在需要时新增任务是否 Earth 的纯识别函数；不削弱身份保护 |
| 新建 | `frontend/src/pages/ModelTrainingPage/earthTrainingConfig.js` | Earth 配置、通道、提交构造纯函数 |
| 新建 | `frontend/src/pages/ModelTrainingPage/EarthTrainingDatasetPanel.jsx` | 日期划分、单位和固定窗口说明 |
| 修改 | `frontend/src/pages/ModelTrainingPage.jsx`、`trainingParamSanitizers.js`、`TrainingTaskParameters.jsx`、`trainingHyperparameterFormatting.js` | 页面接线、历史参数与指标 |
| 修改 | `frontend/src/services/api.js`、`frontend/src/components/TrainingTags/TrainingHistory.jsx` | datasetId 传递、错误和历史组织 |
| 复用 | `frontend/src/services/datasets.js` | 第二步的 `fetchDatasets({signal})` 及结构化目录错误 |
| 修改 | `frontend/src/i18n/zh.js`、`frontend/src/i18n/en.js` | 新增可见标签、错误和单位说明的翻译 |
| 修改 | `frontend/src/pages/PredictPage/trainedModelSelection.js`、`CompareTrainingModels/compareTrainingModelsData.js`、`frontend/src/pages/ModelTrainingPage/transferSourceConfig.js` | 筛选、旧 handoff 复核、迁移限制 |
| 新建 | `docs/earth-training.md` | 实现后的对外契约、启动与验证说明 |

无需新增数据库表：身份、hyperparameters、metrics 与 output_model_path 已有。新增训练 profile 为 API 可选字段；保留旧客户端所需字段。

### Task 1：锁定输入契约与注册表绑定

**文件：** 新建 `services/earth_training_contract.py`、`tests/test_earth_training_contract.py`；修改 `services/dataset_registry.py`、`schemas/datasets.py`、`tests/test_dataset_registry.py`、`tests/test_training_dataset_identity.py`。

以下后端测试命令使用第 7 节的 `Invoke-EarthTrainingTests`；先在后端工作目录定义该函数，每次调用会分配一个新的纯英文临时目录，避免 NetCDF 路径问题及复用 pytest basetemp 的清理行为。

- [ ] 先写 `normalize_earth_training_hyperparameters(hypers)` 的测试：固定窗口、范围、空辅助通道、规范顺序、未知/重复通道、禁止类型强转；函数失败统一抛 `DatasetRequestError`。
- [ ] 建立 `require_earth_training_configuration(model_source, uploaded_model_id, hypers)`；先检测 SPHERE/架构/迁移/上传不支持，再做参数模型验证。模型来源要在通用“非法值回退 official”之前校验。
- [ ] 定义 `EARTH_TRAINING_PROFILE`，以深拷贝放入 descriptor。增加 `DatasetTrainingProfile` schema，旧 Mars 描述符训练 profile=null。
- [ ] 抽出 `get_earth_snapshot()`，保留总览 wrapper 及其错误契约；Earth binding 从同次 release 创建，status=verified。
- [ ] 保留 Mars runner、上传 runner 的 `require_training_dataset()` 拒绝 Earth 行为；更新原来“所有 API Earth 请求必定 409”的测试，使其区分新的 Earth 服务路径和未开放的旧 runner。
- [ ] 验证绑定快照不会被调用者修改污染 registry，包缺失/变化时不返回上次可用身份。

核心断言示例：

```python
import pytest
from services.dataset_identity import DatasetRequestError
from services.earth_training_contract import normalize_earth_training_hyperparameters

def test_channel_order_and_ozone_only():
    one = normalize_earth_training_hyperparameters({"selected_channels": []})
    assert one["selected_channels"] == []
    assert (one["window"], one["horizon"]) == (7, 3)
    two = normalize_earth_training_hyperparameters({"selected_channels": ["SWGDN", "U10M"]})
    assert two["selected_channels"] == ["U10M", "SWGDN"]

@pytest.mark.parametrize("bad", [
    {"window": 3}, {"window": True}, {"epochs": 1.5},
    {"selected_channels": ["U"]}, {"selected_channels": ["U10M", "U10M"]},
    {"learning_rate": float("nan")}, {"_data_source": "personal"},
])
def test_invalid_parameters_are_rejected(bad):
    with pytest.raises(DatasetRequestError) as error:
        normalize_earth_training_hyperparameters(bad)
    assert error.value.status_code == 422
```

运行（后端目录）：`Invoke-EarthTrainingTests tests/test_earth_training_contract.py`。先确认测试因新实现缺失失败，再实现至通过；已有注册表/身份测试按第 7 节独立进程回归。

### Task 2：实现快照窗口与训练集归一化

**文件：** 修改 `services/earth_dataset.py`；新建 `tests/test_earth_training_data.py`；复用 `tests/conftest.py` 的 `earth_release`、`earth_spatial_release`。

- [ ] 为 `from_release()` 增加 357/172/175 数量和首尾输入/目标日期断言；assert 每个样本最后输入日与第一目标日相差一天。
- [ ] 增加有空间变化的 fixture 测试，区分纬经交换、通道错位和南北翻转；不能只用空间常数场验证网格。
- [ ] 实现规范通道选择、纯训练日统计拟合和 normalization 注入；给 validation/test 缺省统计量时明确失败。
- [ ] 保留独立 path 构造行为，内部共用窗口/统计逻辑；不要破坏已有可变 window/horizon 的读取器单元测试，固定 7/3 限制由网页训练契约承担。
- [ ] 用修改 validation/test 数值后训练统计完全不变的测试证明无泄漏；另测常量通道 scale=1、非有限值失败。
- [ ] 对 ndarray 与 Tensor 测试 DU round-trip，统计数组顺序与选中输入严格对应。

```python
import numpy as np
from services.dataset_registry import DatasetRegistry
from services.earth_dataset import EarthOzoneWindows

def test_full_release_windows_and_physical_target(earth_spatial_release):
    registry = DatasetRegistry(**earth_spatial_release)
    release = registry.get_earth_snapshot("earth_merra2_daily_v1")
    train = EarthOzoneWindows.from_release(
        release, split="train", window=7, horizon=3,
        selected_channels=["SWGDN", "U10M"], normalization=None,
    )
    test = EarthOzoneWindows.from_release(
        release, split="test", window=7, horizon=3,
        selected_channels=["U10M", "SWGDN"], normalization=train.normalization,
    )
    assert len(train) == 357 and len(test) == 175
    assert train.input_channels == ["TO3", "U10M", "SWGDN"]
    x, y = test[0]
    assert x.shape == (7, 3, 31, 49)
    assert y.shape == (3, 1, 31, 49)
    start = int(np.flatnonzero(release.dates == np.datetime64("2021-07-08"))[0])
    np.testing.assert_allclose(
        test.denormalize_ozone(y[:, 0]), release.fields["TO3"][start:start + 3],
        rtol=1e-6, atol=1e-4,
    )
```

运行：`Invoke-EarthTrainingTests @('tests/test_earth_training_data.py', 'tests/test_earth_dataset.py')`。预期：新契约和独立读取器用法同时通过。

### Task 3：封装 DLinear 并验证 31×49

**文件：** 新建 `training_backbones/earth_daily_model.py`、`tests/test_earth_dlinear.py`。只在发现必要接口问题时修改 `model_zoo.py`，不重写实验 backbone。

- [ ] 按下列方式实现两个小函数，先验证通道顺序属于已定义规范且 TO3 为首项。
- [ ] 测试 C=1/2/3/4/5 的前向、反向和一次 Adam 更新；确认输出 shape 与 y 完全一致，全部值有限。
- [ ] 测试不同 batch size，`use_sphere` 必定 false；传真实日期无需先变成 Ls。
- [ ] 对有 projector 的 C=1/3 检查参数进入 optimizer、state_dict 和重载，不只测五通道 Identity 情况。

```python
import torch
from training_backbones.model_zoo import build_forecaster

def create_earth_forecaster(input_channel_order, linear_hidden_layers=2):
    return build_forecaster(
        architecture="dlinear", input_channels=len(input_channel_order),
        selected_channels=list(input_channel_order[1:]), hidden_dims=[64, 64, 64],
        height=31, width=49, window=7, horizon=3, use_sphere=False,
        architecture_params={"linear_hidden_layers": linear_hidden_layers},
    )

def earth_forward(model, inputs):
    time_placeholder = inputs.new_zeros((inputs.shape[0], inputs.shape[1]))
    output = model(inputs, time_placeholder)
    expected = (inputs.shape[0], 3, 1, 31, 49)
    if tuple(output.shape) != expected:
        raise ValueError(f"Unexpected Earth output shape: {tuple(output.shape)}")
    if not torch.isfinite(output).all():
        raise ValueError("Non-finite Earth model output")
    return output
```

这段工厂代码展示实际调用接口；生产入口同时使用 Task 1 的通道校验，不接受任意维度/架构透传。零占位仅兼容旧签名，不保存成 Earth 季节特征。

运行：`Invoke-EarthTrainingTests tests/test_earth_dlinear.py`。不以“模型名含 Earthformer”推断它已支持地球任务。

### Task 4：先做 checkpoint 和 DU 指标契约

**文件：** 新建 `services/earth_training_artifact.py`、`tests/test_earth_training_artifact.py`。

- [ ] 定义第 5.4 节各字段的 schema 校验与 `load_earth_training_artifact()`，以不完整非空文件、错误 dataset/task/channel/grid、损坏 state_dict 为失败样例。
- [ ] 实现 `compute_earth_metrics(predictions_du, targets_du)`，参数为 `[N,3,1,H,W]` 数组，输出 `{overall,by_lead}`；shape 不符/非有限值时报错。
- [ ] 对真实生产训练支持逐 batch 的平方误差、绝对误差和元素计数累加，避免为了指标保留所有预测；最终结果与数组版一致。
- [ ] 实现原子保存。临时文件位于最终路径同目录，严格重载和输出比对通过后才替换最终文件；只操作本任务明确路径，不扫描清理目录。
- [ ] 测 CPU round-trip：`torch.load(weights_only=True)` 成功、严格重载后同输入的标准化输出一致、DU 输出一致，零辅助通道和全部通道均覆盖。
- [ ] 测重载使用保存的 normalization，即使当前默认参数改变也不能重新拟合或改变通道顺序。

指标单元测试用已知误差，不依赖随机模型效果：

```python
import numpy as np
import pytest
from services.earth_training_artifact import compute_earth_metrics

def test_metrics_are_physical_and_split_by_lead():
    reference = np.full((2, 3, 1, 31, 49), 250.0)
    prediction = reference + np.array([1.0, 2.0, 3.0])[None, :, None, None, None]
    result = compute_earth_metrics(prediction, reference)
    assert result["overall"]["mae"] == pytest.approx(2.0)
    assert result["overall"]["rmse"] == pytest.approx(np.sqrt(14.0 / 3.0))
    assert [row["lead_day"] for row in result["by_lead"]] == [1, 2, 3]
    assert [row["rmse"] for row in result["by_lead"]] == pytest.approx([1, 2, 3])
```

运行：`Invoke-EarthTrainingTests tests/test_earth_training_artifact.py`。预期：元数据/权重不一致拒绝，合法 artifact 可完全重建模型和 DU 输出。

### Task 5：完成独立 Earth runner

**文件：** 新建 `models/training_scripts/earth_daily.py`、`tests/test_earth_training_runner.py`。

- [ ] 入口按 backend 根目录配置导入路径；只解析 `--output_path`，从 `ARESVISION_EARTH_TRAINING_SPEC` 读取内部 spec，缺少或非法则非零退出。
- [ ] 将可测试核心定义为 `run_training(spec, output_path, registry, device=None)`，CLI 使用真实 registry；测试可传 fixture registry，不向生产公开哈希绕过开关。
- [ ] 验证 spec 与实际 snapshot 身份后构建三份窗口，创建 DLinear、Adam、MSELoss；限制随机数与 DataLoader 行为。
- [ ] 实现训练、验证、按 validation 选择 best、patience、恢复 best、最终 validation/test DU 评估。最优权重须 `.detach().cpu().clone()`，不能引用活模型参数。
- [ ] 日志沿用现有进度格式，普通十进制输出并 flush；epoch 完成后先保留 99.x% 的进行中状态，只有产物校验成功才到 100%。
- [ ] 输出内部日志说明日期、通道、样本量、device、best epoch；用户界面仅显示理解训练所需信息。
- [ ] 全部 loss/梯度/参数和指标做有限值检查；失败抛出清晰错误并不保存完整标记产物。
- [ ] 按第 5.4 节写临时 artifact，再 CPU 重载抽取一个 test batch 验证一致性，通过后发布最终文件。CPU 参考模型从内存 best state 严格恢复，避免把 GPU/CPU 数值差异误当序列化失败；成功打印完成说明并退出 0。

日志必须兼容：

```text
Epoch 1/10 Batch 1/45 Loss=0.123456
Epoch 1/10 Loss=0.110000 Val Loss=0.120000
Earth best epoch: 1
Earth metrics unit: DU
```

45 是 357 个训练窗口、batch_size=8 时的 batch 数；不得硬编码，按 loader 长度输出。不得用测试 loss 填充 Val Loss。

最佳权重测试用受控验证序列 `[0.8, 0.4, 0.6]`：best_epoch=2，保存 epoch 2 的参数；patience=1 时第三轮触发早停，仍评估最佳参数。另测末 batch 不足时 loss 元素加权、test 不参与优化/早停。自动化 runner 集成跑 1 epoch 即可验证链路，不断言随机模型一定提高准确率。

运行：`Invoke-EarthTrainingTests tests/test_earth_training_runner.py`。预期：fixture 完整循环写出可重载 artifact，最佳权重/非有限失败/缺少 spec 测试通过。

### Task 6：接入共享任务服务与完成状态

**文件：** 修改 `services/training_service.py`、`services/training_channels.py`、`routers/training.py`、`schemas/training.py`；新建 `tests/test_earth_training_service.py`、`tests/test_earth_training_routes.py`。

- [ ] 创建任务之前解析 dataset_id、配置支持性、参数、包可用性与身份；标签/名称沿用现有事务检查。错误路径断言数据库无新增记录、Popen 未调用、上传模型加载器未调用。
- [ ] Earth 使用服务端脚本 `earth_daily.py`；`normalize_training_hyperparameters()` 先按 dataset 分派 Earth 纯校验，再处理旧 Mars，防止清空地球通道。
- [ ] 任务 flush 后创建内部 spec，在 `_run_training_subprocess()` 新增可选 `earth_training_spec=None` 参数；其他调用方保持默认值，修正测试 subclass/stub 的签名。
- [ ] Earth 的 args 仅脚本和 output_path；spec 用 env 注入，身份字段不得落入普通超参数 CLI。实际 output_path 与 task id 路径一致。
- [ ] 退出码 0 后使用 `asyncio.to_thread()` 严格验证 artifact 与绑定/规范参数/task id，读取 metrics 后原子更新任务终态；失败写清晰 error_code。
- [ ] 增加停止/完成竞态回归：停止标记不可被末轮日志、待处理 progress 或完成回调覆盖；保留现有 failed+Stopped by user 约定。
- [ ] Earth 错误优先于 ValueError 捕获，返回结构化 detail；schema 增加 computed `trained_prediction_supported`，Earth=false，历史 Mars 按现有身份规则识别。
- [ ] 接通后再启用 registry Earth training capability；保持 trained_prediction=false。

测试至少覆盖：1 epoch 成功、非零进程退出、退出 0 但无文件、非空垃圾文件、有效文件身份不符、stop 后退出 0、tag 权限拒绝、名称冲突、身份字段伪造。数据库用临时 SQLite，日志与产物都放 pytest tmp_path，不污染真实用户记录。

现有 `TrainingTaskResponse.model_available` 不宜在序列化时加载 Torch；模型产物有效性在 runner 与父服务完成关口证明。新增测试应证明 completed 仅在校验后出现。

运行：`Invoke-EarthTrainingTests tests/test_earth_training_service.py`；另进程运行 `Invoke-EarthTrainingTests tests/test_earth_training_routes.py`。预期：成功任务五列一致，错误任务/请求符合第 4.3 节。

### Task 7：封住跨场景推理与迁移入口

**文件：** 修改 `services/inference_service.py`、`routers/predict.py`、`routers/training.py`、`services/training_service.py`、`services/training_weight_service.py`；新建 `tests/test_earth_training_isolation.py`。

- [ ] 增加纯任务识别函数 `is_earth_training_task(task)`：优先读 task.dataset_id，再读合法的 legacy hyperparameters.training_dataset；明确 Earth 时禁止回退 Mars，损坏/未知身份按既有未知身份策略处理。
- [ ] 在 `_prepare_task_prediction_context()` 完成用户访问检查后、准备数据/缓存前拒绝 Earth。
- [ ] 在 `get_test_results()` 直接路径增加同一保护；action=test 路由在 `prepare_task_inference_data_env()` 之前拒绝。
- [ ] 搜索所有以 task id 调用的推理/metrics/compare/error-distribution/PFI 分支，保证覆盖；compare 先对全部任务完成访问和场景预检，再读取任何缓存或开始计算。混入 Earth 时整个请求拒绝，不能先算完 Mars 再发现 Earth，也不能偷偷丢掉它再比较其余模型。
- [ ] `routers/predict.py` 中先捕获 DatasetRequestError 再捕获 ValueError，使拒绝返回 409 和稳定 code，不变成 400 或 500。
- [ ] Mars 迁移读取来源 task 后、加载文件前拒绝 Earth 来源。Earth 本身已拒绝迁移；`TrainingWeightService._validate_weight_file()` 识别 `artifact_schema=aresvision_earth_forecast_checkpoint_v1` 时返回 ok=false 和明确的不兼容 errors，上传记录为 invalid。不能抽取 state_dict 后尝试伪装 Mars；保留原先支持的 Mars 裸权重路径。
- [ ] 不创建 Earth 预测缓存；测试把 Mars loader、cache lookup、weight loader 改为“一调用就失败”，证明保护发生在这些动作之前。

保护核心形式：

```python
from services.dataset_identity import DatasetRequestError, is_earth_training_task

def require_mars_prediction_task(task):
    if is_earth_training_task(task):
        raise DatasetRequestError(
            "dataset_prediction_not_supported",
            "Earth historical prediction is not available yet",
            status_code=409,
        )
```

该 helper 可定义在 `services/inference_service.py` 供路由复用；`is_earth_training_task()` 定义在轻量 identity 模块，不导入 Torch/数据库。历史缺字段 Mars task 保持旧行为，不能仅因 dataset_version=null 拒绝全部旧模型。

运行：`Invoke-EarthTrainingTests tests/test_earth_training_isolation.py`。预期：UI 绕过、直接 API、旧 action 和混合比较都不能触发 Mars 计算。

### Task 8：训练页数据集与 Earth 配置

**文件：** 新建 `earthTrainingConfig.js`、`EarthTrainingDatasetPanel.jsx` 及相邻 `.test.js`；修改 `ModelTrainingPage.jsx`、`trainingParamSanitizers.js`、`frontend/src/services/api.js` 和 API 测试。

- [ ] 复用 `frontend/src/services/datasets.js` 的 `fetchDatasets({signal})`，读取返回对象的 `.items`；不要在 `api.js` 再建一个目录客户端，避免训练页硬编码包日期与 fingerprint。
- [ ] 训练数据集列表基于 registry；默认沿用 Mars。Earth 缺失/invalid 时仍可见，附具体不可用原因，按钮禁用并支持重试。Mars availability=unverified 不能被新逻辑一律禁用。
- [ ] 进入 Earth 时保存当前 Mars 表单快照，切 official/DLinear、7/3、SPHERE=false、transfer=false，清除有效提交中的 uploaded_model_id 与迁移源。回 Mars 恢复 Mars 配置，避免 Earth 通道进入 Mars 请求。
- [ ] Earth 面板显示 TO3 必选、四个辅助变量与单位，真实日期三分区及 357/172/175 样本数，区域/分辨率说明；输入窗口和预测步长文案明确“过去 7 天”“未来 3 天”。
- [ ] 提供 epochs/batch/lr/seed/patience/linear_hidden_layers，范围对应后端；隐藏不适用的循环网络隐藏维度，Earth DLinear 不展示 Mars SPHERE 或上传/迁移表单。
- [ ] 构造 Earth 请求走独立纯函数 `buildEarthTrainingHyperparameters(form)`；只发送白名单字段，规范通道顺序；未知 dataset 不得被 sanitizer 静默改成 OpenMARS。
- [ ] `startTrainingTask()` options 增加 `datasetId` 并序列化 dataset_id，保留 legacy key 同步；解析 detail.code/message，兼容字符串 detail 与非 JSON 响应。
- [ ] 元数据请求加入取消/序号保护；账号退出、场景切换和较慢响应不能把 Earth 配置覆盖到 Mars。提交时校验当前表单场景，避免依赖尚未生效的 React setState。
- [ ] 中英文、深浅主题、窄屏布局跟随已有样式，不引入新组件框架。

纯函数测试的最低要求：

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEarthTrainingHyperparameters } from './earthTrainingConfig.js';

test('Earth payload fixes dates and preserves ozone-only selection', () => {
  const payload = buildEarthTrainingHyperparameters({ selectedChannels: [] });
  assert.equal(payload.training_dataset, 'earth_merra2_daily_v1');
  assert.equal(payload.model_architecture, 'dlinear');
  assert.equal(payload.window, 7);
  assert.equal(payload.horizon, 3);
  assert.equal(payload.use_sphere, false);
  assert.deepEqual(payload.selected_channels, []);
  assert.equal(Object.hasOwn(payload, 'dataset_fingerprint'), false);
  assert.equal(Object.hasOwn(payload, 'transfer_source_task_id'), false);
});
```

运行（frontend 目录）：

```powershell
node --test src/pages/ModelTrainingPage/earthTrainingConfig.test.js
node --test src/pages/ModelTrainingPage/trainingParamSanitizers.test.js src/services/api.trainingTags.test.js
```

新增 API Earth 测试文件命名为 `src/services/api.earthTraining.test.js`，断言顶层 dataset_id、legacy 同步、409/422 message 展示和旧调用兼容。结构测试只能辅助定位，不能代替真实点击验收。

### Task 9：训练历史、指标与模型管理

**文件：** 修改 `ModelTrainingPage.jsx`、`TrainingTaskParameters.jsx`、`trainingHyperparameterFormatting.js`、`TrainingHistory.jsx`、`trainedModelSelection.js`、`compareTrainingModelsData.js`、`transferSourceConfig.js` 及对应测试。

- [ ] 历史卡片增加 Earth/Mars、数据集显示名、version、7天→3天；详情显示规范输入通道、各单位、日期划分、best epoch 与 DU 指标。dataset_id 与 model_source 分别显示，Earth 不是“自定义模型”。
- [ ] metrics 按 schema 分支解析；Earth 展示 validation/test 的总体/逐日 RMSE/MAE；旧 Mars flat metrics 仍正常显示。训练/验证 Loss 曲线标注为标准化 MSE，不能标 DU。
- [ ] 增加历史数据集筛选并与既有搜索、标签交集组合；切换筛选不改变后台运行任务或当前日志订阅。
- [ ] Earth 正常使用日志、重命名、标签及现有单条管理；执行验收时不批量删除任务/文件。
- [ ] Earth 的“模型测试”“去预测分析”明确禁用，说明历史预测尚未开放；已完成 DU 测试指标可直接查看，不调用旧 action=test。
- [ ] `getCompletedTrainingModelOptions()` 排除 Earth，构建 handoff 时拒绝 Earth；读取旧 localStorage handoff 后，必须重新匹配当前可用任务列表，失效则清除该单个 key。
- [ ] 比较选项和迁移选项复用任务场景判断；新增 `trained_prediction_supported` 缺失时保持旧 Mars 兼容，但明确 Earth ID 永远不能被 fallback 放行。
- [ ] 新建 `src/pages/ModelTrainingPage/earthTrainingHistory.test.js`，覆盖不同场景 metrics、标签组合筛选、禁用动作与旧历史 JSON。

运行（frontend 目录）：

```powershell
node --test src/pages/ModelTrainingPage/earthTrainingHistory.test.js
node --test src/pages/PredictPage/trainedModelSelection.test.js
node --test src/pages/PredictPage/CompareTrainingModels/compareTrainingModelsData.test.js
```

预期：completed Earth 仍出现在训练历史，但不出现在当前 Mars 预测/比较/迁移选项。

### Task 10：真实数据联调与文档交付

**文件：** 新建 `docs/earth-training.md`；同步 `README.md`、`docs/earth-compact-dataset.md`、`docs/dataset-registry.md`、`docs/earth-overview.md`；记录本计划实际验收状态。

- [ ] 执行第 7 节回归，逐条记录实际命令与结果；先修复失败再继续。
- [ ] 浏览器以有权使用训练的现有账号进入 `#/training`，选择 Earth，确认 registry/date/unit/sample 数值。
- [ ] 首先 epochs=1、batch=8、全部辅助变量，通过真实网页启动任务，观察 pending→running→completed、日志和 loss 曲线；记录 task id、参数、best epoch、窗口数和 metrics，禁止虚报测试精度。
- [ ] 检查任务 DB 五列与 checkpoint 一致；CPU 加载该真实产物，对一个 test batch 重载前后比对，标准化输出 `rtol=1e-5, atol=1e-6`，DU 输出 `rtol=1e-5, atol=1e-4`。同一设备 eval 条件比较，GPU 到 CPU 差异单独说明。
- [ ] 刷新页面确认记录保留；测试重命名与已有/新建标签，不改变 checkpoint 身份。另启动一次任务验证停止，保留日志说明结果。
- [ ] 切换回 Mars，检查旧表单、历史、预测选择不受 Earth 污染；检查 Earth 不出现在预测/比较/迁移选项，直接请求返回规定的 409。
- [ ] 从已完成的地球总览查看某天 TO3 后进入训练，确认使用相同数据 ID 与版本；训练执行后再读同日同点 TO3，确认总览仍为原始 DU，未被训练归一化污染。
- [ ] 补测单位隔离：固定 dataset fingerprint、日期与经纬网格点，等待加载完成并断言点位值可解析为有限数值，记录 DU 值；改变全局火星臭氧/温度单位后重新选择同日同点，再等待有限数值，确认单位仍为 DU 且数值一致，并与 field 对应网格值核对。占位 `--`、加载中或不同网格点不能算通过。
- [ ] 同步文档：Earth 训练只开放 DLinear/7→3/官方模型，训练 checkpoint 新格式、归一化、命令、错误码、日期划分、停止行为；Earth 预测仍关闭。README 保持简短入口，详细协议放专题文档。
- [ ] 检查 diff、文档链接和新增文件追踪状态；交付改动文件、测试、实际 task id、指标、限制与第四步接口，不自动提交/推送。

## 7. 验证命令与验收矩阵

先激活项目 Python 环境，再执行以下命令。本机已有环境为 `AresVision`；执行方应先确认 `python -c "import sys; print(sys.executable)"` 指向含 torch、netCDF4 的环境。不要默认系统 Python 就是训练环境。

后端工作目录：`AresVision_backend/backend/`。先定义以下 PowerShell 函数。每次调用使用新的纯英文临时路径，不复用已存在的 basetemp，也不执行批量清理；返回非零时立即报告失败。以下是实施后命令，本次计划更新未执行：

```powershell
function Invoke-EarthTrainingTests {
    param([Parameter(Mandatory = $true)][string[]]$TestFiles)
    $earthTrainingTemp = Join-Path 'D:\_Aresvision' ('.earth-training-test-' + [guid]::NewGuid().ToString('N'))
    python -m pytest @TestFiles -q --basetemp "$earthTrainingTemp"
    if ($LASTEXITCODE -ne 0) { throw "Earth training verification failed: $TestFiles" }
}

Invoke-EarthTrainingTests tests/test_earth_training_contract.py
Invoke-EarthTrainingTests tests/test_earth_training_data.py
Invoke-EarthTrainingTests tests/test_earth_dlinear.py
Invoke-EarthTrainingTests tests/test_earth_training_artifact.py
Invoke-EarthTrainingTests tests/test_earth_training_runner.py
Invoke-EarthTrainingTests tests/test_earth_training_service.py
Invoke-EarthTrainingTests tests/test_earth_training_routes.py
Invoke-EarthTrainingTests tests/test_earth_training_isolation.py
Invoke-EarthTrainingTests tests/test_dataset_registry.py
Invoke-EarthTrainingTests tests/test_dataset_routes.py
Invoke-EarthTrainingTests tests/test_earth_overview_service.py
Invoke-EarthTrainingTests tests/test_earth_overview_routes.py
Invoke-EarthTrainingTests tests/test_training_dataset_identity.py
Invoke-EarthTrainingTests tests/test_training_channel_contract.py
Invoke-EarthTrainingTests tests/test_official_training_runner.py
Invoke-EarthTrainingTests tests/test_uploaded_training_contract.py
Invoke-EarthTrainingTests tests/test_trained_model_predict_contract.py
Invoke-EarthTrainingTests tests/test_training_model_artifacts.py
Invoke-EarthTrainingTests tests/test_training_tags.py
Invoke-EarthTrainingTests tests/test_transfer_learning_strategy.py
Invoke-EarthTrainingTests tests/test_inference_legacy_official_weights.py
```

项目部分测试替换 sys.modules，以上默认逐文件独立进程，避免模块污染；不删除失败断言。总览两个文件必须回归，确认取数 wrapper、不可变原始数组与 capability 没被第三步破坏。受本次调用链影响的现有 inference/transfer/notification 测试也须按实际变更运行。

第二步报告的基线为 630 passed / 14 failed：3 项缺外部 MCD 数据，6 项预测契约和 5 项上传训练契约涉及异步测试执行配置。本次未重跑这些失败与修改前对照，因此这里只记录交付方归因，不能直接把后续同名失败判为既有问题。先保存本阶段修改前的同环境结果，修改后逐项比较错误类型与断言。

现有两个异步契约文件包含 `__main__` 的显式 `asyncio.run()` 入口，可以分别补充运行：

```powershell
python tests/test_trained_model_predict_contract.py
if ($LASTEXITCODE -ne 0) { throw 'Trained model prediction contract failed' }
python tests/test_uploaded_training_contract.py
if ($LASTEXITCODE -ne 0) { throw 'Uploaded training contract failed' }
```

独立入口的结果单独报告，不能将其改写为 pytest 全部通过。新增 Earth 异步测试优先使用普通 `def` 测试内的 `asyncio.run()`；若选择 pytest-asyncio，必须显式补全测试依赖与配置并验证，不能靠当前机器偶然存在的插件。缺 MCD 原始数据的测试说明缺失路径与受限范围，不伪造数据、不删除测试。

前端工作目录：`frontend/`：

```powershell
node --test src/pages/ModelTrainingPage/earthTrainingConfig.test.js src/services/api.earthTraining.test.js
node --test src/pages/ModelTrainingPage/earthTrainingHistory.test.js
node --test src/pages/ModelTrainingPage/trainingParamSanitizers.test.js src/pages/ModelTrainingPage/trainingHistoryParameters.test.js
node --test src/pages/PredictPage/trainedModelSelection.test.js src/pages/PredictPage/CompareTrainingModels/compareTrainingModelsData.test.js
node --test src/components/TrainingTags/trainingTagFilters.test.js src/services/api.trainingTags.test.js
node --test src/pages/ModelTrainingPage/transferSourceConfig.test.js src/services/datasets.test.js
node --test src/pages/DataOverviewPage/EarthOverview/earthOverviewModel.test.js src/pages/DataOverviewPage/EarthOverview/earthRequestCoordinator.test.js src/pages/DataOverviewPage/EarthOverview/earthMapGeometry.test.js src/pages/DataOverviewPage/EarthOverview/earthSeriesModel.test.js
npm run build
```

根目录：`git diff --check`。新计划与专题文档可能尚未跟踪，额外检查新文件的尾空格、链接与代码块，不能只依赖 git diff。

| 验收维度 | 必须观察到的结果 |
| --- | --- |
| 数据 | 731 日、31×49、规范纬经数组、TO3 DU；没有 MY/Ls 和全球周期拼接 |
| 通道 | 只臭氧、单辅助、多辅助、全部辅助均可建模；canonical 顺序可恢复 |
| 划分 | 357/172/175，窗口不跨边界；未来辅助场未输入模型 |
| 归一化 | 训练日拟合；修改 validation/test 不改变统计；恢复只读保存统计 |
| 模型 | 全 C 范围在 31×49 前反向可行；adapter/projector 权重一起保存 |
| 选择与评估 | best 由 validation 决定；test 仅最终使用；DU 总体与逐日指标有限 |
| 产物 | CPU weights_only 严格恢复；错误身份/shape/state/nonfinite 拒绝；非空垃圾不算成功 |
| 任务 | 真实任务可创建、跟踪、停止、刷新后保留；停止竞态不变成成功 |
| 权限 | 身份由服务端生成；标签/任务访问规则延续；无客户端路径或哈希绕过 |
| 场景隔离 | Earth 不能通过 UI/API/旧 handoff/Mars transfer/compare 使用 Mars 推理和缓存 |
| 回归 | Mars 数据读取、训练和上传模型仍按原契约工作；第二步总览没有被改坏 |

## 8. 给第四步留下的稳定接口

第四步直接读取 `aresvision_earth_forecast_checkpoint_v1`，通过保存的 model_config/input_channel_order/normalization/grid/date splits 重建模型。它可以扩展日期回测服务，不应重新猜测通道或拟合统计量。

未来比较身份至少包含 dataset_id、version、fingerprint、target、horizon、测试起点集合和指标 aggregation；模型可使用不同辅助输入，但比较的参考目标与日期集合必须一致。持久性基线也要使用同样窗口、目标日期与单位。本阶段仅保存这些必要信息，不提前建立尚未使用的 Earth 预测缓存。

若未来添加模型、季节特征、日期划分或更换归一化，需提升 profile/implementation/artifact 版本中实际改变的契约，不覆盖 v1 语义，也不能修改固定 ID 对应的数据内容来伪装同一版本。

## 9. 执行对话可直接使用的任务说明

```text
请按 docs/plans/2026-09-23-earth-dlinear-training.md 实施第三步“Earth MERRA-2 DLinear 训练接入”。

第二步二维地球总览已交付，可以直接接手第三步。先读 AGENTS.md、README 接手章节、数据集注册、Earth 小包及 docs/earth-overview.md，检查 Git 状态并保留前两步未提交改动。复用现有 VerifiedEarthRelease、registry 与 frontend/src/services/datasets.js，扩展共享接口时保留总览行为和每进程一份原始数组的约定。

完成地球训练数据集选择、固定过去 7 天预测未来 3 天、TO3 必选及四个可选辅助输入；复用任务进度、日志、停止、历史、标签与模型管理。使用独立 Earth runner 和已有 DLinear 工厂，按训练集拟合归一化，按验证集保存最佳模型，最终报告 DU 测试指标。

保存可严格恢复的单文件 checkpoint，包括数据版本/指纹、完整模型配置和权重、通道顺序、真实坐标、日期划分和归一化参数。完成一个真实网页训练任务与 CPU 重载校验。地球预测、更多模型、SPHERE 和迁移本阶段不开放；显式阻止 Earth 权重进入现有 Mars 推理/比较/缓存/迁移路径。

按计划执行后端和前端回归及浏览器验收，补测总览已加载数值的单位隔离，逐项区分既有环境失败与本次回归。同步 README 和专题文档，报告真实 task id、执行命令、结果与未完成项。不要只交付代码而跳过接线与验收；不要自动提交、推送、批量删除文件或创建额外对话。
```

编制验证范围：源码与协议核对、计划内容与链接检查。此计划中的训练、测试和网页验收均需实施对话实际执行，不能作为已通过的证据。
