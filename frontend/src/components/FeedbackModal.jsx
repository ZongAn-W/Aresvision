/**
 * FeedbackModal — 用户反馈弹窗
 */

import { useState, useRef, useCallback } from 'react';
import ReactDOM from 'react-dom';
import C from '../constants/colors';
import { useT } from '../i18n';
import { useAuth } from '../contexts/AuthContext';
import { useSettings } from '../contexts/SettingsContext';
import { useToast } from '../contexts/ToastContext';
import { useScrollLock } from '../hooks/useScrollLock';
import { submitFeedback } from '../services/api';

const TYPES = ['bug', 'suggestion', 'other'];

function FeedbackModalInner({ open, onClose }) {
  const t = useT();
  const { user } = useAuth();
  const { settings } = useSettings();
  const { showToast } = useToast();
  const isLight = settings.theme === 'light';
  useScrollLock(open);

  const [type, setType]               = useState('suggestion');
  const [content, setContent]         = useState('');
  const [email, setEmail]             = useState(user?.email || '');
  const [screenshot, setScreenshot]   = useState(null);    // File object
  const [preview, setPreview]         = useState(null);    // data URL
  const [submitting, setSubmitting]   = useState(false);
  const [contentErr, setContentErr]   = useState('');
  const screenshotRef = useRef(null);

  // Theme tokens
  const overlayBg   = isLight ? 'rgba(210,215,235,0.72)' : 'rgba(0,0,8,0.80)';
  const cardBg      = isLight ? 'rgba(255,255,255,0.97)'  : 'rgba(13,13,28,0.96)';
  const cardBorder  = isLight ? 'rgba(0,0,0,0.09)'        : 'rgba(255,255,255,0.10)';
  const cardShadow  = isLight ? '0 16px 48px rgba(0,0,0,0.12)' : '0 16px 48px rgba(0,0,0,0.72)';
  const titleClr    = isLight ? '#000000' : '#ffffff';
  const labelClr    = isLight ? '#000000' : '#ffffff';
  const inputBg     = isLight ? 'rgba(0,0,0,0.04)'        : 'rgba(255,255,255,0.05)';
  const inputBorder = isLight ? 'rgba(0,0,0,0.12)'        : 'rgba(255,255,255,0.12)';
  const inputClr    = isLight ? '#000000' : '#ffffff';
  const cancelBg    = isLight ? 'rgba(0,0,0,0.07)'        : 'rgba(255,255,255,0.08)';
  const cancelClr   = isLight ? '#000000' : '#ffffff';

  const typeLabel = (tp) => ({
    bug: t('feedback.typeBug'),
    suggestion: t('feedback.typeSuggestion'),
    other: t('feedback.typeOther'),
  }[tp] || tp);

  const typeColor = (tp) => ({
    bug: { active: '#ef4444', activeBg: 'rgba(239,68,68,0.12)', activeBorder: 'rgba(239,68,68,0.40)' },
    suggestion: { active: C.blue, activeBg: 'rgba(74,158,255,0.12)', activeBorder: 'rgba(74,158,255,0.40)' },
    other: { active: isLight ? 'rgba(42,42,58,0.70)' : 'rgba(232,237,243,0.70)', activeBg: isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.08)', activeBorder: isLight ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.20)' },
  }[tp]);

  const handleScreenshotChange = useCallback((file) => {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type)) return;
    setScreenshot(file);
    const reader = new FileReader();
    reader.onload = (e) => setPreview(e.target.result);
    reader.readAsDataURL(file);
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) handleScreenshotChange(file);
  }, [handleScreenshotChange]);

  const handleSubmit = async () => {
    if (!content.trim()) {
      setContentErr(t('feedback.errContentRequired'));
      return;
    }
    setContentErr('');
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('type', type);
      fd.append('content', content.trim());
      if (email.trim()) fd.append('contact_email', email.trim());
      if (screenshot) fd.append('screenshot', screenshot);
      await submitFeedback(fd);
      showToast(t('feedback.submitSuccess'), 'success');
      onClose();
    } catch (e) {
      showToast(e.message || t('feedback.errSubmitFailed'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const labelStyle = {
    fontSize: 'calc(11px * var(--font-scale, 1))', fontWeight: 600,
    letterSpacing: '0.08em', textTransform: 'uppercase',
    color: labelClr, marginBottom: 6, display: 'block',
  };

  const inputStyle = {
    width: '100%', boxSizing: 'border-box',
    background: inputBg, border: `1px solid ${inputBorder}`,
    borderRadius: 8, padding: '9px 12px',
    color: inputClr, fontSize: 'calc(13px * var(--font-scale, 1))', fontFamily: 'inherit',
    outline: 'none', lineHeight: 1.5,
    transition: 'border-color 0.15s',
  };

  return ReactDOM.createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: overlayBg,
        backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
        zIndex: 9000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '20px',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 440, maxHeight: '90vh', overflowY: 'auto',
          background: cardBg,
          border: `1px solid ${cardBorder}`,
          borderRadius: 16,
          boxShadow: cardShadow,
          backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
          padding: '28px 28px 24px',
          display: 'flex', flexDirection: 'column', gap: 18,
        }}
      >
        {/* Header */}
        <div>
          <div style={{
            fontSize: 'calc(10px * var(--font-scale, 1))', fontWeight: 700, letterSpacing: 3,
            fontFamily: "'Orbitron', sans-serif",
            color: C.blue, textTransform: 'uppercase', marginBottom: 6,
          }}>
            ASTRAATMOS
          </div>
          <div style={{
            fontSize: 'calc(20px * var(--font-scale, 1))', fontWeight: 700,
            fontFamily: "'Orbitron', sans-serif",
            color: titleClr, marginBottom: 4,
          }}>
            {t('feedback.title')}
          </div>
          <div style={{ fontSize: 'calc(12px * var(--font-scale, 1))', color: labelClr }}>
            {t('feedback.subtitle')}
          </div>
        </div>

        {/* Type selector */}
        <div>
          <label style={labelStyle}>{t('feedback.typeLabel')}</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {TYPES.map(tp => {
              const sel = type === tp;
              const clr = typeColor(tp);
              return (
                <button
                  key={tp}
                  onClick={() => setType(tp)}
                  style={{
                    flex: 1, padding: '7px 0', borderRadius: 8, cursor: 'pointer',
                    background: sel ? clr.activeBg : inputBg,
                    border: `1px solid ${sel ? clr.activeBorder : inputBorder}`,
                    color: sel ? clr.active : labelClr,
                    fontSize: 'calc(12px * var(--font-scale, 1))', fontWeight: sel ? 700 : 500,
                    fontFamily: 'inherit', transition: 'all 0.15s',
                  }}
                >
                  {typeLabel(tp)}
                </button>
              );
            })}
          </div>
        </div>

        {/* Content */}
        <div>
          <label style={labelStyle}>{t('feedback.contentLabel')}</label>
          <textarea
            value={content}
            onChange={e => { setContent(e.target.value); if (contentErr) setContentErr(''); }}
            placeholder={t('feedback.contentPlaceholder')}
            rows={4}
            maxLength={2000}
            style={{
              ...inputStyle,
              resize: 'vertical', minHeight: 96,
              borderColor: contentErr ? C.mars : inputBorder,
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
            <span style={{ fontSize: 'calc(11px * var(--font-scale, 1))', color: C.mars }}>{contentErr}</span>
            <span style={{ fontSize: 'calc(11px * var(--font-scale, 1))', color: labelClr }}>{content.length}/2000</span>
          </div>
        </div>

        {/* Screenshot */}
        <div>
          <label style={labelStyle}>{t('feedback.screenshotLabel')}</label>
          {preview ? (
            <div style={{ position: 'relative', display: 'inline-block' }}>
              <img
                src={preview} alt="screenshot"
                style={{ maxWidth: '100%', maxHeight: 160, borderRadius: 8,
                  border: `1px solid ${inputBorder}`, display: 'block' }}
              />
              <button
                onClick={() => { setScreenshot(null); setPreview(null); }}
                style={{
                  position: 'absolute', top: 6, right: 6,
                  background: 'rgba(0,0,0,0.55)', border: 'none', borderRadius: 4,
                  color: '#fff', fontSize: 'calc(11px * var(--font-scale, 1))', cursor: 'pointer', padding: '2px 8px',
                  fontFamily: 'inherit',
                }}
              >
                {t('feedback.screenshotRemove')}
              </button>
            </div>
          ) : (
            <div
              onClick={() => screenshotRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={handleDrop}
              style={{
                border: `1.5px dashed ${inputBorder}`, borderRadius: 8,
                padding: '18px 12px', textAlign: 'center', cursor: 'pointer',
                background: inputBg, color: labelClr, fontSize: 'calc(12px * var(--font-scale, 1))',
                transition: 'border-color 0.15s',
              }}
            >
              {t('feedback.screenshotHint')}
            </div>
          )}
          <input
            ref={screenshotRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            style={{ display: 'none' }}
            onChange={e => handleScreenshotChange(e.target.files?.[0])}
          />
        </div>

        {/* Email */}
        <div>
          <label style={labelStyle}>{t('feedback.emailLabel')}</label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder={t('feedback.emailPlaceholder')}
            style={inputStyle}
          />
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
          <button
            onClick={onClose}
            style={{
              padding: '9px 20px', borderRadius: 8,
              background: cancelBg, border: 'none',
              color: cancelClr, fontSize: 'calc(13px * var(--font-scale, 1))', fontWeight: 500,
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            {t('auth.cancelBtn')}
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            style={{
              padding: '9px 22px', borderRadius: 8,
              background: submitting ? 'rgba(74,158,255,0.5)' : C.blue,
              border: 'none', color: '#fff',
              fontSize: 'calc(13px * var(--font-scale, 1))', fontWeight: 600,
              cursor: submitting ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit', transition: 'background 0.15s',
            }}
          >
            {submitting ? t('feedback.submitting') : t('feedback.submitBtn')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default function FeedbackModal({ open, onClose }) {
  if (!open) return null;
  return <FeedbackModalInner open={open} onClose={onClose} />;
}
