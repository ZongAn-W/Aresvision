import React from 'react';
import Plot from 'react-plotly.js';
import C from '../../constants/colors';
import { useT } from '../../i18n';
import { useSettings } from '../../contexts/SettingsContext';
import { convertOzone, ozoneLabel } from '../../utils/units';
import ResearchExportButton from './ResearchExportButton';
import { currentStepScatter } from './researchExportModel';

export default function ErrorDistributionChart({ 
  data, 
  predictionResult,
  step = 0,
  loading,
  isLight,
  plotTextColor,
  plotText60,
  plotGridColor
}) {
  const t = useT();
  const { settings } = useSettings();
  const unit = settings.units.ozone;
  const unitLabel = ozoneLabel(unit);
  const zh = settings.language !== 'en';
  const scatter = currentStepScatter(predictionResult, step, unit) || { trues: [], preds: [] };
  if (!data && !loading) return null;

  if (loading || !data) {
    const skeletonBg = isLight ? 'bg-gray-100' : 'bg-white/5';
    const skeletonBorder = isLight ? 'border-gray-200' : 'border-gray-800';
    return (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 w-full h-[350px]">
        {[1, 2, 3].map((item) => (
          <div 
            key={item} 
            className={`animate-pulse ${skeletonBg} rounded-xl border ${skeletonBorder} backdrop-blur-sm h-full w-full min-h-[300px]`} 
          />
        ))}
      </div>
    );
  }

  // Basic Dark/Cyborg chart layout configuration (Minimalist Science Fiction)
  const baseLayout = {
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { color: plotTextColor, family: 'Inter, system-ui, sans-serif' },
    margin: { t: 30, r: 20, l: 45, b: 40 },
    xaxis: { 
      gridcolor: plotGridColor, 
      zerolinecolor: plotGridColor,
      tickfont: { size: 9, color: plotText60 },
      showline: false,
    },
    yaxis: { 
      gridcolor: plotGridColor, 
      zerolinecolor: plotGridColor,
      tickfont: { size: 9, color: plotText60 },
      showline: false,
    },
    autosize: true
  };

  const getCenters = (edges) => edges.slice(0, -1).map((e, i) => (e + edges[i+1]) / 2);

  // Ordinary scatter of every current-step cell; no fabricated density.
  const scatterTrace = {
    x: scatter.trues,
    y: scatter.preds,
    mode: 'markers',
    type: 'scatter',
    marker: {
      color: '#0072BD',
      size: 3,
      opacity: 0.8,
      showscale: false
    },
    name: zh ? '当前预测步格点' : 'Current-step grid cells'
  };

  const minVal = [...scatter.trues, ...scatter.preds].reduce((value, next) => Math.min(value, next), Infinity);
  const maxVal = [...scatter.trues, ...scatter.preds].reduce((value, next) => Math.max(value, next), -Infinity);
  const baselineTrace = {
    x: [minVal, maxVal],
    y: [minVal, maxVal],
    mode: 'lines',
    type: 'scatter',
    line: { color: 'rgba(248, 113, 113, 0.8)', dash: 'dash', width: 2 }, // Red-400
    name: 'y = x',
    showlegend: false
  };

  // --- Card 2 Data: Dual-Histogram Overlay ---
  const trueHist = {
    x: getCenters(data.hist_trues.bin_edges).map((v) => convertOzone(v, unit)),
    y: data.hist_trues.counts,
    type: 'bar',
    name: t('ai.errorDistribution.trueLabel'),
    marker: { color: 'rgba(56, 189, 248, 0.6)' }, // Sky-400
    opacity: 0.8
  };
  const predHist = {
    x: getCenters(data.hist_preds.bin_edges).map((v) => convertOzone(v, unit)),
    y: data.hist_preds.counts,
    type: 'bar',
    name: t('ai.errorDistribution.predLabel'),
    marker: { color: 'rgba(52, 211, 153, 0.6)' }, // Emerald-400
    opacity: 0.8
  };

  // --- Card 3 Data: Error Histogram ---
  const errorHist = {
    x: getCenters(data.hist_errors.bin_edges).map((v) => convertOzone(v, unit)),
    y: data.hist_errors.counts,
    type: 'bar',
    name: t('ai.errorDistribution.error'),
    marker: { color: 'rgba(167, 139, 250, 0.8)' }, // Violet-400
  };
  
  const maxErrorCount = Math.max(...data.hist_errors.counts);
  const zeroErrorLine = {
    type: 'line',
    x0: 0, x1: 0,
    y0: 0, y1: maxErrorCount * 1.05,
    line: { color: 'rgba(248, 113, 113, 0.8)', width: 2, dash: 'dash' }
  };

    const cardBg = isLight ? 'bg-white/60' : 'bg-black/40';
    const cardBorder = isLight ? 'border-gray-200' : 'border-gray-800';
    const cardShadow = isLight ? 'shadow-sm' : 'shadow-[0_0_20px_rgba(0,0,0,0.4)]';
    const headerColor = isLight ? 'text-gray-500' : 'text-gray-400';

    return (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 w-full">
        {/* Density Scatter Plot */}
        <div className={`${cardBg} border ${cardBorder} ${cardShadow} p-4 rounded-xl flex flex-col backdrop-blur-md relative overflow-hidden group`}>
          <h3 className={`${headerColor} font-semibold text-xs mb-1 tracking-widest uppercase`}>{t('ai.errorDistribution.trueVsPred')}</h3>
          <p style={{ fontSize: 11 }}>{zh ? `当前预测步 ${step + 1} · 普通散点` : `Forecast step ${step + 1} · ordinary scatter`}</p>
          <ResearchExportButton sources={[predictionResult?.export_ref]} kind="scatter" step={step} disabled={loading} />
        <div className="flex-1 w-full min-h-[250px] relative z-10">
          <Plot
            data={[scatterTrace, baselineTrace]}
            layout={{ 
              ...baseLayout, 
              xaxis: { ...baseLayout.xaxis, range: Number.isFinite(minVal) ? [minVal, maxVal] : undefined, title: { text: `${zh ? '参考' : 'Reference'} (${unitLabel})`, font: { size: 11 } } },
              yaxis: { ...baseLayout.yaxis, scaleanchor: 'x', scaleratio: 1, range: Number.isFinite(minVal) ? [minVal, maxVal] : undefined, title: { text: `${zh ? '预测' : 'Prediction'} (${unitLabel})`, font: { size: 11 } } },
              showlegend: false
            }}
            useResizeHandler
            className="w-full h-full"
            config={{ displayModeBar: false, responsive: true }}
          />
        </div>
      </div>

      {/* Distribution Comparison Plot */}
      <div className={`${cardBg} border ${cardBorder} ${cardShadow} p-4 rounded-xl flex flex-col backdrop-blur-md relative overflow-hidden`}>
        <h3 className={`${headerColor} font-semibold text-xs mb-1 tracking-widest uppercase`}>{t('ai.errorDistribution.distMatch')}</h3>
        <p style={{ fontSize: 11 }}>{zh ? `完整测试集 · ${unitLabel}` : `Full test set · ${unitLabel}`}</p>
        <div className="flex-1 w-full min-h-[250px] relative z-10">
          <Plot
            data={[trueHist, predHist]}
            layout={{ 
              ...baseLayout, 
              barmode: 'overlay',
              xaxis: { ...baseLayout.xaxis, title: unitLabel },
              legend: { orientation: 'h', y: 1.15, x: 0.5, xanchor: 'center', font: { size: 10 } }
            }}
            useResizeHandler
            className="w-full h-full"
            config={{ displayModeBar: false, responsive: true }}
          />
        </div>
      </div>

      {/* Error & RMSE Dashboard */}
      <div className={`${cardBg} border ${cardBorder} ${cardShadow} p-4 rounded-xl flex flex-col backdrop-blur-md relative overflow-hidden`}>
        <div className="flex justify-between items-start mb-1">
          <h3 className={`${headerColor} font-semibold text-xs tracking-widest uppercase`}>{t('ai.errorDistribution.errorHist')}</h3>
          <div className="flex flex-col text-right">
            <span className={`${isLight ? 'text-emerald-600 bg-emerald-50' : 'text-emerald-400 bg-emerald-400/10'} font-mono text-xs font-bold px-1.5 py-0.5 rounded backdrop-blur border ${isLight ? 'border-emerald-200' : 'border-emerald-400/20'}`}>
              RMSE: {convertOzone(data.rmse, unit).toFixed(3)} {unitLabel}
            </span>
            <span className={`${isLight ? 'text-sky-600 bg-sky-50' : 'text-sky-400 bg-sky-400/10'} font-mono text-xs font-bold mt-1 px-1.5 py-0.5 rounded backdrop-blur border ${isLight ? 'border-sky-200' : 'border-sky-400/20'}`}>
              MAE: {convertOzone(data.mae, unit).toFixed(3)} {unitLabel}
            </span>
          </div>
        </div>
        <p style={{ fontSize: 11 }}>{zh ? '完整测试集；残差 = 预测 − 参考' : 'Full test set; residual = prediction - reference'}</p>
        <div className="flex-1 w-full min-h-[250px] relative z-10">
          <Plot
            data={[errorHist]}
            layout={{ 
              ...baseLayout, 
              shapes: [zeroErrorLine],
              showlegend: false,
              xaxis: { ...baseLayout.xaxis, title: { text: `${zh ? '预测减参考' : 'Prediction - reference'} (${unitLabel})`, font: { size: 11 } } }
            }}
            useResizeHandler
            className="w-full h-full"
            config={{ displayModeBar: false, responsive: true }}
          />
        </div>
      </div>
    </div>
  );
}
