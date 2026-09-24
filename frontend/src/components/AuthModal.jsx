import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useSettings } from '../contexts/SettingsContext';
import { useToast } from '../contexts/ToastContext';
import { useT } from '../i18n';
import C from '../constants/colors';
import { useScrollLock } from '../hooks/useScrollLock';
import { apiSendCode, apiResetPassword } from '../services/api';

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M3 3L13 13M13 3L3 13" stroke="currentColor" strokeWidth="1.8"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Input({ label, type = 'text', value, onChange, placeholder, disabled, error, name, autoComplete }) {
  const { settings } = useSettings();
  const isLight = settings.theme === 'light';
  const [focused, setFocused] = useState(false);

  const borderColor = error
    ? C.mars
    : focused
      ? C.blue
      : 'var(--border-strong)';

  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{
        display: 'block', fontSize: 'calc(11px * var(--font-scale, 1))', fontWeight: 600, letterSpacing: '0.08em',
        color: 'var(--text-80)',
        marginBottom: 6, textTransform: 'uppercase',
      }}>
        {label}
      </label>
      <input
        type={type}
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
          background: 'var(--bg-muted)',
          border: `1px solid ${borderColor}`,
          borderRadius: 8,
          color: 'var(--text)',
          fontSize: 'calc(14px * var(--font-scale, 1))',
          outline: 'none',
          transition: 'border-color 0.15s',
          fontFamily: 'inherit',
        }}
      />
      {error && (
        <div style={{ fontSize: 'calc(12px * var(--font-scale, 1))', color: C.mars, marginTop: 5 }}>{error}</div>
      )}
    </div>
  );
}

function TabBar({ tab, setTab, t, isLight }) {
  const activeColor = C.blue;
  const inactiveColor = 'var(--text-60)';
  const borderBase = 'var(--border)';

  return (
    <div style={{ display: 'flex', borderBottom: `1px solid ${borderBase}`, marginBottom: 24 }}>
      {['login', 'register'].map(k => (
        <button
          key={k}
          onClick={() => setTab(k)}
          style={{
            flex: 1, padding: '12px 0',
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 'calc(13px * var(--font-scale, 1))', fontWeight: 600, letterSpacing: '0.06em',
            color: tab === k ? activeColor : inactiveColor,
            borderBottom: tab === k ? `2px solid ${activeColor}` : '2px solid transparent',
            marginBottom: -1,
            transition: 'color 0.15s, border-color 0.15s',
            fontFamily: 'inherit',
          }}
        >
          {k === 'login' ? t('auth.loginTab') : t('auth.registerTab')}
        </button>
      ))}
    </div>
  );
}

