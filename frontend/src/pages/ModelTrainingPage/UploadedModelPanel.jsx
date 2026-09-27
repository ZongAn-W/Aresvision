import React, { useRef, useState } from 'react';
import C from '../../constants/colors';
import './experimentCenter.css';

function getStatusColor(status) {
  if (status === 'valid') return C.green;
  if (status === 'pending') return '#c89448';
  return '#d95c5c';
}

function getStatusLabel(status, labels) {
  if (status === 'valid') return labels.valid;
  if (status === 'pending') return labels.pending;
  return labels.invalid;
}

function ValidationMessages({ report, labels, fieldHintStyle }) {
  const errors = Array.isArray(report?.errors) ? report.errors : [];
  const warnings = Array.isArray(report?.warnings) ? report.warnings : [];

  if (errors.length === 0 && warnings.length === 0) {
    return <div style={{ ...fieldHintStyle, marginTop: 0, color: C.green }}>{labels.ready}</div>;
  }

  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {errors.map((message) => (
        <div key={`error-${message}`} style={{ ...fieldHintStyle, marginTop: 0, color: '#d95c5c' }}>
          {message}
        </div>
      ))}
      {warnings.map((message) => (
        <div key={`warning-${message}`} style={{ ...fieldHintStyle, marginTop: 0, color: '#c89448' }}>
          {message}
        </div>
      ))}
    </div>
  );
}

/**
 * 上传模型区域（紧凑版）。
 *
 * 默认只显示当前模型的胶囊式摘要（.py 标记、截断文件名、版本 · 校验状态 · 自定义参数数量）
 * 与两个主要动作（上传 / 替换、编辑自定义参数）。整套模型管理（列表、重新校验、删除）
 * 收在可展开的「管理上传模型」里，不抢占主上传操作的视觉层级。
 *
 * 上传、替换、选择、重新校验、删除、模板与说明下载、格式说明、区内 inline error
 * 全部保留；校验失败、版本不匹配等错误通过 `inlineError` 直接显示在区域顶部。
 */
