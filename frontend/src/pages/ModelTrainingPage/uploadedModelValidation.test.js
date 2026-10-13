import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getUploadedModelValidationErrors, getUploadedModelValidationStatus,
  isUploadedModelValidationTimeout, UPLOADED_MODEL_VALIDATION_TIMEOUT,
} from './uploadedModelValidation.js';

const legacyTimeout = 'User model validation timed out after 30.0 seconds';

test('timeout detection accepts the stable code and legacy validator reports', () => {
  for (const report of [
    { code: UPLOADED_MODEL_VALIDATION_TIMEOUT },
    { errors: [legacyTimeout] },
    { reasons: ['User model validation timed out after 120 seconds'] },
  ]) assert.equal(isUploadedModelValidationTimeout(report), true);

  for (const report of [null, {}, { errors: 'bad report' },
    { errors: ['model forward pass timed out'] },
    { errors: ['Expected float32 output', null, {}] }]) {
    assert.equal(isUploadedModelValidationTimeout(report), false);
  }
});

test('a timeout is displayed separately from invalid, valid and pending models', () => {
  assert.equal(getUploadedModelValidationStatus({
    validation_status: 'invalid', validation_report: { errors: [legacyTimeout] },
  }), 'timeout');
  assert.equal(getUploadedModelValidationStatus({
    validation_status: 'invalid', validation_report: { code: UPLOADED_MODEL_VALIDATION_TIMEOUT },
  }), 'timeout');
  assert.equal(getUploadedModelValidationStatus({ validation_status: 'invalid' }), 'invalid');
  assert.equal(getUploadedModelValidationStatus({ validation_status: 'valid' }), 'valid');
  assert.equal(getUploadedModelValidationStatus({ validation_status: 'pending' }), 'pending');
});

test('timeout details use localized recovery copy while contract errors keep their explanation', () => {
  const timeoutLabel = 'Validation timed out. Please retry.';
  assert.deepEqual(getUploadedModelValidationErrors({ errors: [legacyTimeout] }, timeoutLabel), [timeoutLabel]);
  assert.deepEqual(getUploadedModelValidationErrors({ code: UPLOADED_MODEL_VALIDATION_TIMEOUT }, timeoutLabel), [timeoutLabel]);
  assert.deepEqual(getUploadedModelValidationErrors({ errors: ['Expected float32 output'] }, timeoutLabel), ['Expected float32 output']);
  assert.deepEqual(getUploadedModelValidationErrors(null, timeoutLabel), []);
});
