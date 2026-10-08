# Earth 三小时上传模型 v1

本模板仅适用于 `earth_merra2_3hourly_v1`，独立于日频 `earth_merra2` 声明及 Mars 模板。下载 [Python 模板](earth-3hourly-uploaded-model-template.py)，导出 `MODEL_SPEC` 和 `build_model(config)`。三小时声明的 schema 为 `aresvision_earth_3hourly_uploaded_model_v1`，声明字段必须完整、类型和值必须与模板一致；不接受旧 Earth 标签自动升级。

## 数据与调用

服务端 registry 固定提供 UTC 三小时数据、56 步输入、24 步目标和 240×480 全球网格。目标始终为 TO3（DU），辅助变量可选 U10M/V10M（`m s-1`）、T2M（K）、SWGDN（`W m-2`）。`input_channels/input_units/auxiliary_inputs` 声明的是支持的通道全集，训练请求可选任意辅助变量子集。

**全球网格不是单次模型调用的空间尺寸。** 训练和预测沿用服务端 24×48 不重叠空间分块，共 100 块，再拼成全球输出。块间没有 halo、坐标、经纬度、时间 embedding 或额外位置输入；需要跨块空间上下文的模型不适用本版本。

| 项目 | 实际契约 |
| --- | --- |
| 调用 | `model(x)`，不传额外参数；返回单个 `torch.Tensor` |
| 输入 | `[B,window,C,24,48]`，BTCHW；`window` 为任务配置的 1–240 个三小时时间步，C 为 1 到 5 |
| 通道轴 | 轴 2；顺序为 TO3，然后按 U10M、V10M、T2M、SWGDN 顺序保留所选变量 |
| 输出 | `[B,horizon,1,24,48]`，轴 2 仅 TO3；`horizon` 为任务配置的 1–240 个三小时时间步 |
| 数值 | 输入和输出均为有限 float32；是按训练集统计量标准化后的数值，输出按保存的 TO3 统计量还原为 DU |
| 设备 | dry-run 在 CPU 执行；runner 将模型和输入移到所选 CPU/CUDA 设备，输出必须与输入同设备，模型不得自行固定设备 |
| 训练 | 必须有可训练参数；前向和 backward 必须成功并产生有限梯度 |
| 缺失 | 选中输入及 TO3 目标存在缺失时拒绝窗口/任务，不填零、不插值 |
| split | 沿用 manifest 固定分区；训练、验证、测试窗口及上传模型历史回测不能跨 split，窗口长度由任务配置决定 |
| normalization | 仅训练 split 拟合人口均值/标准差，ddof=0、epsilon=1e-6；预测严格使用 checkpoint 保存值 |

`build_model(config)` 必须返回 `torch.nn.Module`。服务器传入：`dataset_id`、`contract_schema`、`window=56`、`horizon=24`、`height=24`、`width=48`、`global_grid_shape=[240,480]`、`spatial_tile_shape=[24,48]`、`in_channels`、`selected_channels`（含 TO3）、`target_channel='TO3'`，以及校验后的自定义参数。参数 schema 沿用通用 int/float/bool/select 形式，但不得覆盖以上字段、dataset identity、路径、设备或 normalization。

禁止在 spec 或参数中指定数据目录、dataset version、fingerprint、snapshot。数据绑定由服务器创建；上传代码只处理给定张量。

## 校验和错误

上传沿用仓库的单文件大小、UTF-8、AST 导入/调用检查和隔离进程超时边界。该检查不是操作系统级不可信代码沙箱，部署时仍需遵循既有任务执行权限边界。

上传 dry-run 检查全部 16 种通道组合、B=1/2、eval 前向、train 前向及 backward。创建任务前再次在隔离进程中检查实际所选通道和自定义参数。CPU dry-run 通过不代表任意 GPU 资源预算或模型收敛已验收。

兼容性接口 `GET /api/user-models/{id}/earth-compatibility?dataset_id=earth_merra2_3hourly_v1` 返回具体数据集的 `status`、`compatible`、`code` 和 `reasons`：`available` 可用，`unavailable` 明确不兼容，`unknown` 未获得有效执行结论。未知、超时、失败均不能创建训练任务。日频的原接口默认值保留。

| 错误码 | 含义 |
| --- | --- |
| `uploaded_model_not_earth_3hourly_compatible` | 未声明本三小时 feed |
| `uploaded_model_contract_invalid` | spec、保留参数、保存配置或执行契约不合法 |
| `uploaded_model_compatibility_unknown` | 无有效结论、隔离进程超时或异常退出 |
| `uploaded_model_earth_3hourly_dry_run_failed` | 构建、输出类型/形状/有限性或梯度校验失败 |
| `invalid_earth_training_parameters` | 请求参数未通过 schema 或窗口范围与形状校验 |
| `uploaded_model_missing` / `uploaded_model_tampered` | 源码缺失或摘要不匹配 |
| `uploaded_model_invalid` | 上传包整体校验失败，不能进入训练 |
| `earth_prediction_origin_out_of_range` | 没有完整输入/真值或完整窗口跨 split |

返回形状不符、tuple/dict 输出、float64、NaN/Inf、错误设备或无梯度不会被自动转换或补齐。运行阶段也检查有限 float32 和输出形状。

## 任务与 Checkpoint

任务固定包 ID、版本、源码 SHA-256、自定义参数及服务器数据身份，重启队列后仍使用同一份源码。三小时 checkpoint schema 为 `aresvision_earth_forecast_checkpoint_3hourly_v1`；上传模型 implementation 为 `aresvision_earth_3hourly_uploaded_runner_v1`，同时保存独立模型契约版本、全球网格、空间块、通道/单位、步长、固定 split 和 normalization。

重载核对任务与数据集身份、嵌入源码摘要、声明、参数 schema 和 build config，再以 `strict=True` 加载 state dict。runner 在发布前检查重载与前向一致性；任务完成门禁另调度 30 秒超时的独立 CPU 进程复查权重及前向，超时或失败不能标记 completed。原源码文件不可用时使用摘要匹配的嵌入副本，并在预测 context 报告原文件状态。日频及 Mars checkpoint 不能通过三小时 schema/identity 检查。

实现与验收范围见 [三小时专题](earth-merra2-3hourly.md)。合成数据训练、回测 smoke 仅证明代码链路；完整真实包的只读检查不等同于真实数据训练、模型精度或真实任务历史回测验收。

