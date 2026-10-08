import test from 'node:test';
import assert from 'node:assert/strict';
import { researchExportErrorMessage } from './researchExportErrors.js';

test('31-model validation reports the limit without echoing request references', () => {
  const detail = [{ type: 'too_long', loc: ['body', 'sources'],
    msg: 'List should have at most 8 items after validation, not 31',
    input: Array.from({ length: 31 }, (_, task_id) => ({ id: 'private-result-reference', task_id })),
    ctx: { max_length: 8, actual_length: 31 } }];
  assert.equal(researchExportErrorMessage(detail, 422), '每张科研图最多包含 8 个模型，请选择 2–8 个模型后重试。');
  assert.match(researchExportErrorMessage(detail, 422, 'en'), /at most 8 models/);
  assert.doesNotMatch(researchExportErrorMessage(detail, 422), /private-result-reference|input|task_id/);
});

test('other validation errors retain field and reason, omit input and bound length', () => {
  const detail = [{ loc: ['body', 'options', 'dpi'], msg: 'Input should be 300 or 600', input: 'private-value' }];
  assert.equal(researchExportErrorMessage(detail, 422, 'en'), 'Invalid parameters: options.dpi: Input should be 300 or 600');
  assert.ok(researchExportErrorMessage([{ msg: 'x'.repeat(1000) }], 422).length <= 500);
});

test('server messages remain readable and missing responses have localized status hints', () => {
  assert.equal(researchExportErrorMessage({ message: 'Dataset identity changed.' }, 409), 'Dataset identity changed.');
  assert.equal(researchExportErrorMessage('Labels do not fit.', 422), 'Labels do not fit.');
  assert.match(researchExportErrorMessage(null, 401), /重新登录/);
  assert.match(researchExportErrorMessage({}, 429, 'en'), /busy/);
  assert.match(researchExportErrorMessage([], 500), /500/);
});
