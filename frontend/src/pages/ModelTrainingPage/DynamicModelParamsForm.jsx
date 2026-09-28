import React from 'react';
import C from '../../constants/colors';

function formatRange(field, labels) {
  const hasMin = Number.isFinite(field?.min);
  const hasMax = Number.isFinite(field?.max);
  if (hasMin && hasMax) return labels.rangeHint(field.min, field.max);
  if (hasMin) return labels.minHint(field.min);
  if (hasMax) return labels.maxHint(field.max);
  return '';
}

function getStep(field) {
  if (field?.type === 'int') return '1';
  if (Number.isFinite(field?.step)) return String(field.step);
  return '0.01';
}

export default function DynamicModelParamsForm({
  schema = {},
  values = {},
  errors = {},
  onChange,
  labels,
  sectionTitleStyle,
  fieldLabelStyle,
  fieldHintStyle,
  inputStyle,
  disabled = false,
  hideTitle = false,
}) {
  const fields = Object.entries(schema || {});

  if (fields.length === 0) {
    return (
      <div>
        {hideTitle ? null : <div style={{ ...sectionTitleStyle, marginBottom: 10 }}>{labels.title}</div>}
        <div
          className="experiment-expert-field experiment-field-wide"
          style={{ ...fieldHintStyle, borderStyle: 'dashed', borderColor: C.border }}
        >
          {labels.empty}
        </div>
      </div>
    );
  }

  return (
    <div>
      {hideTitle ? null : <div style={{ ...sectionTitleStyle, marginBottom: 10 }}>{labels.title}</div>}
      {/* 与其它页签同一套字段块：三列网格 + surface-2 块（度量在 experimentCenter.css 里）。 */}
      <div className="experiment-expert-fields">
        {fields.map(([key, field]) => {
          const value = values[key] ?? field.default ?? '';
          const label = field.label || key;
          const hintParts = [field.description, formatRange(field, labels)].filter(Boolean);
          const error = errors[key];

          if (field.type === 'bool') {
            const checked = Boolean(value);
            return (
              <label
                key={key}
                className="experiment-expert-field"
                data-invalid={error ? 'true' : 'false'}
                style={{ cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1 }}
              >
                <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block' }}>{label}</span>
                    {hintParts.length > 0 ? (
                      <span style={{ display: 'block', marginTop: 2 }}>{hintParts.join(' / ')}</span>
                    ) : null}
                    {error ? (
                      <span style={{ display: 'block', marginTop: 4, color: '#d95c5c' }}>{error}</span>
                    ) : null}
                  </span>
                  <span
                    aria-hidden="true"
                    style={{
                      flex: '0 0 auto',
                      width: 42,
                      height: 24,
                      borderRadius: 999,
                      padding: 3,
                      background: checked ? 'rgba(74,158,255,0.26)' : 'rgba(255,255,255,0.08)',
                      border: `1px solid ${checked ? 'rgba(74,158,255,0.40)' : C.border}`,
                      transition: 'all 0.18s ease',
                    }}
                  >
                    <span
                      style={{
                        display: 'block',
                        width: 16,
                        height: 16,
                        borderRadius: 999,
                        background: checked ? C.blue : C.ice60,
                        transform: checked ? 'translateX(18px)' : 'translateX(0)',
                        transition: 'transform 0.18s ease',
                      }}
                    />
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled}
                  onChange={(event) => onChange(key, event.target.checked)}
                  style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }}
                />
              </label>
            );
          }

          return (
            <label key={key} className="experiment-expert-field" data-invalid={error ? 'true' : 'false'}>
              <span>{label}</span>
              {field.type === 'select' ? (
                <select
                  value={value}
                  disabled={disabled}
                  style={error ? { borderBottomColor: '#d95c5c' } : undefined}
                  onChange={(event) => onChange(key, event.target.value)}
                >
                  {(field.options || []).map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type={field.type === 'int' || field.type === 'float' ? 'number' : 'text'}
                  value={value}
                  disabled={disabled}
                  min={Number.isFinite(field.min) ? field.min : undefined}
                  max={Number.isFinite(field.max) ? field.max : undefined}
                  step={getStep(field)}
                  style={error ? { borderBottomColor: '#d95c5c' } : undefined}
                  onChange={(event) => onChange(key, event.target.value)}
                />
              )}
              {hintParts.length > 0 ? <small>{hintParts.join(' / ')}</small> : null}
              {error ? <small style={{ color: '#d95c5c' }}>{error}</small> : null}
            </label>
          );
        })}
      </div>
    </div>
  );
}
