# 服务器数据集注册表与训练任务身份

本文记录“数据集注册与训练任务身份兼容”第一阶段的已实现行为：只读数据集目录 API、Earth 小包发布校验、训练任务身份列与旧任务迁移、新训练请求的严格校验，以及当前仍未开放的能力边界。

实施方案见 [数据集注册与训练任务身份实施方案](plans/2026-09-23-dataset-registry-and-task-identity.md)。文档最近核对日期：**2026-09-24**；核对范围见文末“验证记录”。

[二维地球数据总览实施方案](plans/2026-09-23-earth-overview-2d.md) 对应阶段已实现；当前总览行为见 [二维地球数据总览](earth-overview.md)，默认 v2 全球数据契约见 [地球小数据包](earth-compact-dataset.md)。

其后的 [DLinear 地球训练接入实施方案](plans/2026-09-23-earth-dlinear-training.md) 规定 Earth 训练能力开放、任务身份与 checkpoint 绑定、通道/归一化协议及跨场景隔离；这是待实施计划，不代表本文当前的 Earth 训练拒绝规则已改变。

## 已实现范围

| 能力 | 状态 |
| --- | --- |
| `GET /api/datasets` 与 `GET /api/datasets/{dataset_id}` | 已实现，公开只读 |
| 固定注册 `openmars_mcd`、`mcd_overview`、`earth_merra2_daily_v1`、`earth_merra2_daily_v2` | 已实现 |
| Earth 小包（manifest + NetCDF）发布指纹与内容一致性校验 | 已实现 |
| `GET /api/datasets/{dataset_id}/overview/*` 三个地球总览接口 | 已实现，见 [二维地球数据总览](earth-overview.md) |
| 训练任务五个身份列、旧任务幂等回填 | 已实现 |
| 新训练请求严格校验数据集；未知 ID 与 Earth 训练在创建任务前拒绝 | 已实现 |
| 地球总览页面（三维全球球体、逐日播放、点位与区域曲线） | 已实现，见 [共用分析工作台](earth-analysis-workbench.md) |
| `GET /api/analysis/earth/overview/*` 四个地球分析接口（`context`、`research-suite`、`spatial-diagnostics`、`polar-dynamics`）与 `POST .../insight` | 已实现，见 [共用分析工作台](earth-analysis-workbench.md) |
| 地球年度分析、极区统计（`\|latitude\| >= 60°`）与图表 AI 解读 | 已实现 |
| 地球昼夜变化 | 未实现且当前数据不可支持：日平均没有日内采样 |
| 风场粒子、派生风速 | 未实现 |
| Earth 训练、可选 Earth 通道、checkpoint 内容改造 | 未实现 |
| 日期预测 API、历史回测、持久性基线、模型比较 | 未实现 |
| 用户上传数据注册、在线下载、数据集管理后台 | 未实现 |

**地球总览已接入，训练仍未接通。** `capabilities.web_overview=true` 表示总览与三维分析工作台入口已适配，`capabilities.training=false`、`trained_prediction=false` 表示这两条路径仍未开放；metadata 与训练能力必须分开理解。分析接口的 `capabilities.diurnal=false` 是**数据能力**声明：日平均数据没有日内采样，与接口是否实现无关。

## 注册身份：ID、版本与指纹分开

| 数据集 ID | planet | dataset_version | schema | 说明 |
| --- | --- | --- | --- | --- |
| `openmars_mcd` | `mars` | `null` | `null` | 现有服务器目录尚无不可变发布版本 |
| `mcd_overview` | `mars` | `null` | `null` | 同上，与前一来源区分 |
| `earth_merra2_daily_v1` | `earth` | `v1` | `aresvision_earth_daily_v1` | 保留原 31×49 区域抽样包，原始文件和哈希不变 |
| `earth_merra2_daily_v2` | `earth` | `v2` | `aresvision_earth_daily_v1` | 默认全球 36×72、5° 单元，源小时场重新处理 |

