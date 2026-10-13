# Earth 指标契约失败任务的显式恢复

本工具仅处理一种已知故障：三小时任务冻结 v2，但保存的完整运行实际采用 v3 球面面积加权，最后因 `Checkpoint metrics do not match the task's required metrics contract` 失败。它不是通用“标记成功”入口，不会修改 checkpoint、重训或迁移其他历史任务。普通任务创建、队列恢复和模型读取都继续严格匹配冻结版本；统计语义见[地球评价指标](earth-evaluation-metrics.md)。

## 恢复门禁

必须显式指定任务 ID 和 checkpoint SHA-256，任务须为已结束的 failed 三小时任务，失败码和原因必须精确匹配此故障。工具先只读加载原任务、权重和失败日志，验证原 v2 声明与冻结划分，再对**拟迁移为 v3 的任务副本**执行正常的严格 checkpoint 读取。不会修改权重或把 v3 名称改成 v2。

检查包括完整数据 snapshot/发布身份、任务 ID、通道、输入/输出窗口、所有规范化训练参数、种子和轮数、上传模型 ID/版本/参数 schema/自定义参数、冻结源码与磁盘源码的完整 SHA-256。必须是真正完整 v3 指标、面积加权 loss，并核对 validation/test 的物理 MSE 与标准化 loss 一致。原日志必须保留保存、训练完成和原失败证据。

随后重新完整校验发布 NetCDF 的 SHA-256、科学字段/掩码和 manifest，不使用共享验证证明跳过；核对任务冻结的时间轴/空间网格/数据分区、发布纬度 cell bounds，并按原任务 train 分区只读重新计算归一化。要求与 checkpoint 保存值相同。模型执行放在独立 CPU 子进程，包含 strict state-dict、保存 batch 下的 eval 独立性/状态不变与独立重建输出逐位一致检查。任意错误或超时均拒绝恢复，任务保持 failed。

## 备份、迁移与审计

验证通过后开启 SQLite `BEGIN IMMEDIATE`，逐字段确认原任务记录和证据未变化。通过单独的只读连接调用 **SQLite backup API**，保存一致数据库备份并检查 integrity 与原任务记录；原训练日志原样复制，不追加或覆盖。然后将完整原行、原失败 metrics、完整真实 checkpoint metrics、权重/源码/数据摘要、验证结果及迁移理由写入 `data/recovery/task_<id>_<operation_id>/recovery.json`。

只更新该行的冻结指标 schema/aggregation、恢复审计元数据、checkpoint metrics、`status=completed`、`progress=100` 和已结束进程的 `pid=NULL`。原 start/end time、loss history、epoch 与原权重路径保持不变。`_earth_metrics_recovery` 记录操作 ID、UTC 恢复时间、v2→v3、原失败原因与备份/审计位置。同一恢复不能对已 completed 的记录重复执行。目录中的 `database.sqlite3`、`original-training.log` 和 `recovery.json` 属于本机私有运行证据，不提交 Git。

## 执行

工作目录为 `AresVision_backend/backend`，使用部署中 `AresVision` conda 环境的 Python。先审计（默认只读）：

```powershell
& '<AresVision-conda-python.exe>' scripts/recover_earth_metrics_task.py --task-id <id> --checkpoint-sha256 <sha256>
```

显式写入时加 `--apply`；写入模式会重新执行完整只读验证后备份并迁移，不信任上一次审计结果。默认数据库为配置 DATA_DIR 下的 `aresvision.db`，默认发布目录来自 `ARESVISION_EARTH_MERRA2_3HOURLY_DIR`；独立副本可通过 `--database`、`--package-dir`、`--audit-root` 指定。不要对运行中的任务调用，也不要用恢复工具补造不完整指标。

实现：[恢复门禁与事务](../AresVision_backend/backend/services/earth_training_recovery.py)、[命令行入口](../AresVision_backend/backend/scripts/recover_earth_metrics_task.py)。合成回归入口为 `tests/test_earth_training_recovery.py`；契约链路回归为 `test_earth_metrics_execution_contract.py` 与 `test_earth_metrics_task_contract.py`。

