# 实验中心（`#/training`）· 大气实验控制台

本页说明模型训练页现在的承载方式：**实验中心 · Atmospheric Mission Control**。版式与交互对齐设计参照 `output/training-console-preview.html`；实验中心是现有训练能力的**前端重组**，页面地址、训练接口、任务数据结构、日志与轮询机制都没有改变。

相关入口：

- 训练任务与标签：[训练模型标签](training-model-tags.md)
- 自定义模型接入：[自定义模型接入说明](uploaded-model-training.md)
- 数据集身份：[数据集注册表](dataset-registry.md)
- 已训练模型预测：[README 的预测与缓存章节](../README.md#已训练模型预测与缓存)
- 地球训练计划（未开放）：[DLinear 地球训练接入实施方案](plans/2026-09-23-earth-dlinear-training.md)

## 1. 页面结构

```text
#/training
├── 页头：eyebrow + 标题（配置阶段为「新建实验」，其它阶段为「实验中心」）+ 实验目录开关 + 新建实验
├── 阶段指示：配置实验 → 训练监控 → 实验结果（不可点击）
└── 控制台网格
    ├── 左列：实验目录（position: sticky，默认收起）
    ├── 中列：配置画布 / 训练监控 / 实验结果
    └── 右列：配置检查器（position: sticky，仅配置阶段渲染）
底部：运行条（position: fixed，横跨浏览器，仅配置阶段渲染）
```

## 2. 列宽、默认状态与吸附

| 状态 | 网格 | 说明 |
| --- | --- | --- |
| 新建配置（默认） | `minmax(0, 1fr) 284px` | 目录**收起**，画布 + 检查器两列 |
| 展开目录（配置阶段） | `235px minmax(0, 1fr) 284px` | 点击页头「实验目录」后三列 |
| 监控 / 结果阶段 | `235px minmax(0, 1fr)` | 默认展开目录（主要靠它切换实验），无检查器 |
| ≤ 1180px（桌面） | `200px minmax(0, 1fr) 250px` | 侧栏收窄，仍保持三列 |
| ≤ 900px | `minmax(0, 1fr)` | 单列，侧栏取消 sticky |

- 桌面端外边距 28px、列间距 14px，工作区上限 1500px 居中；**1920px 下不再按视口比例放大侧栏**（目录保持 235px、检查器 284px，多出的宽度留给画布）。
- `--experiment-*` 设计参数放在 `:root`，因为运行条被 portal 到 `body`，必须能在页面容器之外解析这些变量。
- **默认收起目录**由阶段决定：`useState(isConfigure)` + `directoryTouchedRef`。用户点过开关后，本次会话的手动状态优先，阶段内重渲染、表单更新都不会重置它；切换目录也不会清空正在编辑的配置（配置工作区始终挂载，只用 `hidden` 隐藏）。

### 吸附与固定的三条规则

```css
@media (min-width: 901px) {
  .experiment-center-grid[data-directory='open'] .experiment-directory {
    position: sticky; top: 86px;
    max-height: calc(100dvh - 86px - 72px);   /* 扣除导航偏移与运行条净空 */
    overflow: hidden; display: flex; flex-direction: column; min-height: 0;
  }
  .experiment-inspector-panel {
    position: sticky; top: 86px;
    max-height: calc(100dvh - 86px - 72px);
    overflow-y: auto; overscroll-behavior: contain;
  }
}
.experiment-run-bar { position: fixed; right: 0; bottom: 0; left: 0; }
```

1. **中间画布不加 sticky**，它保持正常文档流（`position: relative` 只为内部装饰定位）。
2. **运行条用 `position: fixed` 并 portal 到 `document.body`**：`App.jsx` 的页面切换动画在外壳上写了 `transform`，带 transform 的祖先会成为 fixed 的包含块，挂在页面内部时运行条会随页面滚动而不是贴住视口。portal 只影响渲染位置，不改业务。
3. 页面底部按**实测运行条高度**预留空间（`paddingBottom: runBarHeight + 20`），滚到页尾时最后一个字段完整可见，不被底栏遮挡。

目录外框固定在视口中（`overflow: hidden` + flex 列），列表自己滚动（`.experiment-directory-list` 用 `flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain`）；内容少时不会人为撑出空长栏。

## 3. 配置画布

### 画布头部

可编辑的**实验名称**（`.experiment-canvas-name`，占位符为命名示例）+ 一行任务说明（`EXPERIMENT / 001 · 火星臭氧时空预测`）+ 右侧就绪胶囊。旧的「当前配置」大段摘要已删除：摘要集中在右侧检查器，底部只留一行运行摘要。

### 四个分区

| 编号 | 分区 | 内容 |
| --- | --- | --- |
| 01 | 任务定义 | **训练数据集与模型来源并排**（两列，各占一半宽度）；模型来源胶囊在模型块内 |
| 02 | 输入与预测 | 紧凑载荷条（`O₃ 基础输入` + U/V/D/S/T 胶囊 + `N / 5 个驱动`）+ 「输入序列 → 当前模型 → 输出序列」图示 |
| 03 | 训练参数 | WINDOW / HORIZON / EPOCHS / BATCH / LR 五列参数矩阵，等宽数值 + 量纲小字 |
| 04 | 专家参数 | 侧边页签（148px）+ 右侧真实字段 |

- 载荷条与图示随 Window、Horizon、模型来源与模型选择实时更新：图示标题显示上传模型文件名或官方架构标签，帧数与 `INPUT / N STEPS`、`O₃ / N STEPS` 跟随输入。
- 参数矩阵的辅助标识用 `WINDOW`、`BATCH`、`LR` 这类短码，界面不暴露 `windowValue`、`batchSize` 等内部变量名。
- 窄画布下（容器宽度不足）参数矩阵回落三列 / 两列 / 单列。

### 专家参数页签

页签集合**按模型来源决定**，不出现要求用户“去另一个地方”的空页签；权重上传属于迁移学习，不再单独占页签：

| 来源 | 页签 | 字段 |
| --- | --- | --- |
| 上传模型 | 自定义参数 / 训练策略 / 迁移学习 / 实验标签 | 自定义参数（`param_schema` 动态表单）、随机种子、早停轮数、启用开关 / 来源类型 / 来源任务 / 权重文件 / 冻结策略 / 微调学习率 / 严格匹配、`TagPicker` |
| 官方模型 | 模型结构 / 训练策略 / 迁移学习 / 实验标签 | ST-LSTM 层数、各层隐藏维度或当前架构的专属结构参数、随机种子、早停轮数、迁移与标签同上 |

页签面板渲染的是**真实对应字段**（切换后 `data-expert-panel` 与字段一起变化，不是只换标题）。页签状态由页面控制器持有（`expertTab` / `onExpertTabChange`），因此检查器的「编辑自定义参数」可以直接切页并聚焦第一个参数；表单状态全部来自控制器，切页签或收起目录都不会丢值。

## 4. 上传模型是主入口

| 情形 | 界面表现 |
| --- | --- |
| 默认 | `modelSource` 初始值就是 `uploaded`；**登出不会改回官方模型** |
| 账号没有上传模型 | 同一区域给出「上传 .py」、`该模型尚未选择` 说明、模板 / 说明下载与文件格式要求（折叠），区内 inline error 解释原因 |
| 已选择上传模型 | 紧凑卡片：`.PY` 标记、截断的文件名（`title` 给出全名）、`v版本 · N 个自定义参数 · M 个可训练`、校验状态；动作只有「替换文件」「编辑自定义参数」与次要的「管理上传模型」 |
| 管理上传模型（展开） | 全部模型列表（选择）、重新校验、替换、删除、文件格式要求、校验详情 |
| 校验失败 / 版本不匹配 | 区域内 `role="alert"` 的 inline error 逐条列出原因 |
| 没有有效上传模型 | 运行条「开始实验」保持 `disabled` + `aria-disabled="true"`，就绪状态显示「配置未完成」 |
| 自定义参数 | 继续由 `DynamicModelParamsForm` 按上传模型 `param_schema` 渲染；「编辑自定义参数」在检查器与画布都是一级操作 |

官方模型是次级兼容入口：切到官方模型后隐藏上传区域、显示紧凑架构选择器（当前值 + 展开模型库：搜索 + 家族筛选 + 全部 29 个架构）与 SPHERE 开关。

## 5. 配置检查器

检查器只做摘要，不复制整张表单（组件内不渲染任何 `input` / `select`）：

| 区块 | 内容 |
| --- | --- |
| 当前模型 | 文件名（官方模型为架构名）与来源行 `上传模型 · v1 · 可训练`；上传模型时提供「编辑自定义参数 (N)」 |
| 输入变量 | `O₃ + U + T` 与通道总数 |
| 就绪检查 | 逐项 ✓ / !：登录、实验名称、数据集、模型可用性、训练参数（迁移开启时追加来源）；未就绪时在下方列出具体问题 |
| 时序配置 | 窗口 → 步长、训练轮数 |
| 数据集 | 数据集名 + 「展开详细信息」（来源、自定义参数数量、迁移开关、上传模型数） |

**删除资源估算**：过去用 `window − horizon + 1` 推导“训练样本数”，那不是数据集长度。没有真实数据长度、切分与采样信息时不给样本数、显存或耗时。

## 6. 就绪状态：三处必须一致

```js
const readiness = useMemo(() => {
  const blockers = [];
  if (!user) blockers.push({ code: 'login', … });
  if (!customModelName.trim()) blockers.push({ code: 'name-missing', … });
  if (modelSource === 'uploaded' && !selectedUploadedModel) blockers.push({ code: 'model-missing', … });
  // …上传模型校验、自定义参数、脚本可用性、迁移来源
  return { canTrain: blockers.length === 0, blockers };
}, […]);
```

- **`canTrain`**：能否开始**真实训练**（登录 + 校验全过）。
- **`startDisabled`**：主按钮是否允许交互。访客必须可点（点了弹登录），因此两者是不同的问题。
- 检查器（`data-inspector-state`）、画布胶囊（`data-canvas-state`）、运行条（`data-run-state` + `data-run-interactive`）都读这一个 `readiness`，不会出现“列着错误却显示可以开始训练”。
- 修复前的问题：访客 + 缺名称时 `startDisabled === false` 被当成就绪信号，检查器显示绿色「可以开始训练」，同时下方又列出「登录后才可以开始实验 / 缺少实验名称 / 未选择上传模型」。

## 7. 底部运行条

- 桌面配置阶段：`position: fixed`，横跨浏览器；深色连续底栏 + 上方一条细边线；普通字号下约 63px。
- 结构：左侧状态（`配置就绪 / 配置未完成 / 登录后即可开始实验`）+ 单行摘要（`数据集 · 模型 · 输入 · 轮数`，超长用省略号截断，`title` 保留完整信息）；右侧唯一主按钮。
- 放大文字时允许换行变高（1.3 倍字号实测 66px），不裁掉内容；≤ 900px 回到普通流并整行显示。
- 「开始实验」调用页面控制器的 `handleStartTraining`，与改版前完全同一条链路：实验名唯一性 → 官方脚本可用性 → 上传模型校验与自定义参数 → 迁移来源 → `startTrainingTask(script, hyperparameters, name, dataSource, { modelSource, uploadedModelId, tagIds })`。运行条**不做任何自己的校验**。

## 8. 阶段与任务选择

| 阶段 | 进入条件 | 主要内容 |
| --- | --- | --- |
| 配置实验（configure） | 点击“新建实验”，或在目录中选择“返回实验目录”后重新配置 | 画布头部 + 01–04 分区 + 右侧检查器 + 底部运行条 |
| 训练监控（monitor） | 当前任务状态为 `pending` 或 `running` | 进度、Epoch、当前 Loss、ETA、Loss 曲线、终端式实时日志、停止训练、自动跟随状态 |
| 实验结果（result） | `completed`、`failed` 或已停止等其他终态 | 指标、失败/停止原因、折叠运行日志、完整参数与数据集身份、用于预测 / 去模型比较 / 复制配置 / 重命名 / 模型测试 / 删除 |

阶段由纯函数 `getExperimentStage({ activeTask, isCreating })`（[experimentCenterModel.js](../frontend/src/pages/ModelTrainingPage/experimentCenterModel.js)）推导：`isCreating` → configure；无活动任务 → configure；`pending`/`running` → monitor；其他 → result。

三个工作区容器**始终挂载**（`hidden` 隐藏），目录筛选、状态筛选、收起/展开目录与阶段切换都不会清空正在编辑的配置。

### 任务自动选中与抑制

`TrainingContext` 每 5 秒轮询任务列表，并用 `reconcileActiveTrainingTaskId(tasks, preferredTaskId, { suppressAutoSelect })` 决定当前任务：

- 刷新页面后，账号里运行中的实验仍会被自动选中并进入监控阶段（既有行为）。
- 用户点「新建实验」或「复制配置」进入配置阶段后，页面调用 `setSuppressAutoSelect(true)`：**轮询或目录重渲染都不会再把用户拽回监控阶段**。此前展开目录会立刻跳进监控，正是这个原因。
- 用户主动点击目录里的实验（`handleSelectTask`）或返回目录时解除抑制。

## 9. 现有能力如何迁移

| 原有能力 | 现在的位置 |
| --- | --- |
| 官方模型 / 上传模型切换 | 任务定义组的模型来源胶囊（上传模型默认、官方模型次级入口） |
| 上传模型列表、校验、重新校验、删除、替换、模板与说明下载 | 上传模型卡片 + 「管理上传模型」展开区（含区内 inline error） |
| 自定义模型参数动态表单与校验 | 专家参数「自定义参数」页签（检查器有一级入口） |
| 模型架构、SPHERE、结构参数 | 任务定义组的官方模型区域 + 专家参数「模型结构」页签 |
| 迁移学习、上传权重、冻结策略、微调学习率 | 专家参数「迁移学习」页签 |
| 训练标签与批量标签 | 专家参数「实验标签」页签；目录中的筛选、批量标签与标签管理 |
| 进度、Loss 曲线、日志与自动跟随 | 监控工作区（`TrainingProgressMonitor`、`LossEvolutionChart`、原日志面板样式） |
| 停止训练 | 监控工作区与目录中运行中实验行 |
| 重命名、删除、单任务模型测试 | 结果工作区 |
| 用于预测 | 结果工作区，继续使用 `TRAINING_TASK_HANDOFF_KEY` 与 `buildTrainingTaskHandoff` |
| 复制配置 | 结果工作区；只把已完成任务的配置写入新建实验表单，不自动开始训练 |

工作区组件、检查器与运行条都不调用 `startTrainingTask`、`fetchLogs`，也不创建 `setInterval` 或 WebSocket；训练提交、日志轮询与实时更新仍由 [ModelTrainingPage.jsx](../frontend/src/pages/ModelTrainingPage.jsx) 与 [TrainingContext.jsx](../frontend/src/contexts/TrainingContext.jsx) 持有。

实时日志仍是**终端式输出区域**：`role="log"`、等宽字体、行号 gutter、按级别着色、自动跟随与手动滚动暂停。它没有被静态图表替换，也没有引入浏览器内伪终端。

## 10. 结果动作的口径

- **用于预测**：仅当 `completed && model_available` 时出现，写入预测 handoff 并跳转 `#/predict?from=training`。
- **去模型比较**：同样只对 `completed && model_available` 开放，跳转 `#/predict?from=training&mode=trained_compare`；预测页没有批量预选协议，因此不写入任何选择结果。
- **复制配置**：读取任务完整训练配置载入新建实验表单，实验名加“副本”后缀并保证唯一，字段缺失时按 `warnings` 逐条提示，任何情况下都不会自动开始训练；上传模型实验会带回上传模型 ID、版本、名称与 `custom_model_params`（深拷贝，由现有参数表单按 schema 渲染）。
- **重命名 / 模型测试 / 删除**：复用页面既有处理函数，入口都在结果工作区。

### 复制配置覆盖的字段

| 分组 | 字段 |
| --- | --- |
| 命名与标签 | 任务名称（追加副本后缀并保证唯一）、标签 |
| 数据 | 训练数据集（`dataset_id`，兼容旧字段 `hyperparameters.training_dataset`） |
| 模型 | 模型来源、上传模型 ID 与版本、上传模型名称、模型架构、SPHERE |
| 上传模型参数 | `custom_model_params`（深拷贝；仅上传模型实验携带） |
| 输入 | 输入通道、输入窗口、预测步长 |
| 训练 | 训练轮次、批大小、学习率、随机种子、早停轮数 |
| 结构 | 循环网络的 `stlstm_hidden_dims`、非循环网络的专属结构参数 |
| 迁移 | 一律关闭，来源类型、来源任务、冻结策略、微调学习率回到默认值 |

### 失败与停止原因

后端把结果写在任务 `metrics` JSON 里：失败写 `error`，CUDA 显存不足额外写 `error_code: cuda_out_of_memory`，用户停止写 `note`，训练成功但没有有效权重写 `error: Invalid model artifact…`。`getExperimentFailureMessage(task)` 逐级解析并映射到可读原因与恢复建议，非法 JSON 与非法字段安全回退；结果工作区显示原因并提供默认折叠的“查看运行日志”（复用 `TrainingContext` 的 `logs`，不新增请求）。

## 11. 未开放的功能边界

- **没有后端实验实体。** 仍是 `ModelTrainingTask`、`TrainingModelTag`、`TrainingTaskTag`；没有新增数据库表、API 或训练字段。
- **没有配置草稿。** 表单只在页面内存，刷新即丢失；界面**没有**假的“保存草稿”按钮（设计参照里的草稿提示是概念稿演示）。
- **没有实验备注、独立收藏和实验组。**
- **没有自动实验结论。**
- **没有资源估算。** 见第 5 节。
- **个人上传数据仍不能直接作为训练数据。** 训练数据由服务器管理。
- **Earth 训练仍未开放。** 指定地球数据集返回 409。
- **没有跨实验批量重跑或多任务并行调度。**

## 12. 代码入口与验证

| 文件 | 责任 |
| --- | --- |
| [ExperimentCenterShell.jsx](../frontend/src/pages/ModelTrainingPage/ExperimentCenterShell.jsx) | 页头、阶段指示、控制台网格、目录默认折叠状态、运行条 portal 与底部空间预留 |
| [ExperimentDirectory.jsx](../frontend/src/pages/ModelTrainingPage/ExperimentDirectory.jsx) | 左侧目录、状态筛选与轻量实验行 |
| [ExperimentConfigWorkspace.jsx](../frontend/src/pages/ModelTrainingPage/ExperimentConfigWorkspace.jsx) | 画布头部、01–04 分区、载荷条与序列图示、参数矩阵、专家侧边页签 |
| [ExperimentConfigInspector.jsx](../frontend/src/pages/ModelTrainingPage/ExperimentConfigInspector.jsx) | 右侧简短摘要与就绪检查，纯展示 |
| [ExperimentRunBar.jsx](../frontend/src/pages/ModelTrainingPage/ExperimentRunBar.jsx) | fixed 运行条的状态、单行摘要与唯一主操作 |
| [ModelArchitectureSelector.jsx](../frontend/src/pages/ModelTrainingPage/ModelArchitectureSelector.jsx) | 官方架构紧凑选择器（当前值 + 搜索 + 家族筛选） |
| [UploadedModelPanel.jsx](../frontend/src/pages/ModelTrainingPage/UploadedModelPanel.jsx) | 上传模型紧凑卡片与可展开的管理区 |
| [ExperimentRunMonitor.jsx](../frontend/src/pages/ModelTrainingPage/ExperimentRunMonitor.jsx) | 进度、Loss、实时日志与停止训练 |
| [ExperimentResultPanel.jsx](../frontend/src/pages/ModelTrainingPage/ExperimentResultPanel.jsx) | 结果指标、失败原因、折叠日志与后续动作 |
| [ExperimentLogPanel.jsx](../frontend/src/pages/ModelTrainingPage/ExperimentLogPanel.jsx) | 只读终端式日志面板，不请求日志 |
| [experimentCenterModel.js](../frontend/src/pages/ModelTrainingPage/experimentCenterModel.js) | 阶段推导、摘要、指标解析、目录筛选、复制配置、失败原因与官方架构注册表 |
| [experimentCenter.css](../frontend/src/pages/ModelTrainingPage/experimentCenter.css) | 控制台网格、sticky 侧栏、fixed 运行条、画布分区与响应式规则 |
| [trainingTaskSelection.js](../frontend/src/contexts/trainingTaskSelection.js) | 当前任务推导与「新建配置期间不自动选中运行中任务」 |
| [trainingStatusMeta.js](../frontend/src/pages/ModelTrainingPage/trainingStatusMeta.js) | 训练状态配色与文案的单一来源 |

### 界面约定（改版时必须一起维护）

1. **只有一条提交路径。** 画布内不得出现第二个 `onStart`，运行条不得自己调用训练接口。
2. **侧栏 sticky、运行条 fixed + portal。** 不要给运行条套回页面外壳内，也不要给中间画布加 sticky。
3. **目录默认收起。** 默认值只在用户没动过开关时生效；不要用 `useEffect` 无条件覆盖用户选择。
4. **就绪状态只有一个来源。** 检查器 / 画布 / 运行条都读 `readiness`，不要各自判断 `startDisabled`。
5. **字段栅格用 `minmax(min(240px, 100%), 1fr)`**，`--experiment-*` 设计参数放 `:root`（运行条在 body 上）。
6. **官方架构清单只改一处**：`experimentCenterModel.js` 的 `ARCHITECTURE_LABELS` 与 `trainingParamSanitizers.js` 的结构参数配置。

从 `frontend/` 执行：

```bash
node --test
npm run build
```

## 13. 既有浏览器验收记录（本轮未重复执行）

前次实现的验收记录记载：使用 Edge 无头浏览器（Chrome DevTools Protocol）对本地构建产物做了 **39 项控制台检查 + 22 项阶段检查，全部通过**，并保留截图对照设计参照（`shots/final/`：预览 1440/1920、真实页面默认两列 / 展开三列 / 滚动 600px / 页尾 / 1920 / 1024 / 390 / 字体放大 1.3 / 浅色英文）。

控制台检查（登录使用真实账号 + 真实上传模型，参数 schema 为 `probe_alpha` / `probe_ratio` / `probe_flag`）：

- 1440×900：默认两列 `1008px 284px` 且目录未渲染；检查器 284px、sticky；运行条 `fixed` 宽 1434px（等于视口）、高 63px；画布不是 sticky；无横向溢出；检查器无内部滚动条（655px 高）。
- 画布：可编辑实验名称存在；不再有重复的「当前配置」摘要；任务定义两列（478 / 478）；参数五列且辅助标识为 `WINDOW,HORIZON,EPOCHS,BATCH,LR`；专家参数侧边页签 `148px 816px`；载荷条与序列图示存在。
- 展开目录：`235px 759px 284px`，目录 235px、检查器 284px，两者 `sticky`，无横向溢出；滚动 600px 后两者 `top` 均为 **86px**，运行条仍 `bottom=900`（视口 900）。
- 页尾：可滚到 `892/892`，专家分区底边 639 在运行条上沿 837 之上（不被遮挡），运行条仍贴底。
- 1024×768：`200px 412px 250px` 三列、无横向溢出；390×844：单列、侧栏 `static`、运行条 `static`、上传入口与页签可用、主按钮 44px。
- 字体放大 1.3：运行条自适应到 66px、无横向溢出。

阶段检查（注入到本地库的 running / completed 任务走真实任务列表与日志接口）：

- 监控：`running` 任务进入监控阶段、目录默认展开，进度 42.5%，`role="log"` 终端日志 15 行含 epoch / loss 行与 warning 着色，自动跟随状态、停止按钮与 Loss 曲线齐备。
- 结果：`completed` 任务进入结果阶段，RMSE / MAE / MSE / R²、完整参数与数据集身份、折叠的「查看运行日志」（展开 21 行含评估行）都在。
- 复制配置：回到配置阶段并载入画布，实验名「副本 2」、Epochs 8，`probe_alpha=23 / probe_ratio=0.35 / probe_flag=true` 原样回填，检查器显示上传模型。

本轮修复的三个状态错误：

1. **访客 + 缺名称时检查器显示绿色「可以开始训练」**：`startDisabled` 为访客返回 false（为了允许点击登录）被当成就绪信号。现在由 `readiness.canTrain` 决定就绪，与按钮可点性分离，三处显示一致。
2. **检查器编造训练样本数**：删除按 `window − horizon + 1` 推导的资源估算区。
3. **展开目录把用户拽出配置阶段**：`TrainingContext` 的 5 秒轮询会在 `preferredTaskId` 为空时自动选中运行中的任务，用户点「新建实验」后目录重渲染即触发。现在新建配置期间抑制自动选中，用户主动选实验时解除。

另修复登出时把模型来源悄悄切回官方模型（此前访客永远看不到「上传模型」主入口）。

已知边界：账号里存在运行中的实验时，首次加载会自动进入监控阶段（既有行为），验收脚本因此等待配置阶段稳定后再检查配置项。验收用的临时账号、上传模型、任务与日志已由 `seed-probe-profile.mjs cleanup` 清理；运行训练子进程要求 `TRAINING_PYTHON_PATH` 指向真实解释器，仓库内 `.env` 默认仍是占位路径（不影响本页面的阶段推导与判定）。验收中没有启动真实训练。


## 14. 2026-09-27 布局与交互精修

- 页边距只由控制台容器提供：1440px 桌面两侧各 28px，去掉页面外层重复的 36px 内边距；标题改为局部标题样式，避免共享标题组件额外的 32px 留白。任务定义左右区域等高。
- 未选择上传模型时显示一次中性的上传指引；模型校验失败仍在上传区显示错误。新建画布不再展示固定的示例实验编号。
- 检查器过滤空白登录行，普通阻塞原因只展示一次，具体自定义字段错误仍保留。未登录或没有有效模型时，参数检查不会显示绿色通过。
- 画布和检查器的「编辑自定义参数」均切换页签、滚动并聚焦目标；导航上方留出滚动间距。
- 侧栏底部净空使用运行条的实测高度，桌面设置浮钮移到操作条上方，避免遮挡状态文本。
- 本轮只运行配置、检查器、外壳与日志面板的 52 项现有测试；其中旧的固定侧栏净空断言随实测高度规则更新后，该文件的 18 项复跑通过，其余测试首次通过。生产构建通过（仍有既有的大包体积提示）。1440px 浏览器确认两列画布、展开后 235px 目录与 284px 检查器、滚动吸附及全宽底部运行条；没有启动训练，也没有重跑上一节的全量阶段验收。