- `schema` 是文件格式协议名，不是数据集 ID，也不是数据版本。
- `manifest_sha256` 指 `manifest.json` **原始字节**的 SHA-256；发布后即使只是重新序列化 JSON 也算 manifest 变更。
- `data_sha256` 指 NetCDF 文件原始字节的 SHA-256。
- `dataset_fingerprint` 组合 `dataset_id`、`dataset_version`、`manifest_sha256`、`data_sha256`，算法固定为对四字段做 `json.dumps(sort_keys=True, separators=(",", ":"), ensure_ascii=True)` 后再取 SHA-256 十六进制。四个组成部分任一变化都会改变指纹。
- Mars 无版本记录时如实返回 `null`，不给旧来源编造 `v1`，也不用文件修改时间冒充版本。

保留的 Earth v1 发布指纹：

```text
manifest.json           1d346a059aff57964cb726dde7113fc495adb4b8245f533911dc6f3d63e52d7e
earth_merra2_daily.nc   c21c4ddcb03a69d2eb504f746c86b3a15cf33a06929044f50da768bdfc45cf74
dataset_fingerprint     74ce14752cb83932b29b458d9c19a61804861c270e6fec33f55316778ad64d31
```

默认 v2 固定发布 SHA：manifest 为 `935ca37bd3064772a370db6873b605e12b85c031281c2b34d8fbc49ab11f0702`，NetCDF 为 `d280a17cb291e1568ccedd1638cb2fadcc5cb8d89bb8ed0d4d51987e8e181396`。v2 的覆盖判断同时核对两轴实际 cell bounds、中心、连续性和全球范围；归一化摘要与训练日重算值一致后才可用。

把数据和 manifest 一起替换，也不构成原发布：注册表始终以各 ID 固定发布定义中的两个 expected SHA 为准，客户端无法从 API 或配置覆盖它。

## 对外查询协议

两个接口都是公开只读目录，不返回文件绝对路径、内部异常堆栈或用户信息。

```text
GET /api/datasets
200 {"items": [DatasetDescriptor, DatasetDescriptor, DatasetDescriptor, DatasetDescriptor]}

GET /api/datasets/{dataset_id}
200 DatasetDescriptor
404 {"detail": {"code": "unknown_dataset", "message": "Unknown dataset id"}}
```

列表稳定按 `openmars_mcd`、`mcd_overview`、`earth_merra2_daily_v1`、`earth_merra2_daily_v2` 顺序返回。已注册但文件缺失仍返回 200 和明确状态；缺失或损坏的 Earth 不会让整个列表失败，也不从列表消失。只有无效的查询 ID 才返回 404。

`DatasetDescriptor` 字段：

| 字段 | 类型及约定 |
| --- | --- |
| `dataset_id`、`display_name` | string，固定 ID 与展示名 |
| `planet` | `mars` 或 `earth` |
| `dataset_version` | string 或 null |
| `schema` | string 或 null；Earth 使用文件协议名 |
| `availability` | `available` / `missing` / `invalid` / `unverified` |
| `availability_reason` | 稳定错误码或 null，不返回底层异常文本 |
| `manifest_sha256`、`data_sha256`、`dataset_fingerprint` | 验证通过的 64 位小写十六进制 SHA 或 null |
| `capabilities` | `{metadata, training, web_overview, trained_prediction}`，表示入口是否适配，与文件是否齐备分别说明 |
| `time` | Earth 为真实日期；Mars 为 `{kind: "mars_ls", calendar/start/end/count/step/step_unit: null}` |
| `grid` | Earth 含 shape、维度顺序、范围、`cell_bounds`、步长、顺序、覆盖类型、是否循环及完整坐标数组；未验证的 Mars 为 null |
| `variables` | Earth 变量列表（`id`/`label`/`units`/`role`）；未核实 Mars 文件变量时为空列表 |
| `channel_order` | Earth 固定五通道；Mars 为空列表 |
| `splits` | Earth manifest 划分；Mars 为 null |
| `limitations` | string[]，数据边界说明 |

保留的 v1 验证成功示例（v2 使用独立 ID/哈希、36×72、±90°/±180°、`coverage=global`、`wrap_longitude=true`）：

