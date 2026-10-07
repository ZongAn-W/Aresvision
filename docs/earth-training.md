# 地球 MERRA-2 DLinear 训练与历史预测

本文记录 `earth_merra2_daily_v2`（含保留的 v1 兼容身份）的网页训练与历史日期预测，以及 `earth_merra2_3hourly_v1` 的官方 DLinear / 独立契约上传模型 56→24 训练与 UTC datetime 历史回测。地球使用独立的数据准备、训练与推理路径，不进入火星 MY/Ls、通道或旧权重加载逻辑。下文日频接口与上传契约保持原义；三小时细节见[三小时数据构建、训练与历史回测](earth-merra2-3hourly.md)及[专用上传契约](earth-3hourly-uploaded-model.md)。

两个 Earth ID 是不同的时间轴和 checkpoint 契约，不互相转换。`earth_merra2_daily_v2` 为日频旧任务兼容入口，保留 7→3、已有 checkpoint 与满足原 Earth 兼容条件的上传模型；旧任务只读预测，不自动迁移。`earth_merra2_3hourly_v1` 为 UTC 三小时入口，网格 0.75°×0.75°、240×480，字段为 TO3（DU）、U10M/V10M（m s-1）、T2M（K）、SWGDN（W m-2），官方 DLinear 和通过三小时独立校验的上传模型支持 56→24。两种 profile 的任务身份、时间轴、窗口、数据 fingerprint 和 checkpoint schema 分开校验；预测缓存身份也包含 dataset ID/version/fingerprint，不能跨数据集复用。

- 数据包、网格与源处理见[地球 MERRA-2 数据包](earth-compact-dataset.md)
- 数据集身份、发布指纹与目录接口见[服务器数据集注册表](dataset-registry.md)
- 训练页交互与前端结构见[实验中心](experiment-center.md)

## 已开放与未开放

