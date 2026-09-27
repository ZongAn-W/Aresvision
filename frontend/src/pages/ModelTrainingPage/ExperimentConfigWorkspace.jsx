import { useEffect, useState } from 'react';
import C from '../../constants/colors';
import UploadedModelPanel from './UploadedModelPanel';
import DynamicModelParamsForm from './DynamicModelParamsForm';
import ModelArchitectureSelector from './ModelArchitectureSelector';
import { TagPicker } from '../../components/TrainingTags/TagControls';
import {
  TRAINING_DATASET_MCD_OVERVIEW,
  TRAINING_DATASET_OPENMARS_MCD,
  getModelStructureParamLabel,
  isRecurrentArchitecture,
} from './trainingParamSanitizers';
import { getExperimentArchitectureLabel } from './experimentCenterModel';
import './experimentCenter.css';

const OPEN_INTERVAL_FLOAT_FIELDS = new Set(['initial_history_weight', 'initial_translation_weight']);
const BASE_INPUT_CHANNEL = 'O3';

/**
 * 专家参数页签。
 *
 * 页签集合按模型来源决定，避免出现“去另一个地方”的空页签：
 * 上传模型 → 自定义参数 / 训练策略 / 迁移学习 / 实验标签；
 * 官方模型 → 模型结构 / 训练策略 / 迁移学习 / 实验标签。
 * 权重上传与冻结策略都在「迁移学习」里，不再单独占一个页签。
 */
const UPLOADED_EXPERT_TABS = ['customParams', 'strategy', 'transfer', 'tags'];
const OFFICIAL_EXPERT_TABS = ['structure', 'strategy', 'transfer', 'tags'];

function frameCount(value) {
  const numeric = Math.max(1, Math.min(12, Number(value) || 0));
  return Array.from({ length: numeric });
}

/**
 * 配置实验工作区（中间配置画布）。
 *
 * 只接收数据和回调：不调用 startTrainingTask，不持有轮询；
 * 「开始实验」由底部运行条通过父组件的 onStart 提交，避免出现两套提交状态。
 * 表单状态全部来自页面控制器，因此切换页签、收起目录或筛选目录都不会丢值。
 */