export default function AuthModal() {
  const { authModalOpen, authModalTab, closeAuthModal, login, register } = useAuth();
  const { settings } = useSettings();
  const { showToast } = useToast();
  const t = useT();
  const isLight = settings.theme === 'light';
  useScrollLock(authModalOpen);

  // ── 登录/注册 state ──
  const [tab, setTab] = useState(authModalTab);
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState({});
  const [globalError, setGlobalError] = useState('');
  const [loading, setLoading] = useState(false);

  // ── 验证码 state ──
  const [verificationCode, setVerificationCode] = useState('');
  const [codeSending, setCodeSending] = useState(false);
  const [codeCountdown, setCodeCountdown] = useState(0);

  // ── 忘记密码 state ──
  const [forgotMode, setForgotMode] = useState(false);
  const [forgotStep, setForgotStep] = useState(1);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotCode, setForgotCode] = useState('');
  const [forgotNewPwd, setForgotNewPwd] = useState('');
  const [forgotConfirmPwd, setForgotConfirmPwd] = useState('');
  const [forgotError, setForgotError] = useState('');
  const [forgotCodeSending, setForgotCodeSending] = useState(false);
  const [forgotCodeCountdown, setForgotCodeCountdown] = useState(0);

  // ── 倒计时 ──
  useEffect(() => {
    if (codeCountdown <= 0) return;
    const timer = setTimeout(() => setCodeCountdown(c => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [codeCountdown]);

  useEffect(() => {
    if (forgotCodeCountdown <= 0) return;
    const timer = setTimeout(() => setForgotCodeCountdown(c => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [forgotCodeCountdown]);

  // ── 切换 tab 时重置全部状态 ──
  const switchTab = (newTab) => {
    setTab(newTab);
    setEmail(''); setUsername(''); setPassword('');
    setErrors({}); setGlobalError('');
    setVerificationCode(''); setCodeCountdown(0);
    setForgotMode(false); setForgotStep(1);
    setForgotEmail(''); setForgotCode('');
    setForgotNewPwd(''); setForgotConfirmPwd('');
    setForgotError(''); setForgotCodeCountdown(0);
  };

  // ── Modal 打开时同步 tab ──
  useEffect(() => {
    if (authModalOpen) {
      setTab(authModalTab);
      setEmail(''); setUsername(''); setPassword('');
      setErrors({}); setGlobalError('');
      setVerificationCode(''); setCodeCountdown(0);
      setForgotMode(false); setForgotStep(1);
      setForgotEmail(''); setForgotCode('');
      setForgotNewPwd(''); setForgotConfirmPwd('');
      setForgotError(''); setForgotCodeCountdown(0);
    }
  }, [authModalOpen, authModalTab]);

  if (!authModalOpen) return null;

  const L = isLight;
  const overlayBg    = L ? 'rgba(220,224,240,0.72)' : 'rgba(0,0,8,0.75)';
  const cardBg       = 'var(--bg-card-strong)';
  const cardBorder   = 'var(--border)';
  const cardShadow   = L
    ? '0 16px 48px rgba(15,23,42,0.14), 0 4px 12px rgba(15,23,42,0.07)'
    : '0 16px 48px rgba(0,0,0,0.40), 0 4px 12px rgba(0,0,0,0.24)';
  const titleColor   = 'var(--text)';
  const subtitleClr  = 'var(--text-60)';
  const closeColor   = 'var(--text-60)';
  const switchColor  = 'var(--text-60)';
  const hintColor    = 'var(--text-60)';
  const inputBg      = 'var(--bg-muted)';
  const inputBorder  = 'var(--border-strong)';
  const inputText    = 'var(--text)';
  const labelColor   = 'var(--text-80)';

  // ── 注册/登录校验 ──
  const validate = () => {
    const e = {};
    if (!email.trim()) e.email = t('auth.errEmailRequired');
    if (!password.trim()) e.password = t('auth.errPasswordRequired');
    if (tab === 'register') {
      if (!username.trim()) e.username = t('auth.errUsernameRequired');
      if (!verificationCode.trim()) e.verificationCode = t('auth.errCodeRequired');
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  // ── 发送注册验证码 ──
  const handleSendCode = async () => {
    if (!email.trim()) {
      setErrors(prev => ({ ...prev, email: t('auth.errEmailRequired') }));
      return;
    }
    setCodeSending(true);
    try {
      await apiSendCode(email.trim(), 'register');
      setCodeCountdown(60);
      showToast(t('auth.codeSent'), 'success');
    } catch (err) {
      setGlobalError(err.message || t('auth.errSendCodeFailed'));
    } finally {
      setCodeSending(false);
    }
  };

  // ── 登录/注册提交 ──
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;
    setGlobalError('');
    setLoading(true);
    try {
      if (tab === 'login') {
        const user = await login(email.trim(), password);
        closeAuthModal();
        showToast(t('auth.toastWelcome', { username: user.username || user.email }), 'success');
      } else {
        await register(email.trim(), username.trim(), password, verificationCode.trim());
        closeAuthModal();
        showToast(t('auth.toastRegistered'), 'success');
      }
    } catch (err) {
      setGlobalError(err.message || (tab === 'login' ? t('auth.errLoginFailed') : t('auth.errRegisterFailed')));
    } finally {
      setLoading(false);
    }
  };

  // ── 发送找回密码验证码 ──
  const handleForgotSendCode = async () => {
    if (!forgotEmail.trim()) {
      setForgotError(t('auth.errEmailRequired'));
      return;
    }
    setForgotCodeSending(true);
    setForgotError('');
    try {
      await apiSendCode(forgotEmail.trim(), 'reset_password');
      setForgotCodeCountdown(60);
      showToast(t('auth.codeSent'), 'success');
    } catch (err) {
      setForgotError(err.message || t('auth.errSendCodeFailed'));
    } finally {
      setForgotCodeSending(false);
    }
  };

  // ── 忘记密码提交（两步） ──
  const handleResetPassword = async () => {
    setForgotError('');
    if (!forgotEmail.trim()) { setForgotError(t('auth.errEmailRequired')); return; }
    if (!forgotCode.trim() || forgotCode.length !== 6) { setForgotError(t('auth.errCodeRequired')); return; }

    if (forgotStep === 1) {
      setForgotStep(2);
      return;
    }

    // Step 2
    if (forgotNewPwd.length < 6) { setForgotError('密码至少需要 6 位'); return; }
    if (forgotNewPwd !== forgotConfirmPwd) { setForgotError(t('auth.errPasswordMismatch')); return; }

    setLoading(true);
    try {
      await apiResetPassword(forgotEmail.trim(), forgotCode.trim(), forgotNewPwd);
      showToast(t('auth.resetSuccess'), 'success');
      setForgotMode(false);
      switchTab('login');
    } catch (err) {
      setForgotError(err.message || t('auth.errResetFailed'));
    } finally {
      setLoading(false);
    }
  };

  const emailAC    = tab === 'login' ? 'email'             : 'off';
  const passwordAC = tab === 'login' ? 'current-password'  : 'new-password';
  const emailName    = tab === 'login' ? 'login-email'     : 'register-email';
  const passwordName = tab === 'login' ? 'login-password'  : 'register-password';

  // ── 忘记密码视图 ──
  const renderForgotPassword = () => (
    <div>
      {/* Back link */}
      <button
        type="button"
        onClick={() => { setForgotMode(false); setForgotError(''); }}
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          fontSize: 'calc(12px * var(--font-scale, 1))', color: C.blue, fontFamily: 'inherit',
          padding: 0, marginBottom: 20, display: 'flex', alignItems: 'center', gap: 4,
        }}
      >
        {t('auth.forgotBackToLogin')}
      </button>

      {/* Step indicator */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 20, alignItems: 'center' }}>
        {[1, 2].map(n => (
          <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{
              width: 24, height: 24, borderRadius: '50%', display: 'flex',
              alignItems: 'center', justifyContent: 'center',
              background: forgotStep >= n ? C.blue : (L ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.15)'),
              fontSize: 'calc(11px * var(--font-scale, 1))', fontWeight: 700,
              color: forgotStep >= n ? '#fff' : (L ? 'rgba(42,42,58,0.4)' : 'rgba(232,237,243,0.35)'),
            }}>{n}</div>
            {n < 2 && (
              <div style={{
                width: 32, height: 1,
                background: forgotStep > 1 ? C.blue : (L ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.15)'),
              }} />
            )}
          </div>
        ))}
        <span style={{ fontSize: 'calc(12px * var(--font-scale, 1))', color: hintColor, marginLeft: 6 }}>
          {forgotStep === 1 ? t('auth.forgotStep1Hint') : t('auth.forgotStep2Hint')}
        </span>
      </div>

      {/* Step 1: email + code */}
      {forgotStep === 1 && (
        <>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 'calc(11px * var(--font-scale, 1))', fontWeight: 600, letterSpacing: '0.08em', color: labelColor, marginBottom: 6, textTransform: 'uppercase' }}>
              {t('auth.email')}
            </label>
            <input
              type="email"
              value={forgotEmail}
              onChange={e => setForgotEmail(e.target.value)}
              placeholder={t('auth.emailPlaceholder')}
              disabled={loading}
              style={{
                width: '100%', boxSizing: 'border-box', padding: '10px 14px',
                background: inputBg, border: `1px solid ${inputBorder}`,
                borderRadius: 8, color: inputText, fontSize: 'calc(14px * var(--font-scale, 1))',
                outline: 'none', transition: 'border-color 0.15s', fontFamily: 'inherit',
              }}
            />
          </div>

          {/* Code row */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 'calc(11px * var(--font-scale, 1))', fontWeight: 600, letterSpacing: '0.08em', color: labelColor, marginBottom: 6, textTransform: 'uppercase' }}>
              {t('auth.verificationCode')}
            </label>
            <div style={{ display: 'flex', gap: 10 }}>
              <input
                type="text"
                maxLength={6}
                value={forgotCode}
                onChange={e => setForgotCode(e.target.value.replace(/\D/g, ''))}
                placeholder={t('auth.codePlaceholder')}
                disabled={loading}
                style={{
                  flex: 1, boxSizing: 'border-box', padding: '10px 14px',
                  background: L ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.05)',
                  border: `1px solid ${L ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.15)'}`,
                  borderRadius: 8, fontSize: 'calc(14px * var(--font-scale, 1))',
                  color: L ? '#000000' : '#ffffff',
                  outline: 'none', transition: 'border-color 0.15s', fontFamily: 'inherit',
                }}
              />
              <button
                type="button"
                disabled={forgotCodeSending || forgotCodeCountdown > 0 || loading}
                onClick={handleForgotSendCode}
                style={{
                  padding: '10px 16px', whiteSpace: 'nowrap', flexShrink: 0,
                  background: (forgotCodeSending || forgotCodeCountdown > 0)
                    ? (L ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)') : C.blue,
                  border: `1px solid ${(forgotCodeSending || forgotCodeCountdown > 0)
                    ? (L ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.12)') : C.blue}`,
                  borderRadius: 8,
                  color: (forgotCodeSending || forgotCodeCountdown > 0)
                    ? (L ? 'rgba(42,42,58,0.4)' : 'rgba(232,237,243,0.35)') : '#fff',
                  fontSize: 'calc(12px * var(--font-scale, 1))', fontWeight: 600,
                  cursor: (forgotCodeSending || forgotCodeCountdown > 0 || loading) ? 'default' : 'pointer',
                  transition: 'all 0.15s', fontFamily: 'inherit',
                }}
              >
                {forgotCodeSending ? t('auth.codeSending')
                  : forgotCodeCountdown > 0 ? `${forgotCodeCountdown}s`
                  : t('auth.sendCode')}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Step 2: new password */}
      {forgotStep === 2 && (
        <>
          <Input
            label={t('auth.newPassword')}
            type="password"
            value={forgotNewPwd}
            onChange={setForgotNewPwd}
            placeholder={t('auth.newPasswordPlaceholder')}
            disabled={loading}
            autoComplete="new-password"
          />
          <Input
            label={t('auth.confirmPassword')}
            type="password"
            value={forgotConfirmPwd}
            onChange={setForgotConfirmPwd}
            placeholder={t('auth.confirmPasswordPlaceholder')}
            disabled={loading}
            autoComplete="new-password"
          />
        </>
      )}

      {forgotError && (
        <div style={{
          fontSize: 'calc(13px * var(--font-scale, 1))', color: C.mars, marginBottom: 14,
          padding: '8px 12px', borderRadius: 7,
          background: L ? 'rgba(220,80,50,0.07)' : 'rgba(220,80,50,0.12)',
          border: '1px solid rgba(220,80,50,0.22)',
        }}>
          {forgotError}
        </div>
      )}

      <button
        type="button"
        disabled={loading}
        onClick={handleResetPassword}
        style={{
          width: '100%', padding: '11px 0',
          background: loading
            ? (L ? 'rgba(66,133,244,0.5)' : 'rgba(66,133,244,0.35)')
            : C.blue,
          border: 'none', borderRadius: 9,
          color: '#fff', fontSize: 'calc(14px * var(--font-scale, 1))', fontWeight: 700,
          letterSpacing: '0.04em',
          cursor: loading ? 'default' : 'pointer',
          fontFamily: 'Orbitron, sans-serif',
          transition: 'background 0.15s',
        }}
      >
        {loading ? t('auth.forgotResetting')
          : forgotStep === 1 ? t('auth.forgotNextBtn')
          : t('auth.forgotResetBtn')}
      </button>
    </div>
  );

  return (
    <>
      <style>{`
        @keyframes _amodal { from { opacity:0; transform:scale(0.96) translateY(8px); } to { opacity:1; transform:scale(1) translateY(0); } }
      `}</style>

      <div
        onClick={closeAuthModal}
        style={{
          position: 'fixed', inset: 0,
          background: overlayBg,
          backdropFilter: 'blur(6px)',
          WebkitBackdropFilter: 'blur(6px)',
          zIndex: 9000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          overscrollBehavior: 'contain',
        }}
      >
        <div
          onClick={e => e.stopPropagation()}
          style={{
            width: 400, maxWidth: 'calc(100vw - 48px)',
            background: cardBg,
            border: `1px solid ${cardBorder}`,
            borderRadius: 16,
            boxShadow: cardShadow,
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            padding: '28px 32px 32px',
            animation: '_amodal 0.18s ease-out',
            position: 'relative',
          }}
        >
          {/* Close */}
          <button
            onClick={closeAuthModal}
            style={{
              position: 'absolute', top: 18, right: 18,
              background: 'none', border: 'none', cursor: 'pointer',
              color: closeColor, padding: 4, display: 'flex', borderRadius: 6,
            }}
          >
            <CloseIcon />
          </button>

          {/* Header */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 'calc(10px * var(--font-scale, 1))', fontWeight: 700, letterSpacing: '0.12em', color: C.blue, fontFamily: 'Orbitron, sans-serif', marginBottom: 4 }}>
              ASTRAATMOS
            </div>
            <div style={{ fontSize: 'calc(20px * var(--font-scale, 1))', fontWeight: 700, color: titleColor, fontFamily: 'Orbitron, sans-serif', letterSpacing: '0.02em' }}>
              {forgotMode ? t('auth.forgotTitle') : (tab === 'login' ? t('auth.loginTitle') : t('auth.registerTitle'))}
            </div>
            <div style={{ fontSize: 'calc(12px * var(--font-scale, 1))', color: subtitleClr, marginTop: 4 }}>
              {t('home.desc')}
            </div>
          </div>

          {forgotMode ? (
            renderForgotPassword()
          ) : (
            <>
              {/* Tabs */}
              <TabBar tab={tab} setTab={switchTab} t={t} isLight={L} />

              {/* Form — keyed by tab so DOM resets, preventing autocomplete bleed */}
              <form key={tab} onSubmit={handleSubmit} noValidate autoComplete={tab === 'login' ? 'on' : 'off'}>
                <Input
                  label={t('auth.email')}
                  type="email"
                  name={emailName}
                  autoComplete={emailAC}
                  value={email}
                  onChange={setEmail}
                  placeholder={t('auth.emailPlaceholder')}
                  disabled={loading}
                  error={errors.email}
                />

                {tab === 'register' && (
                  <Input
                    label={t('auth.username')}
                    name="register-username"
                    autoComplete="username"
                    value={username}
                    onChange={setUsername}
                    placeholder={t('auth.usernamePlaceholder')}
                    disabled={loading}
                    error={errors.username}
                  />
                )}

                <Input
                  label={t('auth.password')}
                  type="password"
                  name={passwordName}
                  autoComplete={passwordAC}
                  value={password}
                  onChange={setPassword}
                  placeholder={t('auth.passwordPlaceholder')}
                  disabled={loading}
                  error={errors.password}
                />

                {/* 注册验证码行 */}
                {tab === 'register' && (
                  <div style={{ marginBottom: 16 }}>
                    <label style={{
                      display: 'block', fontSize: 'calc(11px * var(--font-scale, 1))', fontWeight: 600, letterSpacing: '0.08em',
                      color: labelColor, marginBottom: 6, textTransform: 'uppercase',
                    }}>
                      {t('auth.verificationCode')}
                    </label>
                    <div style={{ display: 'flex', gap: 10 }}>
                      <input
                        type="text"
                        maxLength={6}
                        value={verificationCode}
                        onChange={e => setVerificationCode(e.target.value.replace(/\D/g, ''))}
                        placeholder={t('auth.codePlaceholder')}
                        disabled={loading}
                        style={{
                          flex: 1, boxSizing: 'border-box', padding: '10px 14px',
                          background: L ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.05)',
                          border: `1px solid ${errors.verificationCode ? C.mars : L ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.15)'}`,
                          borderRadius: 8, fontSize: 'calc(14px * var(--font-scale, 1))',
                          color: L ? '#000000' : '#ffffff',
                          outline: 'none', transition: 'border-color 0.15s', fontFamily: 'inherit',
                        }}
                      />
                      <button
                        type="button"
                        disabled={codeSending || codeCountdown > 0 || loading}
                        onClick={handleSendCode}
                        style={{
                          padding: '10px 16px', whiteSpace: 'nowrap', flexShrink: 0,
                          background: (codeSending || codeCountdown > 0)
                            ? (L ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)') : C.blue,
                          border: `1px solid ${(codeSending || codeCountdown > 0)
                            ? (L ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.12)') : C.blue}`,
                          borderRadius: 8,
                          color: (codeSending || codeCountdown > 0)
                            ? (L ? 'rgba(42,42,58,0.4)' : 'rgba(232,237,243,0.35)') : '#fff',
                          fontSize: 'calc(12px * var(--font-scale, 1))', fontWeight: 600,
                          cursor: (codeSending || codeCountdown > 0 || loading) ? 'default' : 'pointer',
                          transition: 'all 0.15s', fontFamily: 'inherit',
                        }}
                      >
                        {codeSending ? t('auth.codeSending')
                          : codeCountdown > 0 ? `${codeCountdown}s`
                          : t('auth.sendCode')}
                      </button>
                    </div>
                    {errors.verificationCode && (
                      <div style={{ fontSize: 'calc(12px * var(--font-scale, 1))', color: C.mars, marginTop: 5 }}>
                        {errors.verificationCode}
                      </div>
                    )}
                  </div>
                )}

                {globalError && (
                  <div style={{
                    fontSize: 'calc(13px * var(--font-scale, 1))', color: C.mars, marginBottom: 14,
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
                    background: loading
                      ? (L ? 'rgba(66,133,244,0.5)' : 'rgba(66,133,244,0.35)')
                      : C.blue,
                    border: 'none', borderRadius: 9,
                    color: '#fff', fontSize: 'calc(14px * var(--font-scale, 1))', fontWeight: 700,
                    letterSpacing: '0.04em',
                    cursor: loading ? 'default' : 'pointer',
                    fontFamily: 'Orbitron, sans-serif',
                    transition: 'background 0.15s',
                    marginTop: 4,
                  }}
                >
                  {loading
                    ? (tab === 'login' ? t('auth.loggingIn') : t('auth.registering'))
                    : (tab === 'login' ? t('auth.loginBtn') : t('auth.registerBtn'))}
                </button>
              </form>

              {/* 忘记密码 + 切换 tab */}
              <div style={{ textAlign: 'center', marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {tab === 'login' && (
                  <button
                    type="button"
                    onClick={() => { setForgotMode(true); setForgotStep(1); setGlobalError(''); }}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      fontSize: 'calc(12px * var(--font-scale, 1))', color: C.blue,
                      textDecoration: 'underline', textUnderlineOffset: 3,
                      fontFamily: 'inherit',
                    }}
                  >
                    {t('auth.forgotPassword')}
                  </button>
                )}
                <button
                  onClick={() => switchTab(tab === 'login' ? 'register' : 'login')}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    fontSize: 'calc(13px * var(--font-scale, 1))', color: switchColor,
                    textDecoration: 'underline', textUnderlineOffset: 3,
                    fontFamily: 'inherit',
                  }}
                >
                  {tab === 'login' ? t('auth.switchToRegister') : t('auth.switchToLogin')}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
