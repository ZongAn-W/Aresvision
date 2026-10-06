import test from 'node:test';
import assert from 'node:assert/strict';
import { downloadUserModel, renameUserModel } from './api.js';

const originalFetch = globalThis.fetch;
const originalStorage = globalThis.localStorage;
test.afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.localStorage = originalStorage;
});

test('model rename sends the name and bearer authentication', async () => {
  globalThis.localStorage = { getItem: () => 'owner-token' };
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/api/user-models/model%2Fid');
    assert.equal(options.method, 'PATCH');
    assert.equal(options.headers.Authorization, 'Bearer owner-token');
    assert.deepEqual(JSON.parse(options.body), { display_name: '新的模型' });
    return { ok: true, json: async () => ({ id: 'model/id', display_name: '新的模型' }) };
  };
  assert.equal((await renameUserModel('model/id', '新的模型')).display_name, '新的模型');
});

test('source download uses authentication and preserves bytes as a blob', async () => {
  globalThis.localStorage = { getItem: () => 'owner-token' };
  const source = new Blob(['# 原始源码\r\n']);
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/api/user-models/model%2Fid/download');
    assert.equal(options.headers.Authorization, 'Bearer owner-token');
    return { ok: true, blob: async () => source };
  };
  assert.equal(await downloadUserModel('model/id'), source);
});

test('management errors expose the server detail', async () => {
  globalThis.localStorage = { getItem: () => 'owner-token' };
  globalThis.fetch = async () => ({ ok: false, status: 403, json: async () => ({ detail: 'No permission' }) });
  await assert.rejects(downloadUserModel('other-model'), /No permission/);
  await assert.rejects(renameUserModel('other-model', 'new'), /No permission/);
});
