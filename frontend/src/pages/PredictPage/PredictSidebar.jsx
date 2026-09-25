import { useEffect, useMemo, useRef, useState } from 'react';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded';
import C from '../../constants/colors';
import { useT } from '../../i18n';
import GlowCard from '../../components/GlowCard';
import { fmtNum } from '../../utils/fmt';
import { useSettings } from '../../contexts/SettingsContext';
import { buildTrainedModelParameterItems } from './trainedModelSelection';
import { buildCompareModelSummary, getCompareSelectionState } from './CompareTrainingModels/compareTrainingModelsData';
import { PREDICT_MODEL_MODE_COMPARE, PREDICT_MODEL_MODE_TRAINED } from './predictModelModes';
import { clampPredictionHorizon } from './predictionHorizon';
import { useTrainingTags } from '../../components/TrainingTags/useTrainingTags';
import { TagChips, TagFilter } from '../../components/TrainingTags/TagControls';
import { addVisibleSelection, filterTaggedTasks } from '../../components/TrainingTags/trainingTagFilters';

function SectionTitle({ title, subtitle, accent = C.ice }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ color: accent, fontSize: 'calc(14px * var(--font-scale, 1))', fontWeight: 700, fontFamily: 'var(--font-display)' }}>
        {title}
      </div>
      {subtitle ? (
        <div style={{ color: C.ice50, fontSize: 'calc(11px * var(--font-scale, 1))', lineHeight: 1.55, marginTop: 4 }}>
          {subtitle}
        </div>
      ) : null}
    </div>
  );
}

