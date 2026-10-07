import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchDatasets } from '../../../services/datasets.js';
import { resolveEarthDatasetId } from './earthOverviewModel.js';

export function useEarthDatasetCatalog(preferredDatasetId = null) {
  const preferredDatasetIdRef = useRef(preferredDatasetId);
  const [catalog, setCatalog] = useState(null);
  const [defaultDatasetId, setDefaultDatasetId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [retryKey, setRetryKey] = useState(0);

  const retry = useCallback(() => setRetryKey((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetchDatasets({ signal: controller.signal }).then((payload) => {
      if (controller.signal.aborted) return;
      const resolved = resolveEarthDatasetId(payload, preferredDatasetIdRef.current);
      if (!resolved) {
        setCatalog(null);
        setDefaultDatasetId(null);
        setError({ code: 'invalid_dataset_catalog', message: 'Earth default is missing from the dataset catalog' });
        return;
      }
      setCatalog(payload);
      setDefaultDatasetId(resolved);
    }).catch((cause) => {
      if (controller.signal.aborted) return;
      setCatalog(null);
      setDefaultDatasetId(null);
      setError({
        code: cause?.code || 'invalid_request',
        message: cause?.message || 'Dataset catalog could not be loaded',
      });
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [retryKey]);

  return { catalog, defaultDatasetId, loading, error, retry };
}
