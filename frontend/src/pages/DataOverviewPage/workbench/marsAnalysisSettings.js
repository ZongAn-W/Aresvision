const fields = {
  'board-temporal': ['variable'],
  'board-drivers': ['variable'],
  'board-dynamics': ['variable'],
  seasonal: ['variable'],
  seasonalExtremes: ['variable'],
  correlation: ['variable'],
  wave: ['variable'],
  solarsens: ['band'],
  realtime: ['band', 'ls'],
};

export function getMarsAnalysisFields(cardKey) {
  return fields[cardKey] || [];
}

export function updateMarsAnalysisSetting(settings, cardKey, field, value) {
  return { ...settings, [cardKey]: { ...settings[cardKey], [field]: value } };
}

export const MARS_ANALYSIS_BANDS = [
  { id: 'Polar North (60N-90N)', zh: '北极区（60°N–90°N）', en: 'North polar (60°N–90°N)' },
  { id: 'Mid-Lat North (30N-60N)', zh: '北中纬（30°N–60°N）', en: 'North mid-latitudes (30°N–60°N)' },
  { id: 'Equatorial (30S-30N)', zh: '赤道区（30°S–30°N）', en: 'Equatorial (30°S–30°N)' },
  { id: 'Mid-Lat South (30S-60S)', zh: '南中纬（30°S–60°S）', en: 'South mid-latitudes (30°S–60°S)' },
  { id: 'Polar South (60S-90S)', zh: '南极区（60°S–90°S）', en: 'South polar (60°S–90°S)' },
];