export default function UploadedModelPanel({
  models = [],
  selectedId,
  onSelect,
  onUpload,
  onRevalidate,
  onDelete,
  uploading = false,
  busy = false,
  selectionDisabled = false,
  guideDownloadUrl,
  templateDownloadUrl,
  inlineError = '',
  statusLabel = '',
  statusTone = 'ok',
  onEditParams,
  labels,
  sectionTitleStyle,
  fieldLabelStyle,
  fieldHintStyle,
}) {
  const fileRef = useRef(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [formatOpen, setFormatOpen] = useState(false);
  const selected = models.find((item) => item.id === selectedId) || null;
  const validCount = models.filter((item) => item.validation_status === 'valid').length;
  const paramCount = Object.keys(selected?.param_schema || {}).length;
  const formatItems = Array.isArray(labels.formatItems) ? labels.formatItems : [];
  const selectedName = selected?.original_filename || selected?.display_name || labels.noFilename;

  const pickFile = () => fileRef.current?.click();

  return (
    <div className="experiment-uploaded-model" data-uploaded-model-panel="true" data-model-state={selected ? (selected.validation_status === 'valid' ? 'valid' : 'invalid') : 'empty'}>
      <input
        ref={fileRef}
        type="file"
        accept=".py"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onUpload(file);
          event.target.value = '';
        }}
      />

      {/* 错误、校验失败与版本不匹配都在上传模型区域内解释。 */}
      {inlineError ? (
        <div className="experiment-uploaded-model-error" role="alert" data-uploaded-model-error="true">
          {inlineError}
        </div>
      ) : null}

      {selected ? (
        <div className="experiment-uploaded-card" data-uploaded-model-card="true">
          <span className="experiment-uploaded-icon" aria-hidden="true">{labels.typeBadge}</span>
          <div className="experiment-uploaded-body">
            <div className="experiment-uploaded-name" title={selectedName}>{selectedName}</div>
            <div className="experiment-uploaded-meta">
              {`v${selected.version ?? '--'} · ${labels.summaryParamCount ? labels.summaryParamCount(paramCount) : `${paramCount}`} · ${labels.summaryValidCount ? labels.summaryValidCount(validCount) : validCount}`}
            </div>
          </div>
          <span className="experiment-uploaded-status" data-tone={statusTone} data-uploaded-model-status="true">
            {statusLabel || getStatusLabel(selected.validation_status, labels)}
          </span>
        </div>
      ) : (
        <div className="experiment-uploaded-empty" data-uploaded-model-empty="true">
          <strong>{labels.missing}</strong>
          <span>{labels.hint}</span>
        </div>
      )}

      <div className="experiment-uploaded-actions">
        <button
          type="button"
          className="experiment-uploaded-upload"
          data-uploaded-model-upload="true"
          onClick={pickFile}
          disabled={uploading || busy}
        >
          {uploading ? labels.uploading : (selected ? labels.uploadAgain : labels.upload)}
        </button>
        {selected && onEditParams ? (
          <button type="button" className="experiment-uploaded-link" data-uploaded-model-params="true" onClick={onEditParams}>
            {labels.editParams}
          </button>
        ) : null}
        <button
          type="button"
          className="experiment-uploaded-link is-quiet"
          aria-expanded={manageOpen}
          aria-controls="experiment-uploaded-manage"
          onClick={() => setManageOpen((value) => !value)}
        >
          {labels.manage}
        </button>
        {guideDownloadUrl ? (
          <a href={guideDownloadUrl} download className="experiment-uploaded-link is-quiet">
            {labels.downloadGuide}
          </a>
        ) : null}
        {templateDownloadUrl ? (
          <a href={templateDownloadUrl} download className="experiment-uploaded-link is-quiet">
            {labels.downloadTemplate}
          </a>
        ) : null}
      </div>

      {manageOpen ? (
        <div className="experiment-uploaded-manage" id="experiment-uploaded-manage" data-uploaded-model-manage="true">
          {models.length === 0 ? (
            <div className="experiment-uploaded-empty" role="status">
              <strong>{labels.missing}</strong>
              <span>{labels.hint}</span>
            </div>
          ) : (
            <div className="experiment-uploaded-list" role="list">
              {models.map((model) => {
                const active = selectedId === model.id;
                return (
                  <button
                    key={model.id}
                    type="button"
                    role="listitem"
                    className="experiment-uploaded-item"
                    aria-pressed={active}
                    data-uploaded-model-item={model.id}
                    onClick={() => onSelect(model.id)}
                    disabled={selectionDisabled}
                  >
                    <span className="experiment-uploaded-item-name" title={model.original_filename || ''}>
                      {model.display_name || model.original_filename || labels.unnamed}
                    </span>
                    <span className="experiment-uploaded-item-status" style={{ color: getStatusColor(model.validation_status) }}>
                      {getStatusLabel(model.validation_status, labels)}
                    </span>
                    <span className="experiment-uploaded-item-meta">
                      {`v${model.version ?? '--'} / ${model.original_filename || labels.noFilename}`}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {selected ? (
            <div className="experiment-uploaded-detail">
              <div className="experiment-uploaded-detail-actions">
                <button
                  type="button"
                  className="experiment-expert-action"
                  onClick={() => onRevalidate(selected.id)}
                  disabled={busy}
                >
                  {labels.revalidate}
                </button>
                <button
                  type="button"
                  className="experiment-expert-action"
                  onClick={pickFile}
                  disabled={uploading || busy}
                >
                  {labels.replace}
                </button>
                <button
                  type="button"
                  className="experiment-expert-action is-danger"
                  onClick={() => onDelete(selected.id)}
                  disabled={busy}
                >
                  {labels.delete}
                </button>
              </div>
              <ValidationMessages report={selected.validation_report} labels={labels} fieldHintStyle={fieldHintStyle} />
            </div>
          ) : null}

          {formatItems.length > 0 ? (
            <div className="experiment-uploaded-format">
              <button
                type="button"
                className="experiment-uploaded-link is-quiet"
                aria-expanded={formatOpen}
                onClick={() => setFormatOpen((value) => !value)}
              >
                {labels.formatTitle}
              </button>
              {formatOpen ? (
                <ul>
                  {formatItems.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          {fieldLabelStyle ? (
            <div className="experiment-uploaded-foot">
              <span style={{ ...fieldLabelStyle, marginBottom: 0 }}>{`${labels.validationLabel}: ${statusLabel || (selected ? getStatusLabel(selected.validation_status, labels) : '--')}`}</span>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
