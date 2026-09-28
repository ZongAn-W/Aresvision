import { useState, useEffect, useRef } from 'react';
import { useSettings } from '../contexts/SettingsContext';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { useT } from '../i18n';
import C from '../constants/colors';
import ConfirmDialog from './ConfirmDialog';
import FeedbackModal from './FeedbackModal';
import PerformanceMonitor from './PerformanceMonitor';

const COLORMAP_IDS = ['inferno', 'viridis', 'plasma', 'magma', 'cividis', 'jet', 'rdbu'];

function GearIcon({ size = 17 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none">
      <path d="M9 11.25a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5Z"
        stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14.55 11.25a1.238 1.238 0 0 0 .248 1.364l.045.045a1.5 1.5 0 1 1-2.121 2.121l-.045-.045a1.238 1.238 0 0 0-1.364-.248 1.238 1.238 0 0 0-.75 1.133V15.75a1.5 1.5 0 0 1-3 0v-.075a1.238 1.238 0 0 0-.81-1.133 1.238 1.238 0 0 0-1.364.248l-.045.045a1.5 1.5 0 1 1-2.121-2.121l.045-.045A1.238 1.238 0 0 0 3.52 11.306a1.238 1.238 0 0 0-1.133-.75H2.25a1.5 1.5 0 0 1 0-3h.075A1.238 1.238 0 0 0 3.458 6.75a1.238 1.238 0 0 0-.248-1.364l-.045-.045A1.5 1.5 0 1 1 5.286 3.22l.045.045a1.238 1.238 0 0 0 1.364.248h.06A1.238 1.238 0 0 0 7.505 2.38V2.25a1.5 1.5 0 0 1 3 0v.075a1.238 1.238 0 0 0 .75 1.133 1.238 1.238 0 0 0 1.364-.248l.045-.045a1.5 1.5 0 1 1 2.121 2.121l-.045.045A1.238 1.238 0 0 0 14.492 6.694v.06a1.238 1.238 0 0 0 1.133.746H15.75a1.5 1.5 0 0 1 0 3h-.075a1.238 1.238 0 0 0-1.125.75Z"
        stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronRight() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
      <path d="M3.5 2L6.5 5L3.5 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckIcon({ color }) {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{ flexShrink: 0 }}>
      <path d="M2 6.5L5 9.5L11 3" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SubOption({ label, selected, onClick, hoverBg, labelColor, activeClr }) {
  const [hov, setHov] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '9px 16px', cursor: 'pointer',
        background: hov ? hoverBg : 'transparent',
        transition: 'background 0.1s',
        gap: 12,
      }}
    >
      <span style={{
        fontSize: 'calc(13px * var(--font-scale, 1))', userSelect: 'none',
        color: selected ? activeClr : labelColor,
        fontWeight: selected ? 600 : 400,
      }}>
        {label}
      </span>
      {selected
        ? <CheckIcon color={activeClr} />
        : <span style={{ width: 13, flexShrink: 0 }} />}
    </div>
  );
}

function PerfToggleItem({ label, active, onClick, hoverBg, labelClr, valueClr }) {
  const [hov, setHov] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 16px', cursor: 'pointer',
        background: hov ? hoverBg : 'transparent',
        transition: 'background 0.1s',
      }}
    >
      <span style={{ fontSize: 'calc(14px * var(--font-scale, 1))', fontWeight: 500, color: labelClr, userSelect: 'none' }}>
        {label}
      </span>
      <span style={{
        fontSize: 'calc(11px * var(--font-scale, 1))', fontWeight: 600,
        color: active ? '#22c55e' : valueClr,
        userSelect: 'none',
      }}>
        {active ? 'ON' : 'OFF'}
      </span>
    </div>
  );
}

function UserActionItem({ label, onClick, hoverBg, color }) {
  const [hov, setHov] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        padding: '10px 16px', cursor: 'pointer',
        background: hov ? hoverBg : 'transparent',
        transition: 'background 0.1s',
      }}
    >
      <span style={{ fontSize: 'calc(14px * var(--font-scale, 1))', fontWeight: 500, color, userSelect: 'none' }}>
        {label}
      </span>
    </div>
  );
}

