import ReactDOM from 'react-dom';
import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useSettings } from '../contexts/SettingsContext';
import { useToast } from '../contexts/ToastContext';
import { useT } from '../i18n';
import C from '../constants/colors';
import { useScrollLock } from '../hooks/useScrollLock';

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M3 3L13 13M13 3L3 13" stroke="currentColor" strokeWidth="1.8"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PwdInput({ label, value, onChange, placeholder, disabled, error, name, autoComplete }) {
  const { settings } = useSettings();
  const L = settings.theme === 'light';
  const [focused, setFocused] = useState(false);

  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{
        display: 'block', fontSize: 'calc(11px * var(--font-scale, 1))', fontWeight: 600, letterSpacing: '0.08em',
        color: L ? '#000000' : '#ffffff',
        marginBottom: 5, textTransform: 'uppercase',
      }}>
        {label}
      </label>
      <input
        type="password"
        name={name}
        autoComplete={autoComplete}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          width: '100%', boxSizing: 'border-box',
          padding: '10px 14px',
          background: L ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.05)',
          border: `1px solid ${error ? C.mars : focused ? C.blue : L ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.15)'}`,
          borderRadius: 8,
          color: L ? '#000000' : '#ffffff',
          fontSize: 'calc(14px * var(--font-scale, 1))', outline: 'none',
          transition: 'border-color 0.15s',
          fontFamily: 'inherit',
        }}
      />
      {error && <div style={{ fontSize: 'calc(12px * var(--font-scale, 1))', color: C.mars, marginTop: 4 }}>{error}</div>}
    </div>
  );
}

function ModalContent({ onClose }) {
  const { changePassword } = useAuth();
  const { settings } = useSettings();
  const { showToast } = useToast();
  const t = useT();
  const L = settings.theme === 'light';
  useScrollLock();

  const [oldPwd, setOldPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [errors, setErrors] = useState({});
  const [globalError, setGlobalError] = useState('');
  const [loading, setLoading] = useState(false);

  const overlayBg  = L ? 'rgba(210,215,235,0.70)' : 'rgba(0,0,8,0.75)';
  const cardBg     = L ? 'rgba(255,255,255,0.97)'  : 'rgba(13,13,28,0.95)';
  const cardBorder = L ? 'rgba(0,0,0,0.09)'        : 'rgba(255,255,255,0.10)';
  const cardShadow = L
    ? '0 16px 48px rgba(0,0,0,0.12), 0 4px 12px rgba(0,0,0,0.07)'
    : '0 16px 48px rgba(0,0,0,0.72), 0 4px 12px rgba(0,0,0,0.40)';
  const titleColor = L ? '#000000' : '#ffffff';
  const closeColor = L ? '#000000' : '#ffffff';

  const validate = () => {
    const e = {};
    if (!oldPwd) e.oldPwd = t('auth.errPasswordRequired');
    if (!newPwd) e.newPwd = t('auth.errPasswordRequired');
    if (newPwd && confirmPwd && newPwd !== confirmPwd) e.confirmPwd = t('auth.errPasswordMismatch');
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (ev) => {
    ev.preventDefault();
    if (!validate()) return;
    setGlobalError('');
    setLoading(true);
    try {
      await changePassword(oldPwd, newPwd);
      showToast(t('auth.changePwdSuccess'), 'success');
      onClose();
    } catch {
      setGlobalError(t('auth.errChangePwdFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <style>{`@keyframes _cpmodal { from { opacity:0; transform:scale(0.96) translateY(8px); } to { opacity:1; transform:scale(1) translateY(0); } }`}</style>
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0,
          background: overlayBg,
          backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
          zIndex: 9100,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          overscrollBehavior: 'contain',
        }}
      >
        <div
          onClick={e => e.stopPropagation()}
          style={{
            width: 360, maxWidth: 'calc(100vw - 48px)',
            background: cardBg,
            border: `1px solid ${cardBorder}`,
            borderRadius: 16, boxShadow: cardShadow,
            backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
            padding: '26px 28px 28px', position: 'relative',
            animation: '_cpmodal 0.18s ease-out',
          }}
        >
          <button onClick={onClose} style={{
            position: 'absolute', top: 16, right: 16,
            background: 'none', border: 'none', cursor: 'pointer',
            color: closeColor, padding: 4, display: 'flex', borderRadius: 6,
          }}>
            <CloseIcon />
          </button>

          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 'calc(10px * var(--font-scale, 1))', fontWeight: 700, letterSpacing: '0.12em', color: C.blue, fontFamily: 'Orbitron, sans-serif', marginBottom: 4 }}>
              ASTRAATMOS
            </div>
            <div style={{ fontSize: 'calc(18px * var(--font-scale, 1))', fontWeight: 700, color: titleColor, fontFamily: 'Orbitron, sans-serif' }}>
              {t('auth.changePassword')}
            </div>
          </div>

          <form onSubmit={handleSubmit} noValidate autoComplete="off">
            <PwdInput
              label={t('auth.oldPassword')}
              name="current-password"
              autoComplete="current-password"
              value={oldPwd}
              onChange={setOldPwd}
              placeholder={t('auth.oldPasswordPlaceholder')}
              disabled={loading}
              error={errors.oldPwd}
            />
            <PwdInput
              label={t('auth.newPassword')}
              name="new-password"
              autoComplete="new-password"
              value={newPwd}
              onChange={setNewPwd}
              placeholder={t('auth.newPasswordPlaceholder')}
              disabled={loading}
              error={errors.newPwd}
            />
            <PwdInput
              label={t('auth.confirmPassword')}
              name="confirm-password"
              autoComplete="new-password"
              value={confirmPwd}
              onChange={setConfirmPwd}
              placeholder={t('auth.confirmPasswordPlaceholder')}
              disabled={loading}
              error={errors.confirmPwd}
            />

            {globalError && (
              <div style={{
                fontSize: 'calc(13px * var(--font-scale, 1))', color: C.mars, marginBottom: 12,
                padding: '8px 12px', borderRadius: 7,
                background: L ? 'rgba(220,80,50,0.07)' : 'rgba(220,80,50,0.12)',
                border: '1px solid rgba(220,80,50,0.22)',
              }}>
                {globalError}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%', padding: '11px 0',
                background: loading ? 'rgba(74,158,255,0.45)' : C.blue,
                border: 'none', borderRadius: 9,
                color: '#fff', fontSize: 'calc(13px * var(--font-scale, 1))', fontWeight: 700,
                letterSpacing: '0.04em',
                cursor: loading ? 'default' : 'pointer',
                fontFamily: 'Orbitron, sans-serif',
                transition: 'background 0.15s',
                marginTop: 4,
              }}
            >
              {loading ? '...' : t('auth.changePwdBtn')}
            </button>
          </form>
        </div>
      </div>
    </>
  );
}

export default function ChangePasswordModal({ onClose }) {
  return ReactDOM.createPortal(<ModalContent onClose={onClose} />, document.body);
}
