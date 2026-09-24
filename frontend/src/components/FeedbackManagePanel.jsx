/**
 * FeedbackManagePanel — 管理员反馈管理右侧抽屉
 */

import { useState, useEffect, useCallback } from 'react';
import ReactDOM from 'react-dom';
import C from '../constants/colors';
import { useT } from '../i18n';
import { useSettings } from '../contexts/SettingsContext';
import { useToast } from '../contexts/ToastContext';
import { useScrollLock } from '../hooks/useScrollLock';
import { getFeedbackList, resolveFeedback } from '../services/api';

// ─── Icons ────────────────────────────────────────────────────────────────────

function CloseIcon({ size = 16, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function RefreshIcon({ size = 14, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  );
}

function InboxIcon({ size = 44, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
      <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </svg>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso) {
  if (!iso) return '—';
  return iso.replace('T', ' ').slice(0, 16);
}

// ─── FeedbackTypeTag ──────────────────────────────────────────────────────────

function FeedbackTypeTag({ type, t, isLight }) {
  const cfg = {
    bug: { color: '#ef4444', bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.35)' },
    suggestion: { color: C.blue, bg: 'rgba(74,158,255,0.12)', border: 'rgba(74,158,255,0.35)' },
    other: {
      color: isLight ? '#000000' : '#ffffff',
      bg: isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.08)',
      border: isLight ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.18)',
    },
  }[type] || { color: 'var(--text-60)', bg: 'transparent', border: 'var(--border)' };

  const label = {
    bug: t('feedback.typeBug'),
    suggestion: t('feedback.typeSuggestion'),
    other: t('feedback.typeOther'),
  }[type] || type;

  return (
    <span style={{
      fontSize: 'calc(10px * var(--font-scale, 1))', fontWeight: 700, padding: '2px 8px', borderRadius: 5,
      background: cfg.bg, border: `1px solid ${cfg.border}`, color: cfg.color,
      letterSpacing: '0.04em', flexShrink: 0,
    }}>
      {label}
    </span>
  );
}

// ─── FeedbackCard ─────────────────────────────────────────────────────────────

function FeedbackCard({ record, t, isLight, onResolve, loading }) {
  const cardBg     = isLight ? 'rgba(248,248,254,0.9)'  : 'rgba(16,16,32,0.7)';
  const cardBorder = isLight ? 'rgba(0,0,0,0.09)'       : 'rgba(255,255,255,0.09)';
  const resolved   = record.status === 'resolved';

  return (
    <div style={{
      background: cardBg,
      border: `1px solid ${cardBorder}`,
      borderRadius: 12,
      padding: '14px 16px',
      display: 'flex', flexDirection: 'column', gap: 10,
      opacity: resolved ? 0.65 : 1,
    }}>
      {/* Top row: type + status + time */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <FeedbackTypeTag type={record.type} t={t} isLight={isLight} />
        <span style={{ fontSize: 'calc(10px * var(--font-scale, 1))', fontWeight: 600, color: resolved ? '#22c55e' : 'var(--text-30)' }}>
          {resolved ? t('feedback.statusResolved') : t('feedback.statusPending')}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 'calc(11px * var(--font-scale, 1))', color: 'var(--text-30)' }}>
          {formatDate(record.created_at)}
        </span>
      </div>

      {/* Content */}
      <div style={{ fontSize: 'calc(13px * var(--font-scale, 1))', color: 'var(--text)', lineHeight: 1.6, wordBreak: 'break-word' }}>
        {record.content}
      </div>

      {/* Submitter info */}
      <div style={{ fontSize: 'calc(11px * var(--font-scale, 1))', color: 'var(--text-30)' }}>
        {record.user
          ? <>{record.user.username} <span style={{ opacity: 0.7 }}>({record.user.email})</span></>
          : record.contact_email
            ? <span style={{ color: 'var(--text-60)' }}>{record.contact_email}</span>
            : t('feedback.anonymous')
        }
      </div>

      {/* Resolve button — only for pending */}
      {!resolved && (
        <button
          onClick={() => !loading && onResolve(record.id)}
          disabled={loading}
          style={{
            padding: '7px 0', borderRadius: 8,
            background: 'rgba(34,197,94,0.10)',
            border: '1px solid rgba(34,197,94,0.30)',
            color: '#22c55e', fontSize: 'calc(12px * var(--font-scale, 1))', fontWeight: 600,
            cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.6 : 1, fontFamily: 'inherit',
            transition: 'opacity 0.15s',
          }}
        >
          {loading ? '...' : t('feedback.resolveBtn')}
        </button>
      )}
    </div>
  );
}

// ─── Panel Content ────────────────────────────────────────────────────────────

