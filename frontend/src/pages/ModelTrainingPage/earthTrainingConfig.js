/**
 * Earth MERRA-2 训练配置的纯函数。
 *
 * 这里集中 Earth 的固定契约（数据集身份、通道顺序、7 天输入 / 3 天输出、单位），
 * 让训练页与测试共用同一份定义，而不是在 JSX 里散落字面量。所有函数都不依赖
 * React，也不发请求：请求构造与校验可以单独测试。
 *
 * Earth 训练首期只支持官方 DLinear，TO3 必选、四个辅助变量可选；数据集版本、
 * 发布指纹与网格由服务端 registry 提供，这里不复制一份。
 */

import {
  TRAINING_DATASET_EARTH_MERRA2_V2,
  sanitizeNonNegativeInteger,
  sanitizePositiveInteger,
  sanitizePositiveNumber,
} from './trainingParamSanitizers.js';

export const EARTH_DATASET_ID = TRAINING_DATASET_EARTH_MERRA2_V2;
export const EARTH_MODEL_ARCHITECTURE = 'dlinear';
/** 上传模型的架构标记；真正的代码由服务端固定的模型引用决定。 */
export const EARTH_UPLOADED_ARCHITECTURE = 'uploaded';
/** Earth 支持两种模型来源：官方 DLinear 与用户上传模型。 */
export const EARTH_MODEL_SOURCE_OFFICIAL = 'official';
export const EARTH_MODEL_SOURCE_UPLOADED = 'uploaded';
export const EARTH_MODEL_SOURCES = [EARTH_MODEL_SOURCE_OFFICIAL, EARTH_MODEL_SOURCE_UPLOADED];
export const EARTH_MODEL_SOURCE = EARTH_MODEL_SOURCE_OFFICIAL;
export const EARTH_WINDOW = 7;
export const EARTH_HORIZON = 3;
export const EARTH_DEFAULT_SPLIT_RATIOS = {
  train_ratio: 0.7,
  validation_ratio: 0.2,
  test_ratio: 0.1,
};
export const EARTH_TARGET_CHANNEL = 'TO3';
export const EARTH_TARGET_UNIT = 'DU';

/** 规范通道顺序：TO3 固定第一，辅助变量按此顺序进入模型。 */
export const EARTH_CHANNEL_ORDER = ['TO3', 'U10M', 'V10M', 'T2M', 'SWGDN'];
export const EARTH_OPTIONAL_CHANNELS = ['U10M', 'V10M', 'T2M', 'SWGDN'];

export const EARTH_CHANNEL_META = {
  TO3: { name: 'Total column ozone', short: 'TO3', unit: 'DU', locked: true },
  U10M: { name: '10 m eastward wind', short: 'U10M', unit: 'm s-1' },
  V10M: { name: '10 m northward wind', short: 'V10M', unit: 'm s-1' },
  T2M: { name: '2 m air temperature', short: 'T2M', unit: 'K' },
  SWGDN: { name: 'Surface incoming shortwave flux', short: 'SWGDN', unit: 'W m-2' },
};

export const EARTH_PARAM_BOUNDS = {
  epochs: { min: 1, max: 1000, fallback: 10 },
  batch_size: { min: 1, max: 64, fallback: 8 },
  seed: { min: 0, max: 2147483647, fallback: 11 },
  early_stopping_patience: { min: 0, max: 200, fallback: 0 },
  linear_hidden_layers: { min: 1, max: 4, fallback: 2 },
};

export function normalizeEarthSplitRatios(trainRatio, validationRatio, testRatio) {
  const values = [trainRatio, validationRatio, testRatio].map((value, index) => {
    const fallback = Object.values(EARTH_DEFAULT_SPLIT_RATIOS)[index];
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  });
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    train_ratio: values[0],
    validation_ratio: values[1],
    test_ratio: values[2],
    valid: values[0] > 0 && values[1] >= 0 && values[2] > 0 && values.every((value) => value < 1) && Math.abs(total - 1) <= 1e-6,
    total,
  };
}

export function isEarthTrainingDataset(datasetId) {
  return String(datasetId || '').toLowerCase() === EARTH_DATASET_ID;
}

