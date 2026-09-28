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
  isZh,
}) {
  const { modelSource, modelArchitecture, useSphere } = values;
  const { user, selectedUploadedModel, selectedUploadedModelLabel } = resources;
  const { modelNameError, transferStartBlocked } = validation;
  const isUploaded = modelSource === 'uploaded';
  const architectureLabel = MODEL_ARCHITECTURES.find((item) => item.id === modelArchitecture)?.label
    || modelArchitecture
    || '--';
  const uploadedValidation = selectedUploadedModel?.validation_status || '';
  const canTrain = Boolean(readiness?.canTrain);
  const blockers = readiness?.blockers || [];
  const blockerCodes = new Set(blockers.map((item) => item.code));

  const modelSelected = isUploaded
    ? Boolean(selectedUploadedModel) && uploadedValidation === 'valid'
    : !blockerCodes.has('preset');
  const modelReady = modelSelected && !blockerCodes.has('earth-uploaded');
  const datasetReady = Boolean(values.trainingDatasetLabel) && !blockerCodes.has('earth-dataset');
  const hasParamErrors = blockerCodes.has('custom-params')
    || [...blockerCodes].some((code) => code.startsWith('custom-param-'));
  const hasName = Boolean(values.customModelName.trim()) && !modelNameError;

  // 逐条给出「需要用户处理」的原因；与字段旁的错误一一对应，不重复播报已通过项。
  const issues = [];
  if (!user) {
    issues.push({ key: 'login', group: 'name', label: copy.checkLogin, action: onRequestLogin, actionLabel: copy.inspectorGoLogin });
  }
  if (!hasName) {
    issues.push({ key: 'name', group: 'name', label: modelNameError || copy.checkNameMissing, action: 'name', actionLabel: copy.inspectorFixName });
  }
  if (!modelSelected) {
    issues.push({
      key: 'model',
      group: 'model',
      label: isUploaded
        ? (selectedUploadedModel ? copy.checkModelInvalid : copy.checkModelMissing)
        : copy.checkModelMissing,
      action: 'model',
      actionLabel: isZh ? '定位' : 'Locate',
    });
  }
  if (user && modelSelected && hasParamErrors) {
    issues.push({ key: 'params', group: 'params', label: copy.checkParamsMissing, action: 'customParams', actionLabel: copy.inspectorFixParams });
  }
  if (transferStartBlocked) {
    issues.push({ key: 'transfer', group: 'params', label: copy.checkTransferMissing, action: 'transfer', actionLabel: copy.inspectorFixTransfer });
  }
  // 其余阻塞原因（目前只有登录与名称会走到这里）按原顺序补齐，避免漏报。
  blockers.forEach((blocker) => {
    if (issues.some((issue) => issue.key === blocker.code)) return;
    if (blocker.code === 'name-missing' || blocker.code === 'name-invalid') return;
    if (blocker.code === 'model-missing' || blocker.code === 'model-invalid') return;
    if (blocker.code === 'custom-params' || blocker.code === 'transfer' || blocker.code === 'login') return;
    if ((blocker.code === 'preset' || blocker.code === 'earth-uploaded') && !modelSelected) return;
    if (blocker.code.startsWith('custom-param-') && issues.some((issue) => issue.key === 'params')) return;
    const group = blocker.code.startsWith('custom-param-') ? 'params'
      : blocker.code === 'earth-dataset' ? 'dataset' : 'model';
    issues.push({ key: blocker.code, group, label: blocker.label, action: group === 'params' ? 'customParams' : group });
  });

  const currentModel = isUploaded
    ? (selectedUploadedModel ? (selectedUploadedModel.original_filename || selectedUploadedModelLabel) : copy.inspectorMissingUploadedModel)
    : architectureLabel;
  const groups = [
    { id: 'name', title: isZh ? '模型名称' : 'Model name', value: values.customModelName || (isZh ? '未填写' : 'Missing'), action: 'name' },
    { id: 'dataset', title: copy.trainingDataset, value: values.trainingDatasetLabel || (isZh ? '未选择' : 'Missing'), action: 'dataset' },
    { id: 'model', title: copy.inspectorCurrentModel, value: currentModel, action: 'model' },
    { id: 'params', title: isZh ? '超参数' : 'Hyperparameters', value: hasParamErrors || transferStartBlocked ? (isZh ? '需要检查' : 'Needs review') : (isZh ? '无已知问题' : 'No known issues'), action: 'params' },
  ];
  const completedCount = groups.filter((group) => group.id === 'dataset' ? datasetReady
    : group.id === 'name' ? hasName : group.id === 'model' ? modelReady : !hasParamErrors && !transferStartBlocked).length;
  const errorCount = issues.length;

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
      return;
    }
    const target = document.querySelector(`[data-config-group="${issue.action === 'params' ? 'expert' : issue.action}"]`);
    target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    target?.querySelector('button, input, select')?.focus({ preventScroll: true });
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

      <div className="experiment-inspector-summary" aria-label={copy.inspectorReadiness}>
        <span>{`${isZh ? '已完成' : 'Complete'} ${completedCount}/4`}</span>
        <span>{`${isZh ? '警告' : 'Warnings'} 0`}</span>
        <span data-tone={errorCount ? 'error' : 'ready'}>{`${isZh ? '问题' : 'Issues'} ${errorCount}`}</span>
      </div>
      <div className="experiment-inspector-body" data-inspector-issues="true">
        {canTrain ? <div className="experiment-inspector-readiness-row" data-ok="true" data-inspector-clear="true"><span className="experiment-inspector-check" aria-hidden="true">✓</span>{copy.inspectorAllClear}</div> : null}
        {groups.map((group) => {
          const groupIssues = issues.filter((issue) => issue.group === group.id);
          const showModelRef = group.id === 'model';
          return <details className="experiment-inspector-group" key={`${group.id}-${groupIssues.map((item) => item.key).join('-')}`} open={groupIssues.length > 0 || (canTrain && group.id === 'model')}>
            <summary className="experiment-inspector-group-head">
              <span className="experiment-inspector-group-title">{group.title}</span>
              <span className="experiment-inspector-badge" data-tone={groupIssues.length ? 'error' : 'ready'}>{groupIssues.length ? `${groupIssues.length} ${isZh ? '项问题' : 'issues'}` : (isZh ? '通过' : 'Passed')}</span>
            </summary>
            <div className="experiment-inspector-group-body">
              {showModelRef ? (
                <div className="experiment-inspector-value" data-inspector-field="current-model" title={group.value}>{group.value}</div>
              ) : (
                <div className="experiment-inspector-value" data-inspector-value="true" title={group.value}>{group.value}</div>
              )}
              {group.id === 'model' ? <div className="experiment-inspector-sub" data-inspector-field="model-source">{isUploaded
                ? (selectedUploadedModel ? `${copy.modelSourceUploaded} · v${selectedUploadedModel.version ?? '--'} · ${uploadedValidation === 'valid' ? copy.uploadedModelValid : (uploadedValidation === 'pending' ? copy.uploadedModelPending : copy.uploadedModelInvalid)}` : copy.modelSourceUploaded)
                : `${copy.modelSourceOfficial}${useSphere ? ` · ${copy.sphereToggle}: ${copy.enabled}` : ''}`}</div> : null}
              {groupIssues.length ? <ul className="experiment-inspector-blockers">{groupIssues.map((issue) => <li key={issue.key} data-inspector-issue={issue.key}>
                <span className="experiment-inspector-issue-mark" aria-hidden="true">!</span>
                <span className="experiment-inspector-issue-text">{issue.label}</span>
                {issue.action ? <button type="button" className="experiment-inspector-issue-action" onClick={() => handleIssueAction(issue)}>{issue.actionLabel || (isZh ? '定位' : 'Locate')}</button> : null}
              </li>)}</ul> : <div className="experiment-inspector-readiness-row" data-ok="true"><span className="experiment-inspector-check" aria-hidden="true">✓</span>{isZh ? '当前无问题' : 'No issues found'}</div>}
              {group.id === 'model' && isUploaded && selectedUploadedModel && onEditCustomParams ? <button type="button" className="experiment-inspector-link" data-inspector-action="edit-custom-params" onClick={() => handleIssueAction({ action: 'customParams' })}>{copy.editCustomParams}</button> : null}
              {groupIssues.length === 0 && group.id !== 'model' ? <button type="button" className="experiment-inspector-link is-quiet" onClick={() => handleIssueAction({ action: group.action })}>{isZh ? '定位配置' : 'Locate section'}</button> : null}
            </div>
          </details>;
        })}
      </div>
    </div>
  );
}
