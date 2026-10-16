# Earth 三小时 5° 训练数据集

`earth_merra2_3hourly_5deg_v1` 是独立的全球 **36×72、5°** 发布。它由已验证的 `earth_merra2_3hourly_v1`（240×480、0.75°）逐时间点做球面单元面积重叠加权得到。时间不聚合：2020–2021 的 5848 个三小时时间点、01:30 至 22:30 UTC 中心标签、时间边界、五变量单位与缺失掩码全部保留。任一有正重叠面积的源单元缺失会使目标单元缺失，不填零、不对残余有效面积重新归一化。

5° 格点中心为纬度 −87.5…87.5、经度 −177.5…177.5，单元边界覆盖全球。240/36 不是整数，构建器计算实际边界重叠；纬度权重为 `sin(north)-sin(south)`，经度权重为重叠角宽。该数据适合降低空间计算量，但不能保留原有小尺度结构；格点数减少约 44.44 倍不代表模型训练必然等比例加速。

## 构建与配置

工作目录为 `AresVision_backend/backend`，使用项目指定的 AresVision Conda 解释器。用外部目录变量指定源包与新包：

```powershell
# $sourceRelease / $lowresRelease 均为 Git checkout 外的完整绝对路径。
& 'D:\Anaconda\envs\AresVision\python.exe' scripts/build_earth_merra2_5deg.py `
  --source-dir $sourceRelease --output-dir $lowresRelease `
  --verification-cache $verificationCache
```

构建器先校验源发布，保留源发布 SHA-256、指纹、原始 SLV/RAD 清单和时间规则；新 manifest 具有独立 ID、数据文件 SHA-256 与发布指纹。全部变量按小块扫描。输出不覆盖已有目录；已有完整包只有与当前源发布指纹和网格一致且校验通过时才复用，损坏/中断产物保留并拒绝复用，需使用新目录。

后端 `.env` 设置 `ARESVISION_EARTH_MERRA2_3HOURLY_5DEG_DIR` 为新发布目录，默认位置为 `data/earth/merra2_3hourly_5deg_v1/`。该目录须包含 `manifest.json` 与 `earth_merra2_3hourly.nc`。缺包显示不可用，不代用原高分辨率包或日频包。默认数据总览仍使用原三小时 0.75° 发布；5° 条目仅开放训练、历史回测、模型比较和测试诊断，`capabilities.web_overview=false`。

## 训练与上传模型

训练页选择「地球 MERRA-2 · 3 小时 · 36 × 72（5°）」。官方 DLinear 和明确声明低分辨率契约的上传模型均使用完整全球窗口；不切成 24×48 块。新任务按原始 UTC 时间轴连续划分（默认 70/20/10），仅训练分区拟合归一化；窗口与目标不得跨分区，窗口/步长范围仍为 1–240，默认 56→24。目标为 TO3（DU），辅助通道依次为 U10M、V10M、T2M、SWGDN。

上传示例：[5° SimVP 模板](earth-3hourly-5deg-model-template.py)。独立声明：

- 数据集 key：`earth_merra2_3hourly_5deg_v1`
- schema：`aresvision_earth_3hourly_5deg_model_v1`
- `grid=[[36,72]]`、`spatial_tile_shape=[36,72]`
- 输入 `[B,window,C,36,72]`，输出 `[B,horizon,1,36,72]`，float32、同设备
- batch 1–64；上传探针默认 batch 1、优先 2→1，检查全部 16 种通道组合、梯度和 eval 样本独立性

其余 feed 字段与原三小时契约一致。每个上传文件只声明一个三小时空间 feed。旧 24×48/v2 240×480 模型需要修改声明与实现，再上传或校验为新模型；已有高分辨率任务/产物不迁移，跨分辨率模型不能混合比较。

可选 `derived_inputs.ls` 仍按真实窗口 UTC 时间计算。`topography` 使用独立的 `earth_etopo2022_surface_5deg.nc`，按新发布的实际坐标与 cell bounds 从 ETOPO/GSHHG 原始源重新构建；运行时严格校验资产/网格身份，张量为 `[B,1,36,72]`，单位米，不随时间复制为数据通道。默认资产在 `data/assets/`，可通过 `ARESVISION_EARTH_TOPOGRAPHY_5DEG_PATH` 指定。构建方式见 [地形专题](earth-topography-asset.md)，传 `--target-release $lowresRelease/earth_merra2_3hourly.nc --output data/assets/earth_etopo2022_surface_5deg.nc`。不声明地形的模型不依赖该资产。

checkpoint 冻结新发布身份、36×72 网格、窗口、通道、task split 与归一化；完整测试集指标、回测和 PFI 使用 5° 单元球面面积权重。缓存按数据指纹和布局隔离，高分辨率缓存不能复用到本数据集。

## 验证范围

`tests/test_earth_5deg_dataset.py` 覆盖非整数比例重网格、独立单元权重对照、面积均值守恒、缺失传播、发布与缓存证明复用，以及官方/上传地形模型的真实优化、严格 checkpoint 重载、历史预测和诊断。前端 `earth5Degree.test.js` 验证数据集选择、窗口/通道请求和空间契约隔离。生成完整两年发布与短训练验证不代表长期收敛或科学预测精度。

2026-10-16 本机已构建完整两年发布（NetCDF 215,388,392 字节，dataset fingerprint `d685ebc990dc82c31410156e9a0666d055950928ca65df4ab10d88c0181fd9a1`），五变量缺失率均为 0；另独立抽查 3 个时间点 × 9 格 × 5 变量共 135 个值及全球面积均值，最大单格绝对存储误差为 2.81×10⁻⁵，最大面积均值误差为 2.43×10⁻⁷。真实两年五通道 DLinear 使用 7→1、batch 32、1 epoch CPU 完成训练、严格重载、末时刻历史回测与抽样诊断/PFI；其作用是验证链路，不作为精度结论。相关后端两组回归分别通过 236 与 178 项，新增队列恢复与下载模板隔离校验用例另通过；前端相关 72 项及生产构建通过。旧日频 `test_earth_training_artifact.py` 的 40 项在当前分支基线仍因 `dataset_retired` 失败，本次没有重新开放日频入口。
