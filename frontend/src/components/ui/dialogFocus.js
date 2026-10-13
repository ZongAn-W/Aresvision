const dialogStack = [];
const focusableSelector = [
  'button:not(:disabled)', 'a[href]', 'input:not(:disabled):not([type="hidden"])',
  'select:not(:disabled)', 'textarea:not(:disabled)', '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusableElements(container) {
  return Array.from(container.querySelectorAll(focusableSelector)).filter((element) => (
    !element.closest('[inert], [hidden], [aria-hidden="true"]')
    && element.getClientRects().length > 0
  ));
}

export function createDialogFocusScope(container, onClose, doc = document) {
  const previousFocus = doc.activeElement;
  const scope = { container };
  dialogStack.push(scope);
  const isTop = () => dialogStack.at(-1) === scope;
  const focusInitial = () => {
    const target = container.querySelector('[data-dialog-autofocus]')
      || focusableElements(container)[0] || container;
    target.focus({ preventScroll: true });
  };

  const handleKey = (event) => {
    if (!isTop()) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const elements = focusableElements(container);
    const first = elements[0] || container;
    const last = elements.at(-1) || container;
    const outside = !container.contains(doc.activeElement);
    if (!elements.length || outside || (event.shiftKey ? doc.activeElement === first : doc.activeElement === last)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus({ preventScroll: true });
    }
  };
  const handleFocus = (event) => {
    if (isTop() && !container.contains(event.target)) focusInitial();
  };

  doc.addEventListener('keydown', handleKey, true);
  doc.addEventListener('focusin', handleFocus);
  focusInitial();

  return () => {
    const wasTop = isTop();
    doc.removeEventListener('keydown', handleKey, true);
    doc.removeEventListener('focusin', handleFocus);
    dialogStack.splice(dialogStack.indexOf(scope), 1);
    if (!wasTop) return;
    const parent = dialogStack.at(-1)?.container;
    if (previousFocus?.isConnected && !previousFocus.closest('[inert], [hidden], [aria-hidden="true"]')
      && (!parent || parent.contains(previousFocus))) {
      previousFocus.focus({ preventScroll: true });
    } else if (parent) {
      (focusableElements(parent)[0] || parent).focus({ preventScroll: true });
    }
  };
}
