import { MODEL_ARCHITECTURES } from './experimentCenterModel';
import './experimentCenter.css';

/**
 * 右侧配置检查器：只回答两件事——「当前用的是什么模型」和「还有什么阻止开始训练」。
 *
 * 信息减法后删除了主表单已经显示的常态摘要（输入变量、时序配置、数据集与折叠详情），
 * 也删除了逐条「已通过」的重复播报：
 * - 正常时用一行简洁状态表达（「配置检查通过」）；
 * - 有问题时逐条列出阻塞原因，能定位到字段的给出对应操作入口。
 *
 * 组件不渲染任何 input / select，不请求接口，也不做资源估算。
 * 就绪状态来自页面控制器的 `readiness`：`canTrain` 才代表**能开始真实训练**，
 * 与主按钮是否可点（访客可点、点了弹登录）分开，避免「有错误却显示可以开始训练」。
 */
export default function ExperimentConfigInspector({
  values,
  resources,
  validation,
  readiness,
  copy,
  onEditCustomParams,
  onRequestLogin,
}) {
  const { modelSource, modelArchitecture, useSphere } = values;
  const { user, selectedUploadedModel, selectedUploadedModelLabel } = resources;
  const { modelNameError, transferStartBlocked, selectedUploadedModelInvalid } = validation;
  const isUploaded = modelSource === 'uploaded';
  const architectureLabel = MODEL_ARCHITECTURES.find((item) => item.id === modelArchitecture)?.label
    || modelArchitecture
    || '--';
  const uploadedValidation = selectedUploadedModel?.validation_status || '';
  const canTrain = Boolean(readiness?.canTrain);
  const blockers = readiness?.blockers || [];
  const blockerCodes = new Set(blockers.map((item) => item.code));

  const modelReady = isUploaded
    ? Boolean(selectedUploadedModel) && uploadedValidation === 'valid' && !selectedUploadedModelInvalid
    : !blockerCodes.has('preset');
  const hasParamErrors = blockerCodes.has('custom-params')
    || [...blockerCodes].some((code) => code.startsWith('custom-param-'));
  const hasName = Boolean(values.customModelName.trim()) && !modelNameError;

  // 逐条给出「需要用户处理」的原因；与字段旁的错误一一对应，不重复播报已通过项。
  const issues = [];
  if (!user) {
    issues.push({ key: 'login', label: copy.checkLogin, action: onRequestLogin, actionLabel: copy.inspectorGoLogin });
  }
  if (!hasName) {
    issues.push({ key: 'name', label: modelNameError || copy.checkNameMissing, action: 'name', actionLabel: copy.inspectorFixName });
  }
  if (!modelReady) {
    issues.push({
      key: 'model',
      label: isUploaded
        ? (selectedUploadedModel ? copy.checkModelInvalid : copy.checkModelMissing)
        : copy.checkModelMissing,
    });
  }
  if (user && modelReady && hasParamErrors) {
    issues.push({ key: 'params', label: copy.checkParamsMissing, action: 'customParams', actionLabel: copy.inspectorFixParams });
  }
  if (transferStartBlocked) {
    issues.push({ key: 'transfer', label: copy.checkTransferMissing, action: 'transfer', actionLabel: copy.inspectorFixTransfer });
  }
  // 其余阻塞原因（目前只有登录与名称会走到这里）按原顺序补齐，避免漏报。
  blockers.forEach((blocker) => {
    if (issues.some((issue) => issue.key === blocker.code)) return;
    if (blocker.code === 'name-missing' || blocker.code === 'name-invalid') return;
    if (blocker.code === 'model-missing' || blocker.code === 'model-invalid') return;
    if (blocker.code === 'custom-params' || blocker.code === 'transfer' || blocker.code === 'login') return;
    issues.push({ key: blocker.code, label: blocker.label });
  });

  const handleIssueAction = (issue) => {
    if (typeof issue.action === 'function') {
      issue.action();
      return;
    }
    if (issue.action === 'customParams') {
      onEditCustomParams?.();
      const tab = document.getElementById('experiment-expert-tab-customParams');
      tab?.scrollIntoView({ block: 'start' });
      tab?.focus({ preventScroll: true });
      return;
    }
    if (issue.action === 'name') {
      const nameInput = document.getElementById('experiment-name-input');
      nameInput?.scrollIntoView({ block: 'center' });
      nameInput?.focus({ preventScroll: true });
      return;
    }
    if (issue.action === 'transfer') {
      const tab = document.getElementById('experiment-expert-tab-transfer');
      tab?.scrollIntoView({ block: 'start' });
      tab?.focus({ preventScroll: true });
    }
  };

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
          <div
            className="experiment-inspector-value"
            data-inspector-field="current-model"
            title={isUploaded ? (selectedUploadedModel?.original_filename || '') : architectureLabel}
          >
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
          {isUploaded && selectedUploadedModel && onEditCustomParams ? (
            <button
              type="button"
              className="experiment-inspector-link"
              data-inspector-action="edit-custom-params"
              onClick={() => handleIssueAction({ action: 'customParams' })}
            >
              {copy.editCustomParams}
            </button>
          ) : null}
        </section>

        <section className="experiment-inspector-block">
          <div className="experiment-inspector-label">{copy.inspectorReadiness}</div>
          {issues.length === 0 ? (
            <div className="experiment-inspector-readiness-row" data-ok="true" data-inspector-clear="true">
              <span className="experiment-inspector-check" aria-hidden="true">✓</span>
              <span>{copy.inspectorAllClear}</span>
            </div>
          ) : (
            <ul className="experiment-inspector-blockers" data-inspector-issues="true">
              {issues.map((issue) => (
                <li key={issue.key} data-inspector-issue={issue.key}>
                  <span className="experiment-inspector-issue-mark" aria-hidden="true">!</span>
                  <span className="experiment-inspector-issue-text">{issue.label}</span>
                  {issue.action ? (
                    <button
                      type="button"
                      className="experiment-inspector-issue-action"
                      onClick={() => handleIssueAction(issue)}
                    >
                      {issue.actionLabel}
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
