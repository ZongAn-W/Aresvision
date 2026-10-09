import { useState, useEffect, useCallback, useRef, useId } from 'react';
import ReactDOM from 'react-dom';
import CheckOutlined from '@mui/icons-material/CheckOutlined';
import CloseOutlined from '@mui/icons-material/CloseOutlined';
import NotificationsNoneOutlined from '@mui/icons-material/NotificationsNoneOutlined';
import ErrorOutline from '@mui/icons-material/ErrorOutline';
import WarningAmberOutlined from '@mui/icons-material/WarningAmberOutlined';
import RefreshOutlined from '@mui/icons-material/RefreshOutlined';
import { useT } from '../i18n';
import { useSettings } from '../contexts/SettingsContext';
import { useTraining } from '../contexts/TrainingContext';
import { useToast } from '../contexts/ToastContext';
import { useScrollLock } from '../hooks/useScrollLock';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { getNotifications, markNotificationRead, markAllNotificationsRead } from '../services/api';
import { getRelatedTrainingTaskId, parseNotificationTimestamp } from './notificationModel';
import './ui/overlay.css';

function relativeTime(isoStr, t) {
  const timestamp = parseNotificationTimestamp(isoStr);
  if (Number.isNaN(timestamp)) return t('notification.justNow');
  const diff = Math.max(0, Date.now() - timestamp);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t('notification.justNow');
  if (mins < 60) return t('notification.minutesAgo', { n: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t('notification.hoursAgo', { n: hours });
  return t('notification.daysAgo', { n: Math.floor(hours / 24) });
}

function NotificationCard({ notif, t, onMarkRead, onSelect, pending, markReadLabel }) {
  const actionable = getRelatedTrainingTaskId(notif) !== null;
  const TypeIcon = notif.type === 'approved' ? CheckOutlined
    : notif.type === 'rejected' ? CloseOutlined
      : notif.type === 'training_oom' ? ErrorOutline : WarningAmberOutlined;
  return (
    <article className="av-notification" data-unread={!notif.is_read} data-actionable={actionable}
      onClick={event => {
        if (actionable && !pending && !event.target.closest('button')) onSelect(notif);
      }}>
      <span className="av-notification-icon" data-type={notif.type} aria-hidden="true"><TypeIcon /></span>
      <div className="av-notification-content">
        {actionable ? <button type="button" className="av-notification-title" disabled={pending}
          onClick={() => onSelect(notif)}>{notif.title}</button>
          : <div className="av-notification-title">{notif.title}</div>}
        {notif.content && <p className="av-notification-copy">{notif.content}</p>}
        <div className="av-notification-time">{relativeTime(notif.created_at, t)}</div>
      </div>
      {!notif.is_read && (
        <button type="button" className="av-icon-button" title={markReadLabel}
          aria-label={markReadLabel + ': ' + notif.title} disabled={pending}
          onClick={() => onMarkRead(notif.id)}>
          <CheckOutlined />
        </button>
      )}
    </article>
  );
}

function PanelContent({ t, titleId, onClose, onReadCountChange, onNavigate }) {
  const { setActiveTaskId } = useTraining();
  const { settings } = useSettings();
  const { showToast } = useToast();
  const zh = settings.language === 'zh';
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [actionError, setActionError] = useState('');
  const [pending, setPending] = useState(false);
  const requestRef = useRef(0);
  const mountedRef = useRef(true);
  const readErrorLabel = zh ? '未能更新已读状态，请重试。' : 'Could not update read status. Please retry.';
  const closeLabel = zh ? '关闭通知' : 'Close notifications';
  const markReadLabel = zh ? '标为已读' : 'Mark as read';

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; requestRef.current += 1; };
  }, []);

  const load = useCallback(async () => {
    const request = ++requestRef.current;
    setLoading(true);
    setLoadError(false);
    setActionError('');
    try {
      const data = await getNotifications();
      if (!Array.isArray(data)) throw new Error('Invalid notification response');
      if (mountedRef.current && request === requestRef.current) setNotifications(data);
    } catch {
      if (mountedRef.current && request === requestRef.current) setLoadError(true);
    } finally {
      if (mountedRef.current && request === requestRef.current) setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const handleMarkRead = useCallback(async id => {
    setPending(true);
    setActionError('');
    try {
      await markNotificationRead(id);
      if (!mountedRef.current) return;
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
      onReadCountChange?.();
    } catch {
      if (mountedRef.current) setActionError(readErrorLabel);
    } finally {
      if (mountedRef.current) setPending(false);
    }
  }, [onReadCountChange, readErrorLabel]);

  const handleMarkAllRead = useCallback(async () => {
    setPending(true);
    setActionError('');
    try {
      await markAllNotificationsRead();
      if (!mountedRef.current) return;
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
      onReadCountChange?.();
    } catch {
      if (mountedRef.current) setActionError(readErrorLabel);
    } finally {
      if (mountedRef.current) setPending(false);
    }
  }, [onReadCountChange, readErrorLabel]);

  const handleSelect = useCallback(async notification => {
    const taskId = getRelatedTrainingTaskId(notification);
    if (taskId === null) return;
    setPending(true);
    if (!notification.is_read) {
      try {
        await markNotificationRead(notification.id);
        if (!mountedRef.current) return;
        setNotifications(prev => prev.map(n => n.id === notification.id ? { ...n, is_read: true } : n));
        onReadCountChange?.();
      } catch {
        if (mountedRef.current) showToast(readErrorLabel, 'error');
      }
    }
    if (!mountedRef.current) return;
    setPending(false);
    setActiveTaskId(taskId);
    onClose();
    onNavigate?.('training');
  }, [onClose, onNavigate, onReadCountChange, setActiveTaskId, showToast, readErrorLabel]);

  const unreadCount = notifications.filter(n => !n.is_read).length;
  return (
    <>
      <div className="av-drawer-header">
        <h2 id={titleId} className="av-dialog-title">{t('notification.title')}</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {unreadCount > 0 && <button type="button" className="av-button av-button--compact"
            disabled={loading || pending} onClick={handleMarkAllRead}>{t('notification.markAllRead')}</button>}
          <button type="button" className="av-icon-button" title={closeLabel}
            aria-label={closeLabel} data-dialog-autofocus onClick={onClose}><CloseOutlined /></button>
        </div>
      </div>
      <div className="av-drawer-body" aria-busy={loading || pending}>
        {actionError && <div className="av-alert" role="alert">{actionError}</div>}
        {loading && <div className="av-panel-state" role="status">{t('common.loading')}</div>}
        {!loading && loadError && (
          <div className="av-panel-state" role="alert">
            <ErrorOutline />
            <strong>{t('common.error')}</strong>
            <p>{zh ? '暂时无法读取通知，请检查连接后重试。' : 'Notifications could not be loaded. Check your connection and retry.'}</p>
            <button type="button" className="av-button" onClick={load}>
              <RefreshOutlined fontSize="small" style={{ verticalAlign: 'middle', marginRight: 6 }} />{t('common.retry')}
            </button>
          </div>
        )}
        {!loading && !loadError && notifications.length === 0 && (
          <div className="av-panel-state">
            <NotificationsNoneOutlined />
            <strong>{t('notification.empty')}</strong>
            <p>{t('notification.emptySub')}</p>
          </div>
        )}
        {!loading && !loadError && <div className="av-notification-list">
          {notifications.map(notif => <NotificationCard key={notif.id} notif={notif} t={t}
            onMarkRead={handleMarkRead} onSelect={handleSelect} pending={pending} markReadLabel={markReadLabel} />)}
        </div>}
      </div>
    </>
  );
}

function NotificationPanelInner({ open, onClose, onReadCountChange, onNavigate }) {
  const t = useT();
  const panelRef = useRef(null);
  const titleId = useId();
  useScrollLock(open);
  useDialogFocus(open, panelRef, onClose);
  return (
    <>
      <div className="av-overlay-backdrop" onClick={onClose} style={{
        zIndex: 2999, opacity: open ? 1 : 0, pointerEvents: open ? 'auto' : 'none',
        transition: 'opacity 220ms ease',
      }} />
      <div ref={panelRef} className="av-drawer" data-open={open} style={{ zIndex: 3000 }}
        role="dialog" aria-modal={open ? true : undefined} aria-labelledby={titleId}
        tabIndex={-1} inert={!open} aria-hidden={!open}>
        {open && <PanelContent t={t} titleId={titleId} onClose={onClose}
          onReadCountChange={onReadCountChange} onNavigate={onNavigate} />}
      </div>
    </>
  );
}

export default function NotificationPanel({ open, onClose, onReadCountChange, onNavigate }) {
  return ReactDOM.createPortal(
    <NotificationPanelInner open={open} onClose={onClose} onReadCountChange={onReadCountChange} onNavigate={onNavigate} />,
    document.body
  );
}
