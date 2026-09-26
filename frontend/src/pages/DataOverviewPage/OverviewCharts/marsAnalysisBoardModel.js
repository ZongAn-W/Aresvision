import {
  convertOzone, ozoneLabel, convertTemp, tempLabel, convertWind, windLabel,
} from '../../../utils/units.js';

const VARIABLE_COLOR = '#6aa9ff';
const OZONE_COLOR = '#ff9b70';
const LATITUDE_BANDS = [
  { min: 60, max: 90, zh: '北极区 60–90°N', en: 'Polar north 60–90°N' },
  { min: 30, max: 60, zh: '北中纬 30–60°N', en: 'Northern midlatitudes 30–60°N' },
  { min: -30, max: 30, zh: '赤道区 30°S–30°N', en: 'Equatorial 30°S–30°N' },
  { min: -60, max: -30, zh: '南中纬 30–60°S', en: 'Southern midlatitudes 30–60°S' },
  { min: -90, max: -60, zh: '南极区 60–90°S', en: 'Polar south 60–90°S' },
];
const VARIABLE_NAMES = {
  o3col: ['臭氧柱浓度', 'Ozone column'],
  Temperature: ['温度', 'Temperature'],
  Solar_Flux_DN: ['太阳下行辐射', 'Solar downwelling flux'],
  U_Wind: ['纬向风 U', 'Zonal wind U'],
  V_Wind: ['经向风 V', 'Meridional wind V'],
};

const finite = (value) => Number.isFinite(value) ? value : null;
const hasValues = (values) => values.some(Number.isFinite);

