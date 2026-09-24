export const OVERVIEW_LAYOUT = Object.freeze({
  navbarHeight: 70,
  leftWidth: 300,
  rightWidth: 540,
  minSceneWidth: 320,
  compactBreakpoint: 1120,
  timelineBottom: 18,
  overlayGap: 14,
});

export const OVERVIEW_SURFACE = Object.freeze({
  darkPanel: 'rgba(10,12,18,0.62)',
  darkPanelStrong: 'rgba(10,12,18,0.82)',
  darkBorder: 'rgba(255,255,255,0.08)',
  lightPanel: 'rgba(255,255,255,0.86)',
  lightBorder: 'rgba(15,23,42,0.10)',
  blur: '20px',
});

// The particle globe keeps one visual baseline for both planets.  Planet
// adapters may still add their own texture, coastline and seasonal lighting.
export const OVERVIEW_GLOBE = Object.freeze({
  zoom: 3.75,
  palette: Object.freeze({ fieldTint: null, pointTint: '#34d399' }),
  particleDensity: 120,
  particleSize: 0.01,
  pointParticleSize: 0.024,
  darkGlobeColor: 0x14304f,
  lightGlobeColor: 0xcddff2,
  globeShininess: 6,
  lightingMode: 'fixed',
});

export function desktopSceneWidth(viewportWidth, left = OVERVIEW_LAYOUT.leftWidth, right = OVERVIEW_LAYOUT.rightWidth) {
  return viewportWidth - left - right;
}

export function shouldUseCompactOverview(viewportWidth) {
  return viewportWidth <= OVERVIEW_LAYOUT.compactBreakpoint;
}
