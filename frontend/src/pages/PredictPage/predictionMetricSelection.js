/** Current-window metrics cannot replace an available full-test result on a cache hit. */
export function selectPredictionMetrics({ trained, fetched, cached, prediction, cacheMatches }) {
  if (!trained) return prediction ?? null;
  return fetched ?? (cacheMatches ? cached : null) ?? prediction ?? null;
}
