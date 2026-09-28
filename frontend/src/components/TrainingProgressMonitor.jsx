import React from 'react';
import C from '../constants/colors';
import { useT } from '../i18n';
import { getTrainingStatusMeta } from '../pages/ModelTrainingPage/trainingStatusMeta';

const TrainingProgressMonitor = ({
  progress = 0,
  currentEpoch = 0,
  totalEpochs = 0,
  loss = null,
  eta = '--:--',
  status = 'running',
}) => {
  const t = useT();
  const percent = Math.min(100, Math.max(0, progress));
  const statusMeta = getTrainingStatusMeta(status, t);

  const metrics = [
    {
      label: t('modelTraining.statsEpoch'),
      value: `${currentEpoch}`,
      suffix: totalEpochs ? `/ ${totalEpochs}` : '',
      color: C.ice,
    },
    {
      label: t('modelTraining.statsLoss'),
      value: loss !== null && Number.isFinite(loss) ? loss.toFixed(4) : '--',
      suffix: '',
      color: C.mars,
    },
    {
      label: t('modelTraining.statsETA'),
      value: eta || '--:--',
      suffix: '',
      color: C.blue,
    },
    {
      label: t('modelTraining.status'),
      value: statusMeta.label,
      suffix: '',
      color: statusMeta.color,
    },
  ];

  return (
    <div
      style={{
        marginTop: 18,
        padding: '18px 18px 16px',
        borderRadius: 18,
        background: C.bgMuted,
        border: `1px solid ${C.border}`,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap',
          marginBottom: 14,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 'calc(11px * var(--font-scale, 1))',
              color: C.ice50,
              marginBottom: 6,
            }}
          >
            {t('modelTraining.statsProgress')}
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              flexWrap: 'wrap',
            }}
          >
            <div
              style={{
                fontSize: 'calc(28px * var(--font-scale, 1))',
                fontWeight: 800,
                color: C.ice,
                fontFamily: 'var(--font-display)',
                letterSpacing: '-0.03em',
              }}
            >
              {percent.toFixed(1)}%
            </div>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 10px',
                borderRadius: 999,
                background: statusMeta.tint,
                border: `1px solid ${statusMeta.border}`,
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: statusMeta.color,
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  fontSize: 'calc(11px * var(--font-scale, 1))',
                  fontWeight: 700,
                  color: statusMeta.color,
                }}
              >
                {statusMeta.label}
              </span>
            </div>
          </div>
        </div>

        <div
          style={{
            fontSize: 'calc(12px * var(--font-scale, 1))',
            color: C.ice50,
            lineHeight: 1.6,
            textAlign: 'right',
          }}
        >
          {totalEpochs > 0 ? `${currentEpoch}/${totalEpochs}` : '--'}
        </div>
      </div>

      <div
        style={{
          height: 10,
          width: '100%',
          borderRadius: 999,
          background: 'rgba(127, 144, 170, 0.16)',
          overflow: 'hidden',
          marginBottom: 16,
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${percent}%`,
            borderRadius: 999,
            background: `linear-gradient(90deg, ${C.mars} 0%, ${C.blue} 100%)`,
            transition: 'width 0.6s ease',
          }}
        />
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
          gap: 10,
        }}
      >
        {metrics.map((metric) => (
          <div
            key={metric.label}
            style={{
              padding: '12px 14px',
              borderRadius: 14,
              background: 'rgba(255,255,255,0.02)',
              border: `1px solid ${C.border}`,
              minWidth: 0,
            }}
          >
            <div
              style={{
                fontSize: 'calc(10px * var(--font-scale, 1))',
                color: C.ice50,
                marginBottom: 6,
                lineHeight: 1.4,
              }}
            >
              {metric.label}
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: 6,
                minWidth: 0,
              }}
            >
              <span
                style={{
                  fontSize: 'calc(16px * var(--font-scale, 1))',
                  fontWeight: 700,
                  color: metric.color,
                  fontFamily: 'var(--font-display)',
                  lineHeight: 1.2,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {metric.value}
              </span>
              {metric.suffix ? (
                <span
                  style={{
                    fontSize: 'calc(11px * var(--font-scale, 1))',
                    color: C.ice50,
                    lineHeight: 1.2,
                  }}
                >
                  {metric.suffix}
                </span>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default TrainingProgressMonitor;
