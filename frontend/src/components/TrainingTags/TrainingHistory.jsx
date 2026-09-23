import { useEffect, useMemo, useState } from 'react';
import C from '../../constants/colors';
import { replaceTrainingTaskTags, updateTrainingTaskTags } from '../../services/api';
import { filterTaggedTasks } from './trainingTagFilters';
import { TagChips, TagFilter, TagPicker } from './TagControls';
import { EditTaskTagsDialog, TagManager } from './TagDialogs';

export default function TrainingHistory({ tasks, tagState, isZh, renderTask }) {
  const [filter, setFilter] = useState({ tagIds: [], untagged: false });
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState([]);
  const [batchTagIds, setBatchTagIds] = useState([]);
  const [editing, setEditing] = useState(null);
  const [managing, setManaging] = useState(false);
  const [error, setError] = useState('');
  const filtered = useMemo(() => filterTaggedTasks(tasks, { ...filter, search }), [tasks, filter, search]);
  const available = new Set(filtered.map(task => task.id));
  const visibleSelection = selected.filter(id => available.has(id));

  useEffect(() => {
    if (tagState.loading || tagState.error) return;
    const known = new Set(tagState.tags.map(tag => tag.id));
    setFilter(prev => prev.tagIds.some(id => !known.has(id)) ? { ...prev, tagIds: prev.tagIds.filter(id => known.has(id)) } : prev);
    setBatchTagIds(prev => prev.filter(id => known.has(id)));
  }, [tagState.tags, tagState.loading, tagState.error]);

  useEffect(() => { setSelected([]); }, [filter, search]);

  async function batch(operation) {
    setError('');
    try {
      await tagState.mutate(() => updateTrainingTaskTags(visibleSelection, batchTagIds, operation));
      setSelected([]);
      setBatchTagIds([]);
    } catch (err) { setError(err.message); }
  }

  return <div>
    <div className="training-tag-toolbar">
      <input className="training-tag-input" style={{ flex: '1 1 220px' }} type="search" aria-label={isZh ? '搜索模型名称' : 'Search model names'} placeholder={isZh ? '搜索模型名称' : 'Search model names'} value={search} onChange={event => { setSelected([]); setSearch(event.target.value); }} />
      <button className="training-tag-button" disabled={tagState.scope === null || tagState.busy} onClick={() => setManaging(true)}>{isZh ? '管理标签' : 'Manage tags'}</button>
    </div>
    <TagFilter tags={tagState.tags} {...filter} isZh={isZh} disabled={tagState.loading || tagState.busy} onChange={next => { setSelected([]); setFilter(next); }} />
    {tagState.loading && <div role="status" className="training-tag-hint">{isZh ? '正在加载标签…' : 'Loading tags…'}</div>}
    {tagState.error && <div role="alert" className="training-tag-toolbar" style={{ color: C.mars }}>
      {tagState.error}<button className="training-tag-button" onClick={() => tagState.refresh().catch(() => {})}>{isZh ? '重试' : 'Retry'}</button>
    </div>}
    <div className="training-tag-toolbar" style={{ margin: '14px 0' }}>
      <button className="training-tag-button" disabled={!filtered.length || tagState.busy} onClick={() => setSelected(filtered.map(task => task.id))}>{isZh ? '全选当前结果' : 'Select visible'}</button>
      <button className="training-tag-button" disabled={!visibleSelection.length || tagState.busy} onClick={() => setSelected([])}>{isZh ? '清空选择' : 'Clear selection'}</button>
      <span className="training-tag-hint" role="status">{isZh ? `显示 ${filtered.length} / ${tasks.length}，已选 ${visibleSelection.length}` : `Showing ${filtered.length} / ${tasks.length}, ${visibleSelection.length} selected`}</span>
    </div>
    {visibleSelection.length > 0 && <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, marginBottom: 14 }}>
      <TagPicker tags={tagState.tags} value={batchTagIds} onChange={setBatchTagIds} isZh={isZh} label={isZh ? '批量调整标签' : 'Edit tags in bulk'} disabled={tagState.busy || tagState.loading} />
      <div className="training-tag-toolbar">
        <button className="training-tag-button" disabled={tagState.busy || !batchTagIds.length} onClick={() => batch('add')}>{isZh ? '添加所选标签' : 'Add selected tags'}</button>
        <button className="training-tag-button" disabled={tagState.busy || !batchTagIds.length} onClick={() => batch('remove')}>{isZh ? '移除所选标签' : 'Remove selected tags'}</button>
      </div>
    </div>}
    {error && <div role="alert" style={{ color: C.mars }}>{error}</div>}
    <div style={{ display: 'grid', gap: 14 }}>
      {filtered.map(task => renderTask(task, <div className="training-tag-toolbar" onClick={event => event.stopPropagation()} style={{ marginBottom: 12 }}>
        <label className="training-tag-option">
          <input type="checkbox" checked={visibleSelection.includes(task.id)} disabled={tagState.busy} aria-label={isZh ? `选择模型 ${task.custom_model_name || task.id}` : `Select model ${task.custom_model_name || task.id}`} onChange={event => setSelected(prev => event.target.checked ? [...new Set([...prev, task.id])] : prev.filter(id => id !== task.id))} />
          {isZh ? '选择' : 'Select'}
        </label>
        <TagChips tags={task.tags} />
        {!task.tags?.length && <span className="training-tag-hint">{isZh ? '未分组' : 'Untagged'}</span>}
        <button className="training-tag-button" style={{ marginLeft: 'auto' }} disabled={tagState.busy || tagState.loading || Boolean(tagState.error)} onClick={() => setEditing(task)}>{isZh ? '编辑标签' : 'Edit tags'}</button>
      </div>))}
    </div>
    {!filtered.length && <div style={{ padding: 32, textAlign: 'center', color: C.ice60 }}>
      {tasks.length ? (isZh ? '没有匹配的模型，请调整筛选条件。' : 'No matching models. Adjust your filters.') : (isZh ? '暂无训练记录。启动训练后，可在此整理模型。' : 'No training records yet. Start a training run to organize models here.')}
    </div>}
    {managing && <TagManager state={tagState} isZh={isZh} onClose={() => setManaging(false)} />}
    {editing && <EditTaskTagsDialog title={isZh ? `编辑标签 · ${editing.custom_model_name || editing.id}` : `Edit tags · ${editing.custom_model_name || editing.id}`} initialIds={(editing.tags || []).map(tag => tag.id)} state={tagState} isZh={isZh} onClose={() => setEditing(null)} onSave={ids => tagState.mutate(() => replaceTrainingTaskTags(editing.id, ids))} />}
  </div>;
}