export default function ExperimentConfigWorkspace({
  values,
  resources,
  validation,
  actions,
  ui,
  copy,
  t,
  isZh,
  channelOrder,
  channelMap,
  modelNameLabel,
  structureLabelLanguage,
  availableTransferFreezeModes,
  transferFreezeModeLabels,
  presetStatusText,
  controlVisibility,
  pendingSubmission,
  copyConfigWarnings = [],
  expertTab,
  onExpertTabChange,
  readiness,
}) {
  const {
    customModelName,
    newTaskTagIds,
    trainingDataset,
    modelSource,
    selectedUploadedModelId,
    selectedChannels,
    modelArchitecture,
    useSphere,
    epochs,
    batchSize,
    learningRate,
    windowValue,
    horizon,
    earlyStoppingPatience,
    seed,
    transferEnabled,
    transferSourceType,
    transferSourceTaskId,
    transferFreezeMode,
    finetuneLearningRate,
  } = values;
  const {
    uploadedModels,
    completedTransferTasks,
    trainingWeights,
    selectedUploadedModel,
    selectedUploadedModelLabel,
    selectedUploadedParamSchema,
    selectedTrainingWeight,
    selectedTrainingWeightId,
    tagState,
    isProcessing,
  } = resources;
  const {
    modelNameError,
    visibleCustomModelParamErrors,
    transferStartBlocked,
    transferStructureLocked,
    transferStructureDisabled,
    customParamCount,
  } = validation;
  const {
    onModelNameChange,
    onTrainingDatasetChange,
    onModelSourceChange,
    onSelectUploadedModel,
    onUploadModel,
    onRevalidateModel,
    onDeleteUploadedModel,
    onCustomModelParamChange,
    onChannelToggle,
    onArchitectureSelect,
    onToggleSphere,
    onToggleArchitecturePicker,
    onStructureParamChange,
    onLayersChange,
    onDimChange,
    onTransferEnabledChange,
    onTransferSourceTypeChange,
    onTransferSourceTaskChange,
    onSelectTrainingWeight,
    onUploadWeight,
    onDeleteWeight,
    onFoldChange,
    onTagIdsChange,
    onCreateTag,
  } = actions;
  const { sectionTitleStyle, fieldLabelStyle, fieldHintStyle, inputStyle } = ui;

  const normalizedArchitecture = values.normalizedModelArchitecture;
  const activeStructureConfig = values.activeStructureConfig || [];
  const activeStructureParams = values.activeStructureParams || {};
  const structureSummary = values.structureSummary;
  const officialModelControls = controlVisibility.officialModelControls;
  const isUploaded = modelSource === 'uploaded';
  const architecturePickerOpen = resources.architecturePickerOpen;
  const isRecurrentModel = isRecurrentArchitecture(normalizedArchitecture);

  const expertTabs = isUploaded ? UPLOADED_EXPERT_TABS : OFFICIAL_EXPERT_TABS;
  const defaultExpertTab = isUploaded ? 'customParams' : 'structure';
  const [localTab, setLocalTab] = useState(defaultExpertTab);
  const activeTab = expertTabs.includes(expertTab) ? expertTab : (expertTabs.includes(localTab) ? localTab : defaultExpertTab);
  const setActiveTab = (tab) => {
    if (!expertTabs.includes(tab)) return;
    setLocalTab(tab);
    onExpertTabChange?.(tab);
  };

  // 切换模型来源时把页签落到该来源最常用的那一页。
  useEffect(() => {
    setLocalTab(defaultExpertTab);
  }, [defaultExpertTab]);

  const uploadedModel = selectedUploadedModel;
  const uploadedValidationStatus = uploadedModel?.validation_status || '';
  const uploadedStatusLabel = uploadedValidationStatus === 'valid'
    ? copy.uploadedModelValid
    : uploadedValidationStatus === 'pending'
      ? copy.uploadedModelPending
      : copy.uploadedModelInvalid;
  const modelBlockState = isUploaded
    ? (uploadedModel
        ? (uploadedValidationStatus === 'valid' ? 'valid' : 'invalid')
        : 'empty')
    : 'official';
  const flowModelLabel = isUploaded
    ? (uploadedModel?.original_filename || copy.uploadedModelUnnamed)
    : getExperimentArchitectureLabel(modelArchitecture);
  const isReadinessReady = Boolean(readiness?.canTrain);

  const parameterFields = [
    {
      key: 'windowValue',
      label: copy.windowLabel,
      code: copy.codeWindow,
      unit: copy.unitSteps,
      step: '1',
      min: '1',
      max: '30',
      locked: true,
    },
    {
      key: 'horizon',
      label: copy.horizonLabel,
      code: copy.codeHorizon,
      unit: copy.unitPredictSteps,
      step: '1',
      min: '1',
      max: '30',
      locked: true,
    },
    { key: 'epochs', label: copy.epochsLabel, code: copy.codeEpochs, unit: copy.unitEpochs, step: '1', min: '1' },
    {
      key: 'batchSize',
      label: copy.batchSizeLabel,
      code: copy.codeBatch,
      unit: copy.unitSamples,
      step: '1',
      min: '1',
    },
    {
      key: 'learningRate',
      label: copy.learningRateLabel,
      code: copy.codeLr,
      unit: copy.unitLearningRate,
      step: '0.0001',
      min: '0.000001',
    },
  ];
  const expertTabLabels = {
    customParams: copy.expertTabCustomParams,
    structure: copy.expertStructureTab,
    strategy: copy.expertTabStrategy,
    transfer: copy.expertTabTransfer,
    tags: copy.expertTabTags,
  };

  return (
    <div className="experiment-center-stack" data-config-canvas="true">
      {copyConfigWarnings.length > 0 ? (
        <div className="experiment-config-warning" role="status">
          <strong>{copy.copyConfigWarningTitle}</strong>
          {copyConfigWarnings.map((code) => (
            <span key={code}>{copy.copyConfigWarningLabels[code] || copy.copyConfigWarningFallback}</span>
          ))}
        </div>
      ) : null}

      {/* 画布头部：可编辑实验名称 + 简短任务说明，不再重复整段配置摘要。 */}
      <header className="experiment-canvas-head">
        <div className="experiment-canvas-head-main">
          <label className="sr-only" htmlFor="experiment-name-input">{copy.canvasNameLabel}</label>
          <input
            id="experiment-name-input"
            type="text"
            className="experiment-canvas-name"
            placeholder={t('modelTraining.modelNamingPlaceholder')}
            value={customModelName}
            onChange={onModelNameChange}
            aria-invalid={Boolean(modelNameError)}
            aria-describedby="experiment-name-hint"
          />
          <p className="experiment-canvas-meta" id="experiment-name-hint">
            {copy.canvasExperimentMeta}
          </p>
          {modelNameError ? (
            <p className="experiment-canvas-name-error" role="alert">{modelNameError}</p>
          ) : null}
        </div>
        <div
          className="experiment-canvas-state"
          data-canvas-state={isReadinessReady ? 'ready' : 'pending'}
          role="status"
        >
          {isReadinessReady ? copy.runBarReady : copy.runBarNotReady}
        </div>
      </header>

      {/* 01 任务定义：数据集与模型来源并排 */}
      <section className="experiment-canvas-section" data-config-group="task">
        <div className="experiment-section-kicker">
          <span className="experiment-section-index" aria-hidden="true">01</span>
          <span className="experiment-section-title" style={sectionTitleStyle}>{copy.sectionTask}</span>
          <span className="experiment-section-hint">{copy.sectionTaskHint}</span>
        </div>

        <div className="experiment-task-grid">
          <div className="experiment-choice-block" data-active="true">
            <div className="experiment-choice-label">
              <span>{copy.trainingDataset}</span>
              <em>{trainingDataset === TRAINING_DATASET_MCD_OVERVIEW ? 'MCD' : 'MARS'}</em>
            </div>
            <select
              className="experiment-choice-select"
              style={inputStyle}
              value={trainingDataset}
              aria-label={copy.trainingDataset}
              onChange={(event) => onTrainingDatasetChange(event.target.value)}
            >
              <option value={TRAINING_DATASET_OPENMARS_MCD}>{copy.datasetOpenMarsMcd}</option>
              <option value={TRAINING_DATASET_MCD_OVERVIEW}>{copy.datasetMcdOverview}</option>
            </select>
            <div className="experiment-choice-meta">
              {trainingDataset === TRAINING_DATASET_MCD_OVERVIEW ? copy.datasetHintMcdOverview : copy.datasetHintOpenMarsMcd}
            </div>
          </div>

          <div className="experiment-choice-block" data-active="true" data-model-block={modelBlockState}>
            <div className="experiment-choice-label">
              <span>{copy.modelSource}</span>
              <em>{isUploaded ? 'YOUR MODEL' : 'OFFICIAL'}</em>
            </div>
            <div className="experiment-source-toggle" role="group" aria-label={copy.modelSource} data-model-source-toggle="true">
              {[
                { value: 'uploaded', label: copy.modelSourceUploaded, hint: copy.uploadedModelDesc },
                { value: 'official', label: copy.modelSourceOfficial, hint: copy.officialModelDesc },
              ].map((option) => {
                const active = modelSource === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    className="experiment-source-option"
                    aria-pressed={active}
                    data-model-source-option={option.value}
                    disabled={!resources.user || transferStructureDisabled}
                    onClick={() => onModelSourceChange(option.value)}
                  >
                    <strong>{option.label}</strong>
                    <small>{option.hint}</small>
                  </button>
                );
              })}
            </div>

            {isUploaded ? (
              <UploadedModelPanel
                models={uploadedModels}
                selectedId={selectedUploadedModelId}
                onSelect={onSelectUploadedModel}
                onUpload={onUploadModel}
                onRevalidate={onRevalidateModel}
                onDelete={onDeleteUploadedModel}
                uploading={resources.uploadingModel}
                busy={isProcessing || transferStructureLocked}
                selectionDisabled={transferStructureLocked}
                guideDownloadUrl={resources.guideDownloadUrl}
                templateDownloadUrl={resources.templateDownloadUrl}
                inlineError={validation.uploadedModelInlineError}
                statusLabel={uploadedStatusLabel}
                statusTone={uploadedValidationStatus === 'valid' ? 'ok' : 'warn'}
                onEditParams={() => {
                  setActiveTab('customParams');
                  const tab = document.getElementById('experiment-expert-tab-customParams');
                  tab?.scrollIntoView({ block: 'start' });
                  tab?.focus({ preventScroll: true });
                }}
                labels={{
                  title: copy.groupUploadedModel,
                  upload: copy.uploadModel,
                  uploadAgain: copy.uploadedModelReplace,
                  downloadGuide: copy.downloadModelGuide,
                  downloadTemplate: copy.downloadModelTemplate,
                  uploading: copy.uploadingModel,
                  revalidate: copy.revalidateModel,
                  replace: copy.uploadedModelReplace,
                  manage: copy.uploadedModelManage,
                  delete: copy.deleteUploadedModel,
                  valid: copy.uploadedModelValid,
                  invalid: copy.uploadedModelInvalid,
                  pending: copy.uploadedModelPending,
                  ready: copy.uploadedModelReady,
                  unnamed: copy.uploadedModelUnnamed,
                  noFilename: copy.uploadedModelNoFilename,
                  missing: copy.uploadedModelEmptyTitle,
                  typeBadge: copy.uploadedModelTypeBadge,
                  hint: copy.uploadedModelEmptyHint,
                  formatTitle: copy.uploadedModelFormatTitle,
                  formatItems: copy.uploadedModelFormatItems,
                  summaryLabel: copy.uploadedModelSummaryLabel,
                  summaryValidCount: copy.uploadedModelValidCount,
                  summaryParamCount: copy.uploadedModelParamCount,
                  editParams: copy.editCustomParams,
                  versionLabel: copy.inspectorModelVersion,
                  validationLabel: copy.inspectorValidation,
                  officialHint: copy.modelSourceOfficialHint,
                }}
                sectionTitleStyle={sectionTitleStyle}
                fieldLabelStyle={fieldLabelStyle}
                fieldHintStyle={fieldHintStyle}
              />
            ) : (
              <div className="experiment-official-block">
                <ModelArchitectureSelector
                  value={modelArchitecture}
                  onSelect={onArchitectureSelect}
                  copy={copy}
                  isZh={isZh}
                  disabled={transferStructureLocked}
                  sectionTitleStyle={sectionTitleStyle}
                  fieldHintStyle={fieldHintStyle}
                  inputStyle={inputStyle}
                  expanded={architecturePickerOpen}
                  onToggleExpanded={onToggleArchitecturePicker}
                />
                <label className="experiment-toggle-line">
                  <input type="checkbox" checked={useSphere} onChange={onToggleSphere} disabled={transferStructureLocked} />
                  {copy.sphereToggle}
                </label>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* 02 输入与预测：紧凑载荷条 + 序列图示 */}
      <section className="experiment-canvas-section" data-config-group="payload">
        <div className="experiment-section-kicker">
          <span className="experiment-section-index" aria-hidden="true">02</span>
          <span className="experiment-section-title" style={sectionTitleStyle}>{copy.sectionPayload}</span>
          <span className="experiment-section-hint">{copy.sectionPayloadHint}</span>
        </div>

        <div className="experiment-payload-bar" role="group" aria-label={t('modelTraining.inputChannels')}>
          <span className="experiment-payload-lock" data-payload-base="true">
            <span>O₃</span>
            {copy.inspectorBaseInput}
          </span>
          {channelOrder.map((channel) => {
            const active = selectedChannels.includes(channel);
            return (
              <button
                key={channel}
                type="button"
                className="experiment-channel-chip"
                aria-pressed={active}
                data-channel={channel}
                disabled={transferStructureLocked}
                onClick={() => onChannelToggle(channel)}
              >
                <b>{channelMap[channel]?.short || channel}</b>
                {channelMap[channel]?.name || channel}
              </button>
            );
          })}
          <span className="experiment-payload-count" data-payload-count={selectedChannels.length}>
            {copy.payloadCountLabel(selectedChannels.length, channelOrder.length)}
          </span>
        </div>

        <div className="experiment-flow" data-sequence-diagram="true" aria-label={copy.sectionPayload}>
          <div className="experiment-flow-end" data-sequence="input">
            <span className="experiment-flow-caption">{copy.flowInputCaption(windowValue || '--')}</span>
            <div className="experiment-flow-frames" aria-hidden="true">
              {frameCount(windowValue).map((_, index, list) => (
                <span className="experiment-flow-frame" key={`in-${index}`}>
                  {copy.flowFramePast(list.length - 1 - index)}
                </span>
              ))}
            </div>
          </div>
          <span className="experiment-flow-connector" aria-hidden="true" />
          <div className="experiment-flow-model" data-sequence="model">
            <span className="experiment-flow-model-title">
              {isUploaded ? copy.flowUploadedModel : getExperimentArchitectureLabel(modelArchitecture)}
            </span>
            <small>
              {isUploaded
                ? (flowModelLabel || copy.uploadedModelUnnamed)
                : (useSphere ? `${copy.sphereToggle}: ${copy.enabled}` : copy.flowOfficialModel)}
            </small>
          </div>
          <span className="experiment-flow-connector" aria-hidden="true" />
          <div className="experiment-flow-end" data-sequence="output">
            <span className="experiment-flow-caption">{copy.flowOutputCaption(horizon || '--')}</span>
            <div className="experiment-flow-frames" aria-hidden="true">
              {frameCount(horizon).map((_, index) => (
                <span className="experiment-flow-frame" key={`out-${index}`}>
                  {copy.flowFrameFuture(index + 1)}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* 03 训练参数矩阵 */}
      <section className="experiment-canvas-section" data-config-group="training">
        <div className="experiment-section-kicker">
          <span className="experiment-section-index" aria-hidden="true">03</span>
          <span className="experiment-section-title" style={sectionTitleStyle}>{copy.sectionTraining}</span>
          <span className="experiment-section-hint">{copy.sectionTrainingHint}</span>
        </div>
        <div className="experiment-param-grid">
          {parameterFields.map((field) => (
            <label className="experiment-param-cell" key={field.key} data-parameter={field.key}>
              <span className="experiment-param-label">
                {field.label}
                <code>{field.code}</code>
              </span>
              <input
                type="number"
                value={values[field.key]}
                step={field.step}
                min={field.min}
                max={field.max}
                disabled={field.locked ? transferStructureLocked : undefined}
                aria-label={field.label}
                onChange={(event) => onFoldChange(field.key, event.target.value)}
              />
              <small>{field.unit}</small>
            </label>
          ))}
        </div>
      </section>

      {/* 04 专家参数：侧边页签 + 右侧参数 */}
      <section className="experiment-canvas-section" data-config-group="expert">
        <div className="experiment-section-kicker">
          <span className="experiment-section-index" aria-hidden="true">04</span>
          <span className="experiment-section-title" style={sectionTitleStyle}>{copy.sectionExpert}</span>
          <span className="experiment-section-hint">{copy.sectionExpertHint}</span>
        </div>

        <div className="experiment-expert" data-expert-open="true">
          <div className="experiment-expert-tabs" role="tablist" aria-label={copy.sectionExpert}>
            {expertTabs.map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                id={`experiment-expert-tab-${tab}`}
                aria-selected={activeTab === tab}
                aria-controls={`experiment-expert-panel-${tab}`}
                className="experiment-expert-tab"
                data-expert-tab={tab}
                onClick={() => setActiveTab(tab)}
              >
                {expertTabLabels[tab]}
                {tab === 'customParams' && customParamCount > 0 ? (
                  <span className="experiment-expert-tab-count">{customParamCount}</span>
                ) : null}
                {tab === 'transfer' && transferEnabled ? (
                  <span className="experiment-expert-tab-flag" aria-hidden="true">●</span>
                ) : null}
              </button>
            ))}
          </div>

          <div
            className="experiment-expert-content"
            role="tabpanel"
            id={`experiment-expert-panel-${activeTab}`}
            aria-labelledby={`experiment-expert-tab-${activeTab}`}
            data-expert-panel={activeTab}
          >
            {activeTab === 'customParams' ? (
              isUploaded ? (
                uploadedModel ? (
                  <>
                    <h4 className="experiment-expert-heading">
                      {`${uploadedModel.original_filename || copy.uploadedModelUnnamed} / ${copy.expertTabCustomParams}`}
                    </h4>
                    <p className="experiment-expert-note">{copy.customParamsPrimaryHint}</p>
                    <DynamicModelParamsForm
                      schema={selectedUploadedParamSchema}
                      values={values.customModelParams}
                      errors={visibleCustomModelParamErrors}
                      onChange={onCustomModelParamChange}
                      disabled={transferStructureLocked}
                      labels={{
                        title: copy.customModelParams,
                        empty: copy.customModelParamsEmpty,
                        rangeHint: copy.paramRangeHint,
                        minHint: copy.paramMinHint,
                        maxHint: copy.paramMaxHint,
                      }}
                      sectionTitleStyle={sectionTitleStyle}
                      fieldLabelStyle={fieldLabelStyle}
                      fieldHintStyle={fieldHintStyle}
                      inputStyle={inputStyle}
                    />
                  </>
                ) : (
                  <div className="experiment-expert-empty" role="status">{copy.expertNoUploadedModel}</div>
                )
              ) : null
            ) : null}

            {activeTab === 'structure' ? (
              <>
                <h4 className="experiment-expert-heading">
                  {`${getExperimentArchitectureLabel(modelArchitecture)} / ${copy.expertStructureTab}`}
                </h4>
                <p className="experiment-expert-note">{copy.expertStructureHint}</p>
                <div className="experiment-expert-fields">
                  {isRecurrentModel ? (
                    <>
                      <label className="experiment-expert-field">
                        <span>{t('modelTraining.stlstmLayers')}</span>
                        <input
                          type="number"
                          value={values.stlstmLayers}
                          min="1"
                          max="10"
                          disabled={transferStructureLocked}
                          onChange={onLayersChange}
                        />
                      </label>
                      {values.hiddenDims.map((dim, index) => (
                        <label className="experiment-expert-field" key={`dim-${index}`}>
                          <span>{`${t('modelTraining.layer')} ${index + 1} ${t('modelTraining.layerDim')}`}</span>
                          <input
                            type="number"
                            value={dim}
                            min="1"
                            disabled={transferStructureLocked}
                            onChange={(event) => onDimChange(index, event.target.value)}
                          />
                        </label>
                      ))}
                    </>
                  ) : (
                    activeStructureConfig.map((field) => (
                      <label className="experiment-expert-field" key={field.key}>
                        <span>{getModelStructureParamLabel(field.key, structureLabelLanguage)}</span>
                        <input
                          type={field.type === 'integerList' ? 'text' : 'number'}
                          value={
                            Array.isArray(activeStructureParams[field.key] ?? field.defaultValue)
                              ? (activeStructureParams[field.key] ?? field.defaultValue).join(',')
                              : activeStructureParams[field.key] ?? field.defaultValue
                          }
                          disabled={transferStructureLocked}
                          min={
                            field.type === 'boundedFloat' && OPEN_INTERVAL_FLOAT_FIELDS.has(field.key)
                              ? '0.000001'
                              : ['dropout', 'boundedFloat', 'nonNegativeNumber'].includes(field.type)
                                ? '0'
                                : '1'
                          }
                          max={['dropout', 'boundedFloat'].includes(field.type) ? '0.9' : undefined}
                          step={['dropout', 'boundedFloat', 'nonNegativeNumber'].includes(field.type) ? '0.05' : '1'}
                          onChange={(event) => onStructureParamChange(normalizedArchitecture, field, event.target.value)}
                        />
                      </label>
                    ))
                  )}
                </div>
                <div className="experiment-expert-summary">
                  <span className="experiment-center-hint" data-expert-structure-summary="true">{structureSummary}</span>
                  {!officialModelControls ? null : (
                    <button type="button" className="experiment-expert-action" onClick={onToggleArchitecturePicker}>
                      {architecturePickerOpen ? copy.collapse : copy.expand}
                    </button>
                  )}
                </div>
              </>
            ) : null}

            {activeTab === 'strategy' ? (
              <>
                <h4 className="experiment-expert-heading">{copy.expertTabStrategy}</h4>
                <p className="experiment-expert-note">{copy.expertStrategyHint}</p>
                <div className="experiment-expert-fields">
                  <label className="experiment-expert-field">
                    <span>{copy.randomSeed}</span>
                    <input
                      type="number"
                      value={seed}
                      min="0"
                      max="2147483647"
                      onChange={(event) => onFoldChange('seed', event.target.value)}
                    />
                  </label>
                  <label className="experiment-expert-field">
                    <span>{t('modelTraining.earlyStopPatience')}</span>
                    <input
                      type="number"
                      value={earlyStoppingPatience}
                      min="0"
                      max="200"
                      onChange={(event) => onFoldChange('earlyStoppingPatience', event.target.value)}
                    />
                  </label>
                </div>
                <p className="experiment-expert-note">{t('modelTraining.earlyStopNote')}</p>
              </>
            ) : null}

            {activeTab === 'transfer' ? (
              <>
                <h4 className="experiment-expert-heading">{copy.expertTabTransfer}</h4>
                <p className="experiment-expert-note">{copy.expertTransferHintLabel}</p>
                <label className="experiment-toggle-line">
                  <input
                    type="checkbox"
                    checked={transferEnabled}
                    onChange={(event) => onTransferEnabledChange(event.target.checked)}
                  />
                  {copy.transferEnable}
                </label>

                {transferEnabled ? (
                  <div className="experiment-expert-stack">
                    <div className="experiment-config-choice">
                      {[
                        ['task', copy.transferTaskSource],
                        ['upload', copy.transferUploadSource],
                      ].map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          className="experiment-config-chip"
                          aria-pressed={transferSourceType === value}
                          onClick={() => onTransferSourceTypeChange(value)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>

                    {transferSourceType === 'task' ? (
                      <label className="experiment-expert-field">
                        <span>{copy.transferSourceTask}</span>
                        <select value={transferSourceTaskId} onChange={(event) => onTransferSourceTaskChange(event.target.value)}>
                          <option value="">{copy.transferNoTasks}</option>
                          {completedTransferTasks.map((task) => (
                            <option key={task.id} value={task.id}>
                              #{task.id} {task.custom_model_name || task.model_script}
                            </option>
                          ))}
                        </select>
                        {transferStructureLocked ? (
                          <small className="experiment-expert-ok">{copy.transferConfigSynced}</small>
                        ) : null}
                      </label>
                    ) : (
                      <>
                        <label className="experiment-expert-field">
                          <span>{copy.transferWeightFile}</span>
                          <select value={selectedTrainingWeightId} onChange={(event) => onSelectTrainingWeight(event.target.value)}>
                            <option value="">{copy.transferNoWeights}</option>
                            {trainingWeights.map((weight) => (
                              <option key={weight.id} value={weight.id}>
                                {weight.original_filename} / {weight.status}
                              </option>
                            ))}
                          </select>
                        </label>
                        <div className="experiment-expert-actions">
                          <label className="experiment-expert-action" data-disabled={resources.uploadingWeight ? 'true' : 'false'}>
                            {resources.uploadingWeight ? copy.uploadingWeight : copy.uploadWeight}
                            <input
                              type="file"
                              accept=".pth,.pt"
                              disabled={resources.uploadingWeight}
                              style={{ display: 'none' }}
                              onChange={(event) => {
                                const file = event.target.files?.[0];
                                event.target.value = '';
                                if (file) onUploadWeight(file);
                              }}
                            />
                          </label>
                          {selectedTrainingWeight ? (
                            <button
                              type="button"
                              className="experiment-expert-action is-danger"
                              onClick={() => onDeleteWeight(selectedTrainingWeight.id)}
                              disabled={isProcessing}
                            >
                              {copy.deleteWeight}
                            </button>
                          ) : null}
                        </div>
                      </>
                    )}

                    <div className="experiment-expert-fields">
                      <label className="experiment-expert-field">
                        <span>{copy.transferStrict}</span>
                        <input value="strict" disabled readOnly />
                      </label>
                      <label className="experiment-expert-field">
                        <span>{copy.freezeMode}</span>
                        <select value={transferFreezeMode} onChange={(event) => onFoldChange('transferFreezeMode', event.target.value)}>
                          {availableTransferFreezeModes.map((mode) => (
                            <option key={mode} value={mode}>
                              {transferFreezeModeLabels[mode] || mode}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="experiment-expert-field">
                        <span>{copy.finetuneLearningRate}</span>
                        <input
                          type="number"
                          step="0.00001"
                          min="0.000001"
                          value={finetuneLearningRate}
                          onChange={(event) => onFoldChange('finetuneLearningRate', event.target.value)}
                        />
                      </label>
                    </div>
                    {transferStartBlocked ? (
                      <div className="experiment-result-note" data-tone="warning" role="status">
                        <strong>{copy.transferSelectSource}</strong>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : null}

            {activeTab === 'tags' ? (
              <>
                <h4 className="experiment-expert-heading">{copy.expertTabTags}</h4>
                <p className="experiment-expert-note">{copy.expertTagsHintLabel}</p>
                <TagPicker
                  tags={tagState.tags}
                  value={newTaskTagIds}
                  onChange={onTagIdsChange}
                  onCreate={onCreateTag}
                  disabled={!resources.user || tagState.loading || tagState.busy || isProcessing || Boolean(tagState.error)}
                  isZh={isZh}
                  label={copy.expertTagsLabel}
                />
                {tagState.error && <div role="alert" className="training-tag-hint">{tagState.error}</div>}
              </>
            ) : null}
          </div>
        </div>
      </section>

      <div className="experiment-center-hint experiment-canvas-footnote" role="status">
        {resources.user ? presetStatusText : copy.loginRequiredToUse}
        {pendingSubmission ? ` · ${pendingSubmission}` : ''}
      </div>
    </div>
  );
}
