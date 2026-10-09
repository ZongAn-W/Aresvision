import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { fetchEarthDiagnosticContext, runEarthDiagnostics } from '../../services/earthPredict.js';
import { isAbortError } from './predictRequestCoordinator.js';
import {
  buildEarthDiagnosticParameters, createEarthDiagnosticRequestGuard,
  earthDiagnosticErrorText, earthDiagnosticRequestKey,
} from './earthDiagnosticsModel.js';

export default function useEarthDiagnostics(taskId, { identity, options, autoLoad = false } = {}) {
  const { user } = useAuth();
  const guard = useRef(null);
  if (!guard.current) guard.current = createEarthDiagnosticRequestGuard();
  const [state, setState] = useState({ status: 'idle', data: null, error: '', availability: null });
  const [revision, setRevision] = useState(0);
  const parameters = useMemo(() => taskId ? buildEarthDiagnosticParameters(taskId, options) : null,
    [taskId, options]);
  const [requestedKey, setRequestedKey] = useState(null);
  const key = earthDiagnosticRequestKey(taskId, identity, parameters, user?.id);
  const shouldRun = autoLoad || requestedKey === key;

  useEffect(() => {
    guard.current.invalidate();
    setState({ key, status: taskId ? 'checking' : 'idle', data: null, error: '', availability: null });
    if (!parameters) return;
    const token = guard.current.start(key);
    token.taskId = Number(taskId);
    token.identity = identity;
    (async () => {
      try {
        const availability = await fetchEarthDiagnosticContext(taskId, { signal: token.signal });
        if (!guard.current.isCurrent(token)) return;
        if (!availability.available) {
          setState({ key, status: 'unavailable', data: null, error: earthDiagnosticErrorText(availability), availability });
          return;
        }
        if (!shouldRun) {
          setState({ key, status: 'ready', data: null, error: '', availability });
          return;
        }
        setState({ key, status: 'computing', data: null, error: '', availability });
        const data = await runEarthDiagnostics(parameters, { signal: token.signal });
        if (!guard.current.isCurrent(token)) return;
        if (!guard.current.accepts(token, data)) throw new Error('Diagnostic task identity does not match');
        setState({ key, status: 'success', data, error: '', availability });
      } catch (error) {
        if (!isAbortError(error) && guard.current.isCurrent(token)) {
          setState({ key, status: 'error', data: null, error: earthDiagnosticErrorText(error), availability: null });
        }
      }
    })();
    return () => guard.current.invalidate();
  // Stable serialized parameters prevent renders/language changes from restarting expensive inference.
  }, [taskId, key, shouldRun, revision]); // eslint-disable-line react-hooks/exhaustive-deps

  // Hide a previous task's state synchronously, before the cancellation effect runs.
  const displayed = state.key !== key || (state.data && Number(state.data.task_id) !== Number(taskId))
    ? { status: 'checking', data: null, error: '', availability: null } : state;
  return { ...displayed, run: () => { setRequestedKey(key); setRevision((n) => n + 1); } };
}
