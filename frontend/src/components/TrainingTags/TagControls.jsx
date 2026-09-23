import { useId, useState } from 'react';
import C from '../../constants/colors';
import { isValidTagName } from './trainingTagFilters';
import './trainingTags.css';

export function TagChips({ tags = [] }) {
  return <span className="training-tag-chips">{tags.map(tag => (
    <span className="training-tag-chip" key={tag.id}>{tag.name}</span>
  ))}</span>;
}

export function TagPicker({ tags, value, onChange, onCreate, disabled, isZh, label }) {
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const id = useId();
  const normalized = search.trim();
  const matches = tags.filter(tag => tag.name.toLocaleLowerCase().includes(normalized.toLocaleLowerCase()));
  const canCreate = onCreate && isValidTagName(normalized) && !tags.some(tag => tag.name.toLocaleLowerCase() === normalized.toLocaleLowerCase());
  async function create() {
    if (!canCreate || creating) return;
    setCreating(true);
    setError('');
    try {
      const tag = await onCreate(normalized);
      if (tag) { onChange([...new Set([...value, tag.id])]); setSearch(''); }
    } catch (err) { setError(err.message); }
    finally { setCreating(false); }
  }
  return (
    <fieldset className="training-tag-picker" disabled={disabled || creating}>
      <legend>{label || (isZh ? '标签' : 'Tags')}</legend>
      <label className="sr-only" htmlFor={id}>{isZh ? '搜索标签' : 'Search tags'}</label>
      <input id={id} type="search" value={search} onChange={event => { setSearch(event.target.value); setError(''); }} placeholder={isZh ? '搜索标签' : 'Search tags'} className="training-tag-input" />
      <div className="training-tag-options">
        {matches.map(tag => <label key={tag.id} className="training-tag-option">
          <input type="checkbox" checked={value.includes(tag.id)} onChange={event => onChange(event.target.checked ? [...value, tag.id] : value.filter(id => id !== tag.id))} />
          <span>{tag.name}</span>
        </label>)}
        {matches.length === 0 && <span className="training-tag-hint">{isZh ? '没有匹配的标签' : 'No matching tags'}</span>}
      </div>
      {canCreate && <button className="training-tag-button" type="button" onClick={create}>{isZh ? `新建“${normalized}”` : `Create “${normalized}”`}</button>}
      {error && <div role="alert" style={{ color: C.mars }}>{error}</div>}
    </fieldset>
  );
}

export function TagFilter({ tags, tagIds, untagged, onChange, isZh, disabled }) {
  return <div className="training-tag-filter">
    <div className="training-tag-toolbar">
      <button type="button" className="training-tag-button" aria-pressed={!untagged && !tagIds.length} disabled={disabled} onClick={() => onChange({ tagIds: [], untagged: false })}>{isZh ? '全部' : 'All'}</button>
      <button type="button" className="training-tag-button" aria-pressed={untagged} disabled={disabled} onClick={() => onChange({ tagIds: [], untagged: !untagged })}>{isZh ? '未分组' : 'Untagged'}</button>
      <span className="training-tag-hint">{isZh ? '多个标签须同时满足' : 'Match all selected tags'}</span>
    </div>
    <TagPicker tags={tags} value={tagIds} isZh={isZh} disabled={disabled} label={isZh ? '按标签筛选' : 'Filter by tags'} onChange={ids => onChange({ tagIds: ids, untagged: false })} />
  </div>;
}
