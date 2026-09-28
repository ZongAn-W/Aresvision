import React from 'react';
import Plot from 'react-plotly.js';
import { useT } from '../i18n';
import C from '../constants/colors';

const LossEvolutionChart = ({ lossHistory, isLight, compact = false, height, title, subtitle, emptyLabel, className }) => {
  const t = useT();
  const trainLoss = lossHistory?.train || [];
  const valLoss = lossHistory?.val || [];
  const epochs = trainLoss.map((_, index) => index + 1);
  const chartHeight = Number.isFinite(height) && height > 0 ? height : (compact ? 220 : 286);
  // Plotly does not resolve CSS color tokens in its SVG layout.
  const plotText = isLight ? 'rgba(23,33,47,0.88)' : 'rgba(222,236,247,0.9)';
  const plotTextMuted = isLight ? 'rgba(23,33,47,0.68)' : 'rgba(222,236,247,0.68)';
  const plotGrid = isLight ? 'rgba(23,33,47,0.08)' : 'rgba(255,255,255,0.08)';

  const data = [
    {
      x: epochs,
      y: trainLoss,
      type: 'scatter',
      mode: 'lines+markers',
      name: t('modelTraining.charts.trainLoss'),
      line: { color: C.mars, width: 2.5, shape: 'spline' },
      marker: { size: 5, color: C.mars },
      hovertemplate: `%{x}: %{y:.4f}<extra>${t('modelTraining.charts.trainLoss')}</extra>`,
    },
    {
      x: epochs,
      y: valLoss,
      type: 'scatter',
      mode: 'lines+markers',
      name: t('modelTraining.charts.valLoss'),
      line: { color: C.blue, width: 2.5, shape: 'spline' },
      marker: { size: 5, color: C.blue },
      hovertemplate: `%{x}: %{y:.4f}<extra>${t('modelTraining.charts.valLoss')}</extra>`,
    },
  ];

  const layout = {
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    autosize: true,
    height: chartHeight,
    margin: { l: 46, r: 18, t: 18, b: 42 },
    showlegend: true,
    legend: {
      orientation: 'h',
      x: 0,
      y: 1.08,
      font: { color: plotText, size: 11 },
    },
    xaxis: {
      title: { text: t('modelTraining.charts.epoch'), font: { color: plotTextMuted, size: 11 } },
      gridcolor: plotGrid,
      tickfont: { color: plotTextMuted, size: 11 },
      color: plotText,
      zeroline: false,
      nticks: compact ? 6 : 10,
      tickformat: ',d',
    },
    yaxis: {
      title: { text: t('modelTraining.charts.loss'), font: { color: plotTextMuted, size: 11 } },
      gridcolor: plotGrid,
      tickfont: { color: plotTextMuted, size: 11 },
      color: plotText,
      zeroline: false,
      rangemode: 'nonnegative',
    },
    hovermode: 'closest',
    font: { family: 'Inter, system-ui, sans-serif', color: plotText },
  };

  return (
    <div
      className={className}
      style={{
        marginTop: compact ? 0 : 18,
        padding: '18px 18px 12px',
        borderRadius: 12,
        background: C.bgMuted,
        border: `1px solid ${C.border}`,
        minWidth: 0,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
          marginBottom: 8,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 'calc(13px * var(--font-scale, 1))',
              fontWeight: 700,
              color: C.ice,
              fontFamily: 'var(--font-display)',
              marginBottom: 4,
            }}
          >
            {title || t('modelTraining.charts.lossTitle')}
          </div>
          {subtitle !== null ? <div
            style={{
              fontSize: 'calc(11px * var(--font-scale, 1))',
              color: C.ice50,
              lineHeight: 1.55,
            }}
          >
            {subtitle ?? (trainLoss.length > 0
              ? t('modelTraining.charts.noMetrics').replace('...', '').replace('…', '')
              : t('modelTraining.charts.noMetrics'))}
          </div> : null}
        </div>
      </div>

      {trainLoss.length === 0 ? (
        <div
          style={{
            height: chartHeight - 76,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: C.ice50,
            fontSize: 'calc(12px * var(--font-scale, 1))',
            fontStyle: 'italic',
            textAlign: 'center',
            padding: '0 12px',
          }}
        >
          {emptyLabel || t('modelTraining.charts.noMetrics')}
        </div>
      ) : (
        <Plot
          data={data}
          layout={layout}
          config={{ displayModeBar: false, responsive: true }}
          useResizeHandler
          style={{ width: '100%' }}
        />
      )}
    </div>
  );
};

export default LossEvolutionChart;
