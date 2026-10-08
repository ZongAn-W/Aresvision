import C from '../../constants/colors';
import { useT } from '../../i18n';
import GlowCard from '../../components/GlowCard';
import { FieldCanvas, LoadingBox, EmptyBox } from './PredictComponents';
import ResearchExportButton from './ResearchExportButton';

function SegmentedTabs({ items, activeId, onChange }) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 8,
        flexWrap: 'wrap',
      }}
    >
      {items.map((item) => {
        const active = activeId === item.id;
        return (
          <button
            key={item.id}
            onClick={() => onChange(item.id)}
            style={{
              padding: '9px 14px',
              background: active ? 'rgba(74,158,255,0.12)' : C.bgMuted,
              border: `1px solid ${active ? C.blue : C.border}`,
              borderRadius: 999,
              fontSize: 'calc(12px * var(--font-scale, 1))',
              fontWeight: active ? 700 : 600,
              color: active ? C.blue : C.ice60,
              cursor: 'pointer',
              transition: 'all 0.2s ease',
            }}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

export default function PredictDisplay({
  viewMode,
  setViewMode,
  VIEW_MODES,
  results,
  activeHorizon,
  setActiveHorizon,
  loading,
  truthField,
  predField,
  residField,
  stepLs,
  stepLabel,
  setFullscreen3D,
  TRIPTYCH_PANELS,
}) {
  const t = useT();

  const physicalRange = truthField && predField ? {
    min: Math.min(truthField.minVal, predField.minVal),
    max: Math.max(truthField.maxVal, predField.maxVal),
  } : null;
  if (physicalRange && physicalRange.min === physicalRange.max) {
    const pad = Math.max(Math.abs(physicalRange.min) * .01, 1e-6);
    physicalRange.min -= pad; physicalRange.max += pad;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <SegmentedTabs
        items={VIEW_MODES}
        activeId={viewMode}
        onChange={setViewMode}
      />
      <ResearchExportButton sources={[results?.export_ref]} kind="triptych" step={activeHorizon} disabled={loading} />

      {results && results.horizon > 1 && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 'calc(11px * var(--font-scale, 1))', color: C.ice50 }}>
            {t('predict.showStep')}
          </span>
          <SegmentedTabs
            items={Array.from({ length: results.horizon }, (_, i) => ({
              id: String(i),
              label: `${t('predict.display.stepLabelFunc', { step: i + 1 })}${results.ls_values?.[i] != null ? ` · Ls=${results.ls_values[i].toFixed(3)}°` : ''}`,
            }))}
            activeId={String(activeHorizon)}
            onChange={(nextId) => setActiveHorizon(Number(nextId))}
          />
        </div>
      )}

      {viewMode === 'triptych' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 16 }}>
          {TRIPTYCH_PANELS.map((panel, i) => {
            const fieldData = i === 0 ? truthField : i === 1 ? predField : residField;
            return (
              <GlowCard key={panel.title} style={{ padding: 16 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    marginBottom: 10,
                  }}
                >
                  <div style={{ color: panel.color, fontSize: 'calc(14px * var(--font-scale, 1))', fontWeight: 700, fontFamily: 'var(--font-display)' }}>
                    {panel.title}
                  </div>
                  {stepLs != null && (
                    <div style={{ color: C.ice50, fontSize: 'calc(10px * var(--font-scale, 1))' }}>
                      Ls={stepLs.toFixed(3)}°
                    </div>
                  )}
                </div>

                {loading ? (
                  <LoadingBox h={220} />
                ) : fieldData ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <FieldCanvas fieldData={fieldData} colorMode={panel.mode} h={220}
                      colorRange={i < 2 ? physicalRange : undefined} />
                    <button
                      onClick={() => setFullscreen3D({ fieldData, colorMode: panel.mode })}
                      style={{
                        width: '100%',
                        padding: '10px 0',
                        background: C.bgMuted,
                        border: `1px solid ${C.borderStrong}`,
                        borderRadius: 10,
                        color: C.ice,
                        fontSize: 'calc(11px * var(--font-scale, 1))',
                        fontWeight: 600,
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                      }}
                    >
                      {t('predict.display.view3d')}
                    </button>
                  </div>
                ) : (
                  <EmptyBox h={220} />
                )}
              </GlowCard>
            );
          })}
        </div>
      )}

      {viewMode !== 'triptych' && (() => {
        const isResid = viewMode === 'diff';
        const fd = viewMode === 'original' ? truthField : viewMode === 'prediction' ? predField : residField;
        const panelTitle = viewMode === 'original'
          ? `${t('predict.panels.truth')}${stepLabel(stepLs)}`
          : viewMode === 'prediction'
            ? `${t('predict.panels.prediction')}${stepLabel(stepLs)}`
            : `${t('predict.panels.residual')}${stepLabel(stepLs)}`;
        const panelColor = viewMode === 'original' ? C.blue : viewMode === 'prediction' ? C.mars : C.purple;

        return (
          <GlowCard style={{ padding: 20 }}>
            <div style={{ color: panelColor, fontSize: 'calc(15px * var(--font-scale, 1))', fontWeight: 700, fontFamily: 'var(--font-display)', marginBottom: 14 }}>
              {panelTitle}
            </div>

            {loading ? (
              <LoadingBox h={400} />
            ) : fd ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <FieldCanvas fieldData={fd} colorMode={isResid ? 'rdbu' : 'inferno'} h={400} />
                <button
                  onClick={() => setFullscreen3D({ fieldData: fd, colorMode: isResid ? 'rdbu' : 'inferno' })}
                  style={{
                    width: '100%',
                    padding: '12px 0',
                    background: C.bgMuted,
                    border: `1px solid ${C.borderStrong}`,
                    borderRadius: 10,
                    color: C.ice,
                    fontSize: 'calc(12px * var(--font-scale, 1))',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                  }}
                >
                  {t('predict.display.viewFullscreen')}
                </button>
              </div>
            ) : (
              <EmptyBox h={400} />
            )}
          </GlowCard>
        );
      })()}

      {!results && !loading && (
        <GlowCard style={{ padding: 28, textAlign: 'center' }}>
          <div style={{ width: 52, height: 52, margin: '0 auto 14px', borderRadius: 14, background: C.bgMuted, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.blue, fontWeight: 800 }}>
            3D
          </div>
          <div style={{ fontSize: 'calc(16px * var(--font-scale, 1))', color: C.ice, marginBottom: 8, fontWeight: 700, fontFamily: 'var(--font-display)' }}>
            {t('predict.initPrompt')}
          </div>
          <div style={{ fontSize: 'calc(12px * var(--font-scale, 1))', color: C.ice50, lineHeight: 1.7, whiteSpace: 'pre-line', maxWidth: 560, margin: '0 auto' }}>
            {t('predict.initDesc')}
          </div>
        </GlowCard>
      )}
    </div>
  );
}
