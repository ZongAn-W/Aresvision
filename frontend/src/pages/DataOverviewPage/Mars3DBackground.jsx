import React, { forwardRef, useMemo } from 'react';
import SphericalFieldCanvas from '../../components/SphericalFieldCanvas';
import { pointsToFieldData } from './fieldGrid';

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
  leftPanelWidth,
  rightPanelWidth,
  solarLongitudeLs,
  onGlobeClick,
  // 视角记忆：与 Earth 共用同一套缓存，切回火星时恢复上次视角。
  poseKey = null,
  restoreCameraPose = true,
}, ref) => {
  const layerFields = useMemo(() => {
    const layers = sceneModel?.layers?.length ? sceneModel.layers : [ozoneData].filter(Boolean);
    return layers
      .map((layer, index) => {
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
        fieldData={fieldData}
        fieldLayers={layerFields}
        colorMode={sceneModel?.colorMode || 'inferno'}
        h="100vh"
        forceFullscreen
        autoRotate={autoRotate}
        showConcentration={showConcentration3D}
        showGeoAnnotations={showGeoAnnotations}
        showMars={showMarsTexture}
        solarLongitudeLs={solarLongitudeLs}
        zoom={3.75} // reduce initial globe size by ~1/3 (visual size becomes ~2/3)
        offsetX={(rightPanelWidth - leftPanelWidth) / 2} // shift object to center it in remaining viewport space
        poseKey={poseKey}
        restoreCameraPose={restoreCameraPose}
        onGlobeClick={onGlobeClick}
      />
    </div>
  );
});

export default Mars3DBackground;