```json
{
  "dataset_id": "earth_merra2_daily_v1",
  "display_name": "MERRA-2 daily ozone compact v1",
  "planet": "earth",
  "dataset_version": "v1",
  "schema": "aresvision_earth_daily_v1",
  "availability": "available",
  "availability_reason": null,
  "dataset_fingerprint": "74ce14752cb83932b29b458d9c19a61804861c270e6fec33f55316778ad64d31",
  "capabilities": {
    "metadata": true, "web_overview": true, "training": false, "trained_prediction": false
  },
  "time": {
    "kind": "date", "calendar": "proleptic_gregorian",
    "start": "2020-01-01", "end": "2021-12-31", "count": 731, "step": 1, "step_unit": "day"
  },
  "grid": {
    "shape": [31, 49], "dimension_order": ["lat", "lon"],
    "latitude_range": [-60.0, 60.0], "longitude_range": [-120.0, 120.0],
    "latitude_step": 4.0, "longitude_step": 5.0,
    "latitude_order": "ascending", "longitude_order": "ascending",
    "coverage": "regional", "wrap_longitude": false,
    "latitude_values": ["…31 个数值…"], "longitude_values": ["…49 个数值…"]
  },
  "channel_order": ["TO3", "U10M", "V10M", "T2M", "SWGDN"],
  "variables": [
    {"id": "TO3", "label": "Total column ozone", "units": "DU", "role": "target_and_input"},
    {"id": "U10M", "label": "10 m eastward wind", "units": "m s-1", "role": "optional_input"},
    {"id": "V10M", "label": "10 m northward wind", "units": "m s-1", "role": "optional_input"},
    {"id": "T2M", "label": "2 m air temperature", "units": "K", "role": "optional_input"},
    {"id": "SWGDN", "label": "Surface incoming shortwave flux", "units": "W m-2", "role": "optional_input"}
  ],
  "splits": {
    "train": {"start": "2020-01-01", "end": "2020-12-31", "days": 366},
    "validation": {"start": "2021-01-01", "end": "2021-06-30", "days": 181},
    "test": {"start": "2021-07-01", "end": "2021-12-31", "days": 184}
  },
  "limitations": ["Regional point-subsampled daily means; not global coverage", "…"]
}
```

详情在 `grid.latitude_values`、`grid.longitude_values` 返回全部坐标（v2 为 36 + 72 个数值，不另设坐标或分页接口）；列表使用同一结构。

Mars 两个注册项的 `availability=unverified`、`availability_reason=legacy_dataset_not_probed`。本阶段不扫描大型 Mars 目录，`training=true` 与 `trained_prediction=true` 表示已有服务入口，实际执行仍使用原有数据检查；`web_overview=false` 表示这两个训练身份尚未通过新目录协议驱动总览，不能与现有总览的 MCD/OpenMARS 图层入口混为一谈。

### 状态与错误码

`availability` 与 `availability_reason` 的固定组合：

| availability | availability_reason | 含义 |
| --- | --- | --- |
| `available` | `null` | 两个发布 SHA、manifest 自报值与 NetCDF 内容全部一致 |
| `missing` | `package_missing` | `manifest.json` 或 `earth_merra2_daily.nc` 不存在（目录不存在同此） |
| `invalid` | `manifest_fingerprint_mismatch` | manifest 原始字节 SHA 与固定发布不符 |
| `invalid` | `data_fingerprint_mismatch` | NetCDF 原始字节 SHA 与固定发布不符 |
| `invalid` | `invalid_manifest` | manifest 非 JSON 对象，或 `data_file` 不是固定文件名 |
| `invalid` | `manifest_metadata_mismatch` | manifest 自报的数据 SHA/字节数或逐项元数据（日期、维度、通道、单位、值域、划分、来源 SHA）与文件不一致 |
| `invalid` | `invalid_dataset` | 底层数据协议不通过：日期不连续、网格非均匀、单位不符、时间坐标非 Gregorian 日历等 |
| `invalid` | `package_changed_during_verification` | 校验过程中文件签名发生变化；该结果不进入缓存，下次请求重新校验 |
| `unverified` | `legacy_dataset_not_probed` | Mars 旧目录，本阶段不探测 |

