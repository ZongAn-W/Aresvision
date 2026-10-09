import C from '../../constants/colors';
import { useT } from '../../i18n';
import GlowCard from '../../components/GlowCard';
import { FieldCanvas, LoadingBox, EmptyBox } from './PredictComponents';
import ResearchExportButton from './ResearchExportButton';
import { useSettings } from '../../contexts/SettingsContext';
import { DISPLAY_FIELD_KINDS, predictionPhysicalRange, predictionStepItems } from './predictionDisplayModel';
import './predictionDisplay.css';

function SegmentedTabs({ items, activeId, onChange }) {
  return (
    <div className="prediction-display__tabs">
      {items.map((item) => {
        const active = activeId === item.id;
        return (
          <button
            key={item.id}
            type="button"
            aria-pressed={active}
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
  setFullscreen3D,
  TRIPTYCH_PANELS,
  adapter,
}) {
  const t = useT();
  const { settings } = useSettings();
  const isZh = settings.language !== 'en';
  const physicalRange = predictionPhysicalRange(truthField, predField);
  const currentStep = (results && adapter?.stepLabel?.(results, activeHorizon))
    || (stepLs != null ? `Ls=${stepLs.toFixed(3)}°` : '');
  const defaultPanels = [
    { key: 'truth', title: t('predict.panels.truth'), color: C.blue, mode: 'inferno' },
    { key: 'prediction', title: t('predict.panels.prediction'), color: C.mars, mode: 'inferno' },
    { key: 'residual', title: t('predict.panels.residual'), color: C.purple, mode: 'rdbu' },
  ];
  const panels = DISPLAY_FIELD_KINDS.map((key, index) => ({
    ...(TRIPTYCH_PANELS?.find((panel) => panel.key === key) || defaultPanels[index]), key,
  }));
  const renderField = (fieldData, colorMode, height, colorRange) => adapter?.renderField
    ? adapter.renderField({ fieldData, colorMode, height, colorRange, precision: settings.precision, fullscreen: false })
    : <FieldCanvas fieldData={fieldData} colorMode={colorMode} h={height} colorRange={colorRange} />;
  const openFullscreen = (fieldData, colorMode, kind, colorRange) => setFullscreen3D({
    fieldData, colorMode, kind, colorRange,
  });
  const fieldTitle = (kind) => adapter?.fieldTitle?.(kind, isZh) || t(`predict.panels.${kind}`);

  return (
    <div className="prediction-display" data-testid="prediction-display">
      <SegmentedTabs
        items={VIEW_MODES}
        activeId={viewMode}
        onChange={setViewMode}
      />
      {adapter?.capabilities?.triptychExport !== false && (
        <ResearchExportButton sources={[results?.export_ref]} kind="triptych" step={activeHorizon} disabled={loading} />
      )}

      {results && results.horizon > 1 && (
        <div className="prediction-display__steps">
          <span style={{ fontSize: 'calc(11px * var(--font-scale, 1))', color: C.ice50 }}>
            {t('predict.showStep')}
          </span>
          <SegmentedTabs
            items={predictionStepItems(results, adapter, (i) => `${t('predict.display.stepLabelFunc', { step: i + 1 })}${results.ls_values?.[i] != null ? ` · Ls=${results.ls_values[i].toFixed(3)}°` : ''}`)}
            activeId={String(activeHorizon)}
            onChange={(nextId) => setActiveHorizon(Number(nextId))}
          />
        </div>
      )}

      {viewMode === 'triptych' && (
        <div className="prediction-display__triptych">
          {panels.map((panel, i) => {
            const fieldData = i === 0 ? truthField : i === 1 ? predField : residField;
            return (
              <GlowCard key={panel.key} className="prediction-display__card" style={{ padding: 16 }}>
                <div className="prediction-display__header">
                  <div style={{ color: panel.color, fontSize: 'calc(14px * var(--font-scale, 1))', fontWeight: 700, fontFamily: 'var(--font-display)' }}>
                    {fieldTitle(panel.key)}
                  </div>
                  {currentStep && (
                    <div className="prediction-display__time" style={{ color: C.ice50, fontSize: 'calc(10px * var(--font-scale, 1))' }}>
                      {currentStep}
                    </div>
                  )}
                </div>

                {loading ? (
                  <LoadingBox h={220} />
                ) : fieldData ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {renderField(fieldData, panel.mode, 220, i < 2 ? physicalRange : undefined)}
                    <button
                      type="button"
                      onClick={() => openFullscreen(fieldData, panel.mode, panel.key, i < 2 ? physicalRange : undefined)}
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
                      {adapter?.fullscreenButtonLabel || t('predict.display.viewFullscreen')}
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
        const kind = viewMode === 'original' ? 'truth' : viewMode === 'prediction' ? 'prediction' : 'residual';
        const panelTitle = `${fieldTitle(kind)}${currentStep ? ` · ${currentStep}` : ''}`;
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
                {renderField(fd, isResid ? 'rdbu' : 'inferno', 400, isResid ? undefined : physicalRange)}
                <button
                  type="button"
                  onClick={() => openFullscreen(fd, isResid ? 'rdbu' : 'inferno', kind, isResid ? undefined : physicalRange)}
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
                  {adapter?.fullscreenButtonLabel || t('predict.display.viewFullscreen')}
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
            {isZh ? '场' : 'Field'}
          </div>
          <div style={{ fontSize: 'calc(16px * var(--font-scale, 1))', color: C.ice, marginBottom: 8, fontWeight: 700, fontFamily: 'var(--font-display)' }}>
            {adapter?.emptyTitle || t('predict.initPrompt')}
          </div>
          <div style={{ fontSize: 'calc(12px * var(--font-scale, 1))', color: C.ice50, lineHeight: 1.7, whiteSpace: 'pre-line', maxWidth: 560, margin: '0 auto' }}>
            {adapter?.emptyDescription || t('predict.initDesc')}
          </div>
        </GlowCard>
      )}
    </div>
  );
}