export default function SettingsFab({ onOpenSettings, onOpenAdmin }) {
  const { settings, updateSetting } = useSettings();
  const { user, logout, openAuthModal } = useAuth();
  const { showToast } = useToast();
  const t = useT();
  const [menuOpen, setMenuOpen] = useState(false);
  const [logoutConfirm, setLogoutConfirm] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [perfMonitor, setPerfMonitor] = useState(false);
  const [activeSubmenu, setActiveSubmenu] = useState(null);
  const [showTooltip, setShowTooltip] = useState(false);
  const [moreHov, setMoreHov] = useState(false);
  const containerRef = useRef(null);
  const closeTimerRef = useRef(null);

  // Cancel pending close timer on unmount
  useEffect(() => {
    return () => { if (closeTimerRef.current) clearTimeout(closeTimerRef.current); };
  }, []);

  // Clear timer when menu closes
  useEffect(() => {
    if (!menuOpen) {
      if (closeTimerRef.current) { clearTimeout(closeTimerRef.current); closeTimerRef.current = null; }
      setActiveSubmenu(null);
    }
  }, [menuOpen]);

  const scheduleClose = () => {
    closeTimerRef.current = setTimeout(() => setActiveSubmenu(null), 150);
  };
  const cancelClose = () => {
    if (closeTimerRef.current) { clearTimeout(closeTimerRef.current); closeTimerRef.current = null; }
  };

  const isLight = settings.theme === 'light';

  // Click outside closes menu
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    };
    const timer = setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => { clearTimeout(timer); document.removeEventListener('mousedown', handler); };
  }, [menuOpen]);

  // ── Theme-aware palette ──
  const L = isLight;
  const cardBg     = L ? '#ffffff'                  : '#13132a';
  const cardBorder = L ? 'rgba(0,0,0,0.09)'         : 'rgba(255,255,255,0.1)';
  const cardShadow = L
    ? '0 8px 32px rgba(0,0,0,0.14), 0 2px 6px rgba(0,0,0,0.07)'
    : '0 8px 32px rgba(0,0,0,0.7),  0 2px 6px rgba(0,0,0,0.35)';
  const labelClr   = L ? '#000000' : '#ffffff';
  const valueClr   = L ? '#000000' : '#ffffff';
  const hoverBg    = L ? 'rgba(0,0,0,0.045)'        : 'rgba(255,255,255,0.07)';
  const divClr     = L ? '#000000' : '#ffffff';
  const activeClr  = C.blue;
  const fabBg      = L
    ? (menuOpen ? 'rgba(228,232,248,0.97)' : 'rgba(255,255,255,0.88)')
    : (menuOpen ? 'rgba(22,22,46,0.97)'   : 'rgba(10,10,22,0.88)');
  const fabBorder  = L ? 'rgba(0,0,0,0.09)'         : 'rgba(255,255,255,0.1)';
  const fabShadow  = L ? '0 2px 12px rgba(0,0,0,0.1)' : '0 2px 12px rgba(0,0,0,0.48)';
  const fabColor   = L
    ? (menuOpen ? '#1e1e30' : 'rgba(42,42,58,0.52)')
    : (menuOpen ? '#e8edf3' : 'rgba(232,237,243,0.52)');

  // ── Display values ──
  const langDisplay = settings.language === 'zh' ? '中文' : 'English';
  const themeDisplay = settings.theme === 'dark' ? t('settings.theme.dark') : t('settings.theme.light');
  const cmapDisplay  = settings.colormap.charAt(0).toUpperCase() + settings.colormap.slice(1);
  const moreLabel    = settings.language === 'zh' ? '更多设置' : 'More Settings';
  const tooltipText  = settings.language === 'zh' ? '设置' : 'Settings';
  const roleLabel    = user?.role === 'admin' ? t('auth.roleAdmin') : t('auth.roleUser');

  const MAIN_ITEMS = [
    { key: 'language', label: t('settings.language.label'), value: langDisplay },
    { key: 'theme',    label: t('settings.theme.label'),    value: themeDisplay },
    { key: 'colormap', label: t('settings.colormap.label'), value: cmapDisplay },
  ];

  const SUB_OPTIONS = {
    language: [
      { value: 'zh', label: '中文' },
      { value: 'en', label: 'English' },
    ],
    theme: [
      { value: 'dark',  label: t('settings.theme.dark') },
      { value: 'light', label: t('settings.theme.light') },
    ],
    colormap: COLORMAP_IDS.map(id => ({
      value: id,
      label: id.charAt(0).toUpperCase() + id.slice(1),
    })),
  };

  const getCurrentVal = (key) => settings[key] ?? settings.colormap;

  const handleSelect = (key, value) => {
    updateSetting(key, value);
  };

  const activeOptions = activeSubmenu ? SUB_OPTIONS[activeSubmenu] : null;

  return (
    <div className="settings-fab" ref={containerRef} style={{ position: 'fixed', left: 24, bottom: 'var(--floating-settings-bottom, 24px)', zIndex: 1500 }}>
      <style>{`
        @keyframes _sfadeup { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes _sfadein  { from { opacity: 0; transform: translateX(-5px); } to { opacity: 1; transform: translateX(0); } }
      `}</style>

      {/* ── Menu system ── */}
      {menuOpen && (
        <div style={{ position: 'absolute', bottom: 54, left: 0, animation: '_sfadeup 0.15s ease-out' }}>
          {/*
            position:relative wrapper — submenu anchors here via position:absolute.
            Submenu is out of normal flow so it does NOT affect this wrapper's height,
            which eliminates the layout-shift + upward scroll that caused flickering.
          */}
          <div style={{ position: 'relative' }}>

            {/* Main menu card */}
            <div
              style={{
                width: 264,
                background: cardBg,
                border: `1px solid ${cardBorder}`,
                borderRadius: 13,
                backdropFilter: 'blur(24px)',
                WebkitBackdropFilter: 'blur(24px)',
                boxShadow: cardShadow,
                padding: '5px 0',
                overflow: 'hidden',
              }}
              onMouseLeave={scheduleClose}
            >
              {MAIN_ITEMS.map((item, i) => (
                <div key={item.key}>
                  {i > 0 && (
                    <div style={{ height: 1, background: divClr, margin: '2px 10px' }} />
                  )}
                  <div
                    onMouseEnter={() => { cancelClose(); setActiveSubmenu(item.key); }}
                    style={{
                      display: 'flex', alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '11px 16px',
                      cursor: 'default',
                      background: activeSubmenu === item.key ? hoverBg : 'transparent',
                      transition: 'background 0.1s',
                    }}
                  >
                    <span style={{
                      fontSize: 'calc(14px * var(--font-scale, 1))', fontWeight: 500,
                      color: labelClr, userSelect: 'none',
                    }}>
                      {item.label}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: valueClr }}>
                      <span style={{ fontSize: 'calc(13px * var(--font-scale, 1))', userSelect: 'none' }}>{item.value}</span>
                      <ChevronRight />
                    </div>
                  </div>
                </div>
              ))}

              <div style={{ height: 1, background: divClr, margin: '3px 10px' }} />

              {/* More Settings */}
              <div
                onMouseEnter={() => { cancelClose(); setActiveSubmenu(null); setMoreHov(true); }}
                onMouseLeave={() => setMoreHov(false)}
                onClick={() => { setMenuOpen(false); onOpenSettings(); }}
                style={{
                  padding: '11px 16px', cursor: 'pointer',
                  background: moreHov ? hoverBg : 'transparent',
                  transition: 'background 0.1s',
                }}
              >
                <span style={{
                  fontSize: 'calc(14px * var(--font-scale, 1))', fontWeight: 500,
                  color: labelClr, userSelect: 'none',
                }}>
                  {moreLabel}
                </span>
              </div>

              {/* Feedback */}
              <UserActionItem
                label={t('feedback.menuItem')}
                onClick={() => { setMenuOpen(false); setFeedbackOpen(true); }}
                hoverBg={hoverBg}
                color={labelClr}
              />

              {/* Performance Monitor toggle */}
              <PerfToggleItem
                label={t('settings.perfMonitor')}
                active={perfMonitor}
                onClick={() => setPerfMonitor(v => !v)}
                hoverBg={hoverBg}
                labelClr={labelClr}
                valueClr={valueClr}
              />

              <div style={{ height: 1, background: divClr, margin: '3px 10px' }} />

              {/* User section */}
              {user ? (
                <>
                  {/* User info row */}
                  <div style={{ padding: '9px 16px 5px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{
                        width: 28, height: 28, borderRadius: '50%',
                        background: `linear-gradient(135deg, ${C.blue}, ${C.mars})`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0,
                      }}>
                        <span style={{ fontSize: 'calc(11px * var(--font-scale, 1))', fontWeight: 700, color: '#fff' }}>
                          {(user?.username || user?.email || "?")[0]?.toUpperCase() || "?"}
                        </span>
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{
                          fontSize: 'calc(13px * var(--font-scale, 1))', fontWeight: 600, color: labelClr,
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {user.username || user.email}
                        </div>
                        <div style={{ fontSize: 'calc(11px * var(--font-scale, 1))', color: valueClr }}>{roleLabel}</div>
                      </div>
                    </div>
                  </div>
                  {/* Logout */}
                  <UserActionItem
                    label={t('auth.menuLogout')}
                    onClick={() => { setMenuOpen(false); setLogoutConfirm(true); }}
                    hoverBg={hoverBg}
                    color={C.mars}
                  />
                </>
              ) : (
                <UserActionItem
                  label={t('auth.menuLogin')}
                  onClick={() => { setMenuOpen(false); openAuthModal('login'); }}
                  hoverBg={hoverBg}
                  color={C.blue}
                />
              )}
            </div>

            {/*
              Submenu — position:absolute so it floats beside the main card without
              affecting layout. left:264 places it flush against the main card's right
              content edge (0 gap), preventing any mouse-gap between the two panels.
              The 150ms scheduleClose/cancelClose timer bridges any sub-pixel rounding.
            */}
            {activeSubmenu && activeOptions && (
              <div
                key={activeSubmenu}
                style={{
                  position: 'absolute',
                  left: 264,
                  top: 0,
                  background: cardBg,
                  border: `1px solid ${cardBorder}`,
                  borderRadius: 11,
                  backdropFilter: 'blur(24px)',
                  WebkitBackdropFilter: 'blur(24px)',
                  boxShadow: cardShadow,
                  padding: '5px 0',
                  minWidth: 152,
                  overflow: 'hidden',
                  animation: '_sfadein 0.1s ease-out',
                }}
                onMouseEnter={cancelClose}
                onMouseLeave={scheduleClose}
              >
                {activeOptions.map(opt => {
                  const selected = getCurrentVal(activeSubmenu) === opt.value;
                  return (
                    <SubOption
                      key={opt.value}
                      label={opt.label}
                      selected={selected}
                      onClick={() => handleSelect(activeSubmenu, opt.value)}
                      hoverBg={hoverBg}
                      labelColor={labelClr}
                      activeClr={activeClr}
                    />
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Tooltip ── */}
      {showTooltip && !menuOpen && (
        <div style={{
          position: 'absolute', bottom: 50, left: 0,
          background: L ? 'rgba(28,28,48,0.9)' : 'rgba(10,10,22,0.92)',
          color: '#fff', fontSize: 'calc(12px * var(--font-scale, 1))', fontWeight: 500,
          padding: '5px 10px', borderRadius: 7,
          whiteSpace: 'nowrap', pointerEvents: 'none',
          boxShadow: '0 2px 8px rgba(0,0,0,0.22)',
        }}>
          {tooltipText}
        </div>
      )}

      {/* ── FAB Button ── */}
      <button
        onClick={() => {
          setMenuOpen(v => !v);
          setShowTooltip(false);
        }}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        style={{
          width: 42, height: 42, borderRadius: '50%',
          background: fabBg,
          border: `1px solid ${fabBorder}`,
          backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
          boxShadow: fabShadow,
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: fabColor,
          transition: 'background 0.2s, color 0.2s',
          padding: 0,
        }}
      >
        <GearIcon size={17} />
      </button>

      {/* ── Performance Monitor ── */}
      <PerformanceMonitor visible={perfMonitor} />

      {/* ── Feedback modal ── */}
      <FeedbackModal open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />

      {/* ── Logout confirmation ── */}
      {logoutConfirm && (
        <ConfirmDialog
          title={t('auth.logoutConfirmTitle')}
          message={t('auth.logoutConfirmMsg')}
          confirmLabel={t('auth.logoutConfirmBtn')}
          cancelLabel={t('auth.cancelBtn')}
          onConfirm={() => {
            setLogoutConfirm(false);
            logout();
            showToast(t('auth.toastLoggedOut'), 'success');
          }}
          onCancel={() => setLogoutConfirm(false)}
        />
      )}
    </div>
  );
}