详情接口对不存在或未注册的 ID 返回 404：

```json
{"detail": {"code": "unknown_dataset", "message": "Unknown dataset id"}}
```

`package_unreadable` 为保留错误码（登记为 `unverified`），当前实现不主动产生该状态。底层详细原因只写日志；对外不回传绝对路径或异常堆栈。

### 校验与缓存

Earth 校验顺序：两个文件存在 → manifest SHA → manifest JSON 对象 → `data_file` 固定名 → NetCDF SHA → manifest 自报 `data_sha256`/`data_bytes` → `load_earth_dataset()` 数据协议 → manifest 与 NetCDF 逐项元数据一致 → 前后文件签名一致。

- `manifest.data_file` 必须等于 `earth_merra2_daily.nc`；不接受客户端路径或任意相对路径。
- 元数据由文件真实计算得出，不写死 731 天或 31 × 49 来伪造成功。
- 时间 `calendar` 从解码时间编码读取，只接受 `standard`、`gregorian`、`proleptic_gregorian`；其他日历按 `invalid_dataset` 拒绝，不会标成火星时间。
- 校验由锁保护，按发布 ID 分别缓存描述符和不可写的五场数组，每个发布最多一份快照，key 为两个文件的 `(路径, 大小, mtime_ns, ctime_ns)`；文件消失或任一签名变化立即重新校验。每次返回深拷贝，调用方修改返回值不会污染缓存。
- 注册表构造不读取文件，首次查询时才校验。

## 训练任务身份

`model_training_tasks` 增加五个可空列，不建立数据集数据库表：

```text
dataset_id               VARCHAR(80)
dataset_version          VARCHAR(40)
dataset_fingerprint      VARCHAR(64)
dataset_identity_status  VARCHAR(32)
dataset_snapshot         TEXT   -- JSON 对象
```

身份状态：

| 状态 | 含义 |
| --- | --- |
| `legacy_inferred` | 从旧超参数或已知默认规则推断出的 Mars 来源，版本与指纹未知 |
| `legacy_unknown` | 旧 JSON 非对象、损坏或来源不认识；快照保留 `planet=mars` 与原因，`dataset_id=null` |
| `unversioned` | 新创建的现有 Mars 任务，来源明确，数据源尚无发布版本 |
| `verified` | 为将来使用固定发布版本预留；本阶段不创建 Earth 训练任务 |

### 旧任务回填规则

迁移按行判断：只有五个身份列**全部为 NULL** 才回填，因此已有绑定（含部分列已存在）的行原样保留。

| 旧 `hyperparameters` | 回填 `dataset_id` | 状态与 `binding_basis` |
| --- | --- | --- |
| `{"training_dataset":"openmars_mcd"}` | `openmars_mcd` | `legacy_inferred` / `explicit_training_dataset` |
| `{"training_dataset":"mcd_overview"}` | `mcd_overview` | `legacy_inferred` / `explicit_training_dataset` |
| JSON 对象缺少字段、值为 null、空字符串或空白 | `openmars_mcd` | `legacy_inferred` / `historical_default`（旧代码已有默认行为） |
| JSON 损坏、数组/标量、未知非空 ID、非字符串值、Earth ID | `null` | `legacy_unknown`，不猜来源 |

所有旧行的 `dataset_version`、`dataset_fingerprint` 保持 `null`。`dataset_snapshot` 至少保存 `planet`、`binding_basis`、`version_status`。迁移**不修改**旧 `hyperparameters`、状态、权重路径、指标、日志、标签及模型来源，也不移动或删除任何权重文件。

迁移在 `init_database()` 的建表事务中执行，位于既有“尽力补列”异常捕获之外：身份迁移失败会中止启动，避免返回看似健康但任务查询全部失败的应用；SQLite 已成功增加的列允许留下，补列与回填都幂等，修复后可重试。

