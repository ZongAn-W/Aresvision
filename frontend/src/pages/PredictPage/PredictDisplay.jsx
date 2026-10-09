import { useT } from '../../i18n';
import { Button, Panel, SegmentedControl } from '../../components/ui/Controls';
import { FieldCanvas, LoadingBox, EmptyBox } from './PredictComponents';
import ResearchExportButton from './ResearchExportButton';
import { useSettings } from '../../contexts/SettingsContext';
import { DISPLAY_FIELD_KINDS, predictionPhysicalRange, predictionStepItems } from './predictionDisplayModel';
import './predictionDisplay.css';

function SegmentedTabs({ items, activeId, onChange }) {
  return (
    <SegmentedControl className="prediction-display__tabs" value={activeId}
      options={items.map(item => ({ value: item.id, label: item.label }))} onChange={onChange} />
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
    { key: 'truth', title: t('predict.panels.truth'), mode: 'inferno' },
    { key: 'prediction', title: t('predict.panels.prediction'), mode: 'inferno' },
    { key: 'residual', title: t('predict.panels.residual'), mode: 'rdbu' },
  ];
  const panels = DISPLAY_FIELD_KINDS.map((key, index) => ({
    ...(TRIPTYCH_PANELS?.find((panel) => panel.key === key) || defaultPanels[index]), key,
    color: key === 'truth' ? 'var(--brand-ice)' : key === 'prediction' ? 'var(--brand-orange)' : 'var(--status-diagnostic)',
  }));
  const renderField = (fieldData, colorMode, height, colorRange) => adapter?.renderField
    ? adapter.renderField({ fieldData, colorMode, height, colorRange, precision: settings.precision, fullscreen: false })
    : <FieldCanvas fieldData={fieldData} colorMode={colorMode} h={height} colorRange={colorRange} />;
  const openFullscreen = (fieldData, colorMode, kind, colorRange) => setFullscreen3D({
    fieldData, colorMode, kind, colorRange,
  });
  const fieldTitle = (kind) => adapter?.fieldTitle?.(kind, isZh) || t(`predict.panels.${kind}`);

  return (
    <div className="prediction-display" data-testid="prediction-display" data-empty={!results && !loading}>
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
          <span style={{ fontSize: 'calc(var(--type-label) * var(--font-scale, 1))', color: 'var(--text-secondary)' }}>
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
              <Panel key={panel.key} className="prediction-display__card" style={{ padding: 16 }}>
                <div className="prediction-display__header">
                  <div style={{ color: panel.color, fontSize: 'calc(14px * var(--font-scale, 1))', fontWeight: 700, fontFamily: 'var(--font-display)' }}>
                    {fieldTitle(panel.key)}
                  </div>
                  {currentStep && (
                    <div className="prediction-display__time" style={{ color: 'var(--text-secondary)', fontSize: 'calc(var(--type-micro) * var(--font-scale, 1))' }}>
                      {currentStep}
                    </div>
                  )}
                </div>

                {loading ? (
                  <LoadingBox h={220} />
                ) : fieldData ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {renderField(fieldData, panel.mode, 220, i < 2 ? physicalRange : undefined)}
                    <Button
                      type="button"
                      onClick={() => openFullscreen(fieldData, panel.mode, panel.key, i < 2 ? physicalRange : undefined)}
                      className="prediction-display__fullscreen-action"
                    >
                      {adapter?.fullscreenButtonLabel || t('predict.display.viewFullscreen')}
                    </Button>
                  </div>
                ) : (
                  <EmptyBox h={96} />
                )}
              </Panel>
            );
          })}
        </div>
      )}

      {viewMode !== 'triptych' && (() => {
        const isResid = viewMode === 'diff';
        const fd = viewMode === 'original' ? truthField : viewMode === 'prediction' ? predField : residField;
        const kind = viewMode === 'original' ? 'truth' : viewMode === 'prediction' ? 'prediction' : 'residual';
        const panelTitle = `${fieldTitle(kind)}${currentStep ? ` · ${currentStep}` : ''}`;
        const panelColor = viewMode === 'original' ? 'var(--brand-ice)' : viewMode === 'prediction' ? 'var(--brand-orange)' : 'var(--status-diagnostic)';

        return (
          <Panel className="prediction-display__card" style={{ padding: 20 }}>
            <div style={{ color: panelColor, fontSize: 'calc(15px * var(--font-scale, 1))', fontWeight: 700, fontFamily: 'var(--font-display)', marginBottom: 14 }}>
              {panelTitle}
            </div>

            {loading ? (
              <LoadingBox h={400} />
            ) : fd ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {renderField(fd, isResid ? 'rdbu' : 'inferno', 400, isResid ? undefined : physicalRange)}
                <Button
                  type="button"
                  onClick={() => openFullscreen(fd, isResid ? 'rdbu' : 'inferno', kind, isResid ? undefined : physicalRange)}
                  className="prediction-display__fullscreen-action"
                >
                  {adapter?.fullscreenButtonLabel || t('predict.display.viewFullscreen')}
                </Button>
              </div>
            ) : (
              <EmptyBox h={112} />
            )}
          </Panel>
        );
      })()}

      {!results && !loading && (
        <section className="prediction-display__empty" role="status">
          <div className="prediction-display__empty-title">
            {adapter?.emptyTitle || t('predict.initPrompt')}
          </div>
          <div className="prediction-display__empty-description">
            {adapter?.emptyDescription || t('predict.initDesc')}
          </div>
        </section>
      )}
    </div>
  );
}
