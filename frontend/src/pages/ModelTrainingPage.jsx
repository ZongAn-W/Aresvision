import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '../i18n';import { useSettings } from '../contexts/SettingsContext';
import { normalizeTrainingDefaults } from '../utils/trainingDefaults.js';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import {
  fetchScripts,
  startTrainingTask,
  stopTrainingTask,
  cancelTrainingTask,
  deleteTrainingTask,
  uploadUserModel,
  fetchUserModels,
  getUserModelDownloadUrl,
  revalidateUserModel,
  deleteUserModel,
  renameUserModel,
  downloadUserModel,
  uploadTrainingWeight,
  fetchTrainingWeights,
  deleteTrainingWeight,
  renameTrainingModel,
  createTrainingTag,
  fetchUploadedModelEarthCompatibility,
} from '../services/api';
import ConfirmDialog from '../components/ConfirmDialog';
import ModelTestModal from '../components/ModelTestModal';
import { useTraining } from '../contexts/TrainingContext';
import {
  buildTrainingHyperparameters,
  createDefaultArchitectureParamsByModel,
  getModelStructureConfig,
  getModelStructureParamLabel,
  getTransferFreezeModes,
  isRecurrentArchitecture,
  sanitizeTrainingDataset,
  TRAINING_DATASET_EARTH_MERRA2_V2,
  TRAINING_DATASET_MCD_OVERVIEW,
  TRAINING_DATASET_OPENMARS_MCD,
  sanitizeNonNegativeInteger,
  sanitizeDropout,
  sanitizePositiveInteger,
  sanitizePositiveNumber,
} from './ModelTrainingPage/trainingParamSanitizers';
import {
  EARTH_CHANNEL_META,
  EARTH_CHANNEL_ORDER,
  EARTH_HORIZON,
  EARTH_MODEL_ARCHITECTURE,
  EARTH_MODEL_SOURCE,
  EARTH_MODEL_SOURCE_OFFICIAL,
  EARTH_MODEL_SOURCE_UPLOADED,
  EARTH_OPTIONAL_CHANNELS,
  EARTH_WINDOW,
  buildEarthTrainingHyperparameters,
  EARTH_DEFAULT_SPLIT_RATIOS,
  normalizeEarthSplitRatios,
  captureTrainingDraft,
  getEarthUploadedSelectionBlocker,
  readEarthDatasetAvailability,
  readEarthUploadedModelCompatibility,
  resolveEarthTrainingRestore,
  resolveMarsTrainingRestore,
} from './ModelTrainingPage/earthTrainingConfig';
import { fetchDatasets } from '../services/datasets';
import {
  buildCustomModelParams,
  createDefaultCustomModelParams,
  validateCustomModelParams,
} from './ModelTrainingPage/uploadedModelParams';
import { getModelTrainingControlVisibility } from './ModelTrainingPage/modelTrainingVisibility';
import { formatBooleanHyperparameterValue } from './ModelTrainingPage/trainingHyperparameterFormatting';
import {
  TRAINING_TASK_HANDOFF_KEY,
  buildTrainingTaskHandoff,
} from './PredictPage/trainedModelSelection';
import {
  PREDICT_MODEL_MODE_COMPARE,
  buildPredictHash,
} from './PredictPage/predictModelModes';
import { createUserPredictScope } from '../stores/predictCache';
import { getTrainingRequestDataSource, getTrainingSourceLabel } from './ModelTrainingPage/trainingDataSource';
import {
  applyTransferStructureConfig,
  captureTransferStructureSnapshot,
  getAvailableTransferSourceTasks,
  hasTransferSourceTask,
  readTransferSourceTaskConfig,
} from './ModelTrainingPage/transferSourceConfig';
import RenameModelDialog from './ModelTrainingPage/RenameModelDialog';
import { normalizeTrainedModelName } from './ModelTrainingPage/trainedModelRename';
import { useTrainingTags } from '../components/TrainingTags/useTrainingTags';
import ExperimentCenterShell from './ModelTrainingPage/ExperimentCenterShell';
import ExperimentDirectory from './ModelTrainingPage/ExperimentDirectory';
import ExperimentConfigWorkspace from './ModelTrainingPage/ExperimentConfigWorkspace';
import ExperimentConfigInspector from './ModelTrainingPage/ExperimentConfigInspector';
import ExperimentRunBar from './ModelTrainingPage/ExperimentRunBar';
import ExperimentRunMonitor from './ModelTrainingPage/ExperimentRunMonitor';
import ExperimentResultPanel from './ModelTrainingPage/ExperimentResultPanel';
import {
  MODEL_ARCHITECTURES,
  canUseTaskForPrediction,
  cloneExperimentConfigValue,
  getExperimentArchitectureLabel,
  getExperimentStage,
  readExperimentConfig,
  resolveActiveTaskProgress,
} from './ModelTrainingPage/experimentCenterModel';
import './ModelTrainingPage/experimentCenter.css';

const UNIFIED_TRAINING_SCRIPT = 'demo3.py';
const OPEN_INTERVAL_FLOAT_FIELDS = new Set(['initial_history_weight', 'initial_translation_weight']);

function formatHyperValue(key, value, t) {
  if (Array.isArray(value)) return value.join(' / ');
  if (value && typeof value === 'object') return JSON.stringify(value);
  if (key === 'model_architecture') return getExperimentArchitectureLabel(value) || '--';
  if (key === 'learning_rate' && typeof value === 'number') return value.toFixed(5);
  if (key === 'early_stopping_patience' && value === 0) return t('modelTraining.hypers.disabled');
  if (typeof value === 'boolean') return formatBooleanHyperparameterValue(value, t);
  return value ?? '--';
}

function normalizeModelArchitecture(value) {
  const raw = String(value || '').trim().toLowerCase();
  const normalized = raw === 'predrnnv2_sphere' ? 'predrnnv2' : raw;
  return MODEL_ARCHITECTURES.some((item) => item.id === normalized) ? normalized : 'predrnnv2';
}

/**
 * 实验中心控制器。
 *
 * 这里是训练页唯一的业务状态持有者：TrainingContext 继续负责任务轮询、日志轮询
 * 和 WebSocket，本文件负责表单状态、训练提交、标签、重命名、删除和预测 handoff。
 * 三个工作区组件只接收数据和回调，不重复启动训练或日志请求。
 */