### 新训练请求解析与错误

`TrainingStartRequest` 新增顶层可选 `dataset_id`。旧请求继续使用 `hyperparameters.training_dataset`；两处都未给出时仍默认 `openmars_mcd`。

| 请求组合 | 结果 |
| --- | --- |
| 顶层有效 ID + 旧字段缺省 | 使用顶层 |
| 仅旧字段有效 ID | 使用旧字段 |
| 两处有效且相同 | 接受 |
| 两处有效但不同 | 400 `dataset_id_conflict` |
| 显式空字符串、非字符串、未知 ID | 400 `invalid_dataset_id` / `unknown_dataset` |
| 已知 Earth ID | 409 `dataset_training_not_supported` |
| 两处均为 null/未提供 | 默认 `openmars_mcd` |

Pydantic 对字段类型的基本校验错误仍使用 422；上表中 400/409 指服务层语义错误。未知 ID 不会被当作默认值。

客户端**不能**提交 `dataset_version`、`dataset_fingerprint`、`dataset_identity_status`、`dataset_snapshot` 来决定绑定：

- 顶层出现这四个字段 → 请求校验失败（422）。
- `hyperparameters` 中出现这四个字段或 `dataset_id` → 400 `client_identity_not_allowed`。

只支持“顶层新字段”和“旧 `training_dataset`”两个入口，避免出现第三套协议。

### 身份解析时机与持久化

身份解析、能力校验与绑定构造发生在**数据库操作、上传模型加载和子进程调度之前**；被拒绝的请求不会创建任务、不会加载上传模型包，也不会启动子进程。

新 Mars 任务把解析后的 ID 同时写入独立列与原有 `hyperparameters.training_dataset`（保证训练 CLI 与旧读取逻辑一致）；其他身份只写独立列，不会并入 `hyperparameters`，因此不会进入 CLI 参数。官方 `demo3.py` 与上传模型 `user_model_runner.py` 的 `main()` 在 argparse 解析后、数据加载前执行同一套严格校验；两个 runner 原有的宽容 normalizer 保留给旧任务读取与推理兼容，新训练不再经过它。

任务列表/详情响应新增 `dataset_id`、`dataset_version`、`dataset_fingerprint`、`dataset_identity_status`、`dataset_snapshot` 五个字段；`dataset_snapshot` 以 JSON 对象或 null 返回，数据库仍存 TEXT。无快照或快照损坏时返回 null，不会导致整个历史列表崩溃。旧客户端可忽略新字段。

`model_source`、`data_source=default`、上传模型与标签授权语义不变。新增身份列会改变新 Mars 任务的预测缓存产物指纹；本次不重写旧任务 JSON，因此旧缓存载荷保持有效。

## 配置

| 变量 | 用途 |
| --- | --- |
| `ARESVISION_EARTH_MERRA2_DIR` | 覆盖已注册 Earth 小包目录，默认 `data/earth/merra2_daily_v2` |
| `ARESVISION_EARTH_MERRA2_V1_DIR` | 独立指定旧兼容包目录，默认 `data/earth/merra2_daily_v1` |

v1/v2 不按请求互相映射。

相对路径相对后端启动目录解析；路径本身不通过 API 返回。注册服务在 `main.py` 的 lifespan 中装配为 `app.state.dataset_registry`，构造阶段不读取文件。

## 手工验证

从后端目录（`AresVision_backend/backend/`）执行；真实小包只读校验不需要启动完整应用：

```powershell
conda run -n AresVision python -c "from config import EARTH_MERRA2_DIR, EARTH_MERRA2_V1_DIR; from services.dataset_registry import DatasetRegistry; r = DatasetRegistry(EARTH_MERRA2_DIR, earth_dataset_id='earth_merra2_daily_v2', legacy_earth_package_dir=EARTH_MERRA2_V1_DIR).get_dataset('earth_merra2_daily_v2'); print(r['availability'], r['time'], r['grid']['shape'], r['dataset_fingerprint'])"
```

