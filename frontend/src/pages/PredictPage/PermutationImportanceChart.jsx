import Plot from 'react-plotly.js';
import C from '../../constants/colors';
import { useT } from '../../i18n';
import GlowCard from '../../components/GlowCard';
import ResearchExportButton from './ResearchExportButton';
import { useSettings } from '../../contexts/SettingsContext';

export default function PermutationImportanceChart({
  data,
  loading,
  plotTextColor,
  plotGridColor,
  plotText60
}) {
  const t = useT();
  const { settings } = useSettings();

  const chartData = data?.items || [];
  const names = chartData.map(d => t(`predict.variables.${d.name}`) || d.name);
  const values = chartData.map(d => d.importance);

  const trace = {
    x: values,
    y: names,
    type: 'bar',
    orientation: 'h',
    marker: {
      color: values.map((_, i) => i === 0 ? '#4acfac' : C.blue),
      opacity: 0.8,
      line: {
        color: values.map((_, i) => i === 0 ? '#4acfac' : C.blue),
        width: 1
      }
    },
    hovertemplate: t('predict.pfi.hoverTemplate') + '<extra></extra>',
  };

  return (
    <GlowCard style={{ padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 'calc(15px * var(--font-scale, 1))', fontWeight: 700, color: C.ice, fontFamily: 'var(--font-display)' }}>
          {t('predict.pfi.title')}
        </div>
        {data && (
          <div style={{ fontSize: 'calc(11px * var(--font-scale, 1))', color: C.ice50 }}>
            {t('predict.pfi.baselineR2')}<span style={{ color: '#4acfac', fontWeight: 800 }}>{data.baseline_value?.toFixed(4)}</span>
          </div>
        )}
      </div>
      <ResearchExportButton sources={[data?.export_ref]} kind="pfi" disabled={loading} />
      <p style={{ fontSize: 12, color: C.ice60 }}>
        {settings.language === 'en'
          ? `Sampled test set (up to 40 windows${data?.sampling?.sample_size != null ? `; n=${data.sampling.sample_size}` : '; historical sample count unavailable'}); independent of the current prediction window. ΔR² may be negative.`
          : `抽样测试集（最多 40 个窗口${data?.sampling?.sample_size != null ? `；n=${data.sampling.sample_size}` : '；历史缓存未记录样本数'}）；独立于当前预测窗口，ΔR² 可为负。`}
      </p>

      {loading ? (
        <div style={{ height: 300, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, background: 'rgba(255,255,255,0.01)', borderRadius: 12 }}>
          <div style={{ width: 24, height: 24, border: '2px solid rgba(74,207,172,0.2)', borderTop: '2px solid #4acfac', borderRadius: '50%', animation: 'spin-slow 0.8s linear infinite' }} />
          <div style={{ fontSize: 'calc(10px * var(--font-scale, 1))', color: C.ice30 }}>{t('predict.generatingHint')}...</div>
        </div>
      ) : chartData.length > 0 ? (
        <div style={{ background: 'rgba(255,255,255,0.02)', borderRadius: 12, border: `1px solid ${C.border}`, padding: '10px' }}>
          <Plot
            data={[trace]}
            layout={{
              autosize: true,
              height: 280,
              margin: { l: 120, r: 30, t: 10, b: 40 },
              paper_bgcolor: 'rgba(0,0,0,0)',
              plot_bgcolor: 'rgba(0,0,0,0)',
              xaxis: {
                title: { text: 'ΔR²', font: { size: 10, color: plotTextColor } },
                tickfont: { size: 9, color: plotText60 },
                gridcolor: plotGridColor,
                zeroline: true,
                zerolinecolor: plotGridColor,
                zerolinewidth: 1,
              },
              yaxis: {
                autorange: 'reversed',
                tickfont: { size: 10, color: plotTextColor, fontWeight: 600 },
                gridcolor: 'transparent',
              },
              hovermode: 'closest',
            }}
            config={{ displayModeBar: false, responsive: true }}
            style={{ width: '100%' }}
          />
        </div>
      ) : (
        <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.ice30, fontSize: 'calc(11px * var(--font-scale, 1))', border: `1px dashed ${C.border}`, borderRadius: 12 }}>
          {t('predict.pfi.noData')}
        </div>
      )}

      <div style={{ marginTop: 12, fontSize: 'calc(10px * var(--font-scale, 1))', color: C.ice30, lineHeight: 1.5 }}>
        <span style={{ color: C.blue, fontWeight: 700 }}>{t('predict.pfi.helpTitle')}</span> {t('predict.pfi.helpDesc')}
      </div>
    </GlowCard>
  );
}
