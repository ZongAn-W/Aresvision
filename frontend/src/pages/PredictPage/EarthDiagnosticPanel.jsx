import { useMemo, useState } from 'react';
import PredictMetrics from './PredictMetrics.jsx';
import ErrorDistributionChart from './ErrorDistributionChart.jsx';
import PermutationImportanceChart from './PermutationImportanceChart.jsx';
import { createEarthPredictionPresentation } from './predictionPresentation.js';
import { fmtNum } from '../../utils/fmt.js';
import { useSettings } from '../../contexts/SettingsContext.jsx';
import useEarthDiagnostics from './useEarthDiagnostics.js';
import { earthDiagnosticPfiItems } from './earthDiagnosticsModel.js';
import './earthDiagnostics.css';

const jsonLabel = (item) => typeof item === 'string' ? item : item == null ? '—' : JSON.stringify(item);
const timeLabel = (range) => range ? `${range.target_start || range.date_start || range.start || '—'} → ${range.target_end || range.date_end || range.end || '—'}` : '—';

export default function EarthDiagnosticPanel({ taskId, identity, autoLoad = false }) {
  const { settings } = useSettings();
  const isZh = settings.language !== 'en';
  const value = (number) => Number.isFinite(number) ? fmtNum(number, settings.precision) : '—';
  const presentation = useMemo(() => createEarthPredictionPresentation({ settings }), [settings]);
  const fullPresentation = useMemo(() => createEarthPredictionPresentation({ settings, scope: 'full_test' }).metrics, [settings]);
  const samplePresentation = useMemo(() => createEarthPredictionPresentation({ settings, scope: 'sampled_diagnostic' }).metrics, [settings]);
  const label = (zh, en) => isZh ? zh : en;
  const [windows, setWindows] = useState(4);
  const [repeats, setRepeats] = useState(3);
  const options = useMemo(() => ({ sample_windows: windows, pfi_repeats: repeats }), [windows, repeats]);
  const { status, data, error, run } = useEarthDiagnostics(taskId, { identity, options, autoLoad });
  const busy = status === 'checking' || status === 'computing';
  const scope = data?.scope;
  const full = data?.full_test_metrics;
  const fullMetrics = full?.metrics?.overall;
  const pfi = data?.pfi;
  const timeRange = scope?.time_range;
  const rangeText = timeRange ? [timeRange.start || timeRange.input_start || timeRange.target_start,
    timeRange.end || timeRange.target_end].filter(Boolean).join(' → ') || jsonLabel(timeRange) : '—';
  const pfiItems = earthDiagnosticPfiItems(pfi);
  const sampleMetrics = data?.sample_metrics?.overall;

  return <section className="earth-diagnostics" data-earth-diagnostics="true" aria-label={label('地球训练后诊断', 'Earth post-training diagnostics')}>
    <header className="earth-diagnostics-head">
      <div><h3>{label('地球训练后诊断', 'Earth post-training diagnostics')}</h3>
        <p>{label('固定任务 test 分区；指标与诊断均使用反归一化 TO3（DU）。', 'Fixed task test partition; metrics and diagnostics use TO3 in physical DU.')}</p></div>
      <strong className="earth-diagnostic-unit">DU</strong>
    </header>
    <div className="earth-diagnostic-controls">
      <label>{label('诊断窗口数', 'Diagnostic windows')}
        <input type="number" min="1" max="8" value={windows} disabled={busy}
          onChange={(event) => { const n = Number(event.target.value); if (Number.isInteger(n) && n >= 1 && n <= 8) setWindows(n); }} /></label>
      <label>{label('PFI 重复次数', 'PFI repeats')}
        <input type="number" min="1" max="5" value={repeats} disabled={busy}
          onChange={(event) => { const n = Number(event.target.value); if (Number.isInteger(n) && n >= 1 && n <= 5) setRepeats(n); }} /></label>
      <button type="button" disabled={!taskId || busy || status === 'unavailable'} onClick={run}>
        {busy ? label(status === 'checking' ? '核验任务与产物…' : '计算诊断（含 PFI）…', status === 'checking' ? 'Checking task and artifact…' : 'Computing diagnostics (including PFI)…')
          : label(status === 'error' || data ? '重新计算 / 复用缓存' : '计算测试集诊断', status === 'error' || data ? 'Retry / reuse cache' : 'Compute test diagnostics')}
      </button>
      {status === 'unavailable' ? <button type="button" onClick={run}>{label('重新核验', 'Recheck')}</button> : null}
    </div>
    <p className="earth-diagnostic-note">{label('默认 4 个窗口、最多 5,000 对散点、40 个残差分箱、PFI 3 次，固定种子 42。同条件由服务器复用缓存并复核身份。', 'Defaults: 4 windows, up to 5,000 scatter pairs, 40 residual bins, 3 PFI repeats, seed 42. The server reuses identical conditions after rechecking identity.')}</p>
    {busy ? <p role="status" className="earth-diagnostic-status">{label('空间块流式计算中；PFI 耗时随通道数与窗口增加，请等待。', 'Processing spatial blocks; PFI cost grows with channels and windows. Please wait.')}</p> : null}
    {error ? <p role="alert" className="earth-diagnostic-status" data-tone="error">{error}</p> : null}
    {!taskId ? <p className="earth-diagnostic-status">{label('选择已完成且产物有效的地球三小时任务。', 'Select a completed Earth three-hourly task with a valid artifact.')}</p> : null}
    {status === 'ready' ? <p className="earth-diagnostic-status">{label('任务可诊断。诊断取 test 分区，与上方历史预测起点无关。', 'The task is ready. Diagnostics use its test partition independently of the historical forecast origin above.')}</p> : null}
    {data ? <>
      <h4>{label('完整测试集指标', 'Full test-set metrics')}</h4>
      <p className="earth-diagnostic-note">{full?.available === false || !fullMetrics
        ? label('有效 checkpoint 未提供完整测试集指标；缺失项保持未提供，不用抽样结果代替。', 'The valid checkpoint does not provide full test-set metrics. Missing values stay unprovided; sampled metrics do not replace them.')
        : label('复用 checkpoint 保存的完整 test 指标。', 'Reusing full test metrics saved in the checkpoint.')}</p>
      <p className="earth-diagnostic-note">{label('完整测试集范围：', 'Full test partition: ')}{timeLabel(full?.test_range)} · {full?.metrics?.window_count ?? full?.test_range?.window_count ?? '—'} {label('窗口', 'windows')} · {label('任务 / 发布固定划分', 'Fixed task / release partition')}</p>
      <PredictMetrics metrics={{ overall: fullMetrics }} precision={settings.precision} presentation={fullPresentation} />
      <h4>{label('诊断抽样范围', 'Diagnostic sampling scope')}</h4>
      <dl className="earth-diagnostic-facts">
        <div><dt>{label('分区与窗口', 'Partition and windows')}</dt><dd>{`${scope?.split || 'test'} · ${scope?.window_count ?? '—'} / ${scope?.available_window_count ?? '—'}`}</dd></div>
        <div><dt>{label('UTC 时间范围', 'UTC time range')}</dt><dd>{rangeText}</dd></div>
        <div><dt>{label('空间覆盖', 'Spatial coverage')}</dt><dd>{`${label('全球完整网格', 'Complete global grid')} · ${scope?.grid_shape?.join(' × ') || '—'} · ${label('纬度', 'latitude')} ${scope?.spatial_coverage?.latitude_range?.join(' → ') || '—'}° · ${label('经度', 'longitude')} ${scope?.spatial_coverage?.longitude_range?.join(' → ') || '—'}°`}</dd></div>
        <div><dt>{label('有效预测 / 参考对', 'Valid prediction / reference pairs')}</dt><dd>{scope?.valid_points?.toLocaleString() ?? '—'}</dd></div>
        <div><dt>{label('抽样策略', 'Sampling strategy')}</dt><dd>{label('固定种子、窗口无放回抽样，完整提前步与格点', 'Seeded window sampling without replacement, all leads and grid cells')} · seed {scope?.sampling?.seed ?? data.parameters?.seed ?? 42}</dd></div>
        <div><dt>{label('缓存与算法', 'Cache and algorithm')}</dt><dd>{`${label(data.cache?.hit ? '缓存命中' : '本次计算', data.cache?.hit ? 'Cache hit' : 'Computed')} · ${data.cache?.algorithm_version || '—'}`}</dd></div>
      </dl>
      {scope?.windows?.length ? <details className="earth-diagnostic-note"><summary>{label('查看实际测试窗口', 'Inspect sampled test windows')}</summary>
        <ul>{scope.windows.map((window) => <li key={window.test_window_index}>{`#${window.test_window_index} · ${label('起点', 'origin')} ${window.forecast_origin} · ${label('输入', 'input')} ${window.input_start} → ${window.input_end} · ${label('目标', 'target')} ${window.target_start} → ${window.target_end}`}</li>)}</ul>
      </details> : null}
      {data.warnings?.length ? <div className="earth-diagnostic-status" role="status">{data.warnings.map((warning, index) => <p key={index}>{warning}</p>)}</div> : null}
      <h4>{label('相同诊断窗口的指标', 'Metrics for these diagnostic windows')}</h4>
      <p className="earth-diagnostic-note">{label('覆盖所选窗口全部提前步与空间格点；它们是抽样诊断指标，不是散点子样本指标，也不是完整测试集指标。', 'All leads and spatial cells in the selected windows. These are diagnostic-window metrics, distinct from the scatter subsample and full test-set metrics.')}</p>
      <PredictMetrics metrics={{ overall: sampleMetrics }} precision={settings.precision} presentation={samplePresentation} />
      <ErrorDistributionChart data={data} presentation={presentation.distribution} precision={settings.precision} />
      <h4>{label('置换重要性（PFI）', 'Permutation feature importance (PFI)')}</h4>
      <p className="earth-diagnostic-note">{label('主要重要性 = 置换后 RMSE − 基线 RMSE（DU）；保留负值。PFI 表示当前模型在此抽样范围下的输入敏感性，不能解释为因果贡献。每个通道整段历史窗口置换，含历史 TO3；未来目标和参考真值不置换。', 'Importance = permuted RMSE − baseline RMSE (DU), retaining negative values. PFI measures model sensitivity within this sample, not causal contribution. Each input channel, including historical TO3, is permuted as a whole window; future targets and references remain fixed.')}</p>
      {pfi?.status !== 'completed' && pfi?.status !== 'success' ? <p className="earth-diagnostic-status">{jsonLabel(pfi?.reason?.message || pfi?.reason || pfi?.message || label('此范围无法计算 PFI，至少需要两个有效窗口。', 'PFI requires at least two valid windows and a meaningful permutation.'))}</p> : null}
      {pfiItems.length ? <>
        <PermutationImportanceChart data={pfi} presentation={presentation.pfi} precision={settings.precision} />
        <p className="earth-diagnostic-note">{pfi.window_count ?? pfi.scope?.window_count ?? '—'} {label('个相同测试窗口、全部提前步与全球格点；目标 UTC 范围', 'identical test windows, all leads and global cells; target UTC range')} {timeLabel(pfi.scope?.time_range)} · seed {pfi.seed ?? 42}</p>
        <div className="earth-diagnostic-table-scroll"><table>
          <thead><tr>{[label('输入通道', 'Input'), label('基线 RMSE（DU）', 'Baseline RMSE (DU)'), label('均值 ± 标准差（DU）', 'Mean ± std (DU)'), label('每次置换 RMSE（DU）', 'Each permuted RMSE (DU)'), label('每次 RMSE 增量（DU）', 'Each RMSE increase (DU)')].map((text) => <th key={text}>{text}</th>)}</tr></thead>
          <tbody>{pfiItems.map((item) => <tr key={item.channel}><th>{item.channel}</th><td>{value(item.baseline_rmse)}</td><td>{Number.isFinite(item.importance_mean) ? `${value(item.importance_mean)} ± ${value(item.importance_std)}` : jsonLabel(item.reason || label('不可计算', 'Unavailable'))}</td><td>{item.repeats.map((repeat) => typeof repeat === 'number' ? value(repeat) : value(repeat.permuted_rmse ?? repeat.rmse)).join(', ') || '—'}</td><td>{item.repeats.map((repeat) => value(typeof repeat === 'number' ? repeat - item.baseline_rmse : repeat.delta_rmse ?? repeat.importance)).join(', ') || '—'}</td></tr>)}</tbody>
        </table></div>
      </> : null}
      <p className="earth-diagnostic-note">{label('本组诊断图暂未开放科研导出；已有历史预测三联图导出仍消费结果快照，不重新推理。', 'Scientific export is not yet available for these diagnostic plots. Existing forecast triptych export consumes result snapshots without rerunning inference.')}</p>
    </> : null}
  </section>;
}
