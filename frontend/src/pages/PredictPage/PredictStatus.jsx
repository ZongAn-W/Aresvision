export default function PredictStatus({ loading, message, error, onRetry, retryLabel = '重试 / Retry' }) {
  if (!loading && !message && !error) return null;
  return <div className="prediction-status" data-tone={error ? 'error' : 'info'} role={error ? 'alert' : 'status'}>
    <span>{error || message}</span>
    {error && onRetry ? <button type="button" onClick={onRetry} disabled={loading}>{retryLabel}</button> : null}
  </div>;
}
