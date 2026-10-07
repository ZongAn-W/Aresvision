import {
  EARTH_TARGET_UNIT,
  getEarthTrainingProfile,
  describeEarthInputUnits,
  describeEarthSplitSamples,
  getEarthChannelOptions,
} from './earthTrainingConfig';

/**
 * Earth MERRA-2 数据集说明面板。
 *
 * 只展示服务端 registry 与训练契约里的真实数值：日期划分与 profile 窗口样本数由
 * descriptor.splits 推算，通道单位来自固定契约，发布指纹直接显示服务端返回值。
 * 缺包或不可用时仍显示原因，但由父组件禁用提交，不提供伪造日期或坐标。
 */
export default function EarthTrainingDatasetPanel({
  availability,
  selectedChannels,
  copy,
  sectionTitleStyle,
  fieldHintStyle,
}) {
  const profile = getEarthTrainingProfile(availability?.datasetId);
  const splits = describeEarthSplitSamples(availability?.splits, profile.window, profile.horizon);
  const inputUnits = describeEarthInputUnits(selectedChannels);
  const channels = getEarthChannelOptions();
  const shape = availability?.gridShape || availability?.trainingProfile?.grid_shape || profile.gridShape;
  const resolution = shape[0] === 240 ? '0.75° × 0.75°' : '5° × 5°';
  const cadence = profile.frequencyHours === 3 ? '3-hour UTC' : 'daily UTC';

  return (
    <div className="experiment-earth-panel" data-earth-dataset-panel="true">
      <div className="experiment-earth-head">
        <strong>{availability?.displayName || copy.earthDatasetTitle}</strong>
        <span className="experiment-earth-badge" data-earth-version={availability?.datasetVersion || ''}>
          {availability?.datasetVersion ? `v${String(availability.datasetVersion).replace(/^v/, '')}` : '—'}
        </span>
      </div>

      <p className="experiment-expert-note">{copy.earthDatasetNote}</p>

      <dl className="experiment-earth-facts">
        <div>
          <dt>{copy.earthGridLabel}</dt>
          <dd>{`${shape[0]} × ${shape[1]} · ${resolution} · global · ${cadence}`}</dd>
        </div>
        <div>
          <dt>{copy.earthWindowLabel}</dt>
          <dd>{copy.earthWindowValue(profile.window, profile.horizon, profile.frequencyHours)}</dd>
        </div>
        <div>
          <dt>{copy.earthTargetLabel}</dt>
          <dd>{`TO3 · ${EARTH_TARGET_UNIT}`}</dd>
        </div>
        <div>
          <dt>{copy.earthFingerprintLabel}</dt>
          <dd className="experiment-earth-fingerprint" data-earth-fingerprint={availability?.fingerprint || ''}>
            {availability?.fingerprint ? `${availability.fingerprint.slice(0, 12)}…` : copy.earthFingerprintUnavailable}
          </dd>
        </div>
      </dl>

      {/* 只读细节默认收起：网格/窗口/目标/指纹是提交前必须确认的，日期划分与通道
          明细属于参考信息，展开才看。data-* 钩子在收起时仍在 DOM 中。 */}
      <details className="experiment-earth-details" data-earth-details="true">
        <summary className="experiment-expert-heading" data-earth-details-toggle="true">
          {copy.earthDetailsToggle}
        </summary>

        <h4 className="experiment-expert-heading">{copy.earthSplitsTitle}</h4>
        <div className="experiment-earth-splits" data-earth-splits="true">
          {splits.length > 0 ? (
            splits.map((split) => (
              <div className="experiment-earth-split" key={split.name} data-earth-split={split.name}>
                <span>{copy.earthSplitLabels?.[split.name] || split.name}</span>
                <b>{`${split.start} → ${split.end}`}</b>
                <small>{copy.earthSplitSamples(split.days, split.windows)}</small>
              </div>
            ))
          ) : (
            <p className="experiment-expert-note">{copy.earthSplitsUnavailable}</p>
          )}
        </div>

        <h4 className="experiment-expert-heading">{copy.earthChannelsTitle}</h4>
        <p className="experiment-expert-note">{copy.earthChannelsNote}</p>
        <ul className="experiment-earth-channels" data-earth-channels="true">
        <li data-earth-channel="TO3" data-locked="true">
          <span className="experiment-earth-channel-name">Total column ozone</span>
          <b>TO3</b>
          <small>DU</small>
          <em>{copy.earthChannelRequired}</em>
        </li>
        {channels.map((option) => {
          const active = (selectedChannels || []).includes(option.channel);
          return (
            <li
              key={option.channel}
              data-earth-channel={option.channel}
              data-locked="false"
              data-selected={active ? 'true' : 'false'}
            >
              <span className="experiment-earth-channel-name">{option.name}</span>
              <b>{option.short}</b>
              <small>{option.unit}</small>
              <em>{active ? copy.earthChannelSelected : copy.earthChannelOptional}</em>
            </li>
          );
        })}
      </ul>

      <div className="experiment-earth-units" data-earth-input-units="true">
        <span style={fieldHintStyle}>{copy.earthInputUnitsLabel}</span>
        {inputUnits.map((entry) => (
          <code key={entry.channel}>{`${entry.channel} [${entry.unit}]`}</code>
        ))}
      </div>
      </details>

      {availability && !availability.selectable ? (
        <div className="experiment-result-note" data-tone="warning" role="status" data-earth-unavailable="true">
          <strong>{copy.earthUnavailableTitle}</strong>
          <span>{availability.reason || copy.earthUnavailableFallback}</span>
        </div>
      ) : null}

      <p className="experiment-center-hint">{copy.earthLimitationsNote}</p>
    </div>
  );
}
