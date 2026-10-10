# Earth 三小时上传模型 v1

需要一次输入完整全球图时使用独立的[全图 v2 说明与模板](earth-3hourly-fullgrid-model.md)。v1 仍固定 24×48；v2 固定 240×480、batch 1–64（默认 1，可运行大小取决于模型与显存），训练/预测/诊断按各自冻结契约运行，不把旧权重自动升级。

本模板仅适用于 `earth_merra2_3hourly_v1`，独立于日频 `earth_merra2` 声明及 Mars 模板。下载 [Python 模板](earth-3hourly-uploaded-model-template.py)，导出 `MODEL_SPEC` 和 `build_model(config)`。三小时声明的 schema 为 `aresvision_earth_3hourly_uploaded_model_v1`，声明字段必须完整、类型和值必须与模板一致；不接受旧 Earth 标签自动升级。

## 数据与调用

官方与上传模型共用反归一化 TO3 的六项评价指标及 v2 保存/完成门禁：MSE（DU²）、RMSE/MAE（DU）、R²（无量纲）、MAPE/SMAPE（%）。总体、每步和累计时段保持预测起点 × 提前步 × 格点等权；旧三小时 v1 checkpoint 保持只读兼容、缺项不补写。公式、单位和验证入口见[地球评价指标](earth-evaluation-metrics.md)。

服务端 registry 提供 UTC 三小时数据，任务配置输入/输出窗口（默认 56→24）和 240×480 全球网格。目标始终为 TO3（DU），辅助变量可选 U10M/V10M（`m s-1`）、T2M（K）、SWGDN（`W m-2`）。`input_channels/input_units/auxiliary_inputs` 声明的是支持的通道全集，训练请求可选任意辅助变量子集。

**全球网格不是单次模型调用的空间尺寸。** 训练和预测沿用服务端 24×48 不重叠空间分块，共 100 块，再拼成全球输出。块间没有 halo、坐标、经纬度、时间 embedding 或额外位置输入；需要跨块空间上下文的模型不适用本版本。

训练内部缓存按空间块连续存储，缓存物理布局不改变这里的 BTCHW float32 调用及完整空间覆盖。CUDA 加载使用页锁定内存和非阻塞传输，梯度有限性检查仍覆盖全部参数并保留异常拦截。布局、批量读取的身份复核和旧缓存兼容规则见[三小时训练缓存](earth-merra2-3hourly.md)。

| 项目 | 实际契约 |
| --- | --- |
| 调用 | `model(x)`，不传额外参数；返回单个 `torch.Tensor` |
| 输入 | `[B,window,C,24,48]`，BTCHW；`window` 为任务配置的 1–240 个三小时时间步，C 为 1 到 5 |
| 通道轴 | 轴 2；顺序为 TO3，然后按 U10M、V10M、T2M、SWGDN 顺序保留所选变量 |
| 输出 | `[B,horizon,1,24,48]`，轴 2 仅 TO3；`horizon` 为任务配置的 1–240 个三小时时间步 |
| 数值 | 输入和输出均为有限 float32；是按训练集统计量标准化后的数值，输出按保存的 TO3 统计量还原为 DU |
| 模型初始化 | dry-run、实际训练构建和 checkpoint 重建共用 CPU float32 初始化，转换模型浮点参数/缓冲区；runner 再迁移到所选 CPU/CUDA 设备 |
| 设备 | 输出必须与输入同设备，模型不得自行固定设备 |
| eval 批次 | 同一样本的预测不能依赖 batch 大小、其他样本、排列顺序或重复调用状态，eval 不能修改参数或缓冲区；训练模式可使用正常 BatchNorm，eval 使用其固定运行统计量 |
| 训练 | 必须有可训练参数；前向和 backward 必须成功并产生有限梯度 |
| 缺失 | 选中输入及 TO3 目标存在缺失时拒绝窗口/任务，不填零、不插值 |
| split | 新任务按完整原始 UTC 时间轴和请求比例连续划分；训练、验证、测试窗口及上传历史回测均不能跨任务分区；旧任务沿用 manifest |
| normalization | 仅当前任务 train 区间拟合人口均值/标准差，ddof=0、epsilon=1e-6；预测严格使用 checkpoint 保存值 |

`build_model(config)` 必须返回 `torch.nn.Module`。服务器传入：`dataset_id`、`contract_schema`、任务 `window/horizon`（默认 56/24）、`height=24`、`width=48`、`global_grid_shape=[240,480]`、`spatial_tile_shape=[24,48]`、`in_channels`、`selected_channels`（含 TO3）、`target_channel='TO3'`，以及校验后的自定义参数。参数 schema 沿用通用 int/float/bool/select 形式，但不得覆盖以上字段、dataset identity、路径、设备或 normalization。

禁止在 spec 或参数中指定数据目录、dataset version、fingerprint、snapshot。数据绑定由服务器创建；上传代码只处理给定张量。

## 校验和错误

上传沿用仓库的单文件大小、UTF-8、AST 导入/调用检查和隔离进程超时边界。该检查不是操作系统级不可信代码沙箱，部署时仍需遵循既有任务执行权限边界。

上传、重新校验及创建任务前的模型 dry-run 默认使用 120 秒隔离进程预算，可通过后端 `.env` 的 `USER_MODEL_VALIDATION_TIMEOUT_SECONDS` 设置正整数秒数；修改配置后重启后端。到期仍强制终止子进程，全部通道、前向、梯度及 eval 批次一致性检查保留。超时报告顶层 `code` 为 `uploaded_model_validation_timeout`，兼容性查询返回 `status=unknown`、`compatible=false` 和同一错误码，页面显示“校验超时，请重试”。上传包在重新校验成功前仍为 `validation_status=invalid`，禁止创建训练任务。旧报告只有 `User model validation timed out after ... seconds` 文本时也识别为超时，无需改写数据库。该预算不影响下文 checkpoint 完成门禁的独立 30 秒重载检查。

