import { useEffect, useId, useState } from 'react';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import MoreHorizRoundedIcon from '@mui/icons-material/MoreHorizRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import ScienceOutlinedIcon from '@mui/icons-material/ScienceOutlined';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import { fetchEarthDiagnosticContext } from '../../services/earthPredict.js';
import { isEarthTask } from '../PredictPage/earthPredictModel.js';
import { earthDiagnosticTaskAvailability, earthDiagnosticErrorText } from '../PredictPage/earthDiagnosticsModel.js';
import { canUseTaskForPrediction, isRetiredEarthTask } from './experimentCenterModel';

export default function ExperimentMatrixActions({
  task, active, userId, isZh, isProcessing, onSelectTask, onCopyConfig, onPredict, onTest, onDelete,
}) {
  const [anchor, setAnchor] = useState(null);
  const [testCheck, setTestCheck] = useState(null);
  const [revision, setRevision] = useState(0);
  const buttonId = useId();
  const menuId = useId();
  const open = Boolean(anchor) && active;
  const earth = isEarthTask(task);
  const localTest = earthDiagnosticTaskAvailability(task, isZh);
  const identity = JSON.stringify([userId, task.id, task.status, task.model_available,
    task.dataset_id, task.dataset_version, task.dataset_fingerprint, task.checkpoint_sha256,
    task.output_model_path, task.hyperparameters]);

  useEffect(() => { if (!active) setAnchor(null); }, [active]);
  useEffect(() => {
    setTestCheck(null);
    if (!open || !earth || !localTest.available) return undefined;
    const controller = new AbortController();
    fetchEarthDiagnosticContext(task.id, { signal: controller.signal })
      .then((context) => {
        if (!controller.signal.aborted) setTestCheck({ identity, available: context.available === true,
          reason: context.available ? '' : earthDiagnosticErrorText(context) });
      })
      .catch((error) => {
        if (!controller.signal.aborted) setTestCheck({ identity, available: false,
          reason: earthDiagnosticErrorText(error, isZh ? '核验失败，请重新核验。' : 'Verification failed. Try again.') });
      });
    return () => controller.abort();
  }, [open, earth, localTest.available, identity, task.id, isZh, revision]);

  const verified = testCheck?.identity === identity ? testCheck : null;
  const testAvailable = localTest.available && (!earth || verified?.available === true);
  const testReason = !localTest.available ? localTest.reason
    : earth && !verified ? (isZh ? '正在核验数据与模型产物…' : 'Checking data and model artifact…')
      : verified?.reason || '';
  const predictionAvailable = canUseTaskForPrediction(task);
  const predictionReason = predictionAvailable ? '' : isRetiredEarthTask(task)
    ? (isZh ? '日频地球数据集已停用。' : 'Daily Earth datasets are retired.')
    : task.status !== 'completed'
      ? (isZh ? '只有已完成的实验可以预测。' : 'Only completed experiments can be used for prediction.')
      : (isZh ? '模型权重不可用。' : 'Model weights are unavailable.');
  const deletable = ['completed', 'failed', 'cancelled'].includes(task.status);
  const deleteReason = deletable ? ''
    : (isZh ? '请先取消排队或停止训练。' : 'Cancel the queue or stop training first.');
  const run = (callback, value) => { setAnchor(null); callback?.(value); };

  return <div className="experiment-matrix-row-actions" onClick={(event) => event.stopPropagation()}>
    <button type="button" className="experiment-matrix-icon-button" title={isZh ? '查看详情' : 'View details'} aria-label={isZh ? '查看详情' : 'View details'} onClick={() => onSelectTask?.(task.id)}><OpenInNewRoundedIcon fontSize="small" /></button>
    <button type="button" className="experiment-matrix-icon-button" title={isZh ? '复制配置' : 'Copy configuration'} aria-label={isZh ? '复制配置' : 'Copy configuration'} disabled={isProcessing} onClick={() => onCopyConfig?.(task)}><ContentCopyRoundedIcon fontSize="small" /></button>
    <button id={buttonId} type="button" className="experiment-matrix-icon-button" title={isZh ? '更多操作' : 'More actions'} aria-label={isZh ? '更多操作' : 'More actions'} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined} disabled={isProcessing} onClick={(event) => setAnchor(event.currentTarget)}><MoreHorizRoundedIcon fontSize="small" /></button>
    <Menu id={menuId} anchorEl={anchor} open={open} onClose={() => setAnchor(null)}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      marginThreshold={12} disableScrollLock sx={{ zIndex: 9800 }}
      slotProps={{ paper: { className: 'experiment-matrix-action-menu' }, list: { 'aria-labelledby': buttonId } }}>
      <MenuItem disabled={isProcessing || !predictionAvailable} onClick={() => run(onPredict, task)}>
        <PlayArrowRoundedIcon fontSize="small" /><div><span>{isZh ? '用于预测' : 'Use for prediction'}</span>{predictionReason ? <small>{predictionReason}</small> : null}</div>
      </MenuItem>
      <MenuItem disabled={isProcessing || !testAvailable} onClick={() => run(onTest, task.id)}>
        <ScienceOutlinedIcon fontSize="small" /><div><span>{isZh ? '模型测试' : 'Test model'}</span>{testReason ? <small>{testReason}</small> : null}</div>
      </MenuItem>
      {earth && localTest.available && verified?.available === false ? <MenuItem disabled={isProcessing} onClick={() => setRevision((value) => value + 1)}>
        <RefreshRoundedIcon fontSize="small" /><span>{isZh ? '重新核验' : 'Check again'}</span>
      </MenuItem> : null}
      <MenuItem className="experiment-matrix-delete-action" disabled={isProcessing || !deletable} onClick={() => run(onDelete, task.id)}>
        <DeleteOutlineRoundedIcon fontSize="small" /><div><span>{isZh ? '删除实验记录' : 'Delete experiment record'}</span>{deleteReason ? <small>{deleteReason}</small> : null}</div>
      </MenuItem>
    </Menu>
  </div>;
}
