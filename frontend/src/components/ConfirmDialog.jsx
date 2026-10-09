import ReactDOM from 'react-dom';
import { useId, useRef } from 'react';
import { useScrollLock } from '../hooks/useScrollLock';
import { useDialogFocus } from '../hooks/useDialogFocus';
import './ui/overlay.css';

function ConfirmContent({ title, message, confirmLabel, cancelLabel, onConfirm, onCancel, confirmColor }) {
  const dialogRef = useRef(null);
  const titleId = useId();
  const messageId = useId();
  useScrollLock();
  useDialogFocus(true, dialogRef, onCancel);

  return (
    <div
      className="av-overlay-backdrop av-modal-backdrop"
      onClick={onCancel}
      style={{ zIndex: 9800 }}
    >
      <div
        ref={dialogRef}
        className="av-modal av-modal--confirm"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        tabIndex={-1}
        onClick={e => e.stopPropagation()}
      >
        <h2 id={titleId} className="av-dialog-title">{title}</h2>
        <div id={messageId} className="av-dialog-message">{message}</div>
        <div className="av-dialog-actions">
          <button
            type="button"
            className="av-button"
            data-dialog-autofocus
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className="av-button av-button--confirm"
            onClick={onConfirm}
            style={confirmColor ? { '--confirm-color': confirmColor } : undefined}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ConfirmDialog(props) {
  return ReactDOM.createPortal(<ConfirmContent {...props} />, document.body);
}
