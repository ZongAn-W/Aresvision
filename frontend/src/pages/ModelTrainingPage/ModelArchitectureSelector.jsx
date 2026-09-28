import { useState } from 'react';
import {
  MODEL_ARCHITECTURES,
  MODEL_ARCHITECTURE_FAMILIES,
  filterModelArchitectures,
  getModelArchitectureFamily,
  getModelArchitectureFamilyHint,
} from './experimentCenterModel';
import './experimentCenter.css';

/**
 * 官方模型架构选择器：紧凑当前值 + 可展开模型库（搜索 + 家族筛选 + 全部架构）。
 *
 * 只在 `model_source=official` 时渲染（上传模型走 UploadedModelPanel）。
 * 组件不持有训练状态，也不请求接口：选项来自 experimentCenterModel 的
 * 架构注册表，选中结果通过 onSelect 交回页面控制器。
 */
export default function ModelArchitectureSelector({
  value,
  onSelect,
  copy,
  isZh,
  disabled = false,
  fieldHintStyle,
  inputStyle,
  expanded = false,
  onToggleExpanded,
}) {
  const [search, setSearch] = useState('');
  const [family, setFamily] = useState('all');

  const filtered = filterModelArchitectures(MODEL_ARCHITECTURES, { search, family });
  const activeFamily = getModelArchitectureFamily(value);
  const activeHint = getModelArchitectureFamilyHint(activeFamily);
  const activeLabel = MODEL_ARCHITECTURES.find((item) => item.id === value)?.label || value || '--';

  const familyOptions = [
    { id: 'all', label: copy.architectureFamilyAll, count: MODEL_ARCHITECTURES.length },
    ...MODEL_ARCHITECTURE_FAMILIES.map((item) => ({
      id: item.id,
      label: isZh ? item.label : item.labelEn,
      count: MODEL_ARCHITECTURES.filter((architecture) => getModelArchitectureFamily(architecture.id) === item.id).length,
    })).filter((item) => item.count > 0),
  ];

  return (
    <div className="experiment-architecture" data-architecture-selector="true">
      <div className="experiment-choice-label">
        <span>{copy.backboneModel}</span>
        <em>{isZh ? activeHint.label : activeHint.labelEn}</em>
      </div>

      <button
        type="button"
        className="experiment-architecture-current"
        data-architecture-current="true"
        aria-expanded={expanded}
        aria-controls="experiment-architecture-options"
        onClick={onToggleExpanded}
      >
        <span className="experiment-architecture-current-value">{activeLabel}</span>
        <span className="experiment-architecture-current-hint">
          {expanded ? copy.modelPickerCollapse : copy.modelPickerExpand}
        </span>
      </button>

      {expanded ? (
        <div className="experiment-architecture-options" id="experiment-architecture-options">
          <label className="sr-only" htmlFor="experiment-architecture-search-input">
            {copy.architectureSearchLabel}
          </label>
          <input
            id="experiment-architecture-search-input"
            type="search"
            className="experiment-architecture-search"
            style={inputStyle}
            placeholder={copy.modelPickerSearch}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />

          <div className="experiment-architecture-families" role="group" aria-label={copy.architectureFamilyLabel}>
            {familyOptions.map((item) => (
              <button
                key={item.id}
                type="button"
                className="experiment-architecture-family"
                aria-pressed={family === item.id}
                onClick={() => setFamily(item.id)}
              >
                {item.label}
                <span className="experiment-architecture-family-count">{item.count}</span>
              </button>
            ))}
          </div>

          {filtered.length === 0 ? (
            <div className="experiment-architecture-empty" role="status">{copy.architectureEmpty}</div>
          ) : (
            <div className="experiment-architecture-list">
              {filtered.map((architecture) => {
                const active = architecture.id === value;
                return (
                  <button
                    key={architecture.id}
                    type="button"
                    className="experiment-architecture-option"
                    aria-pressed={active}
                    disabled={disabled}
                    data-architecture-option={architecture.id}
                    data-architecture-family={getModelArchitectureFamily(architecture.id)}
                    onClick={() => onSelect(architecture.id)}
                  >
                    {architecture.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ) : null}

      {fieldHintStyle && !expanded ? (
        <div className="experiment-architecture-footnote" style={fieldHintStyle}>
          {copy.architectureSearchPlaceholder}
        </div>
      ) : null}
    </div>
  );
}