/** 按规范顺序返回选中的辅助通道，去重并丢弃非法项。 */
export function normalizeEarthSelectedChannels(selectedChannels) {
  const requested = new Set(
    (Array.isArray(selectedChannels) ? selectedChannels : [])
      .map((value) => String(value || '').trim().toUpperCase())
      .filter((value) => EARTH_OPTIONAL_CHANNELS.includes(value)),
  );
  return EARTH_OPTIONAL_CHANNELS.filter((channel) => requested.has(channel));
}

export function getEarthChannelOptions() {
  return EARTH_OPTIONAL_CHANNELS.map((channel) => ({
    channel,
    ...EARTH_CHANNEL_META[channel],
  }));
}

/**
 * 构造 Earth 训练超参数。
 *
 * 只发送服务端白名单字段：不发送 dataset_version / dataset_fingerprint /
 * dataset_snapshot（由服务端生成），也不发送迁移字段。选择上传模型时只发送
 * `model_source` 与自定义参数值；模型 ID/版本/内容哈希与快照由服务端根据
 * 上传记录生成并固定。
 */
export function buildEarthTrainingHyperparameters({
  selectedChannels = EARTH_OPTIONAL_CHANNELS,
  epochs,
  batchSize,
  learningRate,
  seed,
  earlyStoppingPatience,
  linearHiddenLayers,
  modelSource = EARTH_MODEL_SOURCE_OFFICIAL,
  customModelParams = null,
  trainRatio = EARTH_DEFAULT_SPLIT_RATIOS.train_ratio,
  validationRatio = EARTH_DEFAULT_SPLIT_RATIOS.validation_ratio,
  testRatio = EARTH_DEFAULT_SPLIT_RATIOS.test_ratio,
} = {}) {
  const uploaded = modelSource === EARTH_MODEL_SOURCE_UPLOADED;
  const hyperparameters = {
    training_dataset: EARTH_DATASET_ID,
    model_architecture: uploaded ? EARTH_UPLOADED_ARCHITECTURE : EARTH_MODEL_ARCHITECTURE,
    model_source: uploaded ? EARTH_MODEL_SOURCE_UPLOADED : EARTH_MODEL_SOURCE_OFFICIAL,
    window: EARTH_WINDOW,
    horizon: EARTH_HORIZON,
    use_sphere: false,
    transfer_learning: false,
    train_ratio: Number(trainRatio),
    validation_ratio: Number(validationRatio),
    test_ratio: Number(testRatio),
    selected_channels: normalizeEarthSelectedChannels(selectedChannels),
    // 上限必须与服务端契约一致：超界值在此夹到文档范围，而不是留给服务端 422。
    epochs: sanitizePositiveInteger(epochs, EARTH_PARAM_BOUNDS.epochs.fallback, EARTH_PARAM_BOUNDS.epochs.min, EARTH_PARAM_BOUNDS.epochs.max),
    batch_size: sanitizePositiveInteger(batchSize, EARTH_PARAM_BOUNDS.batch_size.fallback, EARTH_PARAM_BOUNDS.batch_size.min, EARTH_PARAM_BOUNDS.batch_size.max),
    learning_rate: sanitizePositiveNumber(learningRate, 0.001, 0.000001, 1),
    seed: sanitizeNonNegativeInteger(seed, EARTH_PARAM_BOUNDS.seed.fallback, EARTH_PARAM_BOUNDS.seed.max),
    early_stopping_patience: sanitizeNonNegativeInteger(earlyStoppingPatience, 0, EARTH_PARAM_BOUNDS.early_stopping_patience.max),
  };
  if (uploaded) {
    // 官方模型没有 linear_hidden_layers 这个开关；上传模型由源码自己决定结构。
    hyperparameters.custom_model_params = customModelParams && typeof customModelParams === 'object'
      ? { ...customModelParams }
      : {};
  } else {
    hyperparameters.linear_hidden_layers = sanitizePositiveInteger(
      linearHiddenLayers,
      EARTH_PARAM_BOUNDS.linear_hidden_layers.fallback,
      EARTH_PARAM_BOUNDS.linear_hidden_layers.min,
      EARTH_PARAM_BOUNDS.linear_hidden_layers.max,
    );
  }
  return hyperparameters;
}

