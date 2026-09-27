import { useState } from 'react';
import { MODEL_ARCHITECTURES } from './experimentCenterModel';
import { TRAINING_DATASET_MCD_OVERVIEW } from './trainingParamSanitizers';
import './experimentCenter.css';

const BASE_INPUT_CHANNEL = 'O₃';

/**
 * 右侧配置检查器：简短的实时摘要，不是第二张表单。
 *
 * 只显示当前模型（名称 / 来源 / 版本与校验状态）、输入变量、就绪检查、
 * 时序配置与数据集；其余信息收在「展开详细信息」里。
 * 组件不渲染任何 input / select，也不请求接口。
 *
 * 就绪状态来自页面控制器的 `readiness`：`canTrain` 才代表**能开始真实训练**，
 * 与主按钮是否可点（访客可点、点了弹登录）分开，避免「有错误却显示可以开始训练」。
 */
export default function ExperimentConfigInspector({
  values,
  resources,
  validation,
  readiness,
  copy,
  isZh,
  channelOrder,
  channelMap,
  onEditCustomParams,
}) {
  const {
    trainingDataset,
    modelSource,
    selectedChannels,
    modelArchitecture,
    useSphere,
    epochs,
    windowValue,
    horizon,
    transferEnabled,
  } = values;
  const {
    user,
    uploadedModels,
    selectedUploadedModel,
    selectedUploadedModelLabel,
  } = resources;
  const {
    modelNameError,
    transferStartBlocked,
    selectedUploadedModelInvalid,
    customParamCount,
  } = validation;
  const [detailsOpen, setDetailsOpen] = useState(false);

  const isUploaded = modelSource === 'uploaded';
  const datasetLabel = trainingDataset === TRAINING_DATASET_MCD_OVERVIEW
    ? copy.datasetMcdOverview
    : copy.datasetOpenMarsMcd;
  const architectureLabel = MODEL_ARCHITECTURES.find((item) => item.id === modelArchitecture)?.label
    || modelArchitecture
    || '--';
  const channelShorts = selectedChannels.map((channel) => channelMap[channel]?.short || channel);
  const payloadValue = [BASE_INPUT_CHANNEL, ...channelShorts].join(' + ');
  const uploadedValidation = selectedUploadedModel?.validation_status || '';
  const canTrain = Boolean(readiness?.canTrain);
  const blockers = readiness?.blockers || [];
  const blockerCodes = new Set(blockers.map((item) => item.code));
  const hasName = Boolean(values.customModelName.trim()) && !modelNameError;

  const modelReady = isUploaded
    ? Boolean(selectedUploadedModel) && uploadedValidation === 'valid' && !selectedUploadedModelInvalid
    : !blockerCodes.has('preset');
  const hasParamErrors = blockerCodes.has('custom-params')
    || [...blockerCodes].some((code) => code.startsWith('custom-param-'));
  // 常见问题在检查行中只显示一次，保留字段级错误与其它阻塞原因。
  const summarizedCodes = new Set([
    'login', 'name-missing', 'name-invalid', 'model-missing', 'model-invalid',
    'preset', 'transfer', 'custom-params',
  ]);
  const additionalBlockers = blockers.filter((blocker) => !summarizedCodes.has(blocker.code));

  const readinessRows = [
    {
      key: 'login',
      ok: Boolean(user),
      label: user ? null : copy.checkLogin,
    },
    {
      key: 'name',
      ok: hasName,
      label: hasName ? copy.checkName : (modelNameError || copy.checkNameMissing),
    },
    {
      key: 'dataset',
      ok: true,
      label: copy.checkDataset,
    },
    {
      key: 'model',
      ok: modelReady,
      label: isUploaded
        ? (!selectedUploadedModel
            ? copy.checkModelMissing
            : (uploadedValidation === 'valid' && !selectedUploadedModelInvalid
                ? copy.checkModelReady
                : copy.checkModelInvalid))
        : (blockerCodes.has('preset') ? copy.checkModelMissing : copy.checkModelOfficialReady),
    },
    {
      key: 'params',
      ok: Boolean(user) && modelReady && !hasParamErrors,
      label: !user
        ? copy.checkParamsNeedLogin
        : (hasParamErrors
            ? copy.checkParamsMissing
            : (modelReady ? copy.checkParams : copy.checkParamsNeedModel)),
    },
  ];
  if (transferEnabled) {
    readinessRows.push({
      key: 'transfer',
      ok: !transferStartBlocked,
      label: transferStartBlocked ? copy.checkTransferMissing : copy.checkTransfer,
    });
  }

  return (
    <div className="experiment-inspector" data-config-inspector="true">
      <div className="experiment-inspector-head">
        <span className="experiment-inspector-title">{copy.inspectorTitle}</span>
        <span
          className="experiment-inspector-state"
          data-inspector-ready={canTrain ? 'true' : 'false'}
          data-inspector-state={canTrain ? 'ready' : (user ? 'blocked' : 'guest')}
          role="status"
        >
          <span className="experiment-inspector-state-dot" aria-hidden="true" />
          {canTrain ? copy.inspectorReady : copy.inspectorNotReady}
        </span>
      </div>

      <div className="experiment-inspector-body">
        <section className="experiment-inspector-block">
          <div className="experiment-inspector-label">{copy.inspectorCurrentModel}</div>
          <div className="experiment-inspector-value" data-inspector-field="current-model" title={isUploaded ? (selectedUploadedModel?.original_filename || '') : architectureLabel}>
            {isUploaded
              ? (selectedUploadedModel ? (selectedUploadedModel.original_filename || selectedUploadedModelLabel) : copy.inspectorMissingUploadedModel)
              : architectureLabel}
          </div>
          <div className="experiment-inspector-sub" data-inspector-field="model-source">
            {isUploaded
              ? (selectedUploadedModel
                  ? `${copy.modelSourceUploaded} · v${selectedUploadedModel.version ?? '--'} · ${uploadedValidation === 'valid' ? copy.uploadedModelValid : (uploadedValidation === 'pending' ? copy.uploadedModelPending : copy.uploadedModelInvalid)}`
                  : copy.modelSourceUploaded)
              : `${copy.modelSourceOfficial}${useSphere ? ` · ${copy.sphereToggle}: ${copy.enabled}` : ''}`}
          </div>
          {isUploaded && selectedUploadedModel && customParamCount >= 0 ? (
            <button
              type="button"
              className="experiment-inspector-link"
              data-inspector-action="edit-custom-params"
              onClick={() => {
                onEditCustomParams?.();
                const tab = document.getElementById('experiment-expert-tab-customParams');
                tab?.scrollIntoView({ block: 'start' });
                tab?.focus({ preventScroll: true });
              }}
            >
              {`${copy.editCustomParams} (${customParamCount})`}
            </button>
          ) : null}
        </section>

        <section className="experiment-inspector-block">
          <div className="experiment-inspector-label">{copy.inspectorInputVars}</div>
          <div className="experiment-inspector-value" data-inspector-field="payload">{payloadValue}</div>
          <div className="experiment-inspector-sub" data-inspector-field="channel-count">
            {copy.inspectorChannelTotal(selectedChannels.length + 1)}
            {selectedChannels.length === 0 ? ` · ${copy.channelSummaryEmpty}` : ''}
          </div>
        </section>

        <section className="experiment-inspector-block">
          <div className="experiment-inspector-label">{copy.inspectorReadiness}</div>
          <div className="experiment-inspector-readiness" data-inspector-blockers={canTrain ? 'false' : 'true'}>
            {readinessRows.filter((row) => row.label).map((row) => (
              <div className="experiment-inspector-readiness-row" key={row.key} data-ok={row.ok ? 'true' : 'false'}>
                <span className="experiment-inspector-check" aria-hidden="true">{row.ok ? '✓' : '!'}</span>
                <span>{row.label}</span>
              </div>
            ))}
          </div>
          {additionalBlockers.length > 0 ? (
            <ul className="experiment-inspector-blockers" data-inspector-issues="true">
              {additionalBlockers.map((blocker) => (
                <li key={blocker.code}>{blocker.label}</li>
              ))}
            </ul>
          ) : null}
        </section>

        <section className="experiment-inspector-block">
          <div className="experiment-inspector-label">{copy.inspectorSequence}</div>
          <div className="experiment-inspector-telemetry">
            <div className="experiment-inspector-cell">
              <small>{`${copy.windowLabel} → ${copy.horizonLabel}`}</small>
              <strong data-inspector-field="window-horizon">{`${windowValue || '--'} → ${horizon || '--'}`}</strong>
            </div>
            <div className="experiment-inspector-cell">
              <small>{copy.epochsLabel}</small>
              <strong data-inspector-field="epochs">{epochs || '--'}</strong>
            </div>
          </div>
        </section>

        <section className="experiment-inspector-block">
          <div className="experiment-inspector-label">{copy.trainingDataset}</div>
          <div className="experiment-inspector-sub experiment-inspector-dataset" data-inspector-field="dataset" title={datasetLabel}>
            {datasetLabel}
          </div>
          <button
            type="button"
            className="experiment-inspector-link is-quiet"
            aria-expanded={detailsOpen}
            onClick={() => setDetailsOpen((value) => !value)}
          >
            {detailsOpen ? copy.inspectorCollapseDetails : copy.inspectorExpandDetails}
          </button>
          {detailsOpen ? (
            <dl className="experiment-inspector-details">
              <div>
                <dt>{copy.modelSource}</dt>
                <dd>{isUploaded ? copy.modelSourceUploaded : copy.modelSourceOfficial}</dd>
              </div>
              <div>
                <dt>{copy.customModelParams}</dt>
                <dd>{isUploaded ? `${customParamCount}` : '--'}</dd>
              </div>
              <div>
                <dt>{copy.transferLearning}</dt>
                <dd>{transferEnabled ? copy.enabled : copy.disabled}</dd>
              </div>
              <div>
                <dt>{copy.uploadedModels}</dt>
                <dd>{uploadedModels.length}</dd>
              </div>
            </dl>
          ) : null}
        </section>

      </div>
    </div>
  );
}
