import { useEffect, useRef, createContext, useContext } from 'react';
import { useSettings } from '../contexts/SettingsContext';
import { useT } from '../i18n';
import C from '../constants/colors';
import { useScrollLock } from '../hooks/useScrollLock';

/* ─── 面板内 isLight 上下文 ─── */
const LightCtx = createContext(false);

/* ─── 小工具组件 ─── */

function SectionHeader({ label }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{
        fontSize: 'calc(10px * var(--font-scale, 1))',
        fontWeight: 700,
        letterSpacing: 0.8,
        fontFamily: 'var(--font-display)',
        color: C.mars,
        marginBottom: 6,
      }}>
        {label}
      </div>
      <div style={{ height: 1, background: `linear-gradient(to right, ${C.mars}40, transparent)` }} />
    </div>
  );
}

function Divider() {
  return <div style={{ height: 1, background: 'var(--border)', margin: '20px 0' }} />;
}

/** 二选一 / 多选一 pill 按钮组 */
function ChipGroup({ options, value, onChange, cols = 2 }) {
  const isLight = useContext(LightCtx);
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `repeat(${cols}, 1fr)`,
      gap: 6,
    }}>
      {options.map(opt => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            title={opt.desc || opt.label}
            style={{
              padding: '7px 10px',
              borderRadius: 6,
              border: active
                ? `1px solid ${C.blue}66`
                : `1px solid var(--border)`,
              background: active
                ? `${C.blue}1a`
                : 'var(--bg-muted)',
              color: active ? C.blue : 'var(--text-60)',
              fontSize: 'calc(11px * var(--font-scale, 1))',
              fontWeight: active ? 600 : 400,
              cursor: 'pointer',
              transition: 'all 0.18s',
              textAlign: 'center',
              lineHeight: 1.3,
            }}
          >
            {opt.label}
            {opt.sub && (
              <div style={{ fontSize: 'calc(9px * var(--font-scale, 1))', color: active ? `${C.blue}aa` : 'var(--text-30)', marginTop: 1 }}>
                {opt.sub}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** 行内标签 + 控件 */
function SettingRow({ label, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
      <span style={{ fontSize: 'calc(12px * var(--font-scale, 1))', color: 'var(--text-60)', flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end' }}>
        {children}
      </div>
    </div>
  );
}

/** 紧凑型 pill 切换（用于行内 unit 选择等） */
function InlinePill({ options, value, onChange }) {
  const isLight = useContext(LightCtx);
  return (
    <div style={{
      display: 'flex',
      background: 'var(--bg-muted)',
      borderRadius: 6, padding: 2, gap: 2,
    }}>
      {options.map(opt => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            style={{
              padding: '4px 10px',
              border: 'none',
              borderRadius: 5,
              background: active ? `${C.blue}33` : 'transparent',
              color: active ? C.blue : 'var(--text-30)',
              fontSize: 'calc(11px * var(--font-scale, 1))',
              fontWeight: active ? 600 : 400,
              cursor: 'pointer',
              transition: 'all 0.15s',
              whiteSpace: 'nowrap',
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/** Checkbox */
function Checkbox({ label, checked, onChange }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: 8 }}>
      <div
        onClick={() => onChange(!checked)}
        style={{
          width: 16,
          height: 16,
          borderRadius: 4,
          border: checked ? `1px solid ${C.blue}` : `1px solid var(--text-30)`,
          background: checked ? `${C.blue}33` : 'transparent',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          transition: 'all 0.15s',
          cursor: 'pointer',
        }}
      >
        {checked && (
          <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
            <path d="M1 4L3.5 6.5L9 1" stroke={C.blue} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>
      <span style={{ fontSize: 'calc(12px * var(--font-scale, 1))', color: 'var(--text-60)' }}>{label}</span>
    </label>
  );
}

/* ─── 主组件 ─── */

export default function SettingsPanel({ open, onClose }) {
  const { settings, updateSetting } = useSettings();
  const t = useT();
  const panelRef = useRef(null);
  const isLight = settings.theme === 'light';
  useScrollLock(open);

  // 点击面板外侧关闭
  useEffect(() => {
    if (!open) return;
    const handleClick = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        onClose();
      }
    };
    // 延迟绑定，避免与触发按钮的点击事件冲突
    const timer = setTimeout(() => document.addEventListener('mousedown', handleClick), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClick);
    };
  }, [open, onClose]);

  // ESC 关闭
  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  // 浅色/深色主题对应的 CSS 变量值，覆盖页面级主题
  return (
    <LightCtx.Provider value={isLight}>
      {/* 遮罩 */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          background: isLight ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.4)',
          zIndex: 2999,
          opacity: open ? 1 : 0,
          pointerEvents: open ? 'auto' : 'none',
          transition: 'opacity 0.25s',
          backdropFilter: 'blur(2px)',
          overscrollBehavior: 'contain',
        }}
      />

      {/* 面板主体 */}
      <div
        ref={panelRef}
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: 360,
          zIndex: 3000,
          background: 'var(--bg-card-strong)',
          backdropFilter: 'blur(18px)',
          borderLeft: isLight
            ? '1px solid var(--border)'
            : '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.3s cubic-bezier(0.22, 1, 0.36, 1)',
          boxShadow: !open ? 'none' : isLight
            ? '-20px 0 60px rgba(15,23,42,0.10)'
            : '-20px 0 60px rgba(0,0,0,0.32)',
        }}
      >
        {/* 面板头部 */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 24px',
          height: 70,
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}>
          <div>
            <div style={{
              fontSize: 'calc(16px * var(--font-scale, 1))',
              fontWeight: 700,
              color: C.mars,
              fontFamily: 'var(--font-body)',
            }}>
              {t('settings.title')}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 8,
              width: 32,
              height: 32,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-60)',
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = 'var(--border-strong)';
              e.currentTarget.style.color = 'var(--text)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = 'var(--border)';
              e.currentTarget.style.color = 'var(--text-60)';
            }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M1 1L11 11M11 1L1 11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* 可滚动内容区 */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '24px',
          display: 'flex',
          flexDirection: 'column',
          gap: 0,
        }}>

          {/* ── 显示偏好 ── */}
          <SectionHeader label={t('settings.appearance.label')} />
          <p style={{ fontSize: 'calc(10px * var(--font-scale, 1))', color: 'var(--text-30)', marginBottom: 12, lineHeight: 1.5 }}>
            {t('settings.appearance.desc')}
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8, marginBottom: 12 }}>
            <div style={{
              width: 44,
              fontSize: 'calc(11px * var(--font-scale, 1))',
              fontWeight: 600,
              color: 'var(--text-60)',
              textAlign: 'right',
            }}>
              A
            </div>
            
            <input
              type="range"
              min="0.7"
              max="1.5"
              step="0.1"
              value={settings.appearance?.uiScale || 1}
              onChange={e => updateSetting('appearance.uiScale', parseFloat(e.target.value))}
              style={{
                flex: 1,
                cursor: 'pointer',
                accentColor: C.blue,
                height: 4,
              }}
            />
            
            <div style={{
              width: 44,
              fontSize: 'calc(14px * var(--font-scale, 1))',
              fontWeight: 600,
              color: 'var(--text)',
              textAlign: 'left',
            }}>
              A
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 8px' }}>
            <button
              onClick={() => updateSetting('appearance.uiScale', 1)}
              style={{
                background: 'transparent',
                border: 'none',
                color: (settings.appearance?.uiScale || 1) !== 1 ? C.blue : 'var(--text-30)',
                fontSize: 'calc(10px * var(--font-scale, 1))',
                cursor: 'pointer',
                padding: 0,
                textDecoration: (settings.appearance?.uiScale || 1) !== 1 ? 'underline' : 'none',
              }}
            >
              {t('settings.appearance.scaleMedium') || 'Reset'}
            </button>
            <div style={{
              fontSize: 'calc(11px * var(--font-scale, 1))',
              color: C.blue,
              background: 'rgba(74, 158, 255, 0.10)',
              padding: '2px 8px',
              borderRadius: 4,
              fontWeight: 600,
              fontFamily: 'var(--font-display)'
            }}>
              {Math.round((settings.appearance?.uiScale || 1) * 100)}%
            </div>
          </div>
          <Divider />

          {/* ── 单位制 ── */}
          <SectionHeader label={t('settings.units.label')} />
          <SettingRow label={t('settings.units.ozone')}>
            <InlinePill
              options={[
                { value: 'um-atm', label: 'μm-atm' },
                { value: 'DU',     label: 'DU' },
              ]}
              value={settings.units.ozone}
              onChange={v => updateSetting('units.ozone', v)}
            />
          </SettingRow>
          <SettingRow label={t('settings.units.temperature')}>
            <InlinePill
              options={[
                { value: 'K', label: 'K' },
                { value: 'C', label: '°C' },
              ]}
              value={settings.units.temperature}
              onChange={v => updateSetting('units.temperature', v)}
            />
          </SettingRow>
          <SettingRow label={t('settings.units.wind')}>
            <InlinePill
              options={[
                { value: 'm/s',  label: 'm/s' },
                { value: 'km/h', label: 'km/h' },
              ]}
              value={settings.units.wind}
              onChange={v => updateSetting('units.wind', v)}
            />
          </SettingRow>
          <SettingRow label={t('settings.units.pressure')}>
            <InlinePill
              options={[
                { value: 'Pa',  label: 'Pa' },
                { value: 'hPa', label: 'hPa' },
              ]}
              value={settings.units.pressure}
              onChange={v => updateSetting('units.pressure', v)}
            />
          </SettingRow>

          <Divider />

          {/* ── 数据精度 ── */}
          <SectionHeader label={t('settings.precision.label')} />
          <p style={{ fontSize: 'calc(10px * var(--font-scale, 1))', color: 'var(--text-30)', marginBottom: 12, lineHeight: 1.5 }}>
            {t('settings.precision.desc')}
          </p>
          <ChipGroup
            cols={4}
            options={[
              { value: 2,      label: t('settings.precision.opt2') },
              { value: 4,      label: t('settings.precision.opt4') },
              { value: 6,      label: t('settings.precision.opt6') },
              { value: 'full', label: t('settings.precision.optFull') },
            ]}
            value={settings.precision}
            onChange={v => updateSetting('precision', v)}
          />

          <Divider />

          {/* ── 导出偏好 ── */}
          <SectionHeader label={t('settings.export.label')} />
          <p style={{ fontSize: 'calc(10px * var(--font-scale, 1))', color: 'var(--text-30)', marginBottom: 12, lineHeight: 1.5 }}>
            {t('settings.export.desc')}
          </p>

          <div style={{ fontSize: 'calc(11px * var(--font-scale, 1))', color: 'var(--text-60)', marginBottom: 6 }}>{t('settings.export.format')}</div>
          <ChipGroup
            cols={3}
            options={[
              { value: 'png', label: t('settings.export.png'), sub: t('settings.export.pngSub') },
              { value: 'svg', label: t('settings.export.svg'), sub: t('settings.export.svgSub') },
              { value: 'pdf', label: t('settings.export.pdf'), sub: t('settings.export.pdfSub') },
            ]}
            value={settings.export.format}
            onChange={v => updateSetting('export.format', v)}
          />

          <div style={{ fontSize: 'calc(11px * var(--font-scale, 1))', color: 'var(--text-60)', margin: '12px 0 6px' }}>{t('settings.export.dpi')}</div>
          <ChipGroup
            cols={3}
            options={[
              { value: 150, label: '150', sub: t('settings.export.dpi150Sub') },
              { value: 300, label: '300', sub: t('settings.export.dpi300Sub') },
              { value: 600, label: '600', sub: t('settings.export.dpi600Sub') },
            ]}
            value={settings.export.dpi}
            onChange={v => updateSetting('export.dpi', v)}
          />

          <div style={{ fontSize: 'calc(11px * var(--font-scale, 1))', color: 'var(--text-60)', margin: '12px 0 6px' }}>{t('settings.export.fontSize')}</div>
          <ChipGroup
            cols={3}
            options={[
              { value: 8,  label: '8 pt' },
              { value: 10, label: '10 pt' },
              { value: 12, label: '12 pt' },
            ]}
            value={settings.export.fontSize}
            onChange={v => updateSetting('export.fontSize', v)}
          />

          <div style={{ marginTop: 12 }}>
            <Checkbox
              label={t('settings.export.includeTitle')}
              checked={settings.export.includeTitle}
              onChange={v => updateSetting('export.includeTitle', v)}
            />
          </div>

        </div>

        {/* 面板底部 */}
        <div style={{
          padding: '16px 24px',
          borderTop: '1px solid var(--border)',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <span style={{ fontSize: 'calc(10px * var(--font-scale, 1))', color: 'var(--text-30)' }}>{t('settings.autoSave')}</span>
          <button
            onClick={() => {
              if (window.confirm(t('settings.resetConfirm'))) {
                localStorage.removeItem('aresvision_settings');
                window.location.reload();
              }
            }}
            style={{
              background: 'transparent',
              border: `1px solid rgba(199,91,57,0.3)`,
              borderRadius: 6,
              padding: '5px 12px',
              color: `${C.mars}cc`,
              fontSize: 'calc(11px * var(--font-scale, 1))',
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = `${C.mars}77`;
              e.currentTarget.style.color = C.mars;
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = `rgba(199,91,57,0.3)`;
              e.currentTarget.style.color = `${C.mars}cc`;
            }}
          >
            {t('settings.reset')}
          </button>
        </div>
      </div>
    </LightCtx.Provider>
  );
}
