import { useEffect, useRef } from 'react';
import C from '../../constants/colors';
import { useT } from '../../i18n';
import { getExperimentLogLineTone } from './experimentCenterModel';
import { getTrainingStatusMeta } from './trainingStatusMeta';
import './experimentCenter.css';

/**
 * 只读日志面板：监控工作区与结果工作区共用。
 *
 * 日志内容、行号着色与自动跟随状态全部由父组件传入；这里不请求日志、
 * 不创建定时器、也不建立 WebSocket —— 数据仍来自 TrainingContext 的日志轮询。
 * 结果工作区用 `collapsible` 把它做成默认折叠的「查看运行日志」区域。
 */
export default function ExperimentLogPanel({
  task,
  logs,
  isLight,
  autoScrollPinned = true,
  logContainerRef,
  onScroll,
  title,
  hint,
  collapsible = false,
  open = true,
  onToggle,
  emptyLabel,
  autoFollow = true,
  actions = null,
  copy,
}) {
  const t = useT();
  const localRef = useRef(null);
  const scrollRef = logContainerRef || localRef;
  const statusMeta = getTrainingStatusMeta(task?.status || 'idle', t);
  const lines = Array.isArray(logs) ? logs : [];

  // 监控阶段保持「自动跟随」到底部；结果阶段的折叠日志默认从头看。
  useEffect(() => {
    if (!autoFollow || !autoScrollPinned || !scrollRef.current) return;
    if (collapsible && !open) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [autoFollow, autoScrollPinned, collapsible, lines, open, scrollRef]);

  const body = (
    <div
      className="experiment-monitor-log"
      style={{
        border: 'none',
        borderRadius: 0,
        background: isLight ? 'rgba(246,248,252,0.98)' : 'rgba(8,12,18,0.95)',
      }}
    >
      <div className="experiment-monitor-log-toolbar" style={{ background: isLight ? 'rgba(255,255,255,0.72)' : 'rgba(255,255,255,0.025)' }}>
        <div className="experiment-monitor-log-toolbar-left">
          <span className="experiment-monitor-log-dot" style={{ background: task ? statusMeta.color : C.ice40 }} />
          <span style={{ color: C.ice, fontSize: 'calc(12px * var(--font-scale, 1))', fontWeight: 800 }}>
            {task ? `task #${task.id}` : copy.selectedTask}
          </span>
        </div>
        <div className="experiment-monitor-log-toolbar-right">
          <span className="experiment-monitor-log-chip" style={{ color: C.ice60 }}>
            {copy.logLines(lines.length)}
          </span>
          {autoFollow ? (
            <span
              className="experiment-monitor-log-chip"
              style={{
                color: autoScrollPinned ? C.green : '#c89448',
                borderColor: autoScrollPinned ? 'rgba(74,207,172,0.18)' : 'rgba(200,148,72,0.20)',
              }}
            >
              {autoScrollPinned ? copy.autoScrollOn : copy.autoScrollPaused}
            </span>
          ) : null}
        </div>
      </div>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        role="log"
        aria-live="polite"
        aria-label={title || copy.liveLogs}
        className={`experiment-monitor-log-scroll ${!task || lines.length === 0 ? 'is-empty' : ''}`}
        style={{ color: isLight ? 'rgba(23,33,47,0.90)' : C.ice80 }}
      >
        {!task ? (
          <div className="experiment-monitor-log-empty" style={{ color: C.ice50 }}>
            <div className="experiment-monitor-log-empty-mark" style={{ color: C.blue, border: `1px solid ${C.border}` }}>--</div>
            {copy.noTaskSelectedHint}
          </div>
        ) : lines.length > 0 ? (
          lines.map((line, index) => (
            <div key={`${index}`} className="experiment-monitor-log-row" data-tone={getExperimentLogLineTone(line)}>
              <span className="experiment-monitor-log-gutter">{String(index + 1).padStart(3, '0')}</span>
              <span className="experiment-monitor-log-text">{line}</span>
            </div>
          ))
        ) : (
          <div className="experiment-monitor-log-empty" style={{ color: C.ice50 }}>
            <div
              className="experiment-monitor-log-empty-mark"
              style={{ color: statusMeta.color, background: statusMeta.tint, border: `1px solid ${statusMeta.border}` }}
            >
              ...
            </div>
            {emptyLabel || copy.waitingLogs}
          </div>
        )}
      </div>
    </div>
  );

  if (!collapsible) {
    return (
      <div className="experiment-center-card" style={{ padding: 0 }}>
        <div className="experiment-center-action-row" style={{ margin: 0, padding: '14px 16px', borderTop: 'none', borderBottom: `1px solid ${C.border}` }}>
          <div style={{ minWidth: 0 }}>
            <div className="experiment-center-section-title" style={{ marginBottom: 4 }}>{title || copy.liveLogs}</div>
            <div className="experiment-center-hint">{hint || copy.liveLogsHint}</div>
          </div>
          {actions}
        </div>
        {body}
      </div>
    );
  }

  return (
    <div className="experiment-center-card" style={{ padding: 0 }}>
      <button
        type="button"
        className="experiment-log-toggle"
        aria-expanded={open}
        aria-controls="experiment-result-log-panel"
        onClick={onToggle}
      >
        <span style={{ minWidth: 0, textAlign: 'left' }}>
          <span className="experiment-center-section-title" style={{ display: 'block', marginBottom: 2 }}>
            {title || copy.viewRunLogs}
          </span>
          <span className="experiment-center-hint">{hint || copy.logLines(lines.length)}</span>
        </span>
        <span className="experiment-center-hint">{open ? copy.collapse : copy.expand}</span>
      </button>
      {open ? <div id="experiment-result-log-panel">{body}</div> : null}
    </div>
  );
}
