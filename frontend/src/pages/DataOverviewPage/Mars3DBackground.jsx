import React, { forwardRef, useMemo } from 'react';
import SphericalFieldCanvas from '../../components/SphericalFieldCanvas';
import { pointsToFieldData } from './fieldGrid';
import { marsSunDirection } from '../../components/sphericalFieldLayers.js';
import { useOverviewLayout } from './workbench/OverviewShell.jsx';
import { OVERVIEW_GLOBE } from './workbench/overviewVisualContract.js';

const SOURCE_TINTS = {
  mcd: '#f97316',
  openmars: '#38bdf8',
  nomad: '#34d399',
};

const Mars3DBackground = forwardRef(({
  ozoneData,
  sceneModel,
  is3DMode,
  autoRotate,
  showConcentration3D,
  showGeoAnnotations,
  showMarsTexture,
  showContours = false,
  showWindVectors = false,
  showTerminator = false,
  windFields = null,
  solarLongitudeLs,
  onGlobeClick,
  // 视角记忆：与 Earth 共用同一套缓存，切回火星时恢复上次视角。
  poseKey = null,
  restoreCameraPose = true,
}, ref) => {
  const { offsetX } = useOverviewLayout();
  const layerFields = useMemo(() => {
    const layers = sceneModel?.layers?.length ? sceneModel.layers : [ozoneData].filter(Boolean);
    return layers
      .map((layer, index) => {
        // Anomaly values are transformed once at page level so the particle,
        // contour and legend ranges all share the same zero-centred field.
        const fieldData = pointsToFieldData(layer);
        const source = layer.source || layer.id || `layer-${index}`;
        const isMultiSource = sceneModel?.renderMode === 'multi-source';
        const isValidationPointLayer = sceneModel?.renderMode === 'validation' && source === 'nomad-validation';
        if (!fieldData && !isValidationPointLayer) return null;
        return {
          id: layer.id || source,
          source,
          fieldData,
          points: layer.points || [],
          renderAsPoints: isValidationPointLayer,
          colorMode: sceneModel?.colorMode || 'inferno',
          layerColorMode: layer.colorMode,
          tint: isMultiSource ? SOURCE_TINTS[source] : null,
          radiusOffset: isValidationPointLayer ? 0.18 : (isMultiSource ? index * 0.012 : 0),
        };
      })
      .filter(Boolean);
  }, [ozoneData, sceneModel]);

  const fieldData = layerFields[0]?.fieldData || null;
  const sunDirection = useMemo(
    () => (showTerminator ? marsSunDirection(solarLongitudeLs, 12) : null),
    [showTerminator, solarLongitudeLs],
  );

  if (!fieldData) return null;

  return (
    <div style={{
      position: 'absolute', // Modified to absolute to fit HUD container
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      zIndex: is3DMode ? 10 : 1,
      opacity: is3DMode ? 1 : 0.6,
      transition: 'all 0.8s ease',
      pointerEvents: is3DMode ? 'auto' : 'none',
    }}>
      <SphericalFieldCanvas
        ref={ref}
        planet="mars"
        showBaseMap={false}
        fieldData={fieldData}
        fieldLayers={layerFields}
        colorMode={sceneModel?.colorMode || 'inferno'}
        h="100vh"
        forceFullscreen
        autoRotate={autoRotate}
        showConcentration={showConcentration3D}
        showGeoAnnotations={showGeoAnnotations}
        showMars={showMarsTexture}
        showContours={showContours}
        showWindVectors={showWindVectors}
        showTerminator={showTerminator}
        windFields={windFields}
        solarLongitudeLs={solarLongitudeLs}
        sunDirection={sunDirection}
        zoom={OVERVIEW_GLOBE.zoom} // shared overview framing with the Earth particle globe
        offsetX={offsetX} // shift object to center it in remaining viewport space
        poseKey={poseKey}
        restoreCameraPose={restoreCameraPose}
        particleDensity={OVERVIEW_GLOBE.particleDensity}
        particleSize={OVERVIEW_GLOBE.particleSize}
        pointParticleSize={OVERVIEW_GLOBE.pointParticleSize}
        particlePalette={OVERVIEW_GLOBE.palette}
        globeMaterial="shared"
        lightingMode="seasonal"
        onGlobeClick={onGlobeClick}
      />
    </div>
  );
});

export default Mars3DBackground;