function PanelContent({ t, isLight, onClose }) {
  const { showToast } = useToast();
  const [records, setRecords]   = useState([]);
  const [loading, setLoading]   = useState(false);
  const [actionId, setActionId] = useState(null);

  const titleColor  = isLight ? '#000000' : '#ffffff';
  const subColor    = isLight ? '#000000' : '#ffffff';
  const borderColor = isLight ? '#000000' : '#ffffff';
  const hoverBg     = isLight ? 'rgba(0,0,0,0.04)'     : 'rgba(255,255,255,0.06)';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getFeedbackList();
      setRecords(Array.isArray(data) ? data : []);
    } catch {
      showToast(t('admin.errorLoad'), 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast, t]);

  useEffect(() => { load(); }, [load]);

  const doResolve = async (id) => {
    setActionId(id);
    try {
      await resolveFeedback(id);
      setRecords(prev => prev.map(r => r.id === id ? { ...r, status: 'resolved' } : r));
      showToast(t('feedback.resolveSuccess'), 'success');
    } catch (e) {
      showToast(e.message || t('admin.errorAction'), 'error');
    } finally {
      setActionId(null);
    }
  };

  return (
    <>
      {/* Header */}
      <div style={{
        padding: '0 24px', flexShrink: 0,
        borderBottom: `1px solid ${borderColor}`,
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          height: 70,
        }}>
          <div>
            <div style={{
              fontSize: 'calc(10px * var(--font-scale, 1))', fontWeight: 700, letterSpacing: 2.5,
              fontFamily: "'Orbitron', sans-serif",
              color: C.blue, textTransform: 'uppercase', marginBottom: 3,
            }}>
              {t('feedback.manageSubtitle')}
            </div>
            <div style={{ fontSize: 'calc(15px * var(--font-scale, 1))', fontWeight: 700, color: titleColor, fontFamily: "'Orbitron', sans-serif" }}>
              {t('feedback.manageTitle')}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={load}
              title={t('admin.refresh')}
              style={{
                background: 'none', border: `1px solid ${borderColor}`,
                borderRadius: 7, padding: '5px 8px', cursor: 'pointer',
                color: subColor, display: 'flex', alignItems: 'center',
                transition: 'background 0.1s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = hoverBg}
              onMouseLeave={e => e.currentTarget.style.background = 'none'}
            >
              <RefreshIcon size={14} color="currentColor" />
            </button>
            <button
              onClick={onClose}
              style={{
                background: 'none', border: `1px solid ${borderColor}`,
                borderRadius: 7, padding: '5px 8px', cursor: 'pointer',
                color: subColor, display: 'flex', alignItems: 'center',
                transition: 'background 0.1s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = hoverBg}
              onMouseLeave={e => e.currentTarget.style.background = 'none'}
            >
              <CloseIcon size={14} color="currentColor" />
            </button>
          </div>
        </div>
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {loading && (
          <div style={{ textAlign: 'center', color: subColor, paddingTop: 60, fontSize: 'calc(13px * var(--font-scale, 1))' }}>
            {t('admin.loading')}
          </div>
        )}
        {!loading && records.length === 0 && (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            gap: 14, paddingTop: 60, textAlign: 'center',
          }}>
            <div style={{ color: subColor, opacity: 0.5 }}>
              <InboxIcon size={48} color="currentColor" />
            </div>
            <div style={{ fontSize: 'calc(14px * var(--font-scale, 1))', fontWeight: 700, color: titleColor, fontFamily: "'Orbitron', sans-serif" }}>
              {t('feedback.manageEmpty')}
            </div>
            <div style={{ fontSize: 'calc(12px * var(--font-scale, 1))', color: subColor }}>{t('feedback.manageEmptySub')}</div>
          </div>
        )}
        {!loading && records.map(record => (
          <FeedbackCard
            key={record.id}
            record={record}
            t={t}
            isLight={isLight}
            loading={actionId === record.id}
            onResolve={doResolve}
          />
        ))}
      </div>
    </>
  );
}

// ─── FeedbackManagePanelInner ─────────────────────────────────────────────────

function FeedbackManagePanelInner({ open, onClose }) {
  const { settings } = useSettings();
  const t = useT();
  const isLight = settings.theme === 'light';
  useScrollLock(open);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const panelVars = isLight
    ? { '--text': '#2a2a3a', '--text-60': 'rgba(42,42,58,0.65)', '--text-30': 'rgba(42,42,58,0.35)', '--border': 'rgba(26,26,46,0.12)' }
    : { '--text': '#ffffff', '--text-60': '#ffffff', '--text-30': '#ffffff',  '--border': 'rgba(232,237,243,0.08)' };

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0,
          background: isLight ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.4)',
          zIndex: 2799,
          opacity: open ? 1 : 0,
          pointerEvents: open ? 'auto' : 'none',
          transition: 'opacity 0.25s',
          backdropFilter: 'blur(2px)',
        }}
      />
      <div
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0, width: 480,
          zIndex: 2800,
          background: isLight ? 'rgba(248,248,254,0.98)' : 'rgba(8,8,18,0.97)',
          backdropFilter: 'blur(32px)',
          borderLeft: isLight ? '1px solid rgba(26,26,46,0.1)' : '1px solid rgba(232,237,243,0.1)',
          display: 'flex', flexDirection: 'column',
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.3s cubic-bezier(0.22, 1, 0.36, 1)',
          boxShadow: !open ? 'none' : isLight ? '-20px 0 60px rgba(0,0,0,0.12)' : '-20px 0 60px rgba(0,0,0,0.5)',
          ...panelVars,
        }}
      >
        {open && <PanelContent t={t} isLight={isLight} onClose={onClose} />}
      </div>
    </>
  );
}

export default function FeedbackManagePanel({ open, onClose }) {
  return ReactDOM.createPortal(
    <FeedbackManagePanelInner open={open} onClose={onClose} />,
    document.body
  );
}
