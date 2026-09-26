import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { updateMarsAnalysisSetting } from './marsAnalysisSettings.js';

const MarsAnalysisContext = createContext(null);

export function MarsAnalysisProvider({ children }) {
  const [settings, setSettings] = useState({});
  const update = useCallback((cardKey, field, value) => {
    setSettings(previous => updateMarsAnalysisSetting(previous, cardKey, field, value));
  }, []);
  const context = useMemo(() => ({ settings, update }), [settings, update]);
  return <MarsAnalysisContext.Provider value={context}>{children}</MarsAnalysisContext.Provider>;
}

export function useMarsAnalysisManaged() {
  return Boolean(useContext(MarsAnalysisContext));
}

/** Standalone charts retain local controls; the workbench stores choices across unmounts. */
export function useMarsChartSetting(cardKey, field, initialValue) {
  const context = useContext(MarsAnalysisContext);
  const [localValue, setLocalValue] = useState(initialValue);
  const value = context ? (context.settings[cardKey]?.[field] ?? initialValue) : localValue;
  const update = context?.update;
  const setValue = useCallback(next => {
    if (update) update(cardKey, field, next);
    else setLocalValue(next);
  }, [cardKey, field, update]);
  return [value, setValue, Boolean(context)];
}
