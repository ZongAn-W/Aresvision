import { useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import SaveRoundedIcon from '@mui/icons-material/SaveRounded';
import C from '../../constants/colors';
import { useSettings } from '../../contexts/SettingsContext';
import { useScrollLock } from '../../hooks/useScrollLock';
import {
  normalizeTrainedModelName,
  validateTrainedModelName,
} from './trainedModelRename';

function RenameModelDialogContent({ task, tasks, language, onClose, onSave }) {
  const { settings } = useSettings();
  const isLight = settings.theme === 'light';
  const isZh = language !== 'en';
  const [name, setName] = useState(task.custom_model_name || '');
  const [submitError, setSubmitError] = useState('');
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);
  useScrollLock();

  const copy = useMemo(() => ({
    title: isZh ? '重命名模型' : 'Rename model',
    label: isZh ? '模型名称' : 'Model name',
    hint: isZh ? '改名不会更改模型权重文件或训练记录。' : 'Renaming does not change the model weights or training record.',
    cancel: isZh ? '取消' : 'Cancel',
    save: isZh ? '保存名称' : 'Save name',
    saving: isZh ? '正在保存...' : 'Saving...',
    close: isZh ? '关闭重命名窗口' : 'Close rename dialog',
  }), [isZh]);

  const validationError = validateTrainedModelName(name, tasks, task.id, language);
  const visibleError = submitError || (touched ? validationError : '');

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !saving) onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, saving]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (saving || validationError) return;

    try {
      setSaving(true);
      setSubmitError('');
      await onSave(normalizeTrainedModelName(name));
    } catch (saveError) {
      setSubmitError(saveError.message || (isZh ? '模型改名失败' : 'Could not rename model'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9800,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        background: isLight ? 'rgba(210,215,235,0.70)' : 'rgba(0,0,8,0.78)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="rename-model-title"
        onSubmit={handleSubmit}
        style={{
          width: 'min(420px, 100%)',
          padding: '24px',
          borderRadius: 14,
          border: `1px solid ${C.border}`,
          background: C.bgCardStrong,
          boxShadow: isLight
            ? '0 18px 48px rgba(15,23,42,0.16)'
            : '0 18px 48px rgba(0,0,0,0.48)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <div
              id="rename-model-title"
              style={{
                color: C.ice,
                fontFamily: 'var(--font-display)',
                fontSize: 'calc(17px * var(--font-scale, 1))',
                fontWeight: 700,
                lineHeight: 1.4,
              }}
            >
              {copy.title}
            </div>
            <div style={{ marginTop: 6, color: C.ice60, fontSize: 'calc(12px * var(--font-scale, 1))', lineHeight: 1.6 }}>
              {copy.hint}
            </div>
          </div>
          <button
            type="button"
            aria-label={copy.close}
            title={copy.close}
            onClick={onClose}
            disabled={saving}
            style={{
              width: 44,
              height: 44,
              flexShrink: 0,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 8,
              border: `1px solid ${C.border}`,
              background: C.bgMuted,
              color: C.ice60,
              cursor: saving ? 'not-allowed' : 'pointer',
              opacity: saving ? 0.55 : 1,
            }}
          >
            <CloseRoundedIcon sx={{ fontSize: 20 }} />
          </button>
        </div>

        <div style={{ marginTop: 22 }}>
          <label
            htmlFor="trained-model-name"
            style={{ display: 'block', marginBottom: 8, color: C.ice80, fontSize: 'calc(12px * var(--font-scale, 1))', fontWeight: 600 }}
          >
            {copy.label}
          </label>
          <input
            id="trained-model-name"
            autoFocus
            value={name}
            maxLength={255}
            aria-invalid={Boolean(visibleError)}
            aria-describedby={visibleError ? 'trained-model-name-error' : undefined}
            onChange={(event) => {
              setName(event.target.value);
              setTouched(true);
              setSubmitError('');
            }}
            disabled={saving}
            style={{
              boxSizing: 'border-box',
              width: '100%',
              minHeight: 44,
              padding: '10px 12px',
              borderRadius: 8,
              border: `1px solid ${visibleError ? '#d95c5c' : C.borderStrong}`,
              outline: 'none',
              background: isLight ? 'rgba(255,255,255,0.98)' : 'rgba(15,20,28,0.92)',
              color: C.ice,
              fontFamily: 'var(--font-body)',
              fontSize: '16px',
              lineHeight: 1.4,
              boxShadow: visibleError ? '0 0 0 3px rgba(217,92,92,0.10)' : 'none',
            }}
          />
          <div
            id="trained-model-name-error"
            role={visibleError ? 'alert' : undefined}
            style={{ minHeight: 20, marginTop: 7, color: '#d95c5c', fontSize: 'calc(11px * var(--font-scale, 1))', lineHeight: 1.5 }}
          >
            {visibleError}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            style={{
              minHeight: 44,
              padding: '10px 18px',
              borderRadius: 8,
              border: `1px solid ${C.border}`,
              background: C.bgMuted,
              color: C.ice,
              fontFamily: 'inherit',
              fontWeight: 600,
              cursor: saving ? 'not-allowed' : 'pointer',
              opacity: saving ? 0.55 : 1,
            }}
          >
            {copy.cancel}
          </button>
          <button
            type="submit"
            disabled={saving || Boolean(validationError)}
            style={{
              minHeight: 44,
              padding: '10px 18px',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              borderRadius: 8,
              border: '1px solid rgba(74,158,255,0.32)',
              background: 'rgba(74,158,255,0.18)',
              color: C.blue,
              fontFamily: 'inherit',
              fontWeight: 700,
              cursor: saving || validationError ? 'not-allowed' : 'pointer',
              opacity: saving || validationError ? 0.5 : 1,
            }}
          >
            <SaveRoundedIcon sx={{ fontSize: 18 }} />
            {saving ? copy.saving : copy.save}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function RenameModelDialog(props) {
  return ReactDOM.createPortal(<RenameModelDialogContent {...props} />, document.body);
}