export default function ModelTrainingPage() {
  const t = useT();
  const { settings } = useSettings();
  const { user, openAuthModal } = useAuth();
  const { showToast } = useToast();
  const isLight = settings.theme === 'light';
  const isZh = settings.language !== 'en';
  const trainingDefaults = useMemo(
    () => normalizeTrainingDefaults(settings.trainingDefaults),
    [settings.trainingDefaults],
  );
  const structureLabelLanguage = isZh ? 'zh' : 'en';
  const locale = isZh ? 'zh-CN' : 'en-US';

  const {
    tasks,
    setTasks,
    tasksLoading,
    tasksError,
    setTasksError,
    activeTaskId,
    setActiveTaskId,
    setSuppressAutoSelect,
    progressData,
    logs,
    setLogs,
    loadTasks,
  } = useTraining();
  const tagState = useTrainingTags(loadTasks);
  const [view, setView] = useState('config');
  const viewChosenRef = useRef(false);
  const changeView = (nextView) => {
    viewChosenRef.current = true;
    setView(nextView);
  };
  const [newTaskTagIds, setNewTaskTagIds] = useState([]);
  useEffect(() => {
    if (!tagState.loading && !tagState.error) {
      setNewTaskTagIds(ids => ids.filter(id => tagState.tags.some(tag => tag.id === id)));
    }
  }, [tagState.tags, tagState.loading, tagState.error]);

  const [scriptsLoading, setScriptsLoading] = useState(false);
  const [scriptsError, setScriptsError] = useState('');
  const logContainerRef = useRef(null);
  const autoScrollRef = useRef(true);
  const [autoScrollPinned, setAutoScrollPinned] = useState(true);
  // 新建实验状态：让配置工作区优先于当前已完成/运行中任务。
  const [isCreating, setIsCreating] = useState(false);
  // 「复制配置」带回来的警告：载入成功但有字段缺失时提示用户先修正。
  const [copyConfigWarnings, setCopyConfigWarnings] = useState([]);
  // 数据集目录：训练数据集选项与 Earth 可用性都来自服务器 registry。
  const [datasetCatalog, setDatasetCatalog] = useState([]);
  const [datasetCatalogError, setDatasetCatalogError] = useState('');
  // 切到 Earth 前的火星表单快照：切回火星时恢复，避免丢失用户已经填好的配置。
  const marsSnapshotRef = useRef(null);
  // Earth 场景自己的草稿：在 Earth 上选的上传模型与自定义参数切回时也保留。
  const earthSnapshotRef = useRef(null);
  // 当前选中上传模型的 Earth 兼容性结论（来自服务端上传校验的 Earth dry-run）。
  const [earthUploadedStatus, setEarthUploadedStatus] = useState(null);
  const [earthUploadedLoading, setEarthUploadedLoading] = useState(false);

  const channelOrder = useMemo(() => ['U', 'V', 'D', 'S', 'T'], []);
  const channelMap = useMemo(
    () => ({
      U: { name: t('predict.variables.U_Wind'), short: 'U' },
      V: { name: t('predict.variables.V_Wind'), short: 'V' },
      D: { name: t('predict.variables.Dust_Optical_Depth'), short: 'D' },
      S: { name: t('predict.variables.Solar_Flux_DN'), short: 'S' },
      T: { name: t('predict.variables.Temperature'), short: 'T' },
    }),
    [t]
  );

  const copy = useMemo(
    () => ({
      trainingDataset: isZh ? '训练数据集' : 'Training dataset',
      datasetOpenMarsMcd: isZh ? 'OpenMARS + MCD 融合' : 'OpenMARS + MCD',
      datasetMcdOverview: isZh ? 'MCD 全量 MY24-MY35' : 'Full MCD MY24-MY35',
      datasetEarthMerra2V2: isZh ? '地球 MERRA-2 全球 5°' : 'Earth MERRA-2 global 5°',
      // 地球数据集不再渲染说明面板：发布日期划分、网格、通道单位与发布指纹都由
      // 服务端在创建任务时校验并绑定，这里只保留无法训练时的阻塞提示。
      earthUnavailableTitle: isZh ? '当前不可训练' : 'Not trainable right now',
      earthUnavailableFallback: isZh ? '数据集状态不可用。' : 'The dataset state is unavailable.',
      earthModelFixedNote: isZh
        ? 'Earth 官方模型固定为 DLinear（线性隐藏层数可在「超参数」里调整）。'
        : 'The official Earth model is fixed to DLinear; adjust the linear hidden layers under Hyperparameters.',
      earthUploadedCompatibleNote: isZh
        ? '该上传模型已通过 Earth 兼容性校验：接收过去 7 天 × 选中通道 × 36×72 输入，输出未来 3 天 TO3。训练时会固定当前模型版本与内容指纹。'
        : 'This uploaded model passed the Earth compatibility check: it accepts 7 days x selected channels x 36x72 and returns 3 days of TO3. The current version and content hash are pinned when training starts.',
      earthUploadedIncompatible: isZh
        ? '该上传模型不适用于 Earth 数据。'
        : 'This uploaded model is not compatible with Earth data.',
      earthCompatible: isZh ? 'Earth 兼容' : 'Earth compatible',
      earthIncompatible: isZh ? 'Earth 不兼容' : 'Not Earth compatible',
      earthCompatibilityChecking: isZh ? '正在检查 Earth 兼容性…' : 'Checking Earth compatibility…',
      earthCompatibilityFailed: isZh ? '无法读取 Earth 兼容性结论。' : 'Could not read the Earth compatibility result.',
      earthUploadedHelpTitle: isZh ? 'Earth 上传模型要求' : 'Earth uploaded model requirements',
      earthUploadedHelpItems: isZh
        ? '单个 .py 文件导出 MODEL_SPEC 与 build_model(config)；MODEL_SPEC.datasets 必须声明 earth_merra2；输入 [B,7,C,36,72]，输出 [B,3,1,36,72]；不得要求 Ls 或 MOLA 地形（火星专用）。'
        : 'One .py file exporting MODEL_SPEC and build_model(config); MODEL_SPEC.datasets must declare earth_merra2; input [B,7,C,36,72] and output [B,3,1,36,72]; it must not require Ls or MOLA topography (Mars-only).',
      earthBaseInput: isZh ? 'TO3（必选）' : 'TO3 (required)',
      earthWindowField: isZh ? '过去 7 天' : 'Past 7 days',
      earthHorizonField: isZh ? '未来 3 天' : 'Next 3 days',
      sourceDefault: getTrainingSourceLabel('default', { isZh }),
      sourceHintDefault: isZh
        ? '训练数据由管理员在服务器后台维护，普通用户不再切换自有融合数据。'
        : 'Training data is maintained by administrators on the server; user-managed fused datasets are no longer selectable here.',
      trainingPreset: isZh ? '训练预设' : 'Training preset',
      trainingSummary: isZh ? '配置摘要' : 'Configuration summary',
      configSummary: isZh ? '配置摘要' : 'Configuration summary',
      // 配置页顶部的「当前配置」一栏：随表单实时更新，替代原先的重复摘要卡片。
      summaryLabel: isZh ? '当前配置' : 'Current configuration',
      summaryHint: isZh ? '按下方的分组顺序填写；本行随修改实时更新' : 'Fill in the groups below; this line updates as you edit',
      channelCount: (count) => (isZh ? `已选 ${count} 个通道` : `${count} channel${count === 1 ? '' : 's'} selected`),
      advancedSettings: isZh ? '高级设置' : 'Advanced settings',
      advancedHint: isZh
        ? '迁移学习、随机种子、早停与模型结构参数。迁移来源任务选中后会同步并锁定结构。'
        : 'Transfer learning, seed, early stopping, and model-structure parameters. Selecting a source task syncs and locks the structure.',
      presetLoading: isZh ? '正在加载训练脚本...' : 'Loading training presets...',
      modelSource: isZh ? '模型来源' : 'Model source',
      modelSourceOfficial: isZh ? '官方模型' : 'Official model',
      modelSourceUploaded: isZh ? '上传模型' : 'Uploaded model',
      modelSourceOfficialHint: isZh
        ? '使用平台内置训练脚本和模型结构。'
        : 'Use the platform training script and built-in model architectures.',
      modelSourceUploadedHint: isZh
        ? '使用已通过校验的 Python 模型文件进行训练。'
        : 'Train with a validated Python model uploaded by your lab account.',
      modelSourceUploadedPrimaryHint: isZh
        ? '推荐：上传 .py 模型，由平台负责数据加载、训练循环与权重保存。'
        : 'Recommended: upload a .py model; the platform handles data loading, the training loop and weight saving.',
      // 上传模型主入口
      uploadedModelEntry: isZh ? '上传模型（主入口）' : 'Uploaded model (primary entry)',
      uploadedModelSelected: isZh ? '当前训练模型' : 'Model used for this run',
      uploadedModelSummaryLabel: isZh ? '上传模型概况' : 'Uploaded model overview',
      uploadedModelParamCount: (count) => (isZh ? `${count} 个自定义参数` : `${count} custom params`),
      uploadedModelListToggle: (count) => (isZh ? `全部上传模型（${count}）` : `All uploaded models (${count})`),
      uploadedModelReplace: isZh ? '上传模型' : 'Upload model',
      uploadedModelManage: isZh ? '管理模型' : 'Manage models',
      // 分组
      groupTask: isZh ? '任务定义' : 'Task definition',
      groupUploadedModel: isZh ? '上传模型（主入口）' : 'Uploaded model (primary entry)',
      groupOfficialModel: isZh ? '官方模型（兼容入口）' : 'Official model (compatible entry)',
      groupPayload: isZh ? '输入与预测' : 'Input and prediction',      groupExpert: isZh ? '超参数' : 'Hyperparameters',
      groupExpertHint: isZh
        ? '自定义模型参数、模型结构、训练策略、迁移学习、实验标签与上传权重都在这里；所有字段仍然可编辑。'
        : 'Custom model params, model structure, training strategy, transfer learning, tags and uploaded weights all live here; every field stays editable.',
      // 输入与预测
      payloadBaseTitle: isZh ? '臭氧 O₃ 基础输入与预测目标' : 'Ozone O₃ base input and prediction target',
      payloadBaseHint: isZh
        ? '始终参与训练，作为基础输入通道与预测目标，不可取消。'
        : 'Always included as the base input channel and the prediction target; it cannot be deselected.',
      payloadDriversTitle: isZh ? '可选驱动变量' : 'Optional driver variables',
      payloadNoDrivers: isZh ? '未选择驱动变量（仅 O₃ 基线）' : 'No drivers selected (O₃ baseline only)',
      parameterHintWindow: isZh ? '输入的历史时间步数' : 'History steps fed to the model',
      parameterHintHorizon: isZh ? '一次预测的输出步数' : 'Output steps produced per prediction',
      parameterHintEpochs: isZh ? '完整遍历训练集的次数' : 'Full passes over the training set',
      parameterHintBatch: isZh ? '单次前向的样本数，显存敏感' : 'Samples per forward pass; memory sensitive',
      parameterHintLearningRate: isZh ? '优化器步长' : 'Optimizer step size',
      sequenceInputLabel: isZh ? '输入序列 (Window)' : 'Input sequence (Window)',
      sequenceModelLabel: isZh ? '当前模型' : 'Current model',
      sequenceOutputLabel: isZh ? '输出序列 (Horizon)' : 'Output sequence (Horizon)',
      // 官方模型架构选择器
      architectureSearchLabel: isZh ? '搜索官方模型架构' : 'Search official architectures',
      architectureSearchPlaceholder: isZh ? '搜索架构名称，例如 SimVP / convlstm' : 'Search architecture, e.g. SimVP / convlstm',
      architectureFamilyLabel: isZh ? '模型家族筛选' : 'Filter by model family',
      architectureFamilyAll: isZh ? '全部家族' : 'All families',
      architectureEmpty: isZh ? '没有匹配的官方模型架构，请调整搜索或家族筛选。' : 'No architecture matches this search or family filter.',
      // 专家参数页签
      expertTabCustomParams: isZh ? '自定义模型参数' : 'Custom model params',
      expertTabArchitecture: isZh ? '模型结构' : 'Model structure',
      expertTabStrategy: isZh ? '训练策略' : 'Training strategy',
      expertTabTransfer: isZh ? '迁移学习' : 'Transfer learning',
      expertTabTags: isZh ? '实验标签' : 'Experiment tags',
      expertTabWeight: isZh ? '上传权重' : 'Uploaded weights',
      editCustomParams: isZh ? '编辑自定义参数' : 'Edit custom parameters',
      expertNeedsUploaded: isZh
        ? '自定义模型参数只在上传模型下可用。切换到上传模型并选择一个可训练模型即可编辑。'
        : 'Custom model parameters are only available for uploaded models. Switch to an uploaded model and pick a trainable one.',
      expertNeedsOfficial: isZh
        ? '模型结构与官方骨干只在官方模型下可用。切换到官方模型即可选择架构。'
        : 'Model structure and official backbones are only available for official models. Switch to an official model to choose an architecture.',
      expertArchitectureHint: isZh
        ? '当前训练使用官方模型：模型架构选择器在「任务定义」下的「官方模型」分组里，搜索与家族筛选都在那里。'
        : 'This run uses an official model: the architecture selector — with search and family filters — lives in the “Official model” group above.',
      expertTagsHint: isZh
        ? '标签用于在实验目录里分组与筛选；目录中还可以批量添加或移除标签。'
        : 'Tags group and filter experiments in the directory; bulk add and remove also live there.',
      expertTagsLabel: isZh ? '实验标签（可选）' : 'Experiment tags (optional)',
      expertWeightHint: isZh
        ? '上传 .pth/.pt 权重文件后可在迁移学习中使用；上传本身不会修改当前实验配置。'
        : 'Upload a .pth/.pt weight file to use it in transfer learning; uploading does not change this run by itself.',
      strategyStructureHint: isZh
        ? '结构参数只渲染当前架构的字段，选中迁移来源任务后会同步并锁定这些字段。'
        : 'Only the current architecture fields render here; selecting a transfer source syncs and locks them.',
      // 配置检查器
      inspectorTitle: isZh ? '配置检查器' : 'Configuration inspector',
      inspectorHint: '',
      inspectorReady: isZh ? '可以开始训练' : 'Ready to start',
      inspectorNotReady: isZh ? '还不能开始训练' : 'Not ready to start',
      inspectorModelSection: isZh ? '模型来源' : 'Model source',
      inspectorPayloadSection: isZh ? '输入载荷' : 'Input payload',
      inspectorRunSection: isZh ? '数据与训练规模' : 'Data and run size',
      inspectorEstimateSection: isZh ? '预计资源' : 'Estimated resources',
      inspectorEstimateHint: isZh
        ? '按输入窗口与批大小估算的单轮步数，不代表真实训练时长或显存占用。'
        : 'Per-epoch step counts estimated from window and batch size — not a runtime or VRAM prediction.',
      inspectorSampleEstimate: isZh ? '可用训练样本' : 'Training samples',
      inspectorStepsEstimate: isZh ? '每轮步数' : 'Steps per epoch',
      inspectorTotalSteps: isZh ? '总优化步数' : 'Total steps',
      inspectorBlockers: isZh ? '缺失或错误项' : 'Missing or invalid',
      inspectorNoBlockers: isZh ? '没有发现缺失项或错误项。' : 'No missing or invalid items found.',
      inspectorFile: isZh ? '文件名' : 'File name',
      inspectorModelVersion: isZh ? '版本' : 'Version',
      inspectorUploadedInvalid: isZh ? '未通过校验' : 'Not validated',
      inspectorMissingUploadedModel: isZh ? '未选择上传模型' : 'No uploaded model selected',
      inspectorCustomParamsInvalid: isZh ? '自定义参数需要修正' : 'Custom parameters need fixing',
      inspectorMissingName: isZh ? '缺少实验名称' : 'Experiment name is missing',
      inspectorLoginRequired: isZh ? '登录后才可以开始实验' : 'Sign in to start an experiment',
      inspectorDisplayName: isZh ? '展示名称' : 'Display name',
      inspectorFamily: isZh ? '模型家族' : 'Family',
      inspectorCandidates: isZh ? '可选数量' : 'Available',
      inspectorOpenArchitecture: isZh ? '选择官方架构' : 'Choose an official architecture',
      inspectorBaseInput: isZh ? '基础输入' : 'Base input',
      runBarReady: isZh ? '配置就绪' : 'Configuration ready',
      runBarNotReady: isZh ? '配置未完成' : 'Configuration incomplete',
      runBarHint: isZh ? '运行条与检查器随配置实时更新' : 'The run bar and inspector update as you edit',
      stopTrainingDisabledHint: isZh ? '训练进行中时在此停止' : 'Stop the run from here while it is active',

      // 控制台页头与画布头部
      canvasEyebrow: isZh ? 'Atmospheric mission control / 01' : 'Atmospheric mission control / 01',
      newExperimentTitle: isZh ? '新建实验' : 'New experiment',
      canvasDescription: isZh ? '从输入序列到预测场，配置你的下一次火星大气实验。' : 'From input sequence to predicted field — configure your next Mars atmosphere experiment.',
      canvasNameLabel: isZh ? '实验名称' : 'Experiment name',
      // 分区（画布四个部分：模型名称 → 数据集 → 模型 → 超参数）
      sectionName: isZh ? '模型名称' : 'Model name',
      sectionDataset: isZh ? '数据集' : 'Dataset',
      sectionModel: isZh ? '模型' : 'Model',
      sectionPayload: isZh ? '输入与预测' : 'Input and prediction',
      sectionTraining: isZh ? '训练参数' : 'Training parameters',
      sectionExpert: isZh ? '超参数' : 'Hyperparameters',
      // 参数矩阵辅助标识与量纲
      codeWindow: 'WINDOW',
      codeHorizon: 'HORIZON',
      codeEpochs: 'EPOCHS',
      codeBatch: 'BATCH',
      codeLr: 'LR',
      // 官方模型选择器（紧凑版）
      modelOfficialPickerTitle: isZh ? '官方模型架构' : 'Official architecture',
      modelPickerSearch: isZh ? '搜索模型或实验变体…' : 'Search models or variants…',
      modelPickerExpand: isZh ? '展开模型库' : 'Browse model library',
      modelPickerCollapse: isZh ? '收起模型库' : 'Collapse model library',
      // 载荷条与序列图示
      payloadDrivers: isZh ? '驱动变量' : 'Drivers',
      payloadCountLabel: (count, total) => (isZh ? `${count} / ${total} 个驱动` : `${count} / ${total} drivers`),
      // 检查器
      inspectorCurrentModel: isZh ? '当前模型 / CURRENT MODEL' : 'Current model',
      inspectorReadiness: isZh ? '就绪检查 / READINESS' : 'Readiness',
      checkName: isZh ? '实验名称可用' : 'Experiment name is set',
      checkNameMissing: isZh ? '实验名称待填写' : 'Experiment name is missing',
      checkDataset: isZh ? '数据集已选择' : 'Dataset selected',
      checkModelOfficialReady: isZh ? '官方模型结构可用' : 'Official architecture available',
      checkModelMissing: isZh ? '尚未选择可训练模型' : 'No trainable model selected',
      checkModelInvalid: isZh ? '模型未通过校验' : 'Model failed validation',
      checkParamsMissing: isZh ? '训练参数待填写' : 'Training parameters missing',
      checkParamsNeedLogin: isZh ? '登录后校验配置' : 'Sign in to validate the configuration',
      checkParamsNeedModel: isZh ? '选择有效模型后校验参数' : 'Select a valid model to validate parameters',
      uploadedModelEmptyTitle: isZh ? '添加你的训练模型' : 'Add your training model',
      uploadedModelEmptyHint: isZh ? '上传 .py 文件，或从模型列表选择已有版本。' : 'Upload a .py file or select an existing version from your models.',
      checkLogin: isZh ? '需要登录才能开始实验' : 'Sign in to start a run',
      checkTransferMissing: isZh ? '请选择迁移学习来源' : 'Select a transfer learning source',
      // 信息减法后的检查器：正常时一行结论，有问题时逐条原因 + 定位入口。
      inspectorAllClear: isZh ? '配置检查通过' : 'Configuration check passed',
      inspectorGoLogin: isZh ? '去登录' : 'Sign in',
      inspectorFixName: isZh ? '填写名称' : 'Set a name',
      inspectorFixParams: isZh ? '编辑参数' : 'Edit parameters',
      inspectorFixTransfer: isZh ? '选择来源' : 'Choose source',
      // 专家参数
      expertStructureTab: isZh ? '模型结构' : 'Model structure',
      expertStructureHint: isZh ? '结构参数按当前架构渲染，迁移来源锁定后会同步。' : 'Structure fields follow the current architecture and sync when a transfer source locks them.',
      expertCustomHint: isZh ? '这些参数来自上传模型的声明。' : 'These parameters come from the uploaded model declaration.',
      expertStrategyHint: isZh ? '随机种子与早停，用于复现与控制训练长度。' : 'Seed and early stopping for reproducibility and run length.',
      expertTransferHintLabel: isZh ? '从已完成任务或上传权重继续微调。' : 'Fine-tune from a completed task or an uploaded weight.',
      expertTagsHintLabel: isZh ? '标签用于在实验目录里分组与筛选。' : 'Tags group and filter experiments in the directory.',
      expertNoUploadedModel: isZh ? '还没有上传模型，先在「任务定义」里上传 .py 文件。' : 'No uploaded model yet — upload a .py file in “Task definition” first.',
      // 运行条
      runBarReadyToStart: isZh ? '配置就绪，可以开始实验' : 'Ready to start the run',
      runBarNeedsAttention: isZh ? '配置未完成，先处理检查器里的问题' : 'Configuration incomplete — resolve the inspector items',
      runBarGuest: isZh ? '登录后即可开始实验' : 'Sign in to start a run',
      uploadedModels: isZh ? '上传模型' : 'Uploaded models',
      uploadedModelsLabel: isZh ? '上传模型' : 'Uploaded model',
      officialLabel: isZh ? '官方模型' : 'Official model',
      uploadedModelsHint: isZh
        ? '上传、选择、重新校验或删除用于自定义训练的 Python 模型文件。'
        : 'Upload, select, revalidate, or remove Python model files for custom training.',
      uploadedModelsEmpty: isZh ? '还没有上传模型文件。' : 'No uploaded model files yet.',
      uploadModel: isZh ? '上传 .py' : 'Upload .py',
      downloadModelGuide: isZh ? '下载说明' : 'Guide',
      downloadModelTemplate: isZh ? '下载模板' : 'Template',
      uploadingModel: isZh ? '上传中...' : 'Uploading...',
      revalidateModel: isZh ? '重新校验' : 'Revalidate',
      deleteUploadedModel: isZh ? '删除' : 'Delete',
      downloadUploadedModel: isZh ? '下载源码' : 'Download source',
      renameUploadedModel: isZh ? '重命名' : 'Rename',
      uploadedModelName: isZh ? '自定义模型名称' : 'Custom model name',
      saveUploadedModelName: isZh ? '保存' : 'Save',
      cancelUploadedModelRename: isZh ? '取消' : 'Cancel',
      uploadedModelNameRequired: isZh ? '请输入模型名称（最多 120 个字符）。' : 'Enter a model name (up to 120 characters).',
      renameUploadedModelSuccess: isZh ? '自定义模型名称已更新' : 'Custom model name updated',
      uploadedModelValid: isZh ? '可训练' : 'Valid',
      uploadedModelInvalid: isZh ? '需修正' : 'Invalid',
      uploadedModelPending: isZh ? '校验中' : 'Pending',
      uploadedModelReady: isZh ? '该模型已通过校验，可以训练。' : 'This model is ready for training.',
      uploadedModelUnnamed: isZh ? '未命名模型' : 'Unnamed model',
      uploadedModelNoFilename: isZh ? '未知文件' : 'Unknown file',
      customModelParams: isZh ? '自定义模型参数' : 'Custom model params',
      customModelParamsEmpty: isZh
        ? '该模型没有声明额外参数。'
        : 'This model does not define additional parameters.',
      paramRangeHint: (min, max) => (isZh ? `范围 ${min} - ${max}` : `Range ${min} - ${max}`),
      paramMinHint: (min) => (isZh ? `最小值 ${min}` : `Min ${min}`),
      paramMaxHint: (max) => (isZh ? `最大值 ${max}` : `Max ${max}`),
      uploadModelSuccess: isZh ? '模型校验通过' : 'Model validation passed',
      uploadModelInvalid: isZh ? '模型校验失败' : 'Model validation failed',
      uploadModelError: isZh ? '模型上传失败' : 'Model upload failed',
      revalidateModelSuccess: isZh ? '模型已重新校验' : 'Model revalidated',
      deleteUploadedModelSuccess: isZh ? '上传模型已删除' : 'Uploaded model deleted',
      selectValidUploadedModel: isZh ? '请选择通过校验的上传模型。' : 'Select a valid uploaded model.',
      fixCustomModelParams: isZh ? '请修正自定义模型参数。' : 'Fix the custom model parameters.',
      presetUnavailable: isZh
        ? '当前通道组合暂无可用训练脚本。'
        : 'No training preset is available for the current channel selection.',
      presetError: isZh
        ? '训练脚本加载失败，请稍后重试。'
        : 'Training presets failed to load. Please try again later.',
      presetMatched: isZh ? '已匹配可用脚本' : 'Matched to an available script',
      selectionUnavailable: isZh ? '当前组合不可训练' : 'This selection cannot be trained',
      loginRequiredToUse: isZh ? '登录后才可使用' : 'Sign in to use this feature',
      currentSelection: isZh ? '当前选择' : 'Current selection',
      coreParameters: isZh ? '核心参数' : 'Core parameters',
      modelArchitecture: isZh ? '模型结构' : 'Model architecture',
      backboneModel: isZh ? '骨干模型' : 'Backbone model',
      architecturePredRnn: 'PredRNNv2',
      architecturePredRnnHint: isZh
        ? '使用所选通道和当前超参数训练该主干。'
        : 'Train this backbone with the selected channels and hyperparameters.',
      architectureSphereHint: isZh
        ? '独立 SPHERE 前端：为任意所选通道加入 Ls 相位调制特征，Dust 也支持。'
        : 'Independent SPHERE front-end: adds Ls phase-warped features for any selected channels, including Dust.',
      sphereToggle: isZh ? 'SPHERE 模块' : 'SPHERE module',
      enabled: isZh ? '开启' : 'On',
      disabled: isZh ? '关闭' : 'Off',
      randomSeed: 'Seed',
      transferLearning: isZh ? '迁移学习' : 'Transfer learning',
      transferHint: isZh
        ? '从已完成任务或上传权重继续微调。当前版本使用严格匹配加载。'
        : 'Fine-tune from a completed task or uploaded weight. Strict loading is used.',
      transferEnable: isZh ? '启用迁移学习' : 'Enable transfer learning',
      transferTaskSource: isZh ? '历史任务' : 'Completed task',
      transferUploadSource: isZh ? '上传权重' : 'Uploaded weight',
      transferSourceTask: isZh ? '来源任务' : 'Source task',
      transferWeightFile: isZh ? '权重文件' : 'Weight file',
      transferNoTasks: isZh ? '暂无可用的已完成任务。' : 'No completed tasks are available.',
      transferNoWeights: isZh ? '暂无上传权重。' : 'No uploaded weights yet.',
      uploadWeight: isZh ? '上传 .pth/.pt' : 'Upload .pth/.pt',
      uploadingWeight: isZh ? '上传中...' : 'Uploading...',
      deleteWeight: isZh ? '删除权重' : 'Delete weight',
      transferStrict: isZh ? '严格匹配' : 'Strict',
      freezeMode: isZh ? '冻结策略' : 'Freeze strategy',
      freezeNone: isZh ? '不冻结' : 'No freeze',
      freezeBackbone: isZh ? '冻结主体' : 'Freeze backbone',
      freezeHead: isZh ? '只训练输出头' : 'Train head only',
      finetuneLearningRate: isZh ? '微调学习率' : 'Fine-tune LR',
      transferSelectSource: isZh ? '请选择迁移学习来源。' : 'Select a transfer learning source.',
      transferConfigSynced: isZh
        ? '模型结构参数已与来源任务同步并锁定。'
        : 'Model structure parameters are synchronized with the source task and locked.',
      transferConfigUnreadable: isZh
        ? '无法读取来源任务的模型配置。'
        : 'The source task model configuration could not be read.',
      transferConfigIncomplete: isZh
        ? '来源任务的模型配置不完整，无法自动应用。'
        : 'The source task model configuration is incomplete and cannot be applied.',
      transferUploadedModelUnavailable: isZh
        ? '来源任务使用的上传模型或版本当前不可用。'
        : 'The uploaded model or version used by the source task is unavailable.',
      uploadWeightSuccess: isZh ? '权重已上传' : 'Weight uploaded',
      uploadWeightError: isZh ? '权重上传失败' : 'Weight upload failed',
      deleteWeightSuccess: isZh ? '权重已删除' : 'Weight deleted',
      liveLogs: isZh ? '实时日志' : 'Live logs',
      liveLogsHint: isZh
        ? '进度、损失和日志会在这里持续刷新。选择其他实验可切换当前日志。'
        : 'Progress, loss, and logs refresh here while the task is active. Select another experiment to switch logs.',
      logLines: (count) => (isZh ? `${count} 行` : `${count} lines`),
      autoScrollOn: isZh ? '自动跟随' : 'Auto-follow',
      autoScrollPaused: isZh ? '已暂停跟随' : 'Follow paused',
      progressHint: isZh
        ? '进度、损失和日志会在这里持续刷新。'
        : 'Progress, loss, and logs refresh here while a task is active.',
      currentStatus: isZh ? '当前状态' : 'Current status',
      channelSummaryEmpty: isZh ? '仅使用 O3 基线输入' : 'O3 baseline only',
      noTaskSelectedHint: isZh
        ? '还没有选中实验。可以在左侧目录选择实验，或新建一个实验。'
        : 'No experiment is selected yet. Pick one from the directory or create a new experiment.',
      noLogsYet: isZh ? '等待训练日志输出...' : 'Waiting for training logs...',
      waitingLogs: isZh ? '等待训练日志输出...' : 'Waiting for training logs...',
      noLossHistory: isZh ? '该实验没有可用的 Loss 记录。' : 'This experiment has no recorded loss history.',
      lossTitle: isZh ? '损失演变' : 'Loss evolution',
      lossEpochCount: (count) => isZh ? `已记录 ${count} 个训练轮次` : `${count} training epochs recorded`,
      selectedTask: isZh ? '当前查看' : 'Selected task',
      currentModel: isZh ? '当前模型' : 'Current model',
      sourceMode: isZh ? '训练来源' : 'Source mode',
      startTraining: isZh ? '开始实验' : 'Start experiment',
      loginToStart: isZh ? '登录后开始实验' : 'Sign in to start',
      starting: isZh ? '正在启动...' : 'Starting...',
      stopTraining: isZh ? '停止训练' : 'Stop training',
      cancelQueued: isZh ? '取消排队' : 'Cancel queue',
      queuePosition: (position) => position ? (isZh ? `队列第 ${position} 位` : `Queue position ${position}`) : (isZh ? '等待调度' : 'Waiting for scheduler'),
      testModel: isZh ? '模型测试' : 'Test model',
      deleteRecord: isZh ? '删除记录' : 'Delete record',
      renameModel: isZh ? '重命名' : 'Rename',
      renameSuccess: isZh ? '模型名称已更新' : 'Model name updated',
      viewLogs: isZh ? '查看日志' : 'View logs',
      modelNameAvailable: isZh ? '名称可用' : 'Name available',
      presetLoginHint: isZh ? '登录后会自动加载训练脚本。' : 'Training presets load automatically after sign-in.',
      historyCount: (count) => (isZh ? `${count} 条记录` : `${count} records`),
      historyHint: isZh
        ? '训练记录保留在实验目录中，方便回看日志或继续测试。'
        : 'Training records stay in the experiment directory so you can revisit logs or run tests later.',
      noTaskSelectedShort: isZh ? '未选择实验' : 'No experiment selected',
      noHistoryIcon: '[]',
      expand: isZh ? '\u5C55\u5F00' : 'Expand',
      collapse: isZh ? '\u6536\u8D77' : 'Collapse',
      activeModelFallback: '--',
      metricsTitle: isZh ? '测试指标' : 'Evaluation metrics',
      metricsUnavailable: isZh ? '该实验没有可用的指标数据。' : 'No metrics were recorded for this experiment.',
      detailsTitle: isZh ? '训练配置与数据集身份' : 'Training configuration and dataset identity',
      datasetIdentityTitle: isZh ? '数据集身份' : 'Dataset identity',
      trainingSettingsTitle: isZh ? '训练参数' : 'Training settings',
      datasetLabel: isZh ? '数据集' : 'Dataset',
      datasetVersionLabel: isZh ? '数据集版本' : 'Dataset version',
      datasetStatusLabel: isZh ? '身份校验' : 'Identity status',
      datasetFingerprintLabel: isZh ? '发布指纹' : 'Release fingerprint',
      modelSourceLabel: isZh ? '模型来源' : 'Model source',
      customModelLabel: isZh ? '自定义模型' : 'Custom model',
      customModelVersionLabel: isZh ? '模型版本' : 'Model version',
      customModelFileLabel: isZh ? '模型文件' : 'Model file',
      inputChannelsLabel: isZh ? '输入通道' : 'Input channels',
      windowLabel: isZh ? '输入窗口' : 'Input window',
      horizonLabel: isZh ? '预测步长' : 'Horizon',
      epochsLabel: isZh ? '训练轮次' : 'Epochs',
      batchSizeLabel: isZh ? '批大小' : 'Batch size',
      learningRateLabel: isZh ? '学习率' : 'Learning rate',
      weightsAvailable: isZh ? '权重可用' : 'Weights available',
      weightsUnavailable: isZh ? '权重不可用' : 'Weights unavailable',
      modelUnavailableTitle: isZh ? '模型尚不可用' : 'Model not available yet',
      modelUnavailable: isZh
        ? '该实验没有通过校验的权重文件，暂时不能用于预测。'
        : 'This experiment has no validated weight file, so it cannot be used for prediction yet.',
      notCompletedReason: isZh
        ? '该实验尚未成功完成，因此没有可用于预测的权重。'
        : 'This experiment did not complete successfully, so there are no weights for prediction.',
      useForPrediction: isZh ? '用于预测' : 'Use for prediction',
      goCompare: isZh ? '去模型比较' : 'Go to model comparison',
      compareNavigateToast: isZh
        ? '已打开预测页的模型比较模式，请选择至少两个已完成模型。'
        : 'Opened the prediction page in comparison mode. Select at least two completed models there.',
      compareUnavailableToast: isZh
        ? '该实验没有可用权重，暂不能参与模型比较。'
        : 'This experiment has no usable weights, so it cannot join a model comparison yet.',
      copyConfig: isZh ? '复制配置' : 'Copy configuration',
      copyConfigSuccess: isZh
        ? '已复制该实验的完整训练配置，请确认后手动开始实验。'
        : 'Loaded the full training configuration from this experiment. Review it and start manually.',
      copyConfigPartialToast: isZh
        ? '已载入可用字段；部分配置无法读取，请按提示修正后再开始实验。'
        : 'Loaded the available fields. Some configuration could not be read; fix the listed items before starting.',
      copyConfigWarningTitle: isZh ? '复制配置时发现以下问题，请修正后再开始实验：' : 'Copying the configuration found these problems — fix them before starting:',
      copyConfigWarningFallback: isZh ? '部分字段无法读取，已使用默认值。' : 'Some fields could not be read; defaults were used.',
      copyConfigWarningLabels: {
        unreadable_hyperparameters: isZh ? '任务的超参数无法解析，训练参数使用默认值。' : 'The task hyperparameters could not be parsed, so training parameters use defaults.',
        missing_training_fields: isZh ? '任务缺少部分训练参数（轮次、批大小、学习率、窗口或步长），已使用默认值。' : 'The task is missing some training parameters; defaults were used.',
        incomplete_structure: isZh ? '任务的模型结构参数不完整，已用默认值补齐，请确认后再开始实验。' : 'The task model structure parameters are incomplete and were filled with defaults.',
        uploaded_model_unavailable: isZh ? '原任务使用的上传模型已不存在或版本不匹配，请重新选择可训练的上传模型。' : 'The uploaded model used by this task is unavailable; pick a trainable uploaded model again.',
        custom_model_params_missing: isZh ? '原任务的自定义模型参数缺失，请检查上传模型参数。' : 'The task custom model parameters are missing; check the uploaded model parameters.',
      },
      progressLabel: isZh ? '进度' : 'Progress',
      viewRunLogs: isZh ? '查看运行日志' : 'View run logs',
      viewRunLogsHint: isZh ? '展开后查看该实验的完整训练日志' : 'Expand to read the full training log for this experiment',
      noLogsForTask: isZh ? '该实验没有可显示的日志。' : 'This experiment has no logs to show.',
      newExperimentCleared: isZh ? '已清空表单，可以配置新的实验。' : 'Form cleared. Configure a new experiment.',
    }),
    [isZh]
  );

  const [selectedChannels, setSelectedChannels] = useState([]);
  const [selectedScript, setSelectedScript] = useState(UNIFIED_TRAINING_SCRIPT);
  // 上传模型是训练页的一等入口：默认来源就是「上传模型」，没有上传文件时
  // 配置画布会显示上传入口、模板/说明下载与文件格式要求，官方模型作为兼容入口。
  const [modelSource, setModelSource] = useState('uploaded');
  const [uploadedModels, setUploadedModels] = useState([]);
  const [selectedUploadedModelId, setSelectedUploadedModelId] = useState('');
  const [customModelParams, setCustomModelParams] = useState({});
  const [customModelParamErrors, setCustomModelParamErrors] = useState({});
  const [uploadingModel, setUploadingModel] = useState(false);
  const [trainingWeights, setTrainingWeights] = useState([]);
  const [selectedTrainingWeightId, setSelectedTrainingWeightId] = useState('');
  const [uploadingWeight, setUploadingWeight] = useState(false);
  const [trainingDataset, setTrainingDataset] = useState(TRAINING_DATASET_OPENMARS_MCD);
  const [transferEnabled, setTransferEnabled] = useState(trainingDefaults.transferEnabled);
  const [transferSourceType, setTransferSourceType] = useState('task');
  const [transferSourceTaskId, setTransferSourceTaskId] = useState('');
  const [transferFreezeMode, setTransferFreezeMode] = useState(trainingDefaults.transferFreezeMode);
  const [finetuneLearningRate, setFinetuneLearningRate] = useState(trainingDefaults.finetuneLearningRate);
  const [modelArchitecture, setModelArchitecture] = useState('predrnnv2');
  const [useSphere, setUseSphere] = useState(false);
  const [epochs, setEpochs] = useState(trainingDefaults.epochs);
  const [batchSize, setBatchSize] = useState(trainingDefaults.batchSize);
  const [learningRate, setLearningRate] = useState(trainingDefaults.learningRate);
  const [trainRatio, setTrainRatio] = useState(trainingDefaults.trainRatio);
  const [validationRatio, setValidationRatio] = useState(trainingDefaults.validationRatio);
  const [testRatio, setTestRatio] = useState(trainingDefaults.testRatio);
  const [stlstmLayers, setStlstmLayers] = useState(3);
  const [customModelName, setCustomModelName] = useState('');
  const [modelNameError, setModelNameError] = useState('');
  const [hiddenDims, setHiddenDims] = useState([64, 64, 64]);
  const [architectureParamsByModel, setArchitectureParamsByModel] = useState(() =>
    createDefaultArchitectureParamsByModel()
  );
  const [window_, setWindow] = useState(trainingDefaults.window);
  const [horizon, setHorizon] = useState(trainingDefaults.horizon);
  const [earlyStoppingPatience, setEarlyStoppingPatience] = useState(trainingDefaults.earlyStoppingPatience);
  const [seed, setSeed] = useState(trainingDefaults.seed);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [testTaskId, setTestTaskId] = useState(null);
  const [renameTask, setRenameTask] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [architecturePickerOpen, setArchitecturePickerOpen] = useState(false);
  const transferStructureSnapshotRef = useRef(null);
  const restoredCustomModelParamsRef = useRef(null);
  // 「复制配置」带回自定义参数时登记的来源上传模型 ID。
  const copiedCustomModelParamsRef = useRef('');
  // 专家参数页签由页面控制器持有，检查器的「编辑自定义参数」可以直接切页。
  const [expertTab, setExpertTab] = useState('');
  // 底部运行条实测高度：目录/检查器的 max-height 与运行条占位块都用它，
  // 因此宽屏一行、窄屏多行都不会互相压住。
  const [runBarHeight, setRunBarHeight] = useState(0);
  const runBarNodeRef = useRef(null);
  const runBarObserverRef = useRef(null);

  // ── Earth 模式派生值 ────────────────────────────────────────────────
  const earthMode = trainingDataset === TRAINING_DATASET_EARTH_MERRA2_V2;
  const earthDatasetDescriptor = useMemo(
    () => datasetCatalog.find((item) => item.dataset_id === TRAINING_DATASET_EARTH_MERRA2_V2) || null,
    [datasetCatalog],
  );
  const earthAvailability = useMemo(
    () => readEarthDatasetAvailability(earthDatasetDescriptor),
    [earthDatasetDescriptor],
  );
  // Earth 使用规范通道顺序；火星保持原有 U/V/D/S/T 顺序。
  const activeChannelOrder = earthMode ? EARTH_CHANNEL_ORDER : channelOrder;
  const activeChannelMap = useMemo(
    () => (earthMode
      ? Object.fromEntries(EARTH_CHANNEL_ORDER.map((channel) => [
          channel,
          { name: EARTH_CHANNEL_META[channel]?.name || channel, short: channel },
        ]))
      : channelMap),
    [earthMode, channelMap],
  );

  /**
   * 数据集切换：Earth 与火星的通道/窗口/模型来源互不相同，切换时整体换挡。
   *
   * 两个场景各自保留完整草稿：切走时保存当前表单，切回时恢复，因此在 Earth 上
   * 配置的上传模型与自定义参数不会被火星表单覆盖，反之亦然。
   */
  const handleTrainingDatasetChange = useCallback((nextDataset) => {
    const normalized = sanitizeTrainingDataset(nextDataset, { allowEarth: true });
    const currentDraft = captureTrainingDraft({
      trainingDataset,
      modelSource,
      selectedUploadedModelId,
      modelArchitecture,
      useSphere,
      windowValue: window_,
      horizon,
      transferEnabled,
      selectedChannels,
      customModelParams,
    });
    if (normalized === TRAINING_DATASET_EARTH_MERRA2_V2) {
      marsSnapshotRef.current = currentDraft;
      const restore = resolveEarthTrainingRestore(earthSnapshotRef.current);
      setTrainingDataset(normalized);
      setModelSource(restore ? restore.modelSource : EARTH_MODEL_SOURCE);
      setSelectedUploadedModelId(restore ? restore.selectedUploadedModelId : '');
      setModelArchitecture(restore ? restore.modelArchitecture : EARTH_MODEL_ARCHITECTURE);
      setUseSphere(false);
      setWindow(EARTH_WINDOW);
      setHorizon(EARTH_HORIZON);
      setTransferEnabled(false);
      setSelectedChannels(restore ? restore.selectedChannels : [...EARTH_OPTIONAL_CHANNELS]);
      setCustomModelParams(restore ? restore.customModelParams : {});
      setCopyConfigWarnings([]);
      return;
    }
    if (earthMode) earthSnapshotRef.current = currentDraft;
    const restore = resolveMarsTrainingRestore(marsSnapshotRef.current);
    marsSnapshotRef.current = null;
    setTrainingDataset(normalized);
    if (normalized === TRAINING_DATASET_OPENMARS_MCD && restore) {
      setModelSource(restore.modelSource);
      setSelectedUploadedModelId(restore.selectedUploadedModelId);
      setModelArchitecture(restore.modelArchitecture);
      setUseSphere(restore.useSphere);
      setWindow(restore.windowValue);
      setHorizon(restore.horizon);
      setTransferEnabled(restore.transferEnabled);
      setSelectedChannels(restore.selectedChannels);
      setCustomModelParams(restore.customModelParams || {});
    }
  }, [
    customModelParams,
    earthMode,
    horizon,
    modelArchitecture,
    modelSource,
    selectedChannels,
    selectedUploadedModelId,
    trainingDataset,
    transferEnabled,
    useSphere,
    window_,
  ]);

  // 目录在训练页挂载时读取一次；失败只提示，不影响火星训练。
  useEffect(() => {
    const controller = new AbortController();    fetchDatasets({ signal: controller.signal })
      .then((payload) => setDatasetCatalog(Array.isArray(payload?.items) ? payload.items : []))
      .catch((error) => {
        if (error?.name === 'AbortError') return;
        setDatasetCatalogError(error?.message || String(error));
      });
    return () => controller.abort();
  }, []);

  /**
   * Earth + 上传模型：读取服务端的 Earth 兼容性结论。
   *
   * Mars 可用不等于 Earth 可用，所以这里必须问服务端；未取到结论时按不可用处理，
   * 不用「看起来兼容」放行提交。
   */
  useEffect(() => {
    if (!earthMode || modelSource !== EARTH_MODEL_SOURCE_UPLOADED || !selectedUploadedModelId) {
      setEarthUploadedStatus(null);
      setEarthUploadedLoading(false);
      return undefined;
    }
    const controller = new AbortController();
    let active = true;
    setEarthUploadedLoading(true);
    fetchUploadedModelEarthCompatibility(selectedUploadedModelId, { signal: controller.signal })
      .then((payload) => {
        if (active) setEarthUploadedStatus(payload);
      })
      .catch((error) => {
        if (error?.name === 'AbortError') return;
        if (active) {
          setEarthUploadedStatus({
            compatible: false,
            reasons: [error?.message || copy.earthCompatibilityFailed],
          });
        }
      })
      .finally(() => {
        if (active) setEarthUploadedLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [copy.earthCompatibilityFailed, earthMode, modelSource, selectedUploadedModelId]);

  const earthUploadedCompatibility = useMemo(
    () => readEarthUploadedModelCompatibility(earthUploadedStatus),
    [earthUploadedStatus],
  );
  // Earth + 上传模型的选择状态：未选/无结论/不兼容都在这里统一成一句可展示原因。
  const earthUploadedBlocker = getEarthUploadedSelectionBlocker({
    modelSource: earthMode ? modelSource : EARTH_MODEL_SOURCE_OFFICIAL,
    uploadedModelId: selectedUploadedModelId,
    compatibility: earthUploadedStatus,
  });
  const earthUploadedInlineError = earthMode
    && modelSource === EARTH_MODEL_SOURCE_UPLOADED
    && earthUploadedCompatibility.known
    && !earthUploadedCompatibility.compatible
    ? (earthUploadedCompatibility.reason || copy.earthUploadedIncompatible)
    : '';
  const earthUploadedStatusLabel = earthMode && modelSource === EARTH_MODEL_SOURCE_UPLOADED
    ? (earthUploadedLoading
        ? copy.earthCompatibilityChecking
        : (earthUploadedCompatibility.compatible ? copy.earthCompatible : copy.earthIncompatible))
    : '';
  const earthUploadedStatusTone = earthUploadedCompatibility.compatible ? 'ok' : 'error';
  const earthUploadedNotice = earthMode
    && modelSource === EARTH_MODEL_SOURCE_UPLOADED
    && earthUploadedCompatibility.compatible
    ? copy.earthUploadedCompatibleNote
    : '';
  const earthUploadedNoticeTone = 'ok';

  const setRunBarNode = (node) => {
    if (runBarNodeRef.current === node) return;
    runBarObserverRef.current?.disconnect?.();
    runBarObserverRef.current = null;
    runBarNodeRef.current = node;
    if (!node) return;
    const measure = () => {
      const height = Math.round(node.getBoundingClientRect().height);
      setRunBarHeight((previous) => (previous === height ? previous : height));
    };
    measure();
    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(measure);
      observer.observe(node);
      runBarObserverRef.current = observer;
    }
  };

  useEffect(() => () => {
    runBarObserverRef.current?.disconnect?.();
    runBarObserverRef.current = null;
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function' || !runBarHeight) return undefined;
    const query = window.matchMedia('(min-width: 901px)');
    const apply = () => {
      const root = document.documentElement;
      if (query.matches) root.style.setProperty('--experiment-run-bar-measured', `${runBarHeight + 16}px`);
      else root.style.removeProperty('--experiment-run-bar-measured');
    };
    apply();
    query.addEventListener?.('change', apply);
    return () => query.removeEventListener?.('change', apply);
  }, [runBarHeight]);
  const modelNameLabel = String(t('modelTraining.modelName') || '')
    .replace(':', '')
    .replace('：', '')
    .trim();
  const baselineLabel = t('modelTraining.baselineO3');
  const availableTransferFreezeModes = useMemo(() => getTransferFreezeModes(modelSource), [modelSource]);
  const transferFreezeModeLabels = useMemo(
    () => ({
      none: copy.freezeNone,
      backbone: copy.freezeBackbone,
      head: copy.freezeHead,
    }),
    [copy.freezeBackbone, copy.freezeHead, copy.freezeNone]
  );

  const activeTask = useMemo(
    () => tasks.find((task) => task.id === activeTaskId) || null,
    [activeTaskId, tasks]
  );
  useEffect(() => {
    if (activeTask && !isCreating && !viewChosenRef.current) setView('monitor');
  }, [activeTask, isCreating]);
  const stage = useMemo(
    () => getExperimentStage({ activeTask, isCreating }),
    [activeTask, isCreating]
  );
  const resolvedProgress = useMemo(
    () => resolveActiveTaskProgress(activeTask, progressData),
    [activeTask, progressData]
  );
  const selectedUploadedModel = useMemo(
    () => uploadedModels.find((item) => item.id === selectedUploadedModelId) || null,
    [selectedUploadedModelId, uploadedModels]
  );
  const selectedUploadedParamSchema = useMemo(
    () => selectedUploadedModel?.param_schema || {},
    [selectedUploadedModel]
  );
  const customParamValidation = useMemo(
    () => validateCustomModelParams(selectedUploadedParamSchema, customModelParams),
    [customModelParams, selectedUploadedParamSchema]
  );
  const visibleCustomModelParamErrors = useMemo(
    () => ({
      ...customParamValidation.errors,
      ...customModelParamErrors,
    }),
    [customModelParamErrors, customParamValidation.errors]
  );
  const selectedUploadedModelLabel =
    selectedUploadedModel?.display_name || selectedUploadedModel?.original_filename || copy.uploadedModelUnnamed;
  const completedTransferTasks = useMemo(
    () => getAvailableTransferSourceTasks(tasks),
    [tasks]
  );
  const selectedTrainingWeight = useMemo(
    () => trainingWeights.find((item) => item.id === selectedTrainingWeightId) || null,
    [selectedTrainingWeightId, trainingWeights]
  );
  const transferStartBlocked =
    transferEnabled &&
    ((transferSourceType === 'task' && !transferSourceTaskId) ||
      (transferSourceType === 'upload' && (!selectedTrainingWeight || selectedTrainingWeight.status !== 'ready')));
  const transferStructureLocked =
    transferEnabled && transferSourceType === 'task' && Boolean(transferSourceTaskId);

  const normalizedModelArchitecture = normalizeModelArchitecture(modelArchitecture);
  const activeStructureConfig = getModelStructureConfig(normalizedModelArchitecture);
  const activeStructureParams = architectureParamsByModel[normalizedModelArchitecture] || {};
  const isRecurrentModel = isRecurrentArchitecture(normalizedModelArchitecture);
  const structureSummary = isRecurrentModel
    ? `${getExperimentArchitectureLabel(normalizedModelArchitecture)} / ${t('modelTraining.stlstmLayers')}: ${stlstmLayers || 0}`
    : activeStructureConfig
        .slice(0, 2)
        .map((field) => `${getModelStructureParamLabel(field.key, structureLabelLanguage)}: ${activeStructureParams[field.key] ?? field.defaultValue}`)
        .join(' / ') || getExperimentArchitectureLabel(normalizedModelArchitecture);

  const selectedScriptAvailable = !!selectedScript;
  const uploadedModelStartBlocked =
    modelSource === 'uploaded' &&
    (!selectedUploadedModel || selectedUploadedModel.validation_status !== 'valid' || !customParamValidation.ok);
  const activeModelSourceAvailable =
    modelSource === 'uploaded' ? !uploadedModelStartBlocked : selectedScriptAvailable;
  const startDisabled = user
    ? (modelSource === 'official' && !selectedScriptAvailable) ||
      uploadedModelStartBlocked ||
      transferStartBlocked ||
      !!modelNameError ||
      !customModelName.trim() ||
      isProcessing || tagState.busy ||
      (newTaskTagIds.length > 0 && (tagState.loading || Boolean(tagState.error)))
    : false;
  // 检查器与运行条共用的派生值：只在这里算一次，避免两处口径不一致。
  const transferStructureDisabled = transferEnabled && transferSourceType === 'task';
  const customParamSchemaKeys = Object.keys(selectedUploadedParamSchema || {});
  const customParamValues = customModelParams && typeof customModelParams === 'object' ? customModelParams : {};
  const customParamCount = customParamSchemaKeys.filter(
    (key) => customParamValues[key] !== undefined && customParamValues[key] !== ''
  ).length;
  const selectedUploadedModelInvalid =
    modelSource === 'uploaded' && Boolean(selectedUploadedModel) && !customParamValidation.ok;
  const uploadedModelsValidCount = uploadedModels.filter((item) => item.validation_status === 'valid').length;
  // 上传模型区域内的 inline error：错误、校验失败与版本不匹配都在这里解释，
  // 而不是只在点击「开始实验」时弹出提示。
  const uploadedModelInlineError = modelSource !== 'uploaded'
    ? ''
    : !selectedUploadedModel
      ? ''
      : selectedUploadedModel.validation_status !== 'valid'
        ? `${copy.uploadModelInvalid} · ${copy.selectValidUploadedModel}`
        : '';

  /**
   * 统一就绪状态：**能否开始真实训练**与**主按钮是否可点**是两件事。
   *
   * 访客的主按钮必须可点（点了弹登录），但配置当然还不能训练。因此
   * `canTrain` 只在登录且校验全过时为 true，`blockers` 逐条列出原因；
   * 画布状态、右侧检查器与底部运行条都读这一份结果，三者不会互相矛盾。
   */
  const readiness = useMemo(() => {
    const blockers = [];
    if (!user) blockers.push({ code: 'login', label: copy.inspectorLoginRequired });
    if (!customModelName.trim()) {
      blockers.push({ code: 'name-missing', label: copy.inspectorMissingName });
    } else if (modelNameError) {
      blockers.push({ code: 'name-invalid', label: modelNameError });
    }
    if (modelSource === 'uploaded') {
      if (!selectedUploadedModel) {
        blockers.push({ code: 'model-missing', label: copy.inspectorMissingUploadedModel });
      } else if (selectedUploadedModel.validation_status !== 'valid') {
        blockers.push({ code: 'model-invalid', label: copy.inspectorUploadedInvalid });
      }
      if (selectedUploadedModelInvalid) {
        blockers.push({ code: 'custom-params', label: copy.inspectorCustomParamsInvalid });
      }
      Object.entries(visibleCustomModelParamErrors || {}).forEach(([key, message]) => {
        if (message) blockers.push({ code: `custom-param-${key}`, label: String(message) });
      });
    }
    if (modelSource === 'official' && !selectedScriptAvailable) {
      blockers.push({ code: 'preset', label: copy.presetUnavailable });
    }
    // Earth 数据不可训练（缺包/未接线）时同样阻止提交，并给出服务端原因。
    if (earthMode && !earthAvailability.selectable) {
      blockers.push({
        code: 'earth-dataset',
        label: earthAvailability.reason || copy.earthUnavailableFallback,
      });
    }
    // Earth + 上传模型：必须拿到服务端的 Earth 兼容结论才允许提交。
    if (earthMode && earthUploadedBlocker) {
      const label = earthUploadedBlocker === 'uploaded_model_required'
        ? copy.inspectorMissingUploadedModel
        : earthUploadedBlocker === 'earth_compatibility_unknown'
          ? copy.earthCompatibilityChecking
          : earthUploadedBlocker;
      blockers.push({ code: 'earth-uploaded', label });
    }
    if (transferStartBlocked) blockers.push({ code: 'transfer', label: copy.transferSelectSource });
    return { canTrain: blockers.length === 0, blockers };
  }, [
    copy.earthCompatibilityChecking,
    copy.earthUnavailableFallback,
    earthAvailability.reason,
    earthAvailability.selectable,
    earthMode,
    earthUploadedBlocker,
    copy.inspectorCustomParamsInvalid,
    copy.inspectorLoginRequired,
    copy.inspectorMissingName,
    copy.inspectorMissingUploadedModel,
    copy.inspectorUploadedInvalid,
    copy.presetUnavailable,
    copy.transferSelectSource,
    customModelName,
    modelNameError,
    modelSource,
    selectedScriptAvailable,
    selectedUploadedModel,
    selectedUploadedModelInvalid,
    transferStartBlocked,
    user,
    visibleCustomModelParamErrors,
  ]);

  const controlVisibility = getModelTrainingControlVisibility(modelSource);

  const summaryCardStyle = {
    padding: '14px 16px',
    borderRadius: 14,
    background: 'var(--bg-muted)',
    border: '1px solid var(--border)',
  };

  const sectionTitleStyle = {
    fontSize: 'calc(13px * var(--font-scale, 1))',
    fontWeight: 700,
    color: 'var(--text)',
    marginBottom: 10,
    fontFamily: 'var(--font-display)',
  };

  const fieldLabelStyle = {
    fontSize: 'calc(12px * var(--font-scale, 1))',
    fontWeight: 600,
    color: 'var(--text-80)',
    marginBottom: 7,
    lineHeight: 1.45,
  };

  const fieldHintStyle = {
    fontSize: 'calc(11px * var(--font-scale, 1))',
    color: 'var(--text-60)',
    lineHeight: 1.6,
    marginTop: 6,
  };

  const inputStyle = {
    width: '100%',
    borderRadius: 12,
    border: '1px solid var(--border)',
    background: isLight ? 'rgba(255,255,255,0.96)' : 'rgba(15,20,28,0.78)',
    color: 'var(--text)',
    padding: '10px 12px',
    fontSize: 'calc(13px * var(--font-scale, 1))',
    lineHeight: 1.4,
    outline: 'none',
    transition: 'border-color 0.18s ease, box-shadow 0.18s ease',
    fontFamily: 'var(--font-body)',
  };

  const headerMetaTextStyle = {
    fontSize: 'calc(12px * var(--font-scale, 1))',
    color: 'var(--text-60)',
    lineHeight: 1.7,
  };

  const panelTitleStyle = {
    fontSize: 'calc(19px * var(--font-scale, 1))',
    fontWeight: 700,
    color: 'var(--text)',
    fontFamily: 'var(--font-display)',
    marginBottom: 6,
  };

  const validateModelName = (name) => {
    if (!name || !name.trim()) return t('modelTraining.nameRequired');
    const existingNames = tasks.map((task) => task.custom_model_name).filter(Boolean);
    if (existingNames.includes(name.trim())) {
      return t('modelTraining.nameUsed', { name: name.trim() });
    }
    return '';
  };

  const handleLayersChange = (event) => {
    const value = event.target.value;
    if (value === '') {
      setStlstmLayers('');
      return;
    }

    const nextLayerCount = sanitizePositiveInteger(value, 3, 1, 10);
    setStlstmLayers(nextLayerCount);

    setHiddenDims((previous) => {
      const next = [...previous];
      if (nextLayerCount > next.length) {
        for (let index = next.length; index < nextLayerCount; index += 1) next.push(64);
      } else {
        next.length = nextLayerCount;
      }
      return next;
    });
  };

  const handleModelNameChange = (event) => {
    const value = event.target.value;
    setCustomModelName(value);
    setModelNameError(validateModelName(value));
  };

  const handleDimChange = (index, value) => {
    const next = [...hiddenDims];
    next[index] = value === '' ? '' : sanitizePositiveInteger(value, 64);
    setHiddenDims(next);
  };

  const handleStructureParamChange = (modelId, field, value) => {
    const boundedFloatMin = OPEN_INTERVAL_FLOAT_FIELDS.has(field.key) ? 0.000001 : 0;
    const sanitizedValue =
      value === ''
        ? ''
        : field.type === 'integerList'
          ? value
          : field.type === 'dropout'
            ? sanitizeDropout(value, field.defaultValue)
            : field.type === 'boundedFloat'
              ? sanitizePositiveNumber(value, field.defaultValue, boundedFloatMin, 0.9)
              : field.type === 'nonNegativeNumber'
                ? sanitizePositiveNumber(value, field.defaultValue, 0)
                : sanitizePositiveInteger(value, field.defaultValue);

    setArchitectureParamsByModel((previous) => ({
      ...previous,
      [modelId]: {
        ...(previous[modelId] || {}),
        [field.key]: sanitizedValue,
      },
    }));
  };

  const getCurrentTransferStructure = () => ({
    modelSource,
    selectedUploadedModelId,
    customModelParams,
    selectedChannels,
    modelArchitecture,
    useSphere,
    hiddenDims,
    stlstmLayers,
    architectureParamsByModel,
    windowValue: window_,
    horizon,
  });

  const applyTransferStructureState = (structure, { restoring = false } = {}) => {
    if (restoring && structure.selectedUploadedModelId !== selectedUploadedModelId) {
      restoredCustomModelParamsRef.current = {
        modelId: structure.selectedUploadedModelId,
        params: captureTransferStructureSnapshot(structure.customModelParams),
      };
    }
    setModelSource(structure.modelSource);
    setSelectedUploadedModelId(structure.selectedUploadedModelId);
    setCustomModelParams(captureTransferStructureSnapshot(structure.customModelParams));
    setCustomModelParamErrors({});
    setSelectedChannels([...structure.selectedChannels]);
    setModelArchitecture(structure.modelArchitecture);
    setUseSphere(structure.useSphere);
    setHiddenDims([...structure.hiddenDims]);
    setStlstmLayers(structure.stlstmLayers);
    setArchitectureParamsByModel(captureTransferStructureSnapshot(structure.architectureParamsByModel));
    setWindow(structure.windowValue);
    setHorizon(structure.horizon);
  };

  const restoreTransferStructureSnapshot = () => {
    const snapshot = transferStructureSnapshotRef.current;
    if (!snapshot) return;
    applyTransferStructureState(snapshot, { restoring: true });
    transferStructureSnapshotRef.current = null;
  };

  const handleTransferEnabledChange = (enabled) => {
    if (!enabled) {
      restoreTransferStructureSnapshot();
      setTransferSourceTaskId('');
    }
    setTransferEnabled(enabled);
  };

  const handleTransferSourceTypeChange = (sourceType) => {
    if (sourceType === transferSourceType) return;
    if (sourceType === 'upload') {
      restoreTransferStructureSnapshot();
      setTransferSourceTaskId('');
    }
    setTransferSourceType(sourceType);
  };

  const handleTransferSourceTaskChange = (taskId) => {
    if (!taskId) {
      restoreTransferStructureSnapshot();
      setTransferSourceTaskId('');
      return;
    }

    const sourceTask = completedTransferTasks.find((task) => String(task.id) === String(taskId));
    if (!sourceTask) {
      showToast(copy.transferConfigUnreadable, 'error');
      return;
    }

    try {
      const sourceConfig = readTransferSourceTaskConfig(sourceTask, { channelOrder, uploadedModels });
      const currentStructure = getCurrentTransferStructure();
      if (!transferStructureSnapshotRef.current) {
        transferStructureSnapshotRef.current = captureTransferStructureSnapshot(currentStructure);
      }
      applyTransferStructureState(applyTransferStructureConfig(currentStructure, sourceConfig));
      setTransferSourceTaskId(String(taskId));
    } catch (error) {
      const message = error?.code === 'unavailable'
        ? copy.transferUploadedModelUnavailable
        : error?.code === 'incomplete'
          ? copy.transferConfigIncomplete
          : copy.transferConfigUnreadable;
      showToast(message, 'error');
    }
  };

  useEffect(() => {
    if (!user) {
      setScriptsLoading(false);
      setScriptsError('');
      return undefined;
    }

    let active = true;
    setScriptsLoading(true);
    setScriptsError('');

    fetchScripts()
      .then(() => {
        if (!active) return;
      })
      .catch(() => {
        if (!active) return;
        setScriptsError(copy.presetError);
      })
      .finally(() => {
        if (!active) return;
        setScriptsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [copy.presetError, user]);

  useEffect(() => {
    setSelectedScript(UNIFIED_TRAINING_SCRIPT);
  }, [user]);

  useEffect(() => {
    if (!user) {
      // 退出登录只清空账号相关的资源，**不改写模型来源**：
      // 上传模型是默认入口，访客也应看到上传入口与登录提示，
      // 而不是被悄悄切换到官方模型（历史上这里会 setModelSource('official')）。
      setUploadedModels([]);
      setSelectedUploadedModelId('');
      setCustomModelParams({});
      setCustomModelParamErrors({});
      setUploadingModel(false);
      setTrainingWeights([]);
      setSelectedTrainingWeightId('');
      setUploadingWeight(false);
      return undefined;
    }

    let active = true;

    fetchUserModels()
      .then((payload) => {
        if (!active) return;
        const items = Array.isArray(payload?.items) ? payload.items : [];
        setUploadedModels(items);
        setSelectedUploadedModelId((current) => {
          const currentModel = items.find((item) => item.id === current);
          if (currentModel) return current;
          return items.find((item) => item.validation_status === 'valid')?.id || items[0]?.id || '';
        });
      })
      .catch(() => {
        if (!active) return;
        setUploadedModels([]);
        setSelectedUploadedModelId('');
      });

    return () => {
      active = false;
    };
  }, [user]);

  useEffect(() => {
    if (!user) {
      setTrainingWeights([]);
      setSelectedTrainingWeightId('');
      return undefined;
    }

    let active = true;
    fetchTrainingWeights()
      .then((payload) => {
        if (!active) return;
        const items = Array.isArray(payload?.items) ? payload.items : [];
        setTrainingWeights(items);
        setSelectedTrainingWeightId((current) => {
          if (items.find((item) => item.id === current)) return current;
          return items.find((item) => item.status === 'ready')?.id || items[0]?.id || '';
        });
      })
      .catch(() => {
        if (!active) return;
        setTrainingWeights([]);
        setSelectedTrainingWeightId('');
      });

    return () => {
      active = false;
    };
  }, [user]);

  useEffect(() => {
    // 「复制配置」刚回填的参数属于上传模型，不能被 schema 同步重置成默认值；
    // 用户手动切换上传模型时才清除这条登记。
    if (copiedCustomModelParamsRef.current
      && copiedCustomModelParamsRef.current === selectedUploadedModelId) {
      return;
    }
    copiedCustomModelParamsRef.current = '';

    const restored = restoredCustomModelParamsRef.current;
    if (restored && restored.modelId === selectedUploadedModelId) {
      setCustomModelParams(captureTransferStructureSnapshot(restored.params));
      setCustomModelParamErrors({});
      restoredCustomModelParamsRef.current = null;
      return;
    }
    if (transferStructureLocked) return;
    setCustomModelParams(createDefaultCustomModelParams(selectedUploadedParamSchema));
    setCustomModelParamErrors({});
  }, [selectedUploadedModelId, selectedUploadedParamSchema]);

  useEffect(() => {
    if (!transferStructureLocked || hasTransferSourceTask(completedTransferTasks, transferSourceTaskId)) return;
    restoreTransferStructureSnapshot();
    setTransferSourceTaskId('');
  }, [completedTransferTasks, transferSourceTaskId, transferStructureLocked]);

  useEffect(() => {
    if (autoScrollRef.current && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  useEffect(() => {
    if (!availableTransferFreezeModes.includes(transferFreezeMode)) {
      setTransferFreezeMode('none');
    }
  }, [availableTransferFreezeModes, transferFreezeMode]);

  const handleScroll = (event) => {
    const { scrollTop, scrollHeight, clientHeight } = event.target;
    const pinned = scrollHeight - scrollTop - clientHeight < 50;
    autoScrollRef.current = pinned;
    setAutoScrollPinned(pinned);
  };

  const refreshUploadedModels = async (preferredId = selectedUploadedModelId) => {
    const payload = await fetchUserModels();
    const items = Array.isArray(payload?.items) ? payload.items : [];
    setUploadedModels(items);
    setSelectedUploadedModelId(() => {
      const preferredModel = items.find((item) => item.id === preferredId);
      if (preferredModel) return preferredId;
      return items.find((item) => item.validation_status === 'valid')?.id || items[0]?.id || '';
    });
    return items;
  };

  const refreshTrainingWeights = async (preferredId = selectedTrainingWeightId) => {
    const payload = await fetchTrainingWeights();
    const items = Array.isArray(payload?.items) ? payload.items : [];
    setTrainingWeights(items);
    setSelectedTrainingWeightId(() => {
      if (items.find((item) => item.id === preferredId)) return preferredId;
      return items.find((item) => item.status === 'ready')?.id || items[0]?.id || '';
    });
    return items;
  };

  const handleUploadModel = async (file) => {
    if (!user) {
      openAuthModal('login');
      return;
    }

    try {
      setUploadingModel(true);
      const uploaded = await uploadUserModel(file);
      await refreshUploadedModels(uploaded?.id);
      setSelectedUploadedModelId(uploaded?.id || '');
      setModelSource('uploaded');
      showToast(
        uploaded?.validation_status === 'valid' ? copy.uploadModelSuccess : copy.uploadModelInvalid,
        uploaded?.validation_status === 'valid' ? 'success' : 'error'
      );
    } catch (error) {
      showToast(`${copy.uploadModelError}: ${error.message}`, 'error');
    } finally {
      setUploadingModel(false);
    }
  };

  const handleRevalidateModel = async (modelId) => {
    if (!modelId || isProcessing) return;
    try {
      setIsProcessing(true);
      const updated = await revalidateUserModel(modelId);
      await refreshUploadedModels(updated?.id || modelId);
      showToast(
        updated?.validation_status === 'valid' ? copy.revalidateModelSuccess : copy.uploadModelInvalid,
        updated?.validation_status === 'valid' ? 'success' : 'error'
      );
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRenameUploadedModel = async (modelId, displayName) => {
    if (!modelId || isProcessing) return false;
    try {
      setIsProcessing(true);
      const updated = await renameUserModel(modelId, displayName);
      // Preserve the schema reference so editing the name does not reset the
      // custom parameter values already entered for this experiment.
      setUploadedModels((items) => items.map((item) => item.id === modelId
        ? { ...item, display_name: updated.display_name, updated_at: updated.updated_at }
        : item));
      setEarthUploadedStatus((current) => current?.package_id === modelId
        ? { ...current, display_name: updated.display_name }
        : current);
      showToast(copy.renameUploadedModelSuccess, 'success');
      return true;
    } catch (error) {
      showToast(error.message, 'error');
      return false;
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDownloadUploadedModel = async (modelId) => {
    if (!modelId || isProcessing) return;
    try {
      setIsProcessing(true);
      const blob = await downloadUserModel(modelId);
      const model = uploadedModels.find((item) => item.id === modelId);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = model?.original_filename?.split(/[\\/]/).pop() || 'model.py';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDeleteUploadedModel = async (modelId) => {
    if (!modelId || isProcessing) return;
    try {
      setIsProcessing(true);
      await deleteUserModel(modelId);
      await refreshUploadedModels('');
      showToast(copy.deleteUploadedModelSuccess, 'success');
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCustomModelParamChange = (key, value) => {
    setCustomModelParams((previous) => ({ ...previous, [key]: value }));
    setCustomModelParamErrors((previous) => {
      if (!previous[key]) return previous;
      const next = { ...previous };
      delete next[key];
      return next;
    });
  };

  const handleChannelToggle = (channel) => {
    setSelectedChannels((previous) =>
      previous.includes(channel) ? previous.filter((item) => item !== channel) : [...previous, channel]
    );
  };

  const handleFoldChange = (field, rawValue) => {
    const value = rawValue;
    const empty = value === '';
    switch (field) {
      case 'epochs':
        setEpochs(empty ? '' : sanitizePositiveInteger(value, 10));
        break;
      case 'batchSize':
        setBatchSize(empty ? '' : sanitizePositiveInteger(value, 32));
        break;
      case 'learningRate':
        setLearningRate(empty ? '' : sanitizePositiveNumber(value, 0.001));
        break;
      case 'windowValue':
        setWindow(empty ? '' : sanitizePositiveInteger(value, 3, 1, 30));
        break;
      case 'horizon':
        setHorizon(empty ? '' : sanitizePositiveInteger(value, 3, 1, 30));
        break;
      case 'seed':
        setSeed(empty ? '' : sanitizeNonNegativeInteger(value, 11, 2147483647));
        break;
      case 'earlyStoppingPatience':
        setEarlyStoppingPatience(empty ? '' : sanitizeNonNegativeInteger(value, 0, 200));
        break;
      case 'finetuneLearningRate':
        setFinetuneLearningRate(empty ? '' : sanitizePositiveNumber(value, 0.0001));
        break;
      case 'transferFreezeMode':
        setTransferFreezeMode(value);
        break;
      default:
        break;
    }
  };

  const handleTagIdsChange = (ids) => setNewTaskTagIds(ids);
  const handleCreateTag = (name) => tagState.mutate(() => createTrainingTag(name));

  /**
   * 新建实验 / 返回实验目录：清空命名、标签与迁移选择，保留默认模型与数据集参数。
   */
  const handleCreateExperiment = () => {
    const defaults = normalizeTrainingDefaults(settings.trainingDefaults);
    changeView('config');
    restoreTransferStructureSnapshot();
    transferStructureSnapshotRef.current = null;
    copiedCustomModelParamsRef.current = '';
    setCustomModelName('');
    setModelNameError('');
    setNewTaskTagIds([]);
    setTransferEnabled(earthMode ? false : defaults.transferEnabled);
    setTransferSourceType('task');
    setTransferSourceTaskId('');
    setTransferFreezeMode(defaults.transferFreezeMode);
    setFinetuneLearningRate(defaults.finetuneLearningRate);
    setEpochs(defaults.epochs);
    setBatchSize(defaults.batchSize);
    setLearningRate(defaults.learningRate);
    setTrainRatio(defaults.trainRatio);
    setValidationRatio(defaults.validationRatio);
    setTestRatio(defaults.testRatio);
    setWindow(earthMode ? EARTH_WINDOW : defaults.window);
    setHorizon(earthMode ? EARTH_HORIZON : defaults.horizon);
    setEarlyStoppingPatience(defaults.earlyStoppingPatience);
    setSeed(defaults.seed);
    setSelectedUploadedModelId((current) => current);
    setModelArchitecture('predrnnv2');
    setUseSphere(false);
    setStlstmLayers(3);
    setHiddenDims([64, 64, 64]);
    setArchitectureParamsByModel(createDefaultArchitectureParamsByModel());
    setArchitecturePickerOpen(false);
    setAdvancedOpen(false);
    // 新建实验回到超参数模块的第一个页签（输入与预测）。
    setExpertTab('payload');
    setIsCreating(true);
    // 进入新建配置后抑制“自动选中运行中任务”，否则任务轮询或目录重渲染
    // 会把用户从配置画布拽回监控阶段。
    setSuppressAutoSelect?.(true);
    setActiveTaskId(null);
    setLogs([]);
    setCopyConfigWarnings([]);
    showToast(copy.newExperimentCleared, 'info');
  };

  const handleSelectTask = (taskId) => {
    changeView('monitor');
    // 用户主动选择实验（含从目录进入运行中 / 已完成实验）时恢复自动选中行为。
    setSuppressAutoSelect?.(false);
    setIsCreating(false);
    setActiveTaskId(taskId);
  };

  const handleStartTraining = async () => {
    if (!user) {
      openAuthModal('login');
      return;
    }

    const nameError = validateModelName(customModelName);
    if (nameError) {
      alert(!customModelName.trim() ? t('modelTraining.namePrompt') : nameError);
      setModelNameError(nameError);
      return;
    }

    const splitRatios = normalizeEarthSplitRatios(trainRatio, validationRatio, testRatio);
    if (!splitRatios.valid) {
      showToast(isZh ? '训练集、验证集、测试集比例之和必须为 100%' : 'Train, validation and test ratios must total 100%', 'error');
      return;
    }

    // Earth 与火星走两条独立的提交路径：Earth 不发送迁移字段，也不经过火星的
    // 通道与窗口规范化，服务端会独立复核同一套 Earth 契约。选择上传模型时只发送
    // 模型 ID 与自定义参数值；模型版本、内容哈希与数据快照都由服务端固定。
    if (earthMode) {
      if (!earthAvailability.selectable) {
        showToast(copy.earthUnavailableTitle, 'error');
        return;
      }
      const uploadedEarth = modelSource === EARTH_MODEL_SOURCE_UPLOADED;
      if (uploadedEarth) {
        if (!selectedUploadedModel || selectedUploadedModel.validation_status !== 'valid') {
          showToast(copy.selectValidUploadedModel, 'error');
          return;
        }
        if (!earthUploadedCompatibility.compatible) {
          showToast(
            earthUploadedCompatibility.reason || copy.earthUploadedIncompatible,
            'error',
          );
          return;
        }
        const customValidation = validateCustomModelParams(selectedUploadedParamSchema, customModelParams);
        if (!customValidation.ok) {
          setCustomModelParamErrors(customValidation.errors);
          showToast(copy.fixCustomModelParams, 'error');
          return;
        }
      }
      try {
        setIsProcessing(true);
        const earthHyperparameters = buildEarthTrainingHyperparameters({
          selectedChannels,
          epochs,
          batchSize,
          learningRate,
          seed,
          earlyStoppingPatience,
          linearHiddenLayers: architectureParamsByModel?.[EARTH_MODEL_ARCHITECTURE]?.linear_hidden_layers,
          modelSource: uploadedEarth ? EARTH_MODEL_SOURCE_UPLOADED : EARTH_MODEL_SOURCE_OFFICIAL,
          customModelParams: uploadedEarth
            ? buildCustomModelParams(selectedUploadedParamSchema, customModelParams)
            : null,
        });
        const task = await startTrainingTask(
          UNIFIED_TRAINING_SCRIPT,
          earthHyperparameters,
          customModelName.trim(),
          getTrainingRequestDataSource(),
          {
            modelSource: uploadedEarth ? 'uploaded' : 'official',
            uploadedModelId: uploadedEarth ? selectedUploadedModelId : null,
            tagIds: newTaskTagIds,
            datasetId: TRAINING_DATASET_EARTH_MERRA2_V2,
          }
        );
        setTasks((previous) => {
          const exists = previous.find((item) => item.id === task.id);
          if (exists) return previous;
          return [task, ...previous];
        });
        setIsCreating(false);
        setActiveTaskId(task.id);
        changeView('monitor');
        await loadTasks();
      } catch (error) {
        alert(`${t('modelTraining.startError')}${error?.message || ''}`);
      } finally {
        setIsProcessing(false);
      }
      return;
    }

    if (modelSource === 'official' && !selectedScriptAvailable) {
      alert(copy.presetUnavailable);
      return;
    }

    if (modelSource === 'uploaded') {
      if (!selectedUploadedModel || selectedUploadedModel.validation_status !== 'valid') {
        showToast(copy.selectValidUploadedModel, 'error');
        return;
      }

      const customValidation = validateCustomModelParams(selectedUploadedParamSchema, customModelParams);
      if (!customValidation.ok) {
        setCustomModelParamErrors(customValidation.errors);
        showToast(copy.fixCustomModelParams, 'error');
        return;
      }
    }

    if (transferStartBlocked) {
      showToast(copy.transferSelectSource, 'error');
      return;
    }

    try {
      setIsProcessing(true);
      const baseHyperparameters = buildTrainingHyperparameters({
        epochs,
        batchSize,
        learningRate,
        hiddenDims,
        windowValue: window_,
        horizon,
        earlyStoppingPatience,
        seed,
        selectedChannels,
        channelOrder,
        modelArchitecture: normalizeModelArchitecture(modelArchitecture),
        modelSource,
        useSphere,
        architectureParamsByModel,
        trainingDataset,
        transferLearning: {
          enabled: transferEnabled,
          sourceType: transferSourceType,
          sourceTaskId: transferSourceTaskId,
          weightId: selectedTrainingWeightId,
          freezeMode: transferFreezeMode,
          finetuneLearningRate,
        },
        trainRatio: splitRatios.train_ratio,
        validationRatio: splitRatios.validation_ratio,
        testRatio: splitRatios.test_ratio,
      });
      const hyperparameters =
        modelSource === 'uploaded'
          ? {
              ...baseHyperparameters,
              custom_model_params: buildCustomModelParams(selectedUploadedParamSchema, customModelParams),
            }
          : baseHyperparameters;
      const apiModelScript =
        modelSource === 'uploaded' ? selectedScript || UNIFIED_TRAINING_SCRIPT : selectedScript;

      const task = await startTrainingTask(
        apiModelScript,
        hyperparameters,
        customModelName.trim(),
        getTrainingRequestDataSource(),
        {
          modelSource,
          uploadedModelId: modelSource === 'uploaded' ? selectedUploadedModelId : null,
          tagIds: newTaskTagIds,
        }
      );

      setTasks((previous) => {
        const exists = previous.find((item) => item.id === task.id);
        if (exists) return previous;
        return [task, ...previous];
      });
      // 提交成功后进入监控阶段：选中新任务并结束“新建实验”状态。
      setIsCreating(false);
      setActiveTaskId(task.id);
      changeView('monitor');
      await loadTasks();
    } catch (error) {
      alert(t('modelTraining.startError') + error.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleStopTask = async (taskId) => {
    if (isProcessing) return;
    try {
      setIsProcessing(true);
      await stopTrainingTask(taskId);
      await loadTasks();
    } catch (error) {
      alert(t('modelTraining.stopError') + error.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCancelTask = async (taskId) => {
    if (isProcessing) return;
    try {
      setIsProcessing(true);
      await cancelTrainingTask(taskId);
      await loadTasks();
    } catch (error) {
      alert((isZh ? '取消排队出错: ' : 'Cancel queue error: ') + error.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDeleteTask = async (taskId) => {
    const targetId = taskId ?? confirmDeleteId;
    if (!targetId || isProcessing) return;
    try {
      setIsProcessing(true);
      await deleteTrainingTask(targetId);
      if (activeTaskId === targetId) {
        setActiveTaskId(null);
        setLogs([]);
      }
      setConfirmDeleteId(null);
      await loadTasks();
    } catch (error) {
      alert(t('modelTraining.deleteError') + error.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRenameTask = async (normalizedName) => {
    if (!renameTask) return;
    await renameTrainingModel(renameTask.id, normalizedName);
    await loadTasks();
    setRenameTask(null);
    showToast(copy.renameSuccess, 'success');
  };

  const handleUploadWeight = async (file) => {
    if (!user) {
      openAuthModal('login');
      return;
    }

    try {
      setUploadingWeight(true);
      const uploaded = await uploadTrainingWeight(file);
      await refreshTrainingWeights(uploaded.id);
      setSelectedTrainingWeightId(uploaded.id);
      showToast(uploaded.status === 'ready' ? copy.uploadWeightSuccess : copy.uploadWeightError, uploaded.status === 'ready' ? 'success' : 'error');
    } catch (error) {
      showToast(`${copy.uploadWeightError}: ${error.message}`, 'error');
    } finally {
      setUploadingWeight(false);
    }
  };

  const handleDeleteWeight = async (weightId) => {
    if (!weightId || isProcessing) return;
    try {
      setIsProcessing(true);
      await deleteTrainingWeight(weightId);
      await refreshTrainingWeights('');
      showToast(copy.deleteWeightSuccess, 'success');
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  /** 跳转预测页；比较模式通过 hash query 显式声明，单模型 handoff 不带 mode。 */
  const navigateToPredict = ({ mode = null } = {}) => {
    window.history.pushState(null, '', buildPredictHash({ from: 'training', mode }));
    if (typeof PopStateEvent === 'function') {
      window.dispatchEvent(new PopStateEvent('popstate'));
    } else {
      window.dispatchEvent(new Event('popstate'));
    }
  };

  /** 「用于预测」沿用现有 TRAINING_TASK_HANDOFF_KEY 与 buildTrainingTaskHandoff。 */
  const handleAnalyzeTask = (task) => {
    const handoff = buildTrainingTaskHandoff(task, createUserPredictScope(user?.id));
    if (!handoff) return;

    sessionStorage.setItem(TRAINING_TASK_HANDOFF_KEY, JSON.stringify(handoff));
    navigateToPredict();
  };

  /**
   * 「去模型比较」导航到预测页并显式带上比较模式。
   *
   * 预测页没有批量预选协议，因此这里不写入选中的任务，也不伪造选择结果；
   * `mode=trained_compare` 只负责让预测页进入比较模式。
   */
  const handleCompareTask = (task) => {
    if (!canUseTaskForPrediction(task)) {
      showToast(copy.compareUnavailableToast, 'info');
      return;
    }
    navigateToPredict({ mode: PREDICT_MODEL_MODE_COMPARE });
    showToast(copy.compareNavigateToast, 'info');
  };

  /**
   * 「复制配置」把任务的完整训练配置载入新建实验表单，不自动启动训练。
   *
   * 读取失败或字段缺失时仍然载入可用字段，并把警告显示在配置工作区，
   * 由用户修正后手动开始实验。
   */
  const handleCopyConfig = (task) => {
    if (!task) return;
    changeView('config');
    const config = readExperimentConfig(task, {
      uploadedModels,
      channelOrder,
      nameSuffix: isZh ? ' 副本' : ' (Copy)',
      existingNames: tasks.map((item) => item.custom_model_name).filter(Boolean),
    });

    restoreTransferStructureSnapshot();
    transferStructureSnapshotRef.current = null;

    setCustomModelName(config.customModelName);
    setModelNameError('');
    setNewTaskTagIds(config.tagIds.filter((id) => tagState.tags.some((tag) => tag.id === id)));
    setTrainingDataset(config.trainingDataset);
    setModelSource(config.modelSource);
    setSelectedUploadedModelId(config.selectedUploadedModelId);
    // 上传模型的自定义参数必须一起回填；同时登记来源模型，避免下面的
    // schema 同步 effect 把刚复制进来的参数重置成默认值。
    setCustomModelParams(cloneExperimentConfigValue(config.customModelParams));
    copiedCustomModelParamsRef.current = config.customModelParams
      ? config.selectedUploadedModelId || ''
      : '';
    setCustomModelParamErrors({});
    setSelectedChannels([...config.selectedChannels]);
    setModelArchitecture(config.modelArchitecture);
    setUseSphere(config.useSphere);
    setHiddenDims([...config.hiddenDims]);
    setStlstmLayers(config.hiddenDims.length);
    setArchitectureParamsByModel(captureTransferStructureSnapshot(config.architectureParamsByModel));
    setWindow(config.windowValue);
    setHorizon(config.horizon);
    setEpochs(config.epochs);
    setBatchSize(config.batchSize);
    setLearningRate(config.learningRate);
    setTrainRatio(config.trainRatio ?? EARTH_DEFAULT_SPLIT_RATIOS.train_ratio);
    setValidationRatio(config.validationRatio ?? EARTH_DEFAULT_SPLIT_RATIOS.validation_ratio);
    setTestRatio(config.testRatio ?? EARTH_DEFAULT_SPLIT_RATIOS.test_ratio);
    setSeed(config.seed);
    setEarlyStoppingPatience(config.earlyStoppingPatience);
    // 复制配置不把原任务当成迁移学习来源。
    setTransferEnabled(false);
    setTransferSourceType('task');
    setTransferSourceTaskId('');
    setTransferFreezeMode('none');
    setFinetuneLearningRate(0.0001);
    setArchitecturePickerOpen(false);
    setAdvancedOpen(false);
    setCopyConfigWarnings(config.warnings);
    setIsCreating(true);
    setSuppressAutoSelect?.(true);
    setActiveTaskId(null);
    setLogs([]);

    if (config.warnings.length > 0) {
      showToast(copy.copyConfigPartialToast, 'info');
      return;
    }
    showToast(copy.copyConfigSuccess, 'success');
  };

  const presetStatusText = !user
    ? copy.presetLoginHint
    : modelSource === 'uploaded'
      ? selectedUploadedModel?.validation_status === 'valid'
        ? copy.uploadedModelReady
        : copy.selectValidUploadedModel
    : scriptsLoading
      ? copy.presetLoading
      : scriptsError || (selectedScriptAvailable ? copy.presetMatched : copy.presetUnavailable);

  const startButtonLabel = !user
    ? copy.loginToStart
    : isProcessing
      ? copy.starting
      : copy.startTraining;

  const configWorkspace = (
    <ExperimentConfigWorkspace
      values={{
        customModelName,
        newTaskTagIds,
        trainingDataset,
        modelSource,
        selectedUploadedModelId,
        customModelParams,
        selectedChannels,
        modelArchitecture,
        useSphere,
        epochs,
        batchSize,
        learningRate,
        trainRatio,
        validationRatio,
        testRatio,
        windowValue: window_,
        horizon,
        earlyStoppingPatience,
        seed,
        stlstmLayers,
        hiddenDims,
        transferEnabled,
        transferSourceType,
        transferSourceTaskId,
        transferFreezeMode,
        finetuneLearningRate,
        normalizedModelArchitecture,
        activeStructureConfig,
        activeStructureParams,
        structureSummary,
      }}
      resources={{
        user,
        scriptsLoading,
        scriptsError,
        uploadedModels,
        uploadingModel,
        selectedUploadedModel,
        selectedUploadedModelLabel,
        selectedUploadedParamSchema,
        trainingWeights,
        selectedTrainingWeight,
        selectedTrainingWeightId,
        uploadingWeight,
        completedTransferTasks,
        tagState,
        isProcessing,
        architecturePickerOpen,
        advancedOpen,
        modelArchitectures: MODEL_ARCHITECTURES,
        guideDownloadUrl: getUserModelDownloadUrl('guide'),
        templateDownloadUrl: getUserModelDownloadUrl('template'),
        earthDatasetAvailability: earthAvailability,
        datasetCatalogError,
        earthUploadedInlineError,
        earthUploadedStatusLabel,
        earthUploadedStatusTone,
        earthUploadedNotice,
        earthUploadedNoticeTone,
      }}
      validation={{
        modelNameError,
        visibleCustomModelParamErrors,
        transferStartBlocked,
        transferStructureLocked,
        transferStructureDisabled,
        activeModelSourceAvailable,
        startDisabled,
        startButtonLabel,
        customParamCount,
        selectedUploadedModelInvalid,
        uploadedModelsValidCount,
        uploadedModelInlineError,
      }}
      readiness={readiness}
      actions={{
        onModelNameChange: handleModelNameChange,
        onTrainingDatasetChange: handleTrainingDatasetChange,
        onModelSourceChange: setModelSource,
        onSelectUploadedModel: setSelectedUploadedModelId,
        onUploadModel: handleUploadModel,
        onRevalidateModel: handleRevalidateModel,
        onDeleteUploadedModel: handleDeleteUploadedModel,
        onRenameUploadedModel: handleRenameUploadedModel,
        onDownloadUploadedModel: handleDownloadUploadedModel,
        onCustomModelParamChange: handleCustomModelParamChange,
        onChannelToggle: handleChannelToggle,
        onArchitectureSelect: (architectureId) => {
          setModelArchitecture(architectureId);
          setArchitecturePickerOpen(false);
        },
        onToggleSphere: () => setUseSphere((value) => !value),
        onToggleArchitecturePicker: () => setArchitecturePickerOpen((previous) => !previous),
        onToggleAdvanced: () => setAdvancedOpen((previous) => !previous),
        onStructureParamChange: handleStructureParamChange,
        onLayersChange: handleLayersChange,
        onDimChange: handleDimChange,
        onTransferEnabledChange: handleTransferEnabledChange,
        onTransferSourceTypeChange: handleTransferSourceTypeChange,
        onTransferSourceTaskChange: handleTransferSourceTaskChange,
        onSelectTrainingWeight: setSelectedTrainingWeightId,
        onUploadWeight: handleUploadWeight,
        onDeleteWeight: handleDeleteWeight,
        onFoldChange: handleFoldChange,
        onSplitRatioChange: (key, value) => {
          if (key === 'trainRatio') setTrainRatio(value);
          if (key === 'validationRatio') setValidationRatio(value);
          if (key === 'testRatio') setTestRatio(value);
        },
        onTagIdsChange: handleTagIdsChange,
        onCreateTag: handleCreateTag,
        onStart: handleStartTraining,
      }}
      ui={{
        panelTitleStyle,
        sectionTitleStyle,
        fieldLabelStyle,
        fieldHintStyle,
        inputStyle,
        headerMetaTextStyle,
        summaryCardStyle,
      }}
      copy={copy}
      t={t}
      isLight={isLight}
      isZh={isZh}
      channelOrder={activeChannelOrder}
      channelMap={activeChannelMap}
      modelNameLabel={modelNameLabel}
      structureLabelLanguage={structureLabelLanguage}
      availableTransferFreezeModes={availableTransferFreezeModes}
      transferFreezeModeLabels={transferFreezeModeLabels}
      presetStatusText={presetStatusText}
      controlVisibility={controlVisibility}
      copyConfigWarnings={copyConfigWarnings}
      expertTab={expertTab}
      onExpertTabChange={setExpertTab}
    />
  );

  const configInspector = (
    <ExperimentConfigInspector
      values={{
        customModelName,
        modelSource,
        modelArchitecture: normalizedModelArchitecture,
        useSphere,
        trainingDatasetLabel: trainingDataset === TRAINING_DATASET_EARTH_MERRA2_V2 ? copy.datasetEarthMerra2V2
          : trainingDataset === TRAINING_DATASET_MCD_OVERVIEW ? copy.datasetMcdOverview : copy.datasetOpenMarsMcd,
      }}
      resources={{
        user,
        selectedUploadedModel,
        selectedUploadedModelLabel,
      }}
      validation={{
        modelNameError,
        transferStartBlocked,
        selectedUploadedModelInvalid,
      }}
      readiness={readiness}
      copy={copy}
      onEditCustomParams={() => setExpertTab('customParams')}
      onRequestLogin={() => openAuthModal('login')}
      isZh={isZh}
    />
  );

  const configRunBar = (
    <ExperimentRunBar
      resources={{ user }}
      validation={{ startDisabled, startButtonLabel }}
      readiness={readiness}
      copy={copy}
      onStart={handleStartTraining}
      pendingSubmission={isProcessing ? copy.starting : ''}
      barRef={setRunBarNode}
    />
  );

  const monitorWorkspace = (
    <ExperimentRunMonitor
      activeTask={activeTask}
      progress={resolvedProgress}
      logs={logs}
      isProcessing={isProcessing}
      isLight={isLight}
      autoScrollPinned={autoScrollPinned}
      logContainerRef={logContainerRef}
      onScroll={handleScroll}
      onStop={handleStopTask}
      onCancel={handleCancelTask}
      copy={copy}
    />
  );

  const resultWorkspace = (
    <ExperimentResultPanel
      activeTask={activeTask}
      progress={resolvedProgress}
      logs={logs}
      isLight={isLight}
      isProcessing={isProcessing}
      copy={copy}
      channelOrder={activeChannelOrder}
      channelMap={activeChannelMap}
      baselineLabel={baselineLabel}
      onPredict={handleAnalyzeTask}
      onCompare={handleCompareTask}
      onCopyConfig={handleCopyConfig}
      onRename={setRenameTask}
      onDelete={setConfirmDeleteId}
      onTest={setTestTaskId}
      onFormatValue={(key, value) => formatHyperValue(key, value, t)}
    />
  );

  const directoryWorkspace = (
    <ExperimentDirectory
      tasks={tasks}
      tagState={tagState}
      activeTaskId={activeTaskId}
      isProcessing={isProcessing}
      onSelectTask={handleSelectTask}
      onStop={handleStopTask}
      tasksLoading={tasksLoading}
      tasksError={tasksError}
      onCreateTask={handleCreateExperiment}
      onRetryTasks={() => {
        setTasksError(false);
        loadTasks().catch(() => {});
      }}
      copy={copy}
      locale={locale}
      isZh={isZh}
      channelOrder={activeChannelOrder}
      channelMap={activeChannelMap}
      baselineLabel={baselineLabel}
    />
  );

  return (
    <div
      className="model-training-page"
      style={{
        position: 'relative',
        padding: '104px 0 40px',
        // 铺满整个可用宽度（不再固定 1460 上限），超宽屏由 CSS 设置上限。
        width: '100%',
        margin: '0 auto',
        minHeight: '100vh',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: '48px 0 auto',
          height: 320,
          pointerEvents: 'none',
          background: isLight
            ? 'radial-gradient(circle at 12% 10%, rgba(74,158,255,0.12), transparent 32%), radial-gradient(circle at 84% 0%, rgba(199,91,57,0.10), transparent 28%)'
            : 'radial-gradient(circle at 12% 10%, rgba(74,158,255,0.10), transparent 32%), radial-gradient(circle at 84% 0%, rgba(199,91,57,0.10), transparent 28%)',
        }}
      />

      <ExperimentCenterShell
        view={view}
        onChangeView={changeView}
        stage={stage}
        activeTask={activeTask}
        onCreate={handleCreateExperiment}
        directory={directoryWorkspace}
        workspace={{
          configure: configWorkspace,
          monitor: monitorWorkspace,
          result: resultWorkspace,
        }}
        inspector={configInspector}
        runBar={configRunBar}
        runBarHeight={runBarHeight}
      />

      {confirmDeleteId ? (
        <ConfirmDialog
          title={t('modelTraining.confirmDelete')}
          message={t('modelTraining.confirmDeleteMsg', { id: confirmDeleteId })}
          confirmLabel={isProcessing ? t('modelTraining.deleting') : t('modelTraining.confirmDelete')}
          cancelLabel={t('modelTraining.cancel')}
          onConfirm={() => handleDeleteTask(confirmDeleteId)}
          onCancel={() => setConfirmDeleteId(null)}
          confirmColor="#d95c5c"
        />
      ) : null}

      {testTaskId ? <ModelTestModal taskId={testTaskId} onClose={() => setTestTaskId(null)} /> : null}

      {renameTask ? (
        <RenameModelDialog
          task={renameTask}
          tasks={tasks}
          language={settings.language}
          onClose={() => setRenameTask(null)}
          onSave={async (name) => {
            const normalizedName = normalizeTrainedModelName(name);
            await handleRenameTask(normalizedName);
          }}
        />
      ) : null}
    </div>
  );
}