/**
 * 读取某个上传模型的 Earth 兼容性结论。
 *
 * 结论来自服务端（上传校验时的 Earth dry-run），前端只负责展示：Mars 可用不等于
 * Earth 可用，缺少结论一律按不可用处理并说明原因。
 */
export function readEarthUploadedModelCompatibility(compatibility) {
  if (!compatibility || typeof compatibility !== 'object') {
    return { known: false, compatible: false, reason: 'earth_compatibility_unknown' };
  }
  const reasons = Array.isArray(compatibility.reasons) ? compatibility.reasons.filter(Boolean) : [];
  return {
    known: true,
    compatible: compatibility.compatible === true,
    reason: reasons[0] || null,
    reasons,
    warnings: Array.isArray(compatibility.warnings) ? compatibility.warnings : [],
    outputShape: Array.isArray(compatibility.output_shape) ? compatibility.output_shape : null,
    declaresEarthFeed: compatibility.declares_earth_feed === true,
  };
}

/** 当前选中的上传模型是否可用于 Earth 训练；返回阻塞原因。 */
export function getEarthUploadedSelectionBlocker({ modelSource, uploadedModelId, compatibility } = {}) {
  if (modelSource !== EARTH_MODEL_SOURCE_UPLOADED) return null;
  if (!uploadedModelId) return 'uploaded_model_required';
  const verdict = readEarthUploadedModelCompatibility(compatibility);
  if (!verdict.known) return 'earth_compatibility_unknown';
  if (!verdict.compatible) return verdict.reason || 'uploaded_model_not_earth_compatible';
  return null;
}

/**
 * 从 registry 描述符读取 Earth 训练可用性。
 *
 * 入口已接通（capabilities.training）与数据是否齐备（availability）是两件事：
 * 缺包时仍展示选项与原因，只是不允许提交。
 */
export function readEarthDatasetAvailability(descriptor) {
  if (!descriptor) {
    return { present: false, selectable: false, reason: 'catalog_missing' };
  }
  const available = descriptor.availability === 'available';
  const wired = descriptor.capabilities?.training !== false;
  return {
    present: true,
    selectable: available && wired,
    availability: descriptor.availability,
    reason: descriptor.availability_reason || (wired ? null : 'training_not_wired'),
    datasetVersion: descriptor.dataset_version || null,
    fingerprint: descriptor.dataset_fingerprint || null,
    splits: descriptor.splits || null,
    trainingProfile: descriptor.training_profile || null,
    displayName: descriptor.display_name || descriptor.dataset_id,
  };
}

/** 日期划分与 7→3 样本数；样本数只从真实天数推算，不硬编码。 */
export function describeEarthSplitSamples(splits, window = EARTH_WINDOW, horizon = EARTH_HORIZON) {
  if (!splits || typeof splits !== 'object') return [];
  return ['train', 'validation', 'test']
    .filter((name) => splits[name])
    .map((name) => {
      const days = Number(splits[name].days) || 0;
      return {
        name,
        start: splits[name].start,
        end: splits[name].end,
        days,
        windows: Math.max(0, days - window - horizon + 1),
      };
    });
}

/** 展示用单位行：辅助输入各自单位，目标固定 DU。 */
export function describeEarthInputUnits(selectedChannels) {
  const channels = [EARTH_TARGET_CHANNEL, ...normalizeEarthSelectedChannels(selectedChannels)];
  return channels.map((channel) => ({
    channel,
    unit: EARTH_CHANNEL_META[channel]?.unit || '',
  }));
}

/** 提交前的本地就绪检查；服务端仍会独立复核。 */
export function getEarthTrainingReadiness({
  datasetAvailability,
  epochs,
  batchSize,
  learningRate,
  modelName,
} = {}) {
  const blockers = [];
  if (!datasetAvailability?.present) blockers.push('catalog_missing');
  else if (!datasetAvailability.selectable) blockers.push('dataset_unavailable');
  if (!String(modelName || '').trim()) blockers.push('model_name_required');
  const parsedEpochs = Number(epochs);
  if (!Number.isFinite(parsedEpochs) || parsedEpochs < 1 || parsedEpochs > 1000) blockers.push('epochs_out_of_range');
  const parsedBatch = Number(batchSize);
  if (!Number.isFinite(parsedBatch) || parsedBatch < 1 || parsedBatch > 64) blockers.push('batch_size_out_of_range');
  const parsedLr = Number(learningRate);
  if (!Number.isFinite(parsedLr) || parsedLr <= 0 || parsedLr > 1) blockers.push('learning_rate_out_of_range');
  return { ready: blockers.length === 0, blockers };
}