## 验证记录

2026-10-12：任务 97 在只读审计与写入前重新验证中均通过完整发布 SHA-256/五变量科学扫描、冻结 snapshot/划分、train-only 归一化复算、模型源码与完整训练参数核对、完整 v3 指标检查，以及隔离 CPU 重载。随后使用 SQLite backup API 备份并显式迁移至 v3、恢复 completed/100%。metrics 从 checkpoint 完整恢复：test MSE 205.4837688613251 DU²、RMSE 14.334705049680133 DU、MAE 8.664098376107148 DU、R² 0.8733677032219733、MAPE 3.053440583958076%、SMAPE 3.0416285566414905%；validation/test 各 838 个窗口、20 个提前步和累计 24/48/60 小时指标全部保留。

恢复操作 ID 为 `c741088c-3897-4b71-acec-5ba513aae16d`；本机备份、原失败日志副本和审计位于后端 `data/recovery/task_97_<该操作ID>/`。恢复后对照备份确认其余 45 条任务逐字段未变，任务 97 只改变 hyperparameters/status/metrics/pid/progress。原 start/end time、loss history、epoch 和权重路径保留，原失败原因保存在备份、原日志和 `_earth_metrics_recovery.original_failure`。权重 SHA-256 恢复前后均为 `6c271dfd2acd2aa1bcf50eb4a977c53149abd6f9a6f1de1227eb11595f808408`，正常任务匹配读取通过。

本轮已执行合成数据回归：v2/v3 实际优化及队列完成、严格产物匹配/拒绝、旧 v2 与 RMSE/MAE 旧产物读取、上传/全图执行、预测服务与路由、恢复门禁/隔离重载、SQLite backup 先于更新、备份失败回滚及验证后证据变化拒绝。恢复门禁测试还要求未经验证的身份和未知公开训练参数不能被默默忽略，已 completed 的任务不能重复迁移。既有日频契约测试中一条“自定义比例应被拒绝”断言与 HEAD 当前行为不符，未作为本轮通过范围；仓库整体 diff 检查还发现既有 `test_earth_3hourly_data_contract.py` 文件末尾空行，本次未改该文件。本次所改文件的 diff/空白和文档链接检查通过。

已有后端 `/health`、生产前端及 `/api/datasets` 代理只读检查均返回 200。未重新训练或改动真实权重/数据，不声称执行全量仓库测试、浏览器端到端联调、重新计算真实测试预测或独立模型精度验收；上述真实指标来自已经保存并严格核验的完整 checkpoint。

## 验证损失曲线补回

任务 97 的原 `loss_history.val` 为三个 null，并非没有运行验证：runner 输出 `Loss=... (area-weighted normalized MSE) Val Loss=...`，旧进度正则要求两项数值之间只有空白，因而只捕获 train、漏掉 validation。指标/状态恢复时按原要求保留了 loss history，因此该缺口也被保留。前端读取 `loss_history.val` 绘图，不会从最终 checkpoint 指标推导每轮 loss。

2026-10-12 修复日志解析器，兼容面积加权/等权说明标签、无标签旧日志和科学计数法；重放已有 epoch 时也能填回缺失验证值。随后从原训练日志核实三轮 train 与已存值完全一致，最终 val 与 checkpoint `final_validation_loss` 在日志六位小数精度内一致，使用 SQLite backup API 再备份后**仅更新任务 97 的 loss_history**：train `[0.131582,0.081624,0.07643]`，val `[0.067518,0.061179,0.060203]`。未修改权重、原日志、指标、状态、训练时间或其他 45 条任务。后续补回操作 ID 为 `3602b37e-7e0c-4a2d-aa70-2b4da70cb1be`，备份与审计保存在后端 `data/recovery/task_97_loss_history_<该操作ID>/`，原指标恢复审计仍保留。解析回归入口为 `tests/test_training_progress_loss.py`；该文件与模型产物回归共 42 项通过，前端任务/曲线数据整理相关测试 47 项通过。本次未修改前端源码，无需重建生产前端；刷新训练页即可重新取得已补齐的历史值。