回归测试（使用新的纯英文临时目录）：

```powershell
$datasetTestTemp = Join-Path 'D:\_Aresvision' ('.dataset-registry-test-' + [guid]::NewGuid().ToString('N'))
python -m pytest tests/test_dataset_identity.py tests/test_dataset_registry.py tests/test_dataset_routes.py tests/test_training_dataset_identity_migration.py tests/test_training_dataset_identity.py -q --basetemp "$datasetTestTemp"
```

`tests/conftest.py` 提供显式引用的 `earth_release` fixture：它在临时目录用真实尺寸（731 天、31 × 49）重建一个临时小包并返回其实际 SHA，不读取生产文件，也不产生 autouse 全局副作用。

## 当前边界

- 训练页仍只发送原有两种 Mars 来源；二维 Earth 总览默认请求 v2。
- 地球已开放**二维日数据总览**（见 [二维地球数据总览](earth-overview.md)）：区域热力图、逐日播放、点位曲线与覆盖区域加权均值；**没有**三维地球、风场粒子、派生风速、自选多边形区域、重网格、平滑/插值、臭氧单位换算、导出、PFI 或 Earth Copilot。
- Earth **训练与预测仍未开放**：训练请求返回 409 `dataset_training_not_supported`。
- `web_overview=true` 只表示入口已适配，与数据是否齐备分开：缺包时数据接口返回 503，前端同时要求 `availability=available`。
- manifest 中“读取器尚未接注册表”一类构建期说明会被过滤；`limitations` 只保留物理数据限制与当前应用能力说明。
- Mars 身份不伪造版本；`openmars_mcd` 与 `mcd_overview` 何时成为不可变发布版本属于另一个数据发布任务。
- 本阶段的身份快照**不足以独立复现训练**。Earth 训练阶段还需要补充选定通道顺序、输入/输出窗口、归一化数组、坐标、日期划分、checkpoint 绑定与预测复现校验。

## v1 历史验证记录（不代表 v2 验收）

2026-09-23 使用 conda 环境 `AresVision` 的解释器在本地执行：

- 本地固定小包只读校验：`availability=available`、731 天、31 × 49、步长 4°/5°、`wrap_longitude=false`、`TO3` 单位为 `DU`、`capabilities.training=false`；两个实际 SHA 与上表发布定义一致。
- 新增测试全部通过：`tests/test_dataset_identity.py`（44）、`tests/test_dataset_registry.py`、`tests/test_dataset_routes.py`、`tests/test_training_dataset_identity_migration.py`（9）、`tests/test_training_dataset_identity.py`（41，含 HTTP 请求到数据库的集成用例）。
- 方案第 7 节列出的既有回归中，`test_training_channel_contract.py`、`test_training_channels.py`、`test_training_dataset_loader.py`、`test_official_training_runner.py`、`test_user_model_schema.py`、`test_training_tags.py`、`test_earth_dataset.py`、`test_prediction_analysis_cache_identity.py`、`test_uploaded_model_runner.py`、`test_uploaded_model_ls_inference.py` 全部通过（合计 265 项通过）。
- 应用装配与真实小包联调：在真实 SQLite 数据库的临时副本上用 `TestClient` 启动完整 `main.app`，`GET /api/datasets` 返回三个条目、Earth 为 `available` 且指纹为 `74ce…d31`、`training=false`；`GET /api/datasets/missing` 返回 404；响应不含小包绝对路径；启动迁移把 14 条历史任务全部回填为 `legacy_inferred`，旧超参数、状态、权重路径与指标逐字不变。
- 第二阶段（二维地球总览）完成后，`capabilities.web_overview` 改为 `true`，并新增 `test_available_earth_does_not_claim_the_overview_is_unconnected` 等测试，确认目录不再宣称地球总览未接入；Earth 训练拒绝、发布 SHA 与版本断言保持不变。总览接口与真实数据比对结果见 [二维地球数据总览](earth-overview.md) 的“验证记录”。
- 未开放能力仍为未开放：没有运行 Earth 训练或 Earth 预测。