function OptionChips({ items, activeValue, onChange, disabled = false }) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {items.map((item) => {
        const active = activeValue === item.value;
        return (
          <button
            key={item.value}
            onClick={() => !disabled && onChange(item.value)}
            disabled={disabled}
            style={{
              padding: '9px 14px',
              borderRadius: 999,
              border: `1px solid ${active ? item.borderColor || C.mars : C.border}`,
              background: active ? (item.background || 'rgba(199,91,57,0.12)') : C.bgMuted,
              color: active ? (item.color || C.mars) : C.ice60,
              fontSize: 'calc(12px * var(--font-scale, 1))',
              fontWeight: active ? 700 : 600,
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled ? 0.72 : 1,
              transition: 'all 0.36s ease',
            }}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

function ActionButton({ children, secondary = false, disabled = false, onClick, accent = C.mars }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        width: '100%',
        padding: '12px 14px',
        borderRadius: 12,
        border: secondary ? `1px solid ${C.borderStrong}` : 'none',
        background: secondary
          ? C.bgMuted
          : disabled
            ? 'rgba(199,91,57,0.30)'
            : `linear-gradient(135deg, ${accent}, ${C.marsLight})`,
        color: secondary ? C.ice : '#fff',
        fontSize: 'calc(13px * var(--font-scale, 1))',
        fontWeight: 700,
        cursor: disabled ? 'not-allowed' : 'pointer',
        boxShadow: secondary || disabled ? 'none' : '0 10px 24px rgba(199,91,57,0.24)',
        transition: 'all 0.2s ease',
      }}
    >
      {children}
    </button>
  );
}

function TrainedModelDropdown({
  options,
  currentOption,
  value,
  onChange,
  disabled,
  loading,
  isLight,
  isZh,
}) {
  const rootRef = useRef(null);
  const [open, setOpen] = useState(false);
  const selectedOption = options.find((option) => option.id === Number(value)) || currentOption || null;
  const hasOptions = options.length > 0;
  const isDisabled = disabled || loading || !hasOptions;
  const displayText = loading
    ? (isZh ? '正在加载训练模型...' : 'Loading trained models...')
    : selectedOption
      ? `${selectedOption.label} · #${selectedOption.id}`
      : (isZh ? '选择已完成训练模型' : 'Select a completed model');
  const panelBg = isLight ? 'rgba(255,255,255,0.96)' : 'rgba(8,18,31,0.98)';
  const itemBg = isLight ? 'rgba(15,23,42,0.04)' : 'rgba(255,255,255,0.035)';
  const activeBg = isLight ? 'rgba(74,158,255,0.13)' : 'rgba(74,158,255,0.15)';

  useEffect(() => {
    if (isDisabled) setOpen(false);
  }, [isDisabled]);

  useEffect(() => {
    if (!open) return undefined;
    const handleOutsideClick = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [open]);

  return (
    <div
      ref={rootRef}
      onKeyDown={(event) => {
        if (event.key === 'Escape') setOpen(false);
      }}
      style={{ position: 'relative', width: '100%', minWidth: 0, zIndex: open ? 70 : 'auto' }}
    >
      <button
        type="button"
        disabled={isDisabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((valueNow) => !valueNow)}
        style={{
          width: '100%',
          minWidth: 0,
          minHeight: 52,
          boxSizing: 'border-box',
          padding: '11px 12px',
          borderRadius: 12,
          border: `1px solid ${open ? 'rgba(121,187,255,0.62)' : C.border}`,
          background: isLight ? 'rgba(255,255,255,0.92)' : C.bgMuted,
          color: hasOptions ? C.ice : C.ice50,
          fontSize: 'calc(12px * var(--font-scale, 1))',
          fontWeight: 800,
          fontFamily: 'var(--font-body)',
          outline: 'none',
          cursor: isDisabled ? 'not-allowed' : 'pointer',
          opacity: isDisabled ? 0.72 : 1,
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) auto',
          alignItems: 'center',
          gap: 10,
          textAlign: 'left',
          boxShadow: open ? '0 0 0 3px rgba(121,187,255,0.12)' : 'none',
          transition: 'border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {displayText}
        </span>
        <KeyboardArrowDownRoundedIcon
          aria-hidden="true"
          sx={{
            color: open ? C.blue : C.ice60,
            fontSize: 18,
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.18s ease, color 0.18s ease',
            flexShrink: 0,
          }}
        />
      </button>

      {open ? (
        <div
          role="listbox"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 'calc(100% + 8px)',
            zIndex: 80,
            padding: 8,
            boxSizing: 'border-box',
            borderRadius: 12,
            border: '1px solid rgba(121,187,255,0.34)',
            background: panelBg,
            boxShadow: isLight
              ? '0 18px 42px rgba(15,23,42,0.18)'
              : '0 18px 42px rgba(0,0,0,0.48), 0 0 0 1px rgba(121,187,255,0.08)',
            backdropFilter: 'blur(18px)',
            WebkitBackdropFilter: 'blur(18px)',
            maxHeight: 260,
            overflowY: 'auto',
            overflowX: 'hidden',
          }}
        >
          {options.map((option) => {
            const active = option.id === Number(value);
            const summary = buildCompareModelSummary(option.task);
            return (
              <button
                key={option.id}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(option.id);
                  setOpen(false);
                }}
                style={{
                  width: '100%',
                  minWidth: 0,
                  boxSizing: 'border-box',
                  padding: '10px 11px',
                  borderRadius: 10,
                  border: `1px solid ${active ? 'rgba(121,187,255,0.42)' : 'transparent'}`,
                  background: active ? activeBg : 'transparent',
                  color: C.ice,
                  cursor: 'pointer',
                  display: 'grid',
                  gridTemplateColumns: 'minmax(0, 1fr) auto',
                  gap: 10,
                  alignItems: 'center',
                  textAlign: 'left',
                }}
                onMouseEnter={(event) => {
                  if (!active) event.currentTarget.style.background = itemBg;
                }}
                onMouseLeave={(event) => {
                  if (!active) event.currentTarget.style.background = 'transparent';
                }}
              >
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 'calc(12px * var(--font-scale, 1))', fontWeight: 800 }}>
                    {option.label}
                  </span>
                  <span style={{ display: 'block', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: C.ice50, fontSize: 'calc(10px * var(--font-scale, 1))', lineHeight: 1.45 }}>
                    #{summary.taskId} · {summary.architecture} · {summary.inputChannelText}
                  </span>
                  <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: C.ice40, fontSize: 'calc(10px * var(--font-scale, 1))', lineHeight: 1.45 }}>
                    {summary.modelSource} · W{summary.window || '--'} · H{summary.horizon || '--'} · {summary.dataSource}
                  </span>
                  <TagChips tags={option.task.tags} />
                </span>
                {active ? (
                  <CheckRoundedIcon aria-hidden="true" sx={{ color: C.blue, fontSize: 16, flexShrink: 0 }} />
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function ModelSourceControl({
  modelMode,
  setModelMode,
  trainingModelOptions,
  selectedTrainingTaskId,
  setSelectedTrainingTaskId,
  selectedCompareTrainingTaskIds,
  setSelectedCompareTrainingTaskIds,
  trainingTasksLoading,
  selectedTrainingOption,
  requestContextLocked,
  isLight,
  isZh,
}) {
  const hasTrainingModels = trainingModelOptions.length > 0;
  const tagState = useTrainingTags();
  const [tagFilter, setTagFilter] = useState({ tagIds: [], untagged: false });
  useEffect(() => {
    if (tagState.loading || tagState.error) return;
    const known = new Set(tagState.tags.map(tag => tag.id));
    setTagFilter(prev => prev.tagIds.some(id => !known.has(id)) ? { ...prev, tagIds: prev.tagIds.filter(id => known.has(id)) } : prev);
  }, [tagState.tags, tagState.loading, tagState.error]);
  const taggedOptions = useMemo(() => {
    const visible = new Set(filterTaggedTasks(trainingModelOptions.map(option => option.task), tagFilter).map(task => task.id));
    return trainingModelOptions.filter(option => visible.has(option.id));
  }, [trainingModelOptions, tagFilter]);
  const parameterItems = buildTrainedModelParameterItems(selectedTrainingOption?.task, { isZh });
  const [searchTerm, setSearchTerm] = useState('');
  const normalizedSearch = searchTerm.trim().toLowerCase();
  const filteredCompareOptions = useMemo(() => (
    taggedOptions.filter((option) => {
      if (!normalizedSearch) return true;
      const summary = buildCompareModelSummary(option.task);
      return [
        option.label,
        String(option.id),
        summary.architecture,
        summary.inputChannelText,
        summary.dataSource,
      ].join(' ').toLowerCase().includes(normalizedSearch);
    })
  ), [normalizedSearch, taggedOptions]);
  const selectedCompareOptions = trainingModelOptions.filter(option => selectedCompareTrainingTaskIds.includes(option.id));
  const hiddenSelectedCount = selectedCompareOptions.filter(option => !filteredCompareOptions.some(visible => visible.id === option.id)).length;
  const compareSelection = getCompareSelectionState(selectedCompareTrainingTaskIds);
  const modeItems = [
    {
      value: PREDICT_MODEL_MODE_TRAINED,
      label: isZh ? '单训练模型分析' : 'Single trained model',
      borderColor: C.blue,
      background: 'rgba(74,158,255,0.12)',
      color: C.blue,
    },
    {
      value: PREDICT_MODEL_MODE_COMPARE,
      label: isZh ? '多训练模型对比' : 'Compare trained models',
      borderColor: C.green,
      background: 'rgba(74,207,172,0.12)',
      color: C.green,
    },
  ];

  return (
    <GlowCard style={{ padding: 20 }}>
      <SectionTitle
        title={isZh ? '模型来源' : 'Model source'}
        subtitle={
          modelMode === PREDICT_MODEL_MODE_COMPARE
            ? (isZh ? '选择多个已完成训练任务，比较完整测试集表现。' : 'Compare completed training tasks across the full test set.')
            : modelMode === PREDICT_MODEL_MODE_TRAINED
            ? (isZh ? '使用训练页面已完成任务的模型权重进行预测。' : 'Use weights produced by a completed training task.')
            : ''
        }
        accent={modelMode === PREDICT_MODEL_MODE_COMPARE ? C.green : C.blue}
      />

      <OptionChips
        items={modeItems}
        activeValue={modelMode}
        onChange={setModelMode}
        disabled={requestContextLocked}
      />
      <TagFilter tags={tagState.tags} {...tagFilter} onChange={setTagFilter} isZh={isZh} disabled={tagState.loading || requestContextLocked} />
      {tagState.error && <div role="alert" className="training-tag-toolbar" style={{ color: C.mars }}>
        {tagState.error}<button className="training-tag-button" onClick={() => tagState.refresh().catch(() => {})}>{isZh ? '重试标签' : 'Retry tags'}</button>
      </div>}

      {modelMode === PREDICT_MODEL_MODE_TRAINED ? (
        <div style={{ marginTop: 14, display: 'grid', gap: 8 }}>
          <TrainedModelDropdown
            options={taggedOptions}
            currentOption={selectedTrainingOption}
            value={selectedTrainingTaskId || ''}
            disabled={requestContextLocked || trainingTasksLoading || !hasTrainingModels}
            loading={trainingTasksLoading}
            isLight={isLight}
            isZh={isZh}
            onChange={(nextId) => setSelectedTrainingTaskId(Number(nextId) || null)}
          />

          <div style={{ fontSize: 'calc(10px * var(--font-scale, 1))', color: C.ice50, lineHeight: 1.55 }}>
            {hasTrainingModels
              ? `${isZh ? '当前模型' : 'Current model'}: ${selectedTrainingOption?.label || '--'}`
              : (isZh ? '暂无可用于预测分析的已完成训练模型。' : 'No completed trained model is available for prediction analysis.')}
          </div>
          <TagChips tags={selectedTrainingOption?.task.tags} />
          {selectedTrainingOption && !taggedOptions.some(option => option.id === selectedTrainingOption.id) && (
            <div className="training-tag-hint" role="status">{isZh ? '当前模型不在筛选结果内，仍保留选中。' : 'The current model is outside these filters and remains selected.'}</div>
          )}
          {hasTrainingModels && taggedOptions.length === 0 && <div className="training-tag-hint">{isZh ? '没有匹配标签的可用模型。' : 'No available models match these tags.'}</div>}

          {parameterItems.length > 0 ? (
            <div
              style={{
                marginTop: 6,
                padding: 12,
                borderRadius: 12,
                border: `1px solid ${C.border}`,
                background: isLight ? 'rgba(255,255,255,0.78)' : 'rgba(255,255,255,0.03)',
              }}
            >
              <div style={{ color: C.ice, fontSize: 'calc(12px * var(--font-scale, 1))', fontWeight: 700, marginBottom: 10 }}>
                {isZh ? '所选模型参数' : 'Selected model parameters'}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {parameterItems.map((item) => (
                  <div
                    key={item.label}
                    style={{
                      minWidth: 0,
                      padding: '9px 10px',
                      borderRadius: 10,
                      background: C.bgMuted,
                      border: `1px solid ${C.border}`,
                    }}
                  >
                    <div style={{ color: C.ice40, fontSize: 'calc(9px * var(--font-scale, 1))', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      {item.label}
                    </div>
                    <div
                      title={item.value}
                      style={{
                        color: C.ice,
                        fontSize: 'calc(11px * var(--font-scale, 1))',
                        fontWeight: 700,
                        lineHeight: 1.45,
                        marginTop: 5,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {item.value}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {modelMode === PREDICT_MODEL_MODE_COMPARE ? (
        <div style={{ marginTop: 14, display: 'grid', gap: 10 }}>
          <input
            type="search"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder={isZh ? '搜索模型名 / 架构 / 通道' : 'Search name, architecture, channels'}
            disabled={trainingTasksLoading || !hasTrainingModels}
            style={{
              width: '100%',
              minWidth: 0,
              padding: '11px 12px',
              borderRadius: 12,
              border: `1px solid ${C.border}`,
              background: isLight ? 'rgba(255,255,255,0.92)' : C.bgMuted,
              color: C.ice,
              fontSize: 'calc(12px * var(--font-scale, 1))',
              fontWeight: 600,
              fontFamily: 'var(--font-body)',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              disabled={requestContextLocked || !filteredCompareOptions.length}
              onClick={() => setSelectedCompareTrainingTaskIds(previous => addVisibleSelection(previous, filteredCompareOptions.map((option) => option.id)))}
              style={{
                padding: '7px 11px',
                borderRadius: 999,
                border: `1px solid rgba(74,207,172,0.30)`,
                background: 'rgba(74,207,172,0.10)',
                color: hasTrainingModels ? C.green : C.ice40,
                fontSize: 'calc(11px * var(--font-scale, 1))',
                fontWeight: 700,
                cursor: hasTrainingModels ? 'pointer' : 'not-allowed',
              }}
            >
              {isZh ? '全选当前结果' : 'Select visible'}
            </button>
            <button
              type="button"
              disabled={requestContextLocked || compareSelection.count === 0}
              onClick={() => setSelectedCompareTrainingTaskIds([])}
              style={{
                padding: '7px 11px',
                borderRadius: 999,
                border: `1px solid ${C.borderStrong}`,
                background: C.bgMuted,
                color: compareSelection.count > 0 ? C.ice60 : C.ice30,
                fontSize: 'calc(11px * var(--font-scale, 1))',
                fontWeight: 700,
                cursor: compareSelection.count > 0 ? 'pointer' : 'not-allowed',
              }}
            >
              {isZh ? '清空选择' : 'Clear selection'}
            </button>
            <span style={{ marginLeft: 'auto', color: compareSelection.canCompare ? C.green : C.ice50, fontSize: 'calc(10px * var(--font-scale, 1))', fontWeight: 700 }}>
              {isZh ? `已选 ${compareSelection.count}，筛选外 ${hiddenSelectedCount}` : `${compareSelection.count} selected, ${hiddenSelectedCount} hidden`}
            </span>
          </div>

          {selectedCompareOptions.length > 0 && <div className="training-tag-chips" aria-label={isZh ? '已选对比模型' : 'Selected comparison models'}>
            {selectedCompareOptions.map(option => <button type="button" key={option.id} className="training-tag-button" disabled={requestContextLocked}
              aria-label={isZh ? `取消选择 ${option.label}` : `Deselect ${option.label}`}
              onClick={() => setSelectedCompareTrainingTaskIds(ids => ids.filter(id => id !== option.id))}>{option.label} ×</button>)}
          </div>}

          <div style={{ maxHeight: 280, overflowY: 'auto', overflowX: 'hidden', paddingRight: 4, display: 'grid', gap: 8 }}>
            {filteredCompareOptions.map((option) => {
              const active = selectedCompareTrainingTaskIds.includes(option.id);
              const summary = buildCompareModelSummary(option.task);
              return (
                <label
                  key={option.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'auto 1fr',
                    gap: 10,
                    padding: '10px 11px',
                    borderRadius: 12,
                    border: `1px solid ${active ? 'rgba(74,207,172,0.36)' : C.border}`,
                    background: active ? 'rgba(74,207,172,0.08)' : C.bgMuted,
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={active}
                    disabled={requestContextLocked}
                    onChange={() => {
                      setSelectedCompareTrainingTaskIds((prev) => (
                        prev.includes(option.id)
                          ? prev.filter((id) => id !== option.id)
                          : [...prev, option.id]
                      ));
                    }}
                    style={{ accentColor: C.green, marginTop: 2 }}
                  />
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', color: C.ice, fontSize: 'calc(12px * var(--font-scale, 1))', fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {summary.modelName}
                    </span>
                    <span style={{ display: 'block', color: C.ice50, fontSize: 'calc(10px * var(--font-scale, 1))', lineHeight: 1.55, marginTop: 3 }}>
                      #{summary.taskId} · {summary.architecture} · {summary.inputChannelText}
                    </span>
                    <span style={{ display: 'block', color: C.ice40, fontSize: 'calc(10px * var(--font-scale, 1))', lineHeight: 1.55 }}>
                      {summary.modelSource} · W{summary.window || '--'} · H{summary.horizon || '--'} · {summary.dataSource}
                    </span>
                    <TagChips tags={option.task.tags} />
                  </span>
                </label>
              );
            })}

            {!trainingTasksLoading && filteredCompareOptions.length === 0 ? (
              <div style={{ padding: 16, borderRadius: 12, background: C.bgMuted, border: `1px dashed ${C.borderStrong}`, color: C.ice50, fontSize: 'calc(11px * var(--font-scale, 1))', lineHeight: 1.6, textAlign: 'center' }}>
                {hasTrainingModels
                  ? (isZh ? '没有匹配的训练模型。' : 'No matching trained models.')
                  : (isZh ? '暂无可对比的已完成训练模型。' : 'No completed trained models are available.')}
              </div>
            ) : null}
          </div>

          <div style={{ color: compareSelection.canCompare ? C.ice50 : C.mars, fontSize: 'calc(10px * var(--font-scale, 1))', lineHeight: 1.55 }}>
            {compareSelection.canCompare
              ? (isZh ? '点击“开始对比”后将基于完整测试集计算指标。' : 'Start comparison to compute full test-set metrics.')
              : (isZh ? '至少选择 2 个模型才允许开始对比。' : 'Select at least 2 models to start comparison.')}
          </div>
        </div>
      ) : null}
    </GlowCard>
  );
}

function ModelHyperparams({ t, isZh }) {
  const params = [
    { label: 'Epochs', val: '30', color: C.mars },
    { label: 'Layers', val: '3 (ST-LSTM)', color: C.blue },
    { label: 'Hidden', val: '[64, 64, 64]', color: C.blue },
    { label: 'Filter', val: '3 x 3', color: C.green },
    { label: 'Window', val: '3', color: C.purple },
    { label: 'Horizon', val: '3', color: C.purple },
    { label: 'LR', val: '0.001', color: '#d9a441' },
    { label: 'Batch', val: '32', color: C.ice60 },
  ];

  return (
    <GlowCard style={{ padding: 20 }}>
      <SectionTitle
        title={t('predict.hyperTitle')}
        subtitle={isZh ? '当前预测流程使用的模型配置。' : 'Model configuration used for the current prediction flow.'}
      />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {params.map((p) => (
          <div key={p.label} style={{ padding: '10px 12px', background: C.bgMuted, borderRadius: 12, border: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 'calc(9px * var(--font-scale, 1))', color: C.ice40, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {p.label}
            </div>
            <div style={{ fontSize: 'calc(12px * var(--font-scale, 1))', color: p.color, fontWeight: 700, marginTop: 5 }}>
              {p.val}
            </div>
          </div>
        ))}
      </div>
    </GlowCard>
  );
}

export default function PredictSidebar({
  isLight,
  loading,
  requestContextLocked = false,
  isSwitchingSource,
  error,
  modelMode,
  setModelMode,
  trainingModelOptions = [],
  selectedTrainingTaskId,
  setSelectedTrainingTaskId,
  selectedCompareTrainingTaskIds = [],
  setSelectedCompareTrainingTaskIds,
  trainingTasksLoading = false,
  selectedTrainingOption,
  analysisVisibility = {},
  marsYear,
  setMarsYear,
  availableMarsYears,
  lsStart,
  setLsStart,
  predStep,
  setPredStep,
  predictionHorizonLimit,
  selectedVars,
  toggleVar,
  VARIABLES,
  handlePredict,
  precision,
}) {
  const t = useT();
  const { settings } = useSettings();
  const isZh = settings?.language !== 'en';
  const canShowInputVariables = analysisVisibility.inputVariables !== false;
  const canShowSystemHyperparams = analysisVisibility.systemHyperparams !== false;
  const isCompareMode = modelMode === PREDICT_MODEL_MODE_COMPARE;
  const compareSelection = getCompareSelectionState(selectedCompareTrainingTaskIds);

  const years = Array.isArray(availableMarsYears) && availableMarsYears.length > 0
    ? availableMarsYears
    : [27, 28];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <ModelSourceControl
        modelMode={modelMode}
        setModelMode={setModelMode}
        trainingModelOptions={trainingModelOptions}
        selectedTrainingTaskId={selectedTrainingTaskId}
        setSelectedTrainingTaskId={setSelectedTrainingTaskId}
        selectedCompareTrainingTaskIds={selectedCompareTrainingTaskIds}
        setSelectedCompareTrainingTaskIds={setSelectedCompareTrainingTaskIds}
        trainingTasksLoading={trainingTasksLoading}
        selectedTrainingOption={selectedTrainingOption}
        requestContextLocked={requestContextLocked}
        isLight={isLight}
        isZh={isZh}
      />

      <GlowCard style={{ padding: 20 }}>
        <SectionTitle
          title={t('predict.sidebar.predictionControl')}
          subtitle={isCompareMode
            ? (isZh ? '选择对比使用的测试集预测步长。' : 'Choose the test-set horizon used for comparison.')
            : (isZh ? '选择预测步长并发起本次推演。' : 'Choose the prediction horizon and run the next inference.')}
          accent={isCompareMode ? C.green : C.mars}
        />

        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 'calc(11px * var(--font-scale, 1))', color: C.ice50, marginBottom: 8 }}>
            {t('predict.horizon')}
          </div>
          <input
            type="number"
            min="1"
            max={predictionHorizonLimit}
            step="1"
            value={predStep}
            disabled={requestContextLocked || predictionHorizonLimit == null}
            aria-label={t('predict.horizon')}
            onChange={(event) => {
              const nextHorizon = clampPredictionHorizon(event.target.value, predictionHorizonLimit);
              if (nextHorizon != null) setPredStep(nextHorizon);
            }}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: '10px 12px',
              borderRadius: 8,
              border: `1px solid ${C.border}`,
              background: C.bgMuted,
              color: C.ice,
              fontSize: 'calc(13px * var(--font-scale, 1))',
              fontWeight: 700,
              fontFamily: 'var(--font-display)',
              cursor: predictionHorizonLimit == null ? 'not-allowed' : 'text',
              opacity: predictionHorizonLimit == null ? 0.65 : 1,
            }}
          />
          <div style={{ marginTop: 6, color: C.ice40, fontSize: 'calc(10px * var(--font-scale, 1))' }}>
            {predictionHorizonLimit == null
              ? (isZh ? '请选择具有有效输出窗口的训练模型' : 'Select a trained model with a valid output horizon')
              : (isZh ? `当前最大输出窗口：${predictionHorizonLimit}` : `Current maximum: ${predictionHorizonLimit}`)}
          </div>
        </div>

        <div style={{ display: 'grid', gap: 10 }}>
          <ActionButton
            onClick={handlePredict}
            disabled={loading
              || isSwitchingSource
              || predictionHorizonLimit == null
              || predStep > predictionHorizonLimit
              || (isCompareMode && !compareSelection.canCompare)}
            accent={isCompareMode ? C.green : C.mars}
          >
            {(loading || isSwitchingSource) ? (
              isSwitchingSource ? (isZh ? '加载数据中…' : 'Loading data...') : t('predict.runningBtn')
            ) : isCompareMode ? (isZh ? '开始对比' : 'Start comparison') : t('predict.runBtn')}
          </ActionButton>

        </div>

        {error ? (
          <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 12, background: 'rgba(255,80,80,0.08)', border: '1px solid rgba(255,80,80,0.18)', fontSize: 'calc(11px * var(--font-scale, 1))', color: '#ff7b7b', lineHeight: 1.6 }}>
            {error}
          </div>
        ) : null}
      </GlowCard>

      {!isCompareMode ? (
      <GlowCard style={{ padding: 20 }}>
        <SectionTitle
          title={t('predict.sidebar.parameters')}
          subtitle={isZh ? '调整火星年和起始太阳黄经。预测数据由服务器后台维护。' : 'Adjust Mars year and starting solar longitude. Prediction data is server-managed.'}
          accent={C.mars}
        />

        <div style={{ display: 'grid', gap: 16 }}>
          <div>
            <div style={{ fontSize: 'calc(11px * var(--font-scale, 1))', color: C.ice50, marginBottom: 8 }}>
              {t('predict.marsYear')}
            </div>
            <OptionChips
              disabled={requestContextLocked || isSwitchingSource}
              items={years.map((year) => ({
                value: year,
                label: `MY ${year}`,
                color: C.mars,
              }))}
              activeValue={marsYear}
              onChange={setMarsYear}
            />
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 6 }}>
              <span style={{ fontSize: 'calc(11px * var(--font-scale, 1))', color: C.ice50 }}>{t('predict.startLs')}</span>
              <span style={{ fontSize: 'calc(12px * var(--font-scale, 1))', color: C.ice, fontWeight: 700, fontFamily: 'var(--font-display)' }}>
                {lsStart}°
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={355}
              step={1}
              value={lsStart}
              disabled={requestContextLocked}
              onChange={(e) => setLsStart(Number(e.target.value))}
              style={{ width: '100%', accentColor: C.mars }}
            />
          </div>
        </div>
      </GlowCard>
      ) : null}

      {canShowInputVariables ? (
        <GlowCard style={{ padding: 20 }}>
        <SectionTitle
          title={t('predict.sidebar.inputVariables')}
          subtitle={isZh ? '选择参与预测的输入变量。' : 'Choose the input variables used in the model.'}
          accent={C.blue}
        />

        <div style={{ display: 'grid', gap: 8 }}>
          {VARIABLES.map((v) => {
            const active = selectedVars.includes(v.id);
            return (
              <label
                key={v.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 12px',
                  borderRadius: 12,
                  background: active ? `${v.color}12` : C.bgMuted,
                  border: `1px solid ${active ? `${v.color}33` : C.border}`,
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                }}
              >
                <input
                  type="checkbox"
                  checked={active}
                  disabled={requestContextLocked}
                  onChange={() => toggleVar(v.id)}
                  style={{ accentColor: v.color }}
                />
                <span style={{ flex: 1, fontSize: 'calc(12px * var(--font-scale, 1))', color: active ? C.ice : C.ice60 }}>
                  {v.label}
                </span>
              </label>
            );
          })}
        </div>
        </GlowCard>
      ) : null}

      {canShowSystemHyperparams ? <ModelHyperparams t={t} isZh={isZh} /> : null}

    </div>
  );
}
