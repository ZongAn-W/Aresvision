# Earth 三小时训练准备缓存

三小时训练的准备阶段由后端和训练子进程共同使用内容寻址的证明文件。验证证明绑定发布 manifest 的 SHA、NetCDF 数据 SHA、数据 fingerprint、源文件身份和验证器版本；命中前仍读取并核对 manifest、文件大小和身份，`force_full` 可要求重新执行完整 SHA-256 与科学契约扫描。源包改变、证明损坏或版本过期会回退到完整校验。

归一化只扫描任务 train 的连续 UTC 时间步，使用 `per_channel_standard`、ddof=0 和 float64 合并矩；验证集、测试集和预测不能影响统计量。统计量 JSON 的身份包括数据 fingerprint、源文件身份、train 起止时间/步数、输入通道顺序和方法版本。任务返回值重新带回当前冻结划分，统计量内容本身不把 validation/test 边界混入复用键。

训练缓存的身份包括数据 fingerprint、通道顺序、归一化内容、逻辑/物理 shape、`earth_full_grid_v1` 或 `earth_spatial_tiles_v1` 布局以及缓存版本。模型架构、学习率、batch、epoch、窗口读取方式不影响已经归一化的全时间轴字节；如果实际 train 边界或通道改变，身份改变并重新准备。

写入由 `filelock` 跨进程协调：先在隐藏临时目录生成 `.npy`，刷新并计算 SHA-256，写入带完整性摘要的 metadata，最后通过 `os.replace` 发布确定性目录。读者只接受 `ready`、身份一致、shape/dtype/文件大小正确且 payload SHA 匹配的缓存；发布前后的源包和映射文件身份都要再次核对。中断目录、损坏数组、旧版本和身份不匹配缓存继续保留供诊断，不批量删除。已有 v1 全图/分块缓存首次被使用时会逐块对照源包认证，认证完成后才写入新证明。

本轮对完整五通道 5848 步发布包只运行准备，不启动模型或真实训练。实测记录：首次全图验证 179.72 s、train-only normalization 83.10 s、全图缓存生成与 SHA 88.90 s，总计 361.79 s；共享证明/统计量命中且已认证全图缓存的复用准备 9.78 s，其中缓存 SHA 9.67 s。首次生成分块缓存（验证证明和统计量已命中）为 156.05 s，其中生成及完整性处理 144.98 s。已有旧全图缓存的首次认证为 146.06 s。以上是本机文件系统准备耗时，不代表训练吞吐、收敛或精度加速。

验证入口包括 `tests/test_earth_verification_reuse.py`、`tests/test_earth_preparation_cache.py`、三小时数据/registry/全图/分块训练回归，以及 `scripts/benchmark_earth_preparation.py`。
