import { useEffect, useRef } from 'react';
import { createDialogFocusScope } from '../components/ui/dialogFocus';

export function useDialogFocus(open, containerRef, onClose) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open || !containerRef.current) return undefined;
    return createDialogFocusScope(containerRef.current, () => closeRef.current?.());
  }, [open, containerRef]);
}