全图 v2 的实际任务配置检查使用通用预算与 `USER_MODEL_FULL_GRID_VALIDATION_TIMEOUT_SECONDS`（默认 300 秒）的较大值，v1 分块及 Mars 不改变预算。上传短窗口报告通过后仍需检查实际窗口、batch、通道和模型参数；启动超时表示当前配置尚未完成验证，不是模型已经证实不兼容。隔离进程先读取完整报告再等待退出，避免大报告堵塞 Windows 管道；无结果、异常退出和真正超时继续拒绝，详见[全图 v2](earth-3hourly-fullgrid-model.md)。

上传 dry-run 检查全部 16 种通道组合、B=1/2、eval 前向、train 前向及 backward。在 backward 前后均用固定的不同样本核对单独与合批、交换顺序、更换其他成员和重复调用的输出，覆盖 B=2/3/默认8，采用 float32 容差 `rtol=1e-5, atol=1e-5`。创建任务时还覆盖实际请求 batch size；重载时使用保存的 batch 配置。探针拒绝 eval 修改参数或缓冲区，并在结束时恢复原值与各模块模式。依赖 batch 均值、`BatchNorm(track_running_stats=False)`、首次调用校准或 eval 计数缓冲区的模型会被拒绝。创建任务前再次在隔离进程中检查实际所选通道和自定义参数。成功报告保存 `eval_batch_policy=earth_eval_sample_independent_v1`；旧报告没有该证据时显示 unknown，需要重新校验。有限探针不能证明任意源码对全部输入都独立，CPU dry-run 通过也不代表任意 GPU 资源预算或模型收敛已验收。

兼容性接口 `GET /api/user-models/{id}/earth-compatibility?dataset_id=earth_merra2_3hourly_v1` 返回具体数据集的 `status`、`compatible`、`code` 和 `reasons`：`available` 可用，`unavailable` 明确不兼容，`unknown` 未获得有效执行结论。未知、超时、失败均不能创建训练任务。日频的原接口默认值保留。

| 错误码 | 含义 |
| --- | --- |
| `uploaded_model_not_earth_3hourly_compatible` | 未声明本三小时 feed |
| `uploaded_model_contract_invalid` | spec、保留参数、保存配置或执行契约不合法 |
| `uploaded_model_compatibility_unknown` | 无有效结论或隔离进程异常退出 |
| `uploaded_model_validation_timeout` | 模型校验隔离进程超过配置时间上限；未知结论，可重新校验 |
| `uploaded_model_earth_3hourly_dry_run_failed` | 构建、输出类型/形状/有限性或梯度校验失败 |
| `invalid_earth_training_parameters` | 请求参数未通过 schema 或窗口范围与形状校验 |
| `uploaded_model_missing` / `uploaded_model_tampered` | 源码缺失或摘要不匹配 |
| `uploaded_model_invalid` | 上传包整体校验失败，不能进入训练 |
| `earth_prediction_origin_out_of_range` | 没有完整输入/真值或完整窗口跨 split |

模型工厂返回 double/half 浮点参数时，服务器在上述三处统一转为 float32；这不改变输出检查。返回形状不符、tuple/dict 输出、float64 输出、NaN/Inf、错误设备或无梯度仍拒绝。运行阶段也检查有限 float32 和输出形状。

## 任务与 Checkpoint

任务固定包 ID、版本、源码 SHA-256、自定义参数及服务器数据身份，重启队列后仍使用同一份源码。三小时 checkpoint schema 为 `aresvision_earth_forecast_checkpoint_3hourly_v1`；上传模型 implementation 为 `aresvision_earth_3hourly_uploaded_runner_v1`，同时保存独立模型契约版本、全球网格、空间块、通道/单位、步长、任务划分策略/请求比例/实际索引与 UTC 边界/步数及窗口数和 normalization；新策略缺失或不一致时拒绝，旧任务不迁移。

重载核对任务与数据集身份、嵌入源码摘要、声明、参数 schema 和 build config，再以 `strict=True` 加载 state dict，并对加载实际权重后的模型重复 eval 批次一致性检查。旧 checkpoint 不改写，但实际模型违反此检查时拒绝发布、诊断或回测。runner 在发布前检查重载与前向一致性；任务完成门禁另调度 30 秒超时的独立 CPU 进程复查权重及前向，超时或失败不能标记 completed。原源码文件不可用时使用摘要匹配的嵌入副本，并在预测 context 报告原文件状态。日频及 Mars checkpoint 不能通过三小时 schema/identity 检查。

实现与验收范围见 [三小时专题](earth-merra2-3hourly.md)。合成数据训练、回测 smoke 仅证明代码链路；完整真实包的只读检查不等同于真实数据训练、模型精度或真实任务历史回测验收。


## 任务级比例

上传模型和官方 DLinear 共用[任务级划分策略](earth-task-splits.md)。请求比例均为有限数值、大于 0 且总和为 1，默认 0.7/0.2/0.1；每区至少 window+horizon 步。数据身份仍绑定原发布，normalization 与缓存按数据、实际 train 区间、通道顺序及方法/布局版本共享；当前任务和 checkpoint 继续严格保存自己的完整划分。模型自定义参数、batch、学习率和轮次不改变全时间轴缓存内容。复用证明、完整性与失效规则见[训练准备缓存](earth-preparation-cache.md)。队列重启复用固定划分；多模型比较要求相同 test UTC 范围及窗口口径。
