import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { fetchTrainingTags } from '../../services/api';
import { createScopedRequestGate } from './trainingTagFilters';

const EMPTY_TAGS = Object.freeze([]);

export function useTrainingTags(onChanged) {
  const { user } = useAuth();
  const scope = user?.id ?? null;
  const identity = useRef({ scope });
  if (identity.current.scope !== scope) identity.current = { scope };
  const gate = useRef(createScopedRequestGate());
  gate.current.setScope(scope);
  const changedRef = useRef(onChanged);
  changedRef.current = onChanged;
  const [snapshot, setSnapshot] = useState({ identity: null, tags: [], loading: false, error: '' });
  const [busyIdentity, setBusyIdentity] = useState(null);
  const mutationRef = useRef(null);

  const refresh = useCallback(async () => {
    if (scope === null) return;
    const request = gate.current.start();
    const owner = identity.current;
    setSnapshot(prev => ({ ...prev, identity: owner, loading: true, error: '', tags: prev.identity === owner ? prev.tags : [] }));
    try {
      const tags = await fetchTrainingTags();
      if (gate.current.isCurrent(request)) setSnapshot({ identity: owner, tags, loading: false, error: '' });
    } catch (error) {
      if (gate.current.isCurrent(request)) setSnapshot(prev => ({ ...prev, loading: false, error: error.message }));
      throw error;
    }
  }, [scope]);

  useEffect(() => {
    refresh().catch(() => {});
    return () => gate.current.invalidate();
  }, [refresh]);

  const mutate = useCallback(async (operation) => {
    const owner = identity.current;
    if (owner.scope === null || mutationRef.current === owner) return null;
    mutationRef.current = owner;
    setBusyIdentity(owner);
    try {
      const result = await operation();
      if (identity.current !== owner) return null;
      await Promise.all([refresh(), changedRef.current?.()]);
      return identity.current === owner ? result : null;
    } finally {
      if (mutationRef.current === owner) mutationRef.current = null;
      setBusyIdentity(current => current === owner ? null : current);
    }
  }, [refresh]);

  const current = snapshot.identity === identity.current;
  return {
    tags: current ? snapshot.tags : EMPTY_TAGS,
    loading: scope !== null && (!current || snapshot.loading),
    error: current ? snapshot.error : '',
    busy: busyIdentity === identity.current,
    refresh,
    mutate,
    scope,
  };
}
