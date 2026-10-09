import { useState, useEffect, useRef, useId } from 'react';
import CloseOutlined from '@mui/icons-material/CloseOutlined';
import { useAuth } from '../contexts/AuthContext';
import { useSettings } from '../contexts/SettingsContext';
import { useToast } from '../contexts/ToastContext';
import { useT } from '../i18n';
import { useScrollLock } from '../hooks/useScrollLock';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { apiSendCode, apiResetPassword } from '../services/api';
import './ui/overlay.css';

function Input({ label, type = 'text', value, onChange, placeholder, disabled, error, name, autoComplete }) {
  const inputId = useId();
  const errorId = `${inputId}-error`;

  return (
    <div className="av-auth-field">
      <label htmlFor={inputId}>{label}</label>
      <input
        id={inputId}
        type={type}
        name={name}
        autoComplete={autoComplete}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
      />
      {error && (
        <div id={errorId} className="av-auth-error" role="alert">{error}</div>
      )}
    </div>
  );
}

function TabBar({ tab, setTab, t }) {
  return (
    <div className="av-auth-tabs">
      {['login', 'register'].map(k => (
        <button
          key={k}
          type="button"
          aria-pressed={tab === k}
          onClick={() => setTab(k)}
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
  const dialogRef = useRef(null);
  const titleId = useId();
  const fieldPrefix = useId();
  useScrollLock(authModalOpen);
  useDialogFocus(authModalOpen, dialogRef, closeAuthModal);

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
    if (forgotNewPwd.length < 6) { setForgotError(settings.language === 'zh' ? '密码至少需要 6 位' : 'Password must contain at least 6 characters'); return; }
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

  const closeLabel = settings.language === 'zh' ? '关闭登录窗口' : 'Close authentication';
  const renderForgotPassword = () => (
    <div aria-busy={loading}>
      <button type="button" className="av-link-button" onClick={() => { setForgotMode(false); setForgotError(''); }}>
        {t('auth.forgotBackToLogin')}
      </button>
      <div className="av-auth-subtitle" role="status">
        {forgotStep} / 2 · {forgotStep === 1 ? t('auth.forgotStep1Hint') : t('auth.forgotStep2Hint')}
      </div>
      {forgotStep === 1 && (
        <>
          <Input label={t('auth.email')} type="email" value={forgotEmail} onChange={setForgotEmail}
            placeholder={t('auth.emailPlaceholder')} disabled={loading} autoComplete="email" />
          <div className="av-auth-field">
            <label htmlFor={fieldPrefix + '-forgot-code'}>{t('auth.verificationCode')}</label>
            <div className="av-auth-code-row">
              <input id={fieldPrefix + '-forgot-code'} type="text" inputMode="numeric" autoComplete="one-time-code"
                maxLength={6} value={forgotCode} onChange={e => setForgotCode(e.target.value.replace(/\D/g, ''))}
                placeholder={t('auth.codePlaceholder')} disabled={loading} />
              <button type="button" className="av-button" disabled={forgotCodeSending || forgotCodeCountdown > 0 || loading}
                aria-busy={forgotCodeSending} onClick={handleForgotSendCode}>
                {forgotCodeSending ? t('auth.codeSending') : forgotCodeCountdown > 0 ? forgotCodeCountdown + 's' : t('auth.sendCode')}
              </button>
            </div>
          </div>
        </>
      )}
      {forgotStep === 2 && (
        <>
          <Input label={t('auth.newPassword')} type="password" value={forgotNewPwd} onChange={setForgotNewPwd}
            placeholder={t('auth.newPasswordPlaceholder')} disabled={loading} autoComplete="new-password" />
          <Input label={t('auth.confirmPassword')} type="password" value={forgotConfirmPwd} onChange={setForgotConfirmPwd}
            placeholder={t('auth.confirmPasswordPlaceholder')} disabled={loading} autoComplete="new-password" />
        </>
      )}
      {forgotError && <div className="av-alert" role="alert">{forgotError}</div>}
      <button type="button" className="av-button av-button--primary av-auth-submit" disabled={loading} onClick={handleResetPassword}>
        {loading ? t('auth.forgotResetting') : forgotStep === 1 ? t('auth.forgotNextBtn') : t('auth.forgotResetBtn')}
      </button>
    </div>
  );

  return (
    <div className="av-overlay-backdrop av-modal-backdrop" style={{ zIndex: 9000 }} onClick={closeAuthModal}>
      <div ref={dialogRef} className="av-modal av-auth" role="dialog" aria-modal="true" aria-labelledby={titleId}
        tabIndex={-1} onClick={e => e.stopPropagation()}>
        <button type="button" className="av-icon-button av-auth-close" aria-label={closeLabel} title={closeLabel} onClick={closeAuthModal}>
          <CloseOutlined />
        </button>
        <h2 id={titleId} className="av-dialog-title av-auth-title">
          {forgotMode ? t('auth.forgotTitle') : tab === 'login' ? t('auth.loginTitle') : t('auth.registerTitle')}
        </h2>
        <p className="av-auth-subtitle">{t('home.desc')}</p>
        {forgotMode ? renderForgotPassword() : (
          <>
            <TabBar tab={tab} setTab={switchTab} t={t} />
            <form key={tab} onSubmit={handleSubmit} noValidate autoComplete={tab === 'login' ? 'on' : 'off'} aria-busy={loading}>
              <Input label={t('auth.email')} type="email" name={emailName} autoComplete={emailAC}
                value={email} onChange={setEmail} placeholder={t('auth.emailPlaceholder')} disabled={loading} error={errors.email} />
              {tab === 'register' && (
                <Input label={t('auth.username')} name="register-username" autoComplete="username" value={username}
                  onChange={setUsername} placeholder={t('auth.usernamePlaceholder')} disabled={loading} error={errors.username} />
              )}
              <Input label={t('auth.password')} type="password" name={passwordName} autoComplete={passwordAC}
                value={password} onChange={setPassword} placeholder={t('auth.passwordPlaceholder')} disabled={loading} error={errors.password} />
              {tab === 'register' && (
                <div className="av-auth-field">
                  <label htmlFor={fieldPrefix + '-register-code'}>{t('auth.verificationCode')}</label>
                  <div className="av-auth-code-row">
                    <input id={fieldPrefix + '-register-code'} type="text" inputMode="numeric" autoComplete="one-time-code"
                      maxLength={6} value={verificationCode} onChange={e => setVerificationCode(e.target.value.replace(/\D/g, ''))}
                      placeholder={t('auth.codePlaceholder')} disabled={loading}
                      aria-invalid={Boolean(errors.verificationCode)}
                      aria-describedby={errors.verificationCode ? fieldPrefix + '-code-error' : undefined} />
                    <button type="button" className="av-button" disabled={codeSending || codeCountdown > 0 || loading}
                      aria-busy={codeSending} onClick={handleSendCode}>
                      {codeSending ? t('auth.codeSending') : codeCountdown > 0 ? codeCountdown + 's' : t('auth.sendCode')}
                    </button>
                  </div>
                  {errors.verificationCode && <div id={fieldPrefix + '-code-error'} className="av-auth-error" role="alert">{errors.verificationCode}</div>}
                </div>
              )}
              {globalError && <div className="av-alert" role="alert">{globalError}</div>}
              <button type="submit" className="av-button av-button--primary av-auth-submit" disabled={loading}>
                {loading ? tab === 'login' ? t('auth.loggingIn') : t('auth.registering')
                  : tab === 'login' ? t('auth.loginBtn') : t('auth.registerBtn')}
              </button>
            </form>
            <div style={{ textAlign: 'center', marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {tab === 'login' && (
                <button type="button" className="av-link-button"
                  onClick={() => { setForgotMode(true); setForgotStep(1); setGlobalError(''); }}>
                  {t('auth.forgotPassword')}
                </button>
              )}
              <button type="button" className="av-link-button" onClick={() => switchTab(tab === 'login' ? 'register' : 'login')}>
                {tab === 'login' ? t('auth.switchToRegister') : t('auth.switchToLogin')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
