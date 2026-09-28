import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MODEL_ARCHITECTURES,
  MODEL_ARCHITECTURE_FAMILIES,
  filterModelArchitectures,
  getExperimentArchitectureLabel,
  getModelArchitectureFamily,
  getModelArchitectureFamilyHint,
} from './experimentCenterModel.js';
import { MODEL_STRUCTURE_PARAM_CONFIG, RECURRENT_MODEL_ARCHITECTURES } from './trainingParamSanitizers.js';

const pickerSource = readFileSync(new URL('./ModelArchitectureSelector.jsx', import.meta.url), 'utf8');

test('官方模型架构注册表覆盖全部既有架构，一个都没有丢', () => {
  const ids = MODEL_ARCHITECTURES.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length, '架构 id 不能重复');

  // 递归与非递归架构都必须出现在选择器里。
  RECURRENT_MODEL_ARCHITECTURES.forEach((id) => {
    assert.ok(ids.includes(id), `循环架构 ${id} 应在注册表中`);
  });
  Object.keys(MODEL_STRUCTURE_PARAM_CONFIG).forEach((id) => {
    assert.ok(ids.includes(id), `结构参数架构 ${id} 应在注册表中`);
  });

  // 展示名与标签函数一致。
  MODEL_ARCHITECTURES.forEach((item) => {
    assert.equal(item.label, getExperimentArchitectureLabel(item.id), `${item.id} 的展示名应一致`);
  });

  // 既有能力清单仍然齐全。
  ['predrnnv2', 'convlstm', 'simvp', 'patchtst', 'convlstm_mst', 'simvp_hybrid3d'].forEach((id) => {
    assert.ok(ids.includes(id), `${id} 必须保留`);
  });
});

test('每个架构都归属一个已声明的家族', () => {
  const familyIds = MODEL_ARCHITECTURE_FAMILIES.map((item) => item.id);
  MODEL_ARCHITECTURES.forEach((item) => {
    assert.ok(familyIds.includes(item.family), `${item.id} 的家族 ${item.family} 未声明`);
    assert.equal(getModelArchitectureFamily(item.id), item.family);
  });
  // 未登记 id 回退到实验变体而不是抛错。
  assert.equal(getModelArchitectureFamily('不存在的架构'), 'hybrid');
  assert.equal(getModelArchitectureFamily(''), 'hybrid');
  // 家族说明中英文齐全。
  familyIds.forEach((id) => {
    const hint = getModelArchitectureFamilyHint(id);
    assert.ok(hint.label && hint.labelEn && hint.hint && hint.hintEn, `${id} 缺少中英文说明`);
  });
});

test('家族筛选与名称搜索都基于同一份注册表', () => {
  const all = filterModelArchitectures(MODEL_ARCHITECTURES);
  assert.equal(all.length, MODEL_ARCHITECTURES.length);

  const recurrent = filterModelArchitectures(MODEL_ARCHITECTURES, { family: 'recurrent' });
  assert.ok(recurrent.length > 0);
  assert.ok(recurrent.every((item) => getModelArchitectureFamily(item.id) === 'recurrent'));
  assert.ok(recurrent.some((item) => item.id === 'predrnnv2'));
  assert.ok(recurrent.some((item) => item.id === 'convlstm'));

  const byName = filterModelArchitectures(MODEL_ARCHITECTURES, { search: 'simvp' });
  assert.deepEqual(byName.map((item) => item.id).sort(), ['simvp', 'simvp_3dconv', 'simvp_hybrid3d']);

  // 大小写与首尾空格不影响搜索。
  assert.equal(filterModelArchitectures(MODEL_ARCHITECTURES, { search: '  PATCHTST ' }).length, 1);
  // 搜索 + 家族叠加。
  assert.deepEqual(
    filterModelArchitectures(MODEL_ARCHITECTURES, { search: 'simvp', family: 'convolutional' }).map((item) => item.id),
    ['simvp']
  );
  assert.deepEqual(filterModelArchitectures(MODEL_ARCHITECTURES, { search: '没有这个模型' }), []);
  // 非法输入安全回退。
  assert.deepEqual(filterModelArchitectures(null), []);
  assert.deepEqual(filterModelArchitectures(MODEL_ARCHITECTURES, { family: 'all' }).length, MODEL_ARCHITECTURES.length);
});

test('选择器提供搜索框、家族筛选与键盘可达的架构按钮', () => {
  assert.match(pickerSource, /type="search"/);
  assert.match(pickerSource, /copy\.modelPickerSearch/);
  assert.match(pickerSource, /role="group"/);
  assert.match(pickerSource, /copy\.architectureFamilyAll/);
  assert.match(pickerSource, /aria-pressed=\{family === item\.id\}/);
  assert.match(pickerSource, /<button[\s\S]{0,400}?data-architecture-option=\{architecture\.id\}/);
  assert.match(pickerSource, /aria-pressed=\{active\}/);
  assert.match(pickerSource, /data-architecture-family=\{getModelArchitectureFamily\(architecture\.id\)\}/);
  // 不可用（迁移结构锁定）时按钮禁用而不是隐藏。
  assert.match(pickerSource, /disabled=\{disabled\}/);
  // 当前值与展开开关是同一个按钮，键盘可以直接切换。
  assert.match(pickerSource, /data-architecture-current="true"/);
  assert.match(pickerSource, /onClick=\{onToggleExpanded\}/);
});
