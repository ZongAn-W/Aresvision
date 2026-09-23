import { useId, useState } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import C from '../../constants/colors';
import { createTrainingTag, renameTrainingTag, deleteTrainingTag } from '../../services/api';
import { TagPicker } from './TagControls';
import { isValidTagName } from './trainingTagFilters';

export function TagDialog({ title, busy, onClose, children }) {
  const id = useId();
  return <Dialog open onClose={busy ? undefined : onClose} aria-labelledby={id} maxWidth="sm" fullWidth
    sx={{ zIndex: 9800 }} slotProps={{ paper: { sx: { bgcolor: C.bgCardStrong, color: C.ice, backgroundImage: 'none', border: `1px solid ${C.border}`, borderRadius: 3 } } }}>
    <DialogTitle id={id} sx={{ fontFamily: 'inherit', fontSize: 18 }}>{title}</DialogTitle>
    <div className="training-tag-dialog-body">{children}</div>
  </Dialog>;
}

function TagNameRow({ tag, busy, isZh, onRename, onDelete }) {
  const [name, setName] = useState(tag.name);
  return <form className="training-tag-manager-row" onSubmit={event => { event.preventDefault(); onRename(tag.id, name); }}>
    <input className="training-tag-input" aria-label={isZh ? `标签名称：${tag.name}` : `Tag name: ${tag.name}`} aria-invalid={!isValidTagName(name)} value={name} onChange={event => setName(event.target.value)} disabled={busy} required />
    <button className="training-tag-button" disabled={busy || !isValidTagName(name) || name.trim() === tag.name}>{isZh ? '重命名' : 'Rename'}</button>
    <button type="button" className="training-tag-button" disabled={busy} onClick={() => onDelete(tag)}>{isZh ? '删除' : 'Delete'}</button>
  </form>;
}

export function TagManager({ state, isZh, onClose }) {
  const [name, setName] = useState('');
  const [deleting, setDeleting] = useState(null);
  const [error, setError] = useState('');
  async function save(operation, done) {
    setError('');
    try { await state.mutate(operation); done?.(); }
    catch (err) { setError(err.message); }
  }
  return <TagDialog title={isZh ? '管理我的标签' : 'Manage my tags'} busy={state.busy} onClose={onClose}>
    {deleting ? <>
      <p>{isZh
        ? `删除“${deleting.name}”会从当前账号标记的所有训练记录中移除此标签。模型、参数、日志和权重都会保留。`
        : `Deleting “${deleting.name}” removes this tag from all records you tagged. Models, parameters, logs and weights are kept.`}</p>
      <div className="training-tag-toolbar">
        <button className="training-tag-button" disabled={state.busy} onClick={() => setDeleting(null)}>{isZh ? '返回' : 'Back'}</button>
        <button className="training-tag-button" disabled={state.busy} onClick={() => save(() => deleteTrainingTag(deleting.id), () => setDeleting(null))}>{isZh ? '确认删除标签' : 'Delete tag'}</button>
      </div>
    </> : <>
      <p className="training-tag-hint">{isZh ? '标签仅自己可见，一个模型可拥有多个标签。名称去除首尾空格后需为 1–64 个字符。' : 'Tags are private to your account. A model can have multiple tags. Names must contain 1–64 characters after trimming.'}</p>
      <form className="training-tag-toolbar" onSubmit={event => { event.preventDefault(); save(() => createTrainingTag(name.trim()), () => setName('')); }}>
        <input autoFocus className="training-tag-input" aria-label={isZh ? '新标签名称' : 'New tag name'} placeholder={isZh ? '例如：沙尘实验' : 'For example: Dust experiment'} value={name} aria-invalid={Boolean(name) && !isValidTagName(name)} required disabled={state.busy} onChange={event => setName(event.target.value)} />
        <button className="training-tag-button" disabled={state.busy || !isValidTagName(name)}>{isZh ? '新建标签' : 'Create tag'}</button>
      </form>
      <div style={{ maxHeight: '45vh', overflowY: 'auto' }}>
        {state.tags.map(tag => <TagNameRow key={`${tag.id}:${tag.name}`} tag={tag} busy={state.busy} isZh={isZh} onRename={(id, value) => save(() => renameTrainingTag(id, value.trim()))} onDelete={tag => { setDeleting(tag); setError(''); }} />)}
      </div>
      <button type="button" className="training-tag-button" disabled={state.busy} onClick={onClose}>{isZh ? '完成' : 'Done'}</button>
    </>}
    {error && <div role="alert" style={{ color: C.mars }}>{error}</div>}
  </TagDialog>;
}

export function EditTaskTagsDialog({ title, initialIds = [], state, isZh, onClose, onSave }) {
  const [ids, setIds] = useState(initialIds);
  const [error, setError] = useState('');
  return <TagDialog title={title} busy={state.busy} onClose={onClose}>
    <TagPicker tags={state.tags} value={ids.filter(id => state.tags.some(tag => tag.id === id))} onChange={setIds} isZh={isZh} disabled={state.busy || state.loading}
      onCreate={name => state.mutate(() => createTrainingTag(name))} />
    {error && <div role="alert" style={{ color: C.mars }}>{error}</div>}
    <div className="training-tag-toolbar" style={{ justifyContent: 'flex-end' }}>
      <button className="training-tag-button" disabled={state.busy} onClick={onClose}>{isZh ? '取消' : 'Cancel'}</button>
      <button className="training-tag-button" disabled={state.busy || state.loading} onClick={async () => {
        setError('');
        try { await onSave(ids.filter(id => state.tags.some(tag => tag.id === id))); onClose(); }
        catch (err) { setError(err.message); }
      }}>{state.busy ? (isZh ? '正在保存…' : 'Saving…') : (isZh ? '保存标签' : 'Save tags')}</button>
    </div>
  </TagDialog>;
}