/**
 * 场景草稿快照：切走时保存、切回时恢复。
 *
 * Earth 与火星各自保留完整草稿（含上传模型选择与自定义参数），因此两个场景的
 * 配置不会互相覆盖。
 */
export function captureTrainingDraft(values) {
  return {
    trainingDataset: values.trainingDataset,
    modelSource: values.modelSource,
    selectedUploadedModelId: values.selectedUploadedModelId || '',
    modelArchitecture: values.modelArchitecture,
    useSphere: Boolean(values.useSphere),
    windowValue: values.windowValue,
    horizon: values.horizon,
    transferEnabled: Boolean(values.transferEnabled),
    selectedChannels: Array.isArray(values.selectedChannels) ? [...values.selectedChannels] : [],
    customModelParams: values.customModelParams && typeof values.customModelParams === 'object'
      ? { ...values.customModelParams }
      : {},
  };
}

/** 兼容旧命名：火星草稿就是通用草稿。 */
export const captureMarsTrainingSnapshot = captureTrainingDraft;

/**
 * Earth 生效时的表单覆盖值。
 *
 * ``storedMarsSnapshot`` 只被保存，不会被应用：这里的返回值必须让 Earth 的固定
 * 契约生效，因此固定值写在展开之后。
 */
export function applyEarthTrainingDefaults({ storedMarsSnapshot = null } = {}) {
  return {
    trainingDataset: EARTH_DATASET_ID,
    modelSource: EARTH_MODEL_SOURCE_OFFICIAL,
    selectedUploadedModelId: '',
    modelArchitecture: EARTH_MODEL_ARCHITECTURE,
    useSphere: false,
    windowValue: EARTH_WINDOW,
    horizon: EARTH_HORIZON,
    transferEnabled: false,
    selectedChannels: [...EARTH_OPTIONAL_CHANNELS],
    customModelParams: {},
    storedMarsSnapshot,
  };
}

/** 从火星切到 Earth 时恢复的 Earth 草稿；没有草稿则回到 Earth 默认值。 */
export function resolveEarthTrainingRestore(snapshot) {
  if (!snapshot) return null;
  const modelSource = EARTH_MODEL_SOURCES.includes(snapshot.modelSource)
    ? snapshot.modelSource
    : EARTH_MODEL_SOURCE_OFFICIAL;
  return {
    trainingDataset: EARTH_DATASET_ID,
    modelSource,
    selectedUploadedModelId: snapshot.selectedUploadedModelId || '',
    modelArchitecture: modelSource === EARTH_MODEL_SOURCE_UPLOADED
      ? EARTH_UPLOADED_ARCHITECTURE
      : EARTH_MODEL_ARCHITECTURE,
    useSphere: false,
    windowValue: EARTH_WINDOW,
    horizon: EARTH_HORIZON,
    transferEnabled: false,
    selectedChannels: normalizeEarthSelectedChannels(snapshot.selectedChannels),
    customModelParams: snapshot.customModelParams && typeof snapshot.customModelParams === 'object'
      ? { ...snapshot.customModelParams }
      : {},
  };
}

/** 从 Earth 切回火星时恢复的字段；没有快照则回到页面默认值。 */
export function resolveMarsTrainingRestore(snapshot) {
  if (!snapshot) return null;
  return {
    trainingDataset: snapshot.trainingDataset,
    modelSource: snapshot.modelSource,
    selectedUploadedModelId: snapshot.selectedUploadedModelId || '',
    modelArchitecture: snapshot.modelArchitecture,
    useSphere: Boolean(snapshot.useSphere),
    windowValue: snapshot.windowValue,
    horizon: snapshot.horizon,
    transferEnabled: Boolean(snapshot.transferEnabled),
    selectedChannels: Array.isArray(snapshot.selectedChannels) ? [...snapshot.selectedChannels] : [],
    customModelParams: snapshot.customModelParams && typeof snapshot.customModelParams === 'object'
      ? { ...snapshot.customModelParams }
      : {},
  };
}
