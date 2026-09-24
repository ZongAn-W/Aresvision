/**
 * AdminReviewPanel — 管理员数据审核右侧抽屉
 * 显示所有 pending_review 状态的上传记录，支持通过/拒绝操作
 */

import { useState, useEffect, useCallback } from 'react';
import ReactDOM from 'react-dom';
import C from '../constants/colors';
import { useT } from '../i18n';
import { useSettings } from '../contexts/SettingsContext';
import { useToast } from '../contexts/ToastContext';
import { useScrollLock } from '../hooks/useScrollLock';
import { getPendingReviews, reviewUpload, getApprovedDatasets, revokeDataset } from '../services/api';

const adminWorkspaceMinHeight = 520;

// ─── SVG Icons ───────────────────────────────────────────────────────────────

function FileIcon({ size = 14, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <polyline points="13 2 13 9 20 9" />
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

function CloseIcon({ size = 16, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatFileSize(bytes) {
  if (!bytes && bytes !== 0) return '—';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(iso) {
  if (!iso) return '—';
  return iso.replace('T', ' ').slice(0, 16);
}

function MetaRow({ label, value }) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
      <span style={{ fontSize: 'calc(10px * var(--font-scale, 1))', color: 'var(--text-30)', whiteSpace: 'nowrap', minWidth: 52 }}>{label}</span>
      <span style={{ fontSize: 'calc(12px * var(--font-scale, 1))', color: 'var(--text-60)', fontWeight: 500 }}>{value ?? '—'}</span>
    </div>
  );
}

// ─── Rejection Modal (内联，含文本输入) ──────────────────────────────────────

function RejectionModal({ t, isLight, onConfirm, onCancel }) {
  const [reason, setReason] = useState('');
  useScrollLock();

  const overlayBg = isLight ? 'rgba(210,215,235,0.70)' : 'rgba(0,0,8,0.78)';
  const cardBg    = isLight ? 'rgba(255,255,255,0.97)'  : 'rgba(13,13,28,0.95)';
  const cardBorder = isLight ? 'rgba(0,0,0,0.09)'       : 'rgba(255,255,255,0.10)';
  const titleColor = isLight ? '#000000' : '#ffffff';
  const msgColor   = isLight ? '#000000' : '#ffffff';
  const inputBg    = isLight ? 'rgba(0,0,0,0.04)'       : 'rgba(255,255,255,0.05)';
  const inputBorder = isLight ? 'rgba(0,0,0,0.12)'      : 'rgba(255,255,255,0.12)';
  const cancelBg   = isLight ? 'rgba(0,0,0,0.07)'       : 'rgba(255,255,255,0.08)';
  const cancelClr  = isLight ? '#000000' : '#ffffff';

  return ReactDOM.createPortal(
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, background: overlayBg,
        backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
        zIndex: 10100,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 340, background: cardBg,
          border: `1px solid ${cardBorder}`, borderRadius: 14,
          boxShadow: isLight
            ? '0 12px 36px rgba(0,0,0,0.10)'
            : '0 12px 36px rgba(0,0,0,0.70)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          padding: '24px 24px 20px',
        }}
      >
        <div style={{
          fontSize: 'calc(14px * var(--font-scale, 1))', fontWeight: 700, color: titleColor,
          fontFamily: 'Orbitron, sans-serif', letterSpacing: '0.02em', marginBottom: 10,
        }}>
          {t('admin.rejectTitle')}
        </div>
        <textarea
          autoFocus
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder={t('admin.rejectPlaceholder')}
          rows={3}
          style={{
            width: '100%', boxSizing: 'border-box',
            background: inputBg,
            border: `1px solid ${inputBorder}`,
            borderRadius: 8, padding: '8px 12px',
            color: titleColor, fontSize: 'calc(13px * var(--font-scale, 1))',
            resize: 'vertical', outline: 'none',
            fontFamily: 'inherit', lineHeight: 1.55,
            marginBottom: 18,
          }}
        />
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            style={{
              padding: '8px 18px', borderRadius: 8,
              background: cancelBg, border: 'none',
              color: cancelClr, fontSize: 'calc(13px * var(--font-scale, 1))', fontWeight: 500,
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            {t('admin.cancelBtn')}
          </button>
          <button
            onClick={() => onConfirm(reason)}
            style={{
              padding: '8px 18px', borderRadius: 8,
              background: C.mars, border: 'none',
              color: '#fff', fontSize: 'calc(13px * var(--font-scale, 1))', fontWeight: 600,
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            {t('admin.confirmRejectBtn')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ─── ReviewCard ───────────────────────────────────────────────────────────────

function ReviewCard({ record, t, isLight, onApprove, onReject, loading }) {
  const cardBg    = isLight ? 'rgba(248,248,254,0.9)'  : 'rgba(16,16,32,0.7)';
  const cardBorder = isLight ? 'rgba(0,0,0,0.09)'      : 'rgba(255,255,255,0.09)';

  return (
    <div style={{
      background: cardBg,
      border: `1px solid ${cardBorder}`,
      borderRadius: 12,
      padding: '14px 16px',
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      {/* Filename */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <span style={{ color: 'var(--text-30)', flexShrink: 0 }}>
          <FileIcon size={14} color="currentColor" />
        </span>
        <span style={{
          fontSize: 'calc(13px * var(--font-scale, 1))', fontWeight: 700, color: 'var(--text)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
        }} title={record.filename}>
          {record.filename}
        </span>
      </div>

      {/* Uploader */}
      <div style={{ fontSize: 'calc(11px * var(--font-scale, 1))', color: 'var(--text-30)' }}>
        {t('admin.cardUploader')}: <span style={{ color: 'var(--text-60)', fontWeight: 500 }}>
          {record.uploader_username || record.uploader_email || '—'}
          {record.uploader_email && record.uploader_username
            ? ` (${record.uploader_email})`
            : ''}
        </span>
      </div>

      {/* Description / Note */}
      {record.description && (
        <div style={{ fontSize: 'calc(12px * var(--font-scale, 1))', color: 'var(--text-60)', lineHeight: 1.55 }}>
          <span style={{ color: 'var(--text-30)' }}>{t('admin.cardNote')}：</span>
          {record.description}
        </div>
      )}

      {/* Meta */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 8px' }}>
        <MetaRow label={t('admin.cardType')}     value={record.data_type || '—'} />
        <MetaRow label={t('admin.cardMarsYear')} value={record.mars_year != null ? `MY ${record.mars_year}` : '—'} />
        {record.ls_start != null && record.ls_end != null && (
          <MetaRow
            label={t('admin.cardLs')}
            value={`${Number(record.ls_start).toFixed(1)}° – ${Number(record.ls_end).toFixed(1)}°`}
          />
        )}
        <MetaRow label={t('admin.cardSize')} value={formatFileSize(record.file_size)} />
        <MetaRow label={t('admin.cardTime')} value={formatDate(record.created_at)} />
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
        <button
          onClick={() => !loading && onApprove(record.id)}
          disabled={loading}
          style={{
            flex: 1, padding: '7px 0', borderRadius: 8,
            background: 'rgba(34,197,94,0.12)',
            border: '1px solid rgba(34,197,94,0.35)',
            color: '#22c55e', fontSize: 'calc(12px * var(--font-scale, 1))', fontWeight: 600,
            cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.6 : 1, fontFamily: 'inherit',
            transition: 'opacity 0.15s',
          }}
        >
          {loading ? '...' : t('admin.approveBtn')}
        </button>
        <button
          onClick={() => !loading && onReject(record.id)}
          disabled={loading}
          style={{
            flex: 1, padding: '7px 0', borderRadius: 8,
            background: 'rgba(199,91,57,0.12)',
            border: `1px solid rgba(199,91,57,0.35)`,
            color: C.mars, fontSize: 'calc(12px * var(--font-scale, 1))', fontWeight: 600,
            cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.6 : 1, fontFamily: 'inherit',
            transition: 'opacity 0.15s',
          }}
        >
          {t('admin.rejectBtn')}
        </button>
      </div>
    </div>
  );
}

// ─── ApprovedCard ─────────────────────────────────────────────────────────────

function ApprovedCard({ record, t, isLight, onRevoke, loading }) {
  const cardBg    = isLight ? 'rgba(248,248,254,0.9)'  : 'rgba(16,16,32,0.7)';
  const cardBorder = isLight ? 'rgba(0,0,0,0.09)'      : 'rgba(255,255,255,0.09)';

  return (
    <div style={{
      background: cardBg,
      border: `1px solid ${cardBorder}`,
      borderRadius: 12,
      padding: '14px 16px',
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <span style={{ color: 'var(--text-30)', flexShrink: 0 }}>
          <FileIcon size={14} color="currentColor" />
        </span>
        <span style={{
          fontSize: 'calc(13px * var(--font-scale, 1))', fontWeight: 700, color: 'var(--text)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
        }} title={record.filename}>
          {record.filename}
        </span>
      </div>

      <div style={{ fontSize: 'calc(11px * var(--font-scale, 1))', color: 'var(--text-30)' }}>
        {t('admin.cardUploader')}: <span style={{ color: 'var(--text-60)', fontWeight: 500 }}>
          {record.uploader_username || record.uploader_email || '—'}
          {record.uploader_email && record.uploader_username
            ? ` (${record.uploader_email})`
            : ''}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 8px' }}>
        <MetaRow label={t('admin.cardType')}     value={record.data_type || '—'} />
        <MetaRow label={t('admin.cardMarsYear')} value={record.mars_year != null ? `MY ${record.mars_year}` : '—'} />
        {record.ls_start != null && record.ls_end != null && (
          <MetaRow
            label={t('admin.cardLs')}
            value={`${Number(record.ls_start).toFixed(1)}° – ${Number(record.ls_end).toFixed(1)}°`}
          />
        )}
        <MetaRow label={t('admin.cardSize')} value={formatFileSize(record.file_size)} />
      </div>

      <button
        onClick={() => !loading && onRevoke(record.id)}
        disabled={loading}
        style={{
          padding: '7px 0', borderRadius: 8,
          background: 'rgba(199,91,57,0.10)',
          border: `1px solid rgba(199,91,57,0.30)`,
          color: C.mars, fontSize: 'calc(12px * var(--font-scale, 1))', fontWeight: 600,
          cursor: loading ? 'not-allowed' : 'pointer',
          opacity: loading ? 0.6 : 1, fontFamily: 'inherit',
          transition: 'opacity 0.15s',
        }}
      >
        {loading ? '...' : t('admin.revokeBtn')}
      </button>
    </div>
  );
}

// ─── PendingTab ────────────────────────────────────────────────────────────────

function PendingTab({ t, isLight, onReviewComplete, subColor, reviewSignal = 0 }) {
  const { showToast } = useToast();
  const [records, setRecords]         = useState([]);
  const [loading, setLoading]         = useState(false);
  const [actionId, setActionId]       = useState(null);
  const [approvingId, setApprovingId] = useState(null);
  const [rejectingId, setRejectingId] = useState(null);

  const titleColor  = isLight ? '#000000' : '#ffffff';
  const hoverBg     = isLight ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.06)';
  const borderColor = isLight ? '#000000' : '#ffffff';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getPendingReviews();
      setRecords(Array.isArray(data) ? data : []);
    } catch {
      showToast(t('admin.errorLoad'), 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast, t]);

  useEffect(() => { load(); }, [load, reviewSignal]);

  const doApprove = async (id, confirmed) => {
    if (!confirmed) { setApprovingId(id); return; }
    setApprovingId(null);
    setActionId(id);
    try {
      await reviewUpload(id, 'approve');
      setRecords(prev => prev.filter(r => r.id !== id));
      showToast(t('admin.approveSuccess'), 'success');
      onReviewComplete?.();
    } catch (e) {
      showToast(e.message || t('admin.errorAction'), 'error');
    } finally {
      setActionId(null);
    }
  };

  const doReject = async (id, reason) => {
    setRejectingId(null);
    setActionId(id);
    try {
      await reviewUpload(id, 'reject', reason);
      setRecords(prev => prev.filter(r => r.id !== id));
      showToast(t('admin.rejectSuccess'), 'success');
      onReviewComplete?.();
    } catch (e) {
      showToast(e.message || t('admin.errorAction'), 'error');
    } finally {
      setActionId(null);
    }
  };

  return (
    <>
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
              {t('admin.empty')}
            </div>
            <div style={{ fontSize: 'calc(12px * var(--font-scale, 1))', color: subColor }}>{t('admin.emptySub')}</div>
          </div>
        )}
        {!loading && records.map(record => (
          <ReviewCard
            key={record.id}
            record={record}
            t={t}
            isLight={isLight}
            loading={actionId === record.id}
            onApprove={(id) => doApprove(id, false)}
            onReject={(id) => setRejectingId(id)}
          />
        ))}
      </div>

      {approvingId != null && (
        <div
          onClick={() => setApprovingId(null)}
          style={{
            position: 'fixed', inset: 0,
            background: isLight ? 'rgba(210,215,235,0.70)' : 'rgba(0,0,8,0.78)',
            backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
            zIndex: 10100, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: 300,
              background: isLight ? 'rgba(255,255,255,0.97)' : 'rgba(13,13,28,0.95)',
              border: `1px solid ${isLight ? 'rgba(0,0,0,0.09)' : 'rgba(255,255,255,0.10)'}`,
              borderRadius: 14,
              boxShadow: isLight ? '0 12px 36px rgba(0,0,0,0.10)' : '0 12px 36px rgba(0,0,0,0.70)',
              backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
              padding: '24px 24px 20px',
            }}
          >
            <div style={{
              fontSize: 'calc(14px * var(--font-scale, 1))', fontWeight: 700,
              color: isLight ? '#000000' : '#ffffff',
              fontFamily: 'Orbitron, sans-serif', marginBottom: 10,
            }}>
              {t('admin.confirmApproveTitle')}
            </div>
            <div style={{ fontSize: 'calc(13px * var(--font-scale, 1))', color: isLight ? '#000000' : '#ffffff', marginBottom: 22, lineHeight: 1.65 }}>
              {t('admin.confirmApproveMsg')}
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setApprovingId(null)}
                style={{
                  padding: '8px 18px', borderRadius: 8,
                  background: isLight ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.08)',
                  border: 'none', color: isLight ? '#000000' : '#ffffff',
                  fontSize: 'calc(13px * var(--font-scale, 1))', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                {t('admin.cancelBtn')}
              </button>
              <button
                onClick={() => doApprove(approvingId, true)}
                style={{
                  padding: '8px 18px', borderRadius: 8,
                  background: '#22c55e', border: 'none',
                  color: '#fff', fontSize: 'calc(13px * var(--font-scale, 1))', fontWeight: 600,
                  cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                {t('admin.confirmApproveBtn')}
              </button>
            </div>
          </div>
        </div>
      )}

      {rejectingId != null && (
        <RejectionModal
          t={t}
          isLight={isLight}
          onConfirm={(reason) => doReject(rejectingId, reason)}
          onCancel={() => setRejectingId(null)}
        />
      )}
    </>
  );
}

// ─── ApprovedTab ──────────────────────────────────────────────────────────────

function ApprovedTab({ t, isLight, subColor, onReviewComplete, reviewSignal = 0 }) {
  const { showToast } = useToast();
  const [records, setRecords]     = useState([]);
  const [loading, setLoading]     = useState(false);
  const [actionId, setActionId]   = useState(null);
  const [revokingId, setRevokingId] = useState(null);

  const titleColor = isLight ? '#000000' : '#ffffff';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getApprovedDatasets();
      setRecords(Array.isArray(data) ? data : []);
    } catch {
      showToast(t('admin.errorLoad'), 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast, t]);

  useEffect(() => { load(); }, [load, reviewSignal]);

  const doRevoke = async (id, confirmed) => {
    if (!confirmed) { setRevokingId(id); return; }
    setRevokingId(null);
    setActionId(id);
    try {
      await revokeDataset(id);
      setRecords(prev => prev.filter(r => r.id !== id));
      showToast(t('admin.revokeSuccess'), 'success');
      onReviewComplete?.();
    } catch (e) {
      showToast(e.message || t('admin.errorAction'), 'error');
    } finally {
      setActionId(null);
    }
  };

  return (
    <>
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
              {t('admin.approvedEmpty')}
            </div>
            <div style={{ fontSize: 'calc(12px * var(--font-scale, 1))', color: subColor }}>{t('admin.approvedEmptySub')}</div>
          </div>
        )}
        {!loading && records.map(record => (
          <ApprovedCard
            key={record.id}
            record={record}
            t={t}
            isLight={isLight}
            loading={actionId === record.id}
            onRevoke={(id) => doRevoke(id, false)}
          />
        ))}
      </div>

      {revokingId != null && (
        <div
          onClick={() => setRevokingId(null)}
          style={{
            position: 'fixed', inset: 0,
            background: isLight ? 'rgba(210,215,235,0.70)' : 'rgba(0,0,8,0.78)',
            backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
            zIndex: 10100, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: 300,
              background: isLight ? 'rgba(255,255,255,0.97)' : 'rgba(13,13,28,0.95)',
              border: `1px solid ${isLight ? 'rgba(0,0,0,0.09)' : 'rgba(255,255,255,0.10)'}`,
              borderRadius: 14,
              boxShadow: isLight ? '0 12px 36px rgba(0,0,0,0.10)' : '0 12px 36px rgba(0,0,0,0.70)',
              backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
              padding: '24px 24px 20px',
            }}
          >
            <div style={{
              fontSize: 'calc(14px * var(--font-scale, 1))', fontWeight: 700,
              color: isLight ? '#000000' : '#ffffff',
              fontFamily: 'Orbitron, sans-serif', marginBottom: 10,
            }}>
              {t('admin.confirmRevokeTitle')}
            </div>
            <div style={{ fontSize: 'calc(13px * var(--font-scale, 1))', color: isLight ? '#000000' : '#ffffff', marginBottom: 22, lineHeight: 1.65 }}>
              {t('admin.confirmRevokeMsg')}
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setRevokingId(null)}
                style={{
                  padding: '8px 18px', borderRadius: 8,
                  background: isLight ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.08)',
                  border: 'none', color: isLight ? '#000000' : '#ffffff',
                  fontSize: 'calc(13px * var(--font-scale, 1))', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                {t('admin.cancelBtn')}
              </button>
              <button
                onClick={() => doRevoke(revokingId, true)}
                style={{
                  padding: '8px 18px', borderRadius: 8,
                  background: C.mars, border: 'none',
                  color: '#fff', fontSize: 'calc(13px * var(--font-scale, 1))', fontWeight: 600,
                  cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                {t('admin.confirmRevokeBtn')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Panel Content ────────────────────────────────────────────────────────────

function PanelContent({ t, isLight, onClose, onReviewComplete, reviewSignal = 0 }) {
  const [activeTab, setActiveTab] = useState('pending'); // 'pending' | 'approved'

  const titleColor  = isLight ? '#000000' : '#ffffff';
  const subColor    = isLight ? '#000000' : '#ffffff';
  const borderColor = isLight ? '#000000' : '#ffffff';
  const hoverBg     = isLight ? 'rgba(0,0,0,0.04)'     : 'rgba(255,255,255,0.06)';

  const tabActive = isLight
    ? { color: C.mars, borderBottom: `2px solid ${C.mars}` }
    : { color: C.mars, borderBottom: `2px solid ${C.mars}` };
  const tabInactive = {
    color: subColor, borderBottom: '2px solid transparent',
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
          height: 56,
        }}>
          <div>
            <div style={{
              fontSize: 'calc(10px * var(--font-scale, 1))', fontWeight: 700, letterSpacing: 2.5,
              fontFamily: "'Orbitron', sans-serif",
              color: C.mars, textTransform: 'uppercase', marginBottom: 3,
            }}>
              {t('admin.panelSubtitle')}
            </div>
            <div style={{ fontSize: 'calc(15px * var(--font-scale, 1))', fontWeight: 700, color: titleColor, fontFamily: "'Orbitron', sans-serif" }}>
              {t('admin.panelTitle')}
            </div>
          </div>
          {onClose ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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
                aria-label="Close admin review panel"
              >
                <CloseIcon size={14} color="currentColor" />
              </button>
            </div>
          ) : null}
        </div>

        {/* Tab bar */}
        <div style={{ display: 'flex', gap: 0 }}>
          {['pending', 'approved'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                padding: '8px 18px 10px',
                fontSize: 'calc(12px * var(--font-scale, 1))', fontWeight: 600,
                fontFamily: 'inherit',
                transition: 'color 0.15s',
                ...(activeTab === tab ? tabActive : tabInactive),
              }}
            >
              {t(`admin.tab${tab.charAt(0).toUpperCase() + tab.slice(1)}`)}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      {activeTab === 'pending' ? (
        <PendingTab t={t} isLight={isLight} onReviewComplete={onReviewComplete} subColor={subColor} reviewSignal={reviewSignal} />
      ) : (
        <ApprovedTab t={t} isLight={isLight} subColor={subColor} onReviewComplete={onReviewComplete} reviewSignal={reviewSignal} />
      )}
    </>
  );
}

export function AdminReviewWorkspace({ onReviewComplete, reviewSignal = 0 }) {
  const { settings } = useSettings();
  const t = useT();
  const isLight = settings.theme === 'light';
  const panelVars = isLight
    ? { '--text': '#2a2a3a', '--text-60': 'rgba(42,42,58,0.65)', '--text-30': 'rgba(42,42,58,0.35)', '--border': 'rgba(26,26,46,0.12)' }
    : { '--text': '#ffffff', '--text-60': '#ffffff', '--text-30': '#ffffff', '--border': 'rgba(232,237,243,0.08)' };

  return (
    <div
      style={{
        minHeight: adminWorkspaceMinHeight,
        border: isLight ? '1px solid rgba(26,26,46,0.12)' : '1px solid rgba(232,237,243,0.10)',
        borderRadius: 14,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        background: isLight ? 'rgba(248,248,254,0.92)' : 'rgba(8,8,18,0.76)',
        ...panelVars,
      }}
    >
      <PanelContent t={t} isLight={isLight} onClose={null} onReviewComplete={onReviewComplete} reviewSignal={reviewSignal} />
    </div>
  );
}

// ─── AdminReviewPanel (drawer wrapper) ───────────────────────────────────────

function AdminReviewPanelInner({ open, onClose, onReviewComplete, reviewSignal = 0 }) {
  const { settings } = useSettings();
  const t = useT();
  const isLight = settings.theme === 'light';
  useScrollLock(open);

  // ESC to close
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
      {/* Overlay — clicking outside the panel closes it */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0,
          background: isLight ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.4)',
          zIndex: 2999,
          opacity: open ? 1 : 0,
          pointerEvents: open ? 'auto' : 'none',
          transition: 'opacity 0.25s',
          backdropFilter: 'blur(2px)',
        }}
      />

      {/* Panel — zIndex 3000 sits above the overlay; clicks here never reach the overlay */}
      <div
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0, width: 480,
          zIndex: 3000,
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
        {open && <PanelContent t={t} isLight={isLight} onClose={onClose} onReviewComplete={onReviewComplete} reviewSignal={reviewSignal} />}
      </div>
    </>
  );
}

export default function AdminReviewPanel({ open, onClose, onReviewComplete, reviewSignal = 0 }) {
  return ReactDOM.createPortal(
    <AdminReviewPanelInner open={open} onClose={onClose} onReviewComplete={onReviewComplete} reviewSignal={reviewSignal} />,
    document.body
  );
}
