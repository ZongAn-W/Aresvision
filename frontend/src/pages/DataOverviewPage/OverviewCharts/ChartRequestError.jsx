import React, { useState } from 'react';

/** Each request effect clears its own error and includes retryToken in its dependencies. */
export function useChartRequestError() {
  const [requestError, setRequestError] = useState(null);
  const [retryToken, setRetryToken] = useState(0);
  return { requestError, setRequestError, retryToken, retry: () => setRetryToken(value => value + 1) };
}

export default function ChartRequestError({ isZh = true, onRetry }) {
  return (
    <div className="analysis-state" role="alert">
      <span>{isZh ? '图表加载失败，请重试。' : 'The chart could not be loaded. Please retry.'}</span>
      <button type="button" className="analysis-action" onClick={onRetry}>
        {isZh ? '重新加载图表' : 'Retry chart'}
      </button>
    </div>
  );
}