| 能力 | 状态 |
| --- | --- |
| 训练页选择 `earth_merra2_daily_v2` / `earth_merra2_daily_v1` | 已开放 |
| 官方 DLinear，固定过去 7 天 → 未来 3 天，目标 TO3 | 已开放 |
| **用户上传模型（须通过 Earth 兼容校验）作为日频 Earth 训练的模型来源** | 已开放 |
| 三小时官方 DLinear 后端训练，固定 56→24、240×480、TO3 DU | 已实现；按需读窗与空间块，完成前严格重载 |
| 三小时历史回测 API，56 输入步与 24 个预测/参考/残差场 | 已实现；UTC datetime、总体/逐步/累计 24/48/72 小时 DU 指标 |
| 三小时数据总览 | 已开放 UTC 时间轴、降采样地图、原生点位及后端日聚合；见[总览协议](earth-overview.md#三小时-utc-总览) |
| 三小时训练/预测前端选项与预测展示 | 已开放；训练显示 UTC/240×480/56→24，预测按 UTC 起点展示 24 个 lead、场和指标 |
| 三小时用户上传模型 | 已开放独立 v1 契约、隔离 dry-run、训练/验证/测试、严格重载与历史回测；见[专用模板说明](earth-3hourly-uploaded-model.md) |
| TO3 必选 + U10M / V10M / T2M / SWGDN 四个可选输入（允许只用 TO3） | 已开放 |
| 训练期归一化（只拟合 train 划分），验证/测试/预测复用 | 已开放 |
| 单文件 checkpoint（权重 + 模型配置 + 数据身份 + 归一化 + 指标） | 已开放 |
| 训练完成前 CPU 严格重载校验 | 已开放；三小时完成门禁由父进程调度有超时的独立进程 |
| 保存 DU 单位的验证集与测试集总体 / 逐日 RMSE、MAE | 已开放 |
| 预测页按**历史预测起点**回测随后 3 天的预测场 / 参考场 / 残差场（DU）与指标 | 已开放 |
| 预测上下文与结果显示所用模型身份（官方 DLinear 或上传模型名称/版本/内容指纹） | 已开放 |
| 服务端返回可选起点范围、三天真实日期与真实经纬网格 | 已开放 |
| 训练任务的启动、进度、日志、停止、历史、重命名、标签 | 复用现有机制，已开放 |
| 无参考真值的未来日期外推 | 未开放（数据集只到 2021-12-31） |
| Earth / Mars 混合比较、持久性基线 | 未开放 |
| SPHERE、迁移学习、地球其他**官方**架构 | 未开放（返回 409） |
| 地球上传模型的 Ls / MOLA 地形等火星辅助输入 | 不开放（校验期即拒绝并给出原因） |
| Earth 预测结果的持久化缓存 | 未实现；三小时有独立进程内 LRU，日频保持每次重新推理 |

## 日频固定契约

| 项目 | 值 |
| --- | --- |
| 数据集 ID / 版本 | `earth_merra2_daily_v2` / `v2`（`earth_merra2_daily_v1` / `v1` 为保留身份） |
| 训练脚本 | 服务端固定 `models/training_scripts/earth_daily.py`，客户端不能指定 |
| 模型来源 | `official`（官方 DLinear）或 `uploaded`（用户上传模型，须通过 Earth 兼容校验） |
| 架构 | 官方 `dlinear`（`implementation_id = aresvision_gridpoint_dlinear_v1`）；上传模型记为 `uploaded`，实际代码由 checkpoint 固定的模型引用决定 |
| 输入 / 输出 | 窗口 7 天、步长 3 天，一次输出三天，不做递归滚动 |
| 上传模型张量契约 | 输入 `[B, 7, C, 36, 72]`，输出 `[B, 3, 1, 36, 72]`（C = 实际选用通道数） |
| 通道顺序 | `TO3` 固定第一，其后按 `U10M, V10M, T2M, SWGDN`；请求顺序不影响模型顺序 |
| 单位 | `TO3` DU；风 `m s-1`；`T2M` K；`SWGDN` W m-2 |
| 目标 | `TO3`，反归一化后为 DU |

日期划分来自已发布 manifest，页面只读展示：

| 划分 | 日期范围（含首尾） | 天数 | 7→3 窗口数 |
| --- | --- | --- | --- |
| train | 2020-01-01…2020-12-31 | 366 | 357 |
| validation | 2021-01-01…2021-06-30 | 181 | 172 |
| test | 2021-07-01…2021-12-31 | 184 | 175 |

窗口严格留在所属划分内：样本 `i` 使用输入索引 `[i, i+6]`、目标索引 `[i+7, i+9]`，不向前一划分借 7 天。

## 日频归一化

- 每个有效通道在 **366 个训练日的全部 36×72 网格**上拟合一个均值与标准差；float64 累加，保存 float32 有效值，`ddof=0`。
- 标准差小于 `1e-6` 的通道保留 `scale = 1.0`，并在 `constant_channel_mask` 中标记，不产生 NaN 或 Inf。
- validation / test / 预测只复用保存的统计量；`fit_split` 必须是 `train`，通道顺序必须与模型输入一致，否则拒绝加载。
- 不做 MinMax、对数、插值、缺值补零或负值裁剪。
- 已发布 v2 包的训练期统计量：`TO3` 286.762064 / 47.314837；`U10M` −0.001669 / 4.970813；`V10M` 0.220144 / 4.115977；`T2M` 278.888111 / 21.438948；`SWGDN` 158.234657 / 106.847826。

## 训练请求与参数范围

沿用 `POST /api/training/start`；数据集既可用顶层 `dataset_id`，也可用旧字段 `hyperparameters.training_dataset`，两处冲突仍按既有规则拒绝。

```json
{
  "model_script": "demo3.py",
  "model_name": "Earth DLinear 7d-3d",
  "model_source": "official",
  "data_source": "default",
  "dataset_id": "earth_merra2_daily_v2",
  "tag_ids": [],
  "hyperparameters": {
    "training_dataset": "earth_merra2_daily_v2",
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

Earth 只使用发布 manifest 固定的 `train` / `validation` / `test` 日期块；页面以只读方式显示 `70% / 20% / 10%` 兼容比例，新的 Earth 请求不发送自定义比例。checkpoint 保存每个日期块和实际窗口范围，比例字段仅保留给旧任务读取。

`model_script` 仅为兼容现有客户端保留；服务端会按数据集选择 `earth_daily.py` 并写入任务，实际执行的脚本与客户端提交值无关。

严格范围（越界即 422，不静默夹取）：`epochs` 1…1000、`batch_size` 1…64、`learning_rate` (0, 1]、`seed` 0…2³²−1、`early_stopping_patience` 0…200、`linear_hidden_layers` 1…4。日频 `window`/`horizon` 必须为 7/3；三小时必须为 56/24。布尔值不能充当整数。

### 三小时官方 DLinear

同一训练接口选择 `dataset_id=earth_merra2_3hourly_v1` 后，服务端 profile 固定为三小时 UTC、56 输入步、24 输出步、240×480 全球网格。TO3 必选，四个辅助输入及通道顺序沿用日频规则；目标仅 TO3，单位 DU。上传模型不参与三小时执行，返回 409 `dataset_training_configuration_not_supported`，不调用日频上传兼容门或降级模型。

完整两年发布的连续 split 各自独立切窗，train/validation/test 分别有 2928/1448/1472 步、2849/1369/1393 个窗口。归一化只扫描 train，逐通道最多 8 步，以 float64 合并统计量；选中通道的缺失显式拒绝。分块生成 normalized float32 磁盘内存映射后按需读取窗口与 24×48 空间块，避免压缩整场反复解压；每个窗口 100 块，`batch_size` 以块为单位，checkpoint 仍绑定完整 240×480 网格。缓存通过 `ARESVISION_EARTH_TRAINING_CACHE_DIR` 配置，默认位于 Git checkout 外的工作区父级，完整五通道约 12.55 GiB，并在训练结束或中断后保留。

三小时 checkpoint schema 为 `aresvision_earth_forecast_checkpoint_3hourly_v1`，实现 ID 为 `aresvision_gridpoint_dlinear_3hourly_v1`。保存 window/horizon、hour/step=3、UTC、区间中心规则和 90 分钟中心偏移（01:30…22:30）、完整网格、通道/单位、发布 split、训练期 normalization、SHA/fingerprint 和任务身份；日频 checkpoint 不能加载到三小时任务。验证/测试保存总体、24 个 lead step（3…72 小时）及累计前 24/48/72 小时的 DU RMSE/MAE。

实际 smoke 使用合成 30 天/240 步、完整网格，测试专用连续 split 各 10 天、各 1 个时间窗口；五通道 CPU 训练 1 epoch，最终内存映射版本严格重载通过（1 passed，16.02 秒），归一化只拟合前 10 天。真实数据仅有已验证 7 天包（56 步），不足完整 80 步窗口；未执行真实全两年构建或训练。smoke 与后续分文件测试命令见[三小时训练验证](earth-merra2-3hourly.md#官方-dlinear-后端训练)。

### 用用户上传模型训练日频 Earth

把 `model_source` 设为 `uploaded` 并在顶层传 `uploaded_model_id`。自定义参数值放在 `hyperparameters.custom_model_params`，服务端按该上传包自己的 `MODEL_SPEC.parameters` 逐项校验（类型、范围、未知键）。

```json
{
  "model_script": "unified_training.py",
  "model_name": "Earth uploaded conv",
  "model_source": "uploaded",
  "uploaded_model_id": "<UserModelPackage.id>",
  "dataset_id": "earth_merra2_daily_v2",
  "hyperparameters": {
    "training_dataset": "earth_merra2_daily_v2",
    "model_source": "uploaded",
    "selected_channels": ["U10M", "T2M"],
    "epochs": 5,
    "batch_size": 64,
    "custom_model_params": {"hidden_dim": 16, "dropout": 0.0}
  }
}
```

上传模型用于 Earth 的前提条件（任一不满足即拒绝并返回原因）：

| 条件 | 不满足时的表现 |
| --- | --- |
| 上传包属于当前账号且 `validation_status = valid` | 404 / 422 |
| 源文件存在且内容哈希与记录一致 | 422（`uploaded_model_not_earth_compatible`，说明文件已被改动） |
| `MODEL_SPEC.datasets` 显式声明 `earth_merra2` | 422，提示模型未声明该数据源 |
| 声明不要求 Ls / MOLA 地形等火星辅助输入 | 422，提示 Earth 不接受辅助输入 |
| Earth dry-run 真实构建并跑通 `[1,7,{1,5},36,72] → [1,3,1,36,72]` | 422，附带 `build_model` 或形状失败的具体原因 |

**“适用于火星”不等于“适用于地球”**：没有 `datasets` 声明的历史上传包一律按仅火星处理，不会因为它在火星校验通过就被 Earth 接受。

启动训练时服务端把这些身份与代码一起固定进任务与 checkpoint：

- `_uploaded_model_id` / `_uploaded_model_version` / `_uploaded_model_content_hash` / `_uploaded_model_name` / `_uploaded_model_param_schema` / `custom_model_params` 写入任务 `hyperparameters`（客户端提交值不参与身份决定）。
- 训练 spec 的 `uploaded_model` 块只保留服务端白名单字段，并内嵌**哈希校验过的源码文本**。
- 因此任务创建之后用户再上传新版本、或改动/删除原文件，都不会改变该任务实际训练的代码；原始文件被删除或篡改时，重建改用 checkpoint 内嵌副本，并在预测上下文与结果里给出警告。

#### Earth 上传模型的 checkpoint 与重载

`model_ref` 是 checkpoint 内的模型引用块：

| 字段 | 含义 |
| --- | --- |
| `model_source` | `official` 或 `uploaded` |
| `architecture` | 官方为 `dlinear`，上传为 `uploaded` |
| `uploaded_model.package_id` / `version` / `content_hash` / `display_name` | 固定的上传包身份；`package_id` 与 `content_hash` 缺失即拒绝写入 |
| `uploaded_model.source_path` | 用于检测原文件是否仍在/是否被改动，不参与执行 |
| `uploaded_model.source_text` | 哈希校验通过后实际执行的源码副本（必需） |
| `uploaded_model.param_schema` / `custom_model_params` / `build_config` | 重建 `build_model(config)` 所需的参数与配置 |
| `uploaded_model.input_channel_order` | 与 checkpoint 通道顺序一致性校验 |

重建时不使用任何 pickle 反序列化对象：源码先过与上传校验同一套 AST 安全门（只允许 `torch` / `numpy`，禁止 `open`/`eval`/`exec`/`compile`/`__import__` 与 `system`/`popen`/`Popen`/`run`），再 `exec` 后调用 `build_model(config)`；权重用 `torch.load(..., weights_only=True)` 加载。缺少 `model_ref` 的旧 checkpoint（含既有官方 DLinear 任务）一律按官方处理，保持可读、可预测。

## 服务端执行与产物

1. 父进程在**任何数据库写入、上传模型加载或子进程调度之前**解析数据集身份、校验配置支持性与参数，并构造绑定（`dataset_identity_status = verified`）。
2. 任务行 flush 后生成内部 spec（`earth_training_spec_v1`：任务 ID、五列绑定、规范超参数），通过环境变量 `ARESVISION_EARTH_TRAINING_SPEC` 传给子进程。子进程只接收 `--output_path`，身份与快照从不作为命令行参数。
3. 子进程重新校验 spec 与实际快照身份，用训练期统计量构建三份窗口，训练官方 DLinear（Adam + 标准化空间 MSE），按 validation 选择最佳 epoch，恢复最佳权重后评估 validation 与 test。
4. 产物先写同目录临时文件，严格重载并比对同输入输出，全部通过才原子替换为最终 `.pth`。
5. 父进程在**标记 completed 之前**再次 CPU 严格重载：校验 schema、字段、通道顺序、网格、窗口、归一化、指标与任务身份；成功才写 `completed`，并把 checkpoint 里的 DU 指标直接写入任务 `metrics`（不从日志正则凑另一套）。
6. 用户停止后到达的 exit 0 完成回调不会把任务改成 completed；保持既有的 `failed` + `Stopped by user` 约定。

日频 checkpoint 继续使用单文件 `aresvision_earth_forecast_checkpoint_v1`，三小时使用独立的 `aresvision_earth_forecast_checkpoint_3hourly_v1`；均包含 `model_state_dict`、`model_config`、`dataset_binding`、`training_contract`、`normalization`、`run`、`metrics`，只保存张量与 `weights_only=True` 可读的普通类型。加载校验 dataset_id 与时间契约，不能跨日频/三小时绑定。

## 日频历史预测

### `GET /api/earth/predict/context?training_task_id=<id>`（需认证）

返回可选预测起点与已训练信息：

```json
{
  "planet": "earth",
  "task_id": 25,
  "dataset_id": "earth_merra2_daily_v2",
  "dataset_version": "v2",
  "dataset_fingerprint": "8871…ea01",
  "target": "TO3",
  "target_unit": "DU",
  "window": 7,
  "horizon": 3,
  "input_channel_order": ["TO3", "U10M", "V10M", "T2M", "SWGDN"],
  "input_units": ["DU", "m s-1", "m s-1", "K", "W m-2"],
  "grid": {"shape": [36, 72], "latitude": ["…36 个中心纬度…"], "longitude": ["…72 个中心经度…"]},
  "origins": {
    "start": "2020-01-07", "end": "2021-12-28", "count": 722,
    "dates": ["…722 个可选日期…"], "window": 7, "horizon": 3,
    "input_offset_days": -6, "target_offset_days": 1
  },
  "training_split_end": "2020-12-31",
  "metrics": {"schema": "earth_training_metrics_v1", "unit": "DU", "aggregation": "…", "splits": {"…": "…"}},
  "run": {"best_epoch": 1, "epochs_completed": 1, "seed": 11, "device": "cpu", "linear_hidden_layers": 2},
  "model": {
    "model_source": "uploaded",
    "model_architecture": "uploaded",
    "uploaded_model_id": "<UserModelPackage.id>",
    "uploaded_model_name": "EarthConvBaseline",
    "uploaded_model_version": 3,
    "uploaded_model_content_hash": "<sha256>",
    "uploaded_model_source_embedded": true
  },
  "warnings": []
}
```

起点合法条件：起点当天计入输入窗口，输入索引为 `[origin-6 … origin]`，之后还要有 3 个已发布参考日。因此可选范围是 **2020-01-07 … 2021-12-28**（731 日轴上索引 6…727），共 722 个起点。首日起点 `2020-01-07` 的输入日期是 `2020-01-01 … 2020-01-07`，目标日期是 `2020-01-08 … 2020-01-10`。

### `POST /api/earth/predict/run`（需认证）

```json
{"training_task_id": 25, "forecast_origin": "2021-07-08"}
```

响应要点：

- `forecast_origin`、`origin_split`（`train` / `validation` / `test`）、`input_dates`（7 天，`origin-6 … origin`）、`target_dates`（`origin+1 … origin+3`）
- `grid`：真实 36×72 中心经纬、范围、步长、`coverage`、`wrap_longitude`
- `prediction` / `reference` / `residual`：各 3 天，每天 `{field: [36][72], minVal, maxVal, valid_cells}`，单位 DU；`residual = prediction − reference`
- `metrics`：`unit=DU`、`target=TO3`、`aggregation=user_forecast_origin_lead_grid_uniform`、`reference_available=true`、`overall{rmse,mae}` 与 `by_lead[{lead_day,rmse,mae}]`
- `dataset_id` / `dataset_version` / `dataset_fingerprint` / `input_channel_order`，供前端缓存键区分身份
- `model`：本次预测所用模型身份。官方为 `model_source=official`、`model_architecture=dlinear`；上传模型额外给出 `uploaded_model_id` / `uploaded_model_name` / `uploaded_model_version` / `uploaded_model_content_hash` / `uploaded_model_source_embedded`，界面据此显示模型名称、版本与内容指纹前缀
- `warnings`：重建期间原文件缺失或被改动等提示（例如 "the original uploaded model file is unavailable; prediction uses the verified copy stored inside the checkpoint"）。出现警告不影响预测结果，它说明代码取自 checkpoint 内嵌的哈希校验副本

参考场取自同一发布数据集的对应日期，因此指标是**有真值的历史回测**，不是无真值外推。指标在当前 3 天窗口内按「起点 × 提前量 × 格点」等权聚合，不代表独立日样本数。

预测不写入后端持久化缓存，也不进入火星预测缓存。

## 三小时历史回测

同一 `GET /api/earth/predict/context` 和 `POST /api/earth/predict/run` 按已完成任务的 `dataset_id=earth_merra2_3hourly_v1` 选择三小时分支。`forecast_origin` 使用明确 UTC 的 ISO datetime，例如 `2021-07-08T01:30:00Z`；输入包含起点共 56 步，目标共 24 步，从 `2021-07-08T04:30:00Z` 到 `2021-07-11T01:30:00Z`。

context 返回 datetime 可选范围、数量、完整时间戳数组和 hour/step=3；完整两年发布有 5769 个有效起点。结果返回 `input_timestamps`、`target_timestamps`，预测/参考/残差各 `[24,240,480]`、单位 DU；`input_dates` / `target_dates` 在三小时响应中为相同时间戳的兼容别名。指标为总体 RMSE/MAE、24 个 lead step（+3…+72 小时）和累计前 +24/+48/+72 小时汇总。参考场来自相同 fingerprint 的真实发布，不重新拟合 normalization。

任务、checkpoint、数据发布、时间规则、窗口和网格均严格一致后才读取缓存。三小时有独立的进程内 LRU（128 MiB、至多 4 条），键包含 planet、dataset_id/version/fingerprint、task_id、规范 origin、24 个 target timestamps 和 checkpoint SHA；缓存不会持久化，也不进入 Mars 或旧日频路径。训练页与预测页已提供三小时选项、UTC 起点和 24 个 lead 展示。完整 API 示例、错误码与验证命令见[三小时历史回测 API](earth-merra2-3hourly.md#三小时历史回测-api)。

预测参考场必须来自同一已绑定发布，当前只支持历史回测；无参考真值的未来外推未开放。三小时每次成功回测都序列化 prediction、reference、residual 三组 `[24,240,480]` 完整场。合成 smoke 的实际响应 JSON 约 157.5 MB，预测约 5.1 秒、采样 RSS 峰值约 1.75 GiB；这是该次运行的测量，不是容量保证。完整响应下载、JSON 解析和浏览器内存是高分辨率预测界面的性能限制；总览地图默认先降采样到 60×120，点位序列仍基于原生网格。

## 错误码

| 情形 | HTTP / code |
| --- | --- |
| 非 DLinear、未知架构、SPHERE、迁移学习 | 409 `dataset_training_configuration_not_supported` |
| `model_source=uploaded` 但缺少 `uploaded_model_id` | 422 `invalid_earth_training_parameters` |
| `model_source=official` 却传了 `uploaded_model_id` | 422 `invalid_earth_training_parameters` |
| 上传模型不存在 / 不属于当前账号 | 404 `uploaded_model_not_found` |
| 上传包校验状态不是 valid | 422 `uploaded_model_invalid` |
| 上传模型未声明 `earth_merra2`、要求 Ls / 地形、网格或输出形状不符 | 422 `uploaded_model_not_earth_compatible`（message 含具体原因） |
| 上传文件在任务创建后消失，且 checkpoint 无内嵌副本 | 409 `uploaded_model_missing` |
| 上传文件在任务创建后被改动，且 checkpoint 无内嵌副本 | 409 `uploaded_model_tampered` |
| 窗口/通道/范围/类型/未知字段错误 | 422 `invalid_earth_training_parameters` |
| 客户端提交 `dataset_version` / `dataset_fingerprint` / `dataset_identity_status` / `dataset_snapshot` | 400 `client_identity_not_allowed` |
| 发布包缺失、哈希不符、内容非法（数据读取/创建训练） | 503 `dataset_unavailable`（附 `availability_reason`）；已绑定三小时回测复核返回下列 409 |
| checkpoint 缺失、损坏、与任务身份不符 | 409 `invalid_earth_training_artifact` |
| 数据集发布指纹变化 | 409 `dataset_version_changed` |
| 三小时回测绑定发布缺失、损坏，或时间/网格/版本与绑定不一致 | 409 `dataset_version_changed` |
| 三小时回测选中通道或 TO3 参考场缺测/不可读取 | 503 `earth_prediction_data_unavailable`；包读取权限导致无法验证为 503 `dataset_unavailable` |
| 任务未成功完成 | 409 `earth_prediction_task_not_completed` |
| 预测起点不在数据集内、缺少完整输入或参考时间步 | 422 `earth_prediction_origin_out_of_range` |
| 起点格式非法 | 422 `invalid_earth_prediction_origin` |
| Earth 任务进入火星推理 / metrics / 比较 / PFI / `action=test` | 409 `dataset_prediction_not_supported` |
| 火星迁移选择 Earth 来源任务 | 409 `dataset_transfer_not_supported` |
| 非本人且非管理员访问任务 | 403；任务不存在 404 |

## 场景隔离

- `services/dataset_identity.py` 的 `is_earth_training_task()` 是轻量识别函数（优先读任务身份列，其次读合法 legacy key；损坏身份按非 Earth 处理，保持旧 Mars 行为）。
- 火星推理的所有入口（`predict_task`、metrics/comparison/error-distribution/PFI、`get_test_results`）在**用户访问检查之后、火星数据准备与缓存访问之前**调用 `require_mars_prediction_task()`，拒绝 Earth 任务。
- 火星 `action=test` 在构造推理数据环境之前拒绝。
- 火星迁移在读取来源任务后、加载权重前拒绝 Earth 来源。
- 上传权重校验识别日频 `aresvision_earth_forecast_checkpoint_v1` 和三小时 `aresvision_earth_forecast_checkpoint_3hourly_v1`，返回明确不兼容并记录为 `invalid`，不会抽取其 `state_dict` 冒充火星权重。
- 前端缓存键包含 `planet`、数据集 ID/版本/指纹、任务与预测起点，并带 `mode:earth` 前缀，与火星键互不命中；切换任务或起点会清空旧结果。

## 前端

- 训练页「数据集」分区包含两个火星身份和两个 Earth 发布 ID；默认 Earth 入口读取 catalog 的 `default_earth_dataset_id`。日频为 7/3；三小时显示 UTC、240×480 和 56/24，允许官方 DLinear 或独立契约上传模型，并提供专用模板、自定义参数和 dataset_id 兼容性状态。Earth 与火星草稿隔离，任务各用自己的时间轴与窗口。
- Earth 的「模型」分区提供**官方 DLinear / 用户上传模型**两个来源。选官方时只显示固定架构说明；选上传时复用同一套上传卡片（上传、模板/说明下载、重新校验、删除、自定义参数入口），选中后向 `GET /api/user-models/{id}/earth-compatibility` 取回服务端 Earth 兼容性结论：**未取到结论一律按不可用处理**，不兼容时在区内显示具体原因并禁用「开始实验」，检查器同步列出阻塞项。
- Earth + 上传模型的请求只发送模型 ID 与自定义参数值；版本、内容哈希与数据快照由服务端固定，前端不生成也不接受。
- 地球数据集分区显示当前发布的频率、网格、变量、单位与窗口契约；发布日期划分和发布指纹仍由服务端在创建任务时校验并绑定。数据不可用时会在就绪检查里给出阻塞原因并禁用「开始实验」，三小时任务固定展示 56→24 和 240×480。
- 预测页「地球历史预测」按已完成任务的数据集身份选择日频日期或 UTC 三小时起点，使用相应 checkpoint 和窗口；展示预测/参考/残差场（DU）、逐步与按天/时段指标。地球任务不进入 Earth/Mars 混合比较、火星推理或迁移学习。窗口不兼容的三小时上传模型在任务创建前被拒绝；日频上传模型只按原 Earth 兼容协议处理。
- 生产站点使用 `frontend/dist`，前端源码修改后必须在 `frontend/` 执行 `npm run build`。

## 验证入口

后端从 `AresVision_backend/backend/` 执行，使用 `AresVision` conda 环境，并为 Windows NetCDF 测试指定新的纯英文临时目录：

```powershell
$earthTrainingTemp = Join-Path 'D:\_Aresvision' ('.earth-training-test-' + [guid]::NewGuid().ToString('N'))
conda run -n AresVision python -m pytest `
  tests/test_earth_training_contract.py tests/test_earth_training_data.py `
  tests/test_earth_dlinear.py tests/test_earth_training_artifact.py `
  tests/test_earth_training_runner.py tests/test_earth_training_service.py `
  tests/test_earth_training_isolation.py tests/test_earth_prediction_service.py `
  tests/test_earth_prediction_routes.py `
  -q --basetemp "$earthTrainingTemp"
```

**请逐文件运行**：本仓库部分既有测试会替换 `sys.modules`（例如 `tests/test_training_model_zoo.py` 把 `database.models` 换成普通对象），同一进程内混跑会让后续文件的导入失败。这不是本功能引入的问题，按文件运行即可避免。

真实端到端验收（需要后端运行在 8000 端口）：

```powershell
conda run -n AresVision python scripts\audit\earth-training-acceptance.py
```

脚本只使用公开 HTTP 接口：登录 → 读目录 → 启动真实训练 → 轮询到结束 → 读可选起点 → 运行历史预测 → 校验三天 DU 场/日期/网格/指标 → 逐条验证错误码。

> 本机 `.env` 若保留了 `.env.example` 的占位 `TRAINING_PYTHON_PATH="C:\Path\To\Your\Environment\python.exe"`，训练子进程会以 `FileNotFoundError: [WinError 2]` 失败。请把该值改为真实解释器路径，或删除该行让 `config.TRAINING_PYTHON_PATH` 回退到当前解释器。

## 后续阶段

第四步及以后可直接读取 `aresvision_earth_forecast_checkpoint_v1`，用保存的 `model_config` / `input_channel_order` / `normalization` / grid / splits 重建模型。未来比较身份至少包含 `planet`、`dataset_id`、`version`、`fingerprint`、`target`、`horizon`、测试起点集合与指标 aggregation；持久性基线与无参考真值外推须复用同样窗口、目标日期与单位。
## 发布 split 与窗口边界

Earth 训练以发布 manifest 的连续区间为唯一 split 边界。train、validation 和 test 分别在自己的区间内独立生成窗口：日频 7→3 日，三小时 56→24 步，均不得跨越发布边界。三小时上传模型历史回测也要求完整 80 步在同一 split 内。日频与既有三小时官方模型历史范围保留，可从完整发布时间轴读取 origin 之前的输入和 origin 之后的参考值；所有分支返回 `origin_split`，不改变训练 split、归一化范围或重新按比例切分窗口。

Earth 请求中的 `train_ratio`、`validation_ratio`、`test_ratio` 仅作为历史兼容字段；服务端仍拒绝非默认值并返回 `422 invalid_earth_training_parameters`。新 checkpoint 保存 `split_policy=published_manifest_splits`、每个 split 的 `date_start`、`date_end` 和 `window_count`，预测时会校验这些范围及数据集 fingerprint。旧 checkpoint 没有该元数据时保持兼容读取，但新训练不会产生此类 artifact。
