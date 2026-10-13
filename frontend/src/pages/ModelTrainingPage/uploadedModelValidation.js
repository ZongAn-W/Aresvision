export const UPLOADED_MODEL_VALIDATION_TIMEOUT = 'uploaded_model_validation_timeout';

export function isUploadedModelValidationTimeout(report) {
  if (report?.code === UPLOADED_MODEL_VALIDATION_TIMEOUT) return true;
  const messages = [...(Array.isArray(report?.errors) ? report.errors : []),
    ...(Array.isArray(report?.reasons) ? report.reasons : [])];
  return messages.some((message) => typeof message === 'string'
    && /^User model validation timed out after \d+(?:\.\d+)? seconds$/i.test(message.trim()));
}

export function getUploadedModelValidationStatus(model) {
  if (model?.validation_status === 'valid') return 'valid';
  if (model?.validation_status === 'pending') return 'pending';
  return isUploadedModelValidationTimeout(model?.validation_report) ? 'timeout' : 'invalid';
}

export function getUploadedModelValidationErrors(report, timeoutLabel) {
  if (isUploadedModelValidationTimeout(report)) return [timeoutLabel];
  return Array.isArray(report?.errors) ? report.errors : [];
}