function mean(values) {
  const valid = values.filter(Number.isFinite);
  if (!valid.length) return null;
  // Preserve exact constants before summation can introduce a false variance (e.g. 0.1).
  // Exact equality keeps even adjacent representable values eligible for real variation.
  if (valid.every((value) => value === valid[0])) return valid[0];
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function span(values) {
  const valid = values.filter(Number.isFinite);
  return valid.length ? Math.max(...valid) - Math.min(...valid) : null;
}

function convert(value, variable, units, difference = false) {
  if (!Number.isFinite(value)) return null;
  if (variable === 'o3col') return finite(convertOzone(value, units.ozone));
  if (variable === 'Temperature') return difference ? value : finite(convertTemp(value, units.temperature));
  if (variable === 'U_Wind' || variable === 'V_Wind') return finite(convertWind(value, units.wind));
  return value;
}

function unitLabel(variable, units) {
  if (variable === 'o3col') return ozoneLabel(units.ozone);
  if (variable === 'Temperature') return tempLabel(units.temperature);
  if (variable === 'U_Wind' || variable === 'V_Wind') return windLabel(units.wind);
  return variable === 'Solar_Flux_DN' ? 'W/m²' : '';
}

function variableLabel(variable, isZh) {
  return VARIABLE_NAMES[variable]?.[isZh ? 0 : 1] || variable;
}

function axisLabel(name, unit) {
  return unit ? `${name} (${unit})` : name;
}

function gridFrom(data, variable, units, difference = false) {
  if (!Array.isArray(data?.x) || !Array.isArray(data?.y) || !Array.isArray(data?.z)) {
    return { x: [], y: [], z: [] };
  }
  const x = data.x.map(finite);
  const y = data.y.map(finite);
  // Square grids keep the API's [latitude, x] orientation; transpose only when unambiguous.
  const transpose = x.length !== y.length && data.z.length === x.length
    && data.z.every((row) => Array.isArray(row) && row.length === y.length);
  const z = y.map((lat, rowIndex) => x.map((coordinate, colIndex) => {
    if (lat === null || coordinate === null) return null;
    const value = transpose ? data.z[colIndex]?.[rowIndex] : data.z[rowIndex]?.[colIndex];
    return convert(value, variable, units, difference);
  }));
  return { x, y, z };
}

function meanSeries(grid, rows = grid.y.map((_, index) => index)) {
  return grid.x.map((_, column) => mean(rows.map((row) => grid.z[row]?.[column])));
}

function bandRows(grid, band) {
  // Keep the existing Mars diagnostics' inclusive band boundaries.
  return grid.y.flatMap((latitude, index) => Number.isFinite(latitude)
    && latitude >= band.min && latitude <= band.max ? [index] : []);
}

function panel(id, title, xTitle, yTitle, traces = [], extraLayout = {}) {
  return {
    id, title, data: traces, empty: traces.length === 0,
    layout: {
      xaxis: { title: xTitle, automargin: true },
      yaxis: { title: yTitle, automargin: true },
      showlegend: false,
      ...extraLayout,
    },
  };
}

function lineTrace(x, y, name, color = VARIABLE_COLOR) {
  return { type: 'scatter', mode: 'lines', x: [...x], y: [...y], name, connectgaps: false, line: { color, width: 2.5 } };
}

function barTraces(values, isZh, name) {
  return hasValues(values) ? [{
    type: 'bar', orientation: 'h', x: values,
    y: LATITUDE_BANDS.map((band) => isZh ? band.zh : band.en),
    name, marker: { color: VARIABLE_COLOR },
  }] : [];
}

function temporalBoard(data, variable, units, isZh) {
  const grid = gridFrom(data, variable, units);
  const label = variableLabel(variable, isZh);
  const unit = unitLabel(variable, units);
  const valueAxis = axisLabel(label, unit);
  const lsAxis = isZh ? '太阳黄经 Ls (°)' : 'Solar longitude Ls (°)';
  const latitudeAxis = isZh ? '纬度 (°)' : 'Latitude (°)';
  const annual = meanSeries(grid);
  const amplitudes = LATITUDE_BANDS.map((band) => span(meanSeries(grid, bandRows(grid, band))));
  const seasonTraces = hasValues(grid.z.flat()) ? [{
    type: 'heatmap', x: grid.x, y: grid.y, z: grid.z,
    colorscale: 'Blues', colorbar: { title: valueAxis }, hoverongaps: false,
  }] : [];
  return {
    panels: [
      panel('season', isZh ? `${label}季节分布` : `${label}: seasonal distribution`, lsAxis, latitudeAxis, seasonTraces),
      panel('annual', isZh ? '全年变化 · 等纬度权重均值' : 'Annual cycle · equal latitude mean', lsAxis, valueAxis,
        hasValues(annual) ? [lineTrace(grid.x, annual, label)] : []),
      panel('amplitude', isZh ? '各纬带季节振幅' : 'Seasonal amplitude by latitude band', axisLabel(isZh ? '振幅（最大值 − 最小值）' : 'Amplitude (maximum − minimum)', unit),
        isZh ? '纬带' : 'Latitude band', barTraces(amplitudes, isZh, label), { yaxis: { title: isZh ? '纬带' : 'Latitude band', autorange: 'reversed', automargin: true } }),
    ],
    note: isZh
      ? '曲线为有效纬度行的等权均值，未按面积加权；振幅为各纬带均值在现有 Ls 样本上的最大值减最小值。缺测保留为空，纬带边界沿用单项分析的闭区间。'
      : 'The curve gives each valid latitude row equal weight, without area weighting. Amplitude is the maximum minus minimum band mean over available Ls samples. Missing values remain gaps; band boundaries follow the inclusive intervals used by individual analyses.',
  };
}

function standardize(values) {
  const average = mean(values);
  if (average === null) return values.map(() => null);
  const variance = mean(values.map((value) => Number.isFinite(value) ? (value - average) ** 2 : null));
  if (!(variance > 0)) return values.map(() => null);
  return values.map((value) => Number.isFinite(value) ? finite((value - average) / Math.sqrt(variance)) : null);
}

function linearFit(xs, ys) {
  if (xs.length < 2) return null;
  const averageX = mean(xs);
  const averageY = mean(ys);
  const denominator = xs.reduce((sum, value) => sum + (value - averageX) ** 2, 0);
  if (!(denominator > 0)) return null;
  const slope = xs.reduce((sum, value, index) => sum + (value - averageX) * (ys[index] - averageY), 0) / denominator;
  const x = [Math.min(...xs), Math.max(...xs)];
  const y = x.map((value) => averageY + slope * (value - averageX));
  return y.every(Number.isFinite) ? { x, y } : null;
}

function correlation(xs, ys) {
  if (xs.length < 3) return null;
  const meanX = mean(xs);
  const meanY = mean(ys);
  let xx = 0;
  let yy = 0;
  let xy = 0;
  xs.forEach((value, index) => {
    const dx = value - meanX;
    const dy = ys[index] - meanY;
    xx += dx * dx;
    yy += dy * dy;
    xy += dx * dy;
  });
  return xx > 0 && yy > 0 ? finite(Math.max(-1, Math.min(1, xy / Math.sqrt(xx * yy)))) : null;
}

function uniformSpacing(x) {
  if (x.length < 2 || !x.every(Number.isFinite)) return null;
  const spacing = x[1] - x[0];
  if (!(spacing > 0)) return null;
  return x.slice(1).every((value, index) => Math.abs(value - x[index] - spacing) <= Math.max(1e-8, spacing * 1e-6)) ? spacing : null;
}

function alignSeries(driver, ozone) {
  const driverSeries = meanSeries(driver);
  const ozoneSeries = meanSeries(ozone);
  // Multiple identical Ls coordinates cannot be paired safely without an additional time key.
  const uniqueIndices = (x) => {
    const result = new Map();
    x.forEach((coordinate, index) => {
      if (Number.isFinite(coordinate)) result.set(coordinate, result.has(coordinate) ? null : index);
    });
    return result;
  };
  const driverIndex = uniqueIndices(driver.x);
  const ozoneIndex = uniqueIndices(ozone.x);
  const referenceOrder = new Map([...ozoneIndex.keys()].sort((a, b) => a - b).map((coordinate, index) => [coordinate, index]));
  return driver.x.flatMap((coordinate, index) => {
    const other = ozoneIndex.get(coordinate);
    if (driverIndex.get(coordinate) !== index || !Number.isInteger(other)) return [];
    return [{ ls: coordinate, driver: driverSeries[index], ozone: ozoneSeries[other], driverIndex: index, ozoneIndex: referenceOrder.get(coordinate) }];
  });
}

function lagSeries(aligned, spacing) {
  const maxLag = Math.min(12, Math.max(0, aligned.length - 1));
  const segments = [];
  let segment = 0;
  aligned.forEach((point, index) => {
    const previous = aligned[index - 1];
    if (!Number.isFinite(point.driver) || !Number.isFinite(point.ozone)) {
      segments.push(null);
      segment += 1;
    } else {
      if (previous && (segments[index - 1] === null || point.ls <= previous.ls
        || point.driverIndex !== previous.driverIndex + 1 || point.ozoneIndex !== previous.ozoneIndex + 1)) segment += 1;
      segments.push(segment);
    }
  });
  const x = [];
  const y = [];
  const counts = [];
  for (let lag = -maxLag; lag <= maxLag; lag += 1) {
    const drivers = [];
    const ozone = [];
    aligned.forEach((point, index) => {
      const otherIndex = index + lag;
      if (otherIndex < 0 || otherIndex >= aligned.length || segments[index] === null || segments[index] !== segments[otherIndex]) return;
      drivers.push(point.driver);
      ozone.push(aligned[otherIndex].ozone);
    });
    x.push(lag === 0 ? 0 : lag * (spacing || 1));
    y.push(correlation(drivers, ozone));
    counts.push(drivers.length);
  }
  return { x, y, counts };
}

function driversBoard(data, reference, variable, units, isZh) {
  const driver = gridFrom(data, variable, units);
  const ozone = gridFrom(reference, 'o3col', units);
  const aligned = alignSeries(driver, ozone);
  const label = variableLabel(variable, isZh);
  const ozoneName = variableLabel('o3col', isZh);
  const pairs = aligned.filter((point) => Number.isFinite(point.driver) && Number.isFinite(point.ozone));
  const xs = pairs.map((point) => point.driver);
  const ys = pairs.map((point) => point.ozone);
  const scatterTraces = pairs.length ? [{
    type: 'scatter', mode: 'markers', x: xs, y: ys, name: isZh ? '有效样本' : 'Valid samples',
    customdata: pairs.map((point) => point.ls), marker: { color: VARIABLE_COLOR, size: 7, opacity: 0.75 },
    hovertemplate: `${axisLabel(label, unitLabel(variable, units))}: %{x}<br>${axisLabel(ozoneName, ozoneLabel(units.ozone))}: %{y}<br>Ls: %{customdata}°<extra></extra>`,
  }] : [];
  const fit = linearFit(xs, ys);
  if (fit) scatterTraces.push({ ...lineTrace(fit.x, fit.y, isZh ? '线性拟合' : 'Linear fit', OZONE_COLOR), line: { color: OZONE_COLOR, width: 2, dash: 'dash' }, hoverinfo: 'skip' });
  const x = aligned.map((point) => point.ls);
  const standardizedDriver = standardize(aligned.map((point) => point.driver));
  const standardizedOzone = standardize(aligned.map((point) => point.ozone));
  const evolution = hasValues(standardizedDriver) || hasValues(standardizedOzone) ? [
    lineTrace(x, standardizedDriver, label),
    lineTrace(x, standardizedOzone, ozoneName, OZONE_COLOR),
  ] : [];
  const spacing = uniformSpacing(x);
  const lag = lagSeries(aligned, spacing);
  const lagTraces = hasValues(lag.y) ? [{
    ...lineTrace(lag.x, lag.y, isZh ? 'Pearson 相关系数' : 'Pearson correlation'),
    mode: 'lines+markers', marker: { color: VARIABLE_COLOR, size: 5 }, customdata: lag.counts,
    hovertemplate: `${isZh ? '滞后' : 'Lag'}: %{x}<br>r: %{y:.3f}<br>n: %{customdata}<extra></extra>`,
  }] : [];
  const lagAxis = spacing
    ? (isZh ? '滞后 ΔLs (°)' : 'Lag ΔLs (°)')
    : (isZh ? '滞后（采样步）' : 'Lag (sample steps)');
  return {
    panels: [
      panel('scatter', isZh ? `${label}与臭氧关系` : `${label} and ozone`, axisLabel(label, unitLabel(variable, units)), axisLabel(ozoneName, ozoneLabel(units.ozone)), scatterTraces),
      panel('evolution', isZh ? '标准化协同变化' : 'Standardized co-evolution', isZh ? '太阳黄经 Ls (°)' : 'Solar longitude Ls (°)', 'Z-score', evolution, { showlegend: true }),
      panel('lag', isZh ? '领先与滞后相关' : 'Lead–lag correlation', lagAxis, isZh ? 'Pearson 相关系数 r' : 'Pearson correlation r', lagTraces,
        { yaxis: { title: isZh ? 'Pearson 相关系数 r' : 'Pearson correlation r', range: [-1, 1], automargin: true } }),
    ],
    note: (isZh
      ? '先对有效纬度行等权平均，再按共同 Ls 对齐；散点仅使用成对有效值，Z-score 保留缺测。正滞后表示臭氧晚于所选变量；相关只使用连续有效片段（至少 3 对），不跨缺测或年界，也不代表因果。'
      : 'Equal latitude means are aligned by shared Ls. Scatter uses finite pairs and Z-scores preserve missing values. A positive lag means ozone follows the selected variable. Correlations use continuous valid runs (at least 3 pairs), without crossing missing samples or year boundaries; correlation does not establish causation.')
      + (spacing ? '' : (isZh ? ' Ls 间隔不确定或不均匀，滞后以采样步表示。' : ' Ls spacing is unknown or irregular, so lag is shown in sample steps.')),
  };
}

function dynamicsBoard(data, variable, units, isZh) {
  const grid = gridFrom(data, variable, units, true);
  const unit = unitLabel(variable, units);
  const label = variableLabel(variable, isZh);
  const values = grid.z.flat().filter(Number.isFinite);
  const bound = values.length ? Math.max(...values.map(Math.abs)) : 0;
  const bandValues = LATITUDE_BANDS.map((band) => bandRows(grid, band).flatMap((row) => grid.z[row]).filter(Number.isFinite));
  const rms = bandValues.map((entries) => entries.length ? finite(Math.sqrt(mean(entries.map((value) => value ** 2)))) : null);
  const spans = bandValues.map(span);
  const map = values.length ? [{
    type: 'heatmap', x: grid.x, y: grid.y, z: grid.z, colorscale: 'RdBu', reversescale: true,
    zmid: 0, ...(bound > 0 ? { zmin: -bound, zmax: bound } : {}),
    colorbar: { title: axisLabel(isZh ? `${label}距平` : `${label} anomaly`, unit) }, hoverongaps: false,
  }] : [];
  const latitudeAxis = isZh ? '纬带' : 'Latitude band';
  const bandLayout = { yaxis: { title: latitudeAxis, autorange: 'reversed', automargin: true } };
  return {
    panels: [
      panel('anomaly', isZh ? `${label}纬向距平` : `${label}: zonal anomaly`, isZh ? '经度 (°)' : 'Longitude (°)', isZh ? '纬度 (°)' : 'Latitude (°)', map),
      panel('rms', isZh ? '各纬带异常 RMS' : 'Anomaly RMS by latitude band', axisLabel(isZh ? '异常 RMS' : 'Anomaly RMS', unit), latitudeAxis, barTraces(rms, isZh, label), bandLayout),
      panel('span', isZh ? '各纬带峰谷跨度' : 'Peak-to-peak span by latitude band', axisLabel(isZh ? '峰谷跨度' : 'Peak-to-peak span', unit), latitudeAxis, barTraces(spans, isZh, label), bandLayout),
    ],
    note: isZh
      ? '直接使用纬向距平场，RMS 与峰谷跨度按各纬带的有效空间格点计算，未按面积加权；它们表示空间差异，不是时间波动。温度距平和跨度按温差换算，缺测保留为空。'
      : 'The supplied zonal anomaly field is used directly. RMS and peak-to-peak span use valid spatial cells within each latitude band without area weighting; they describe spatial differences, not temporal variability. Temperature anomalies and spans use temperature differences; missing values remain gaps.',
  };
}

/** Build three Plotly panels from Mars API payloads without mutating source data. */
export function buildMarsAnalysisBoard({ mode, data, reference = null, variable = 'o3col', units = {}, isZh = true } = {}) {
  if (mode === 'drivers') return driversBoard(data, reference, variable, units, isZh);
  if (mode === 'dynamics') return dynamicsBoard(data, variable, units, isZh);
  return temporalBoard(data, variable, units, isZh);
}
