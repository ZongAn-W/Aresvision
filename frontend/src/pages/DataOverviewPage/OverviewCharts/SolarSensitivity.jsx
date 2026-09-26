import { useMarsChartSetting } from '../workbench/MarsAnalysisSettings.jsx';
import ChartRequestError, { useChartRequestError } from './ChartRequestError.jsx';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Plot from 'react-plotly.js';
import C from '../../../constants/colors';
import { useSettings } from '../../../contexts/SettingsContext';
import { fetchOverviewSolarPhotochemical } from '../../../services/api';
import useAiInsightRegistration from './useAiInsightRegistration';
import {
  buildOverviewSourceSnapshot,
  correlation,
  sampleInsightSeries,
  summarizeInsightSeries,
} from './aiInsight';
import { formatAdaptiveSeries } from './chartValueFormat';

const BANDS = [
  'Equatorial (30S-30N)',
  'Mid-Lat North (30N-60N)',
  'Mid-Lat South (30S-60S)',
  'Polar North (60N-90N)',
  'Polar South (60S-90S)',
];

export default function SolarSensitivity({ marsYear, overviewSourceParams = {} }) {
  const { settings } = useSettings();

  const isLight = settings?.theme === 'light';
  const plotText = isLight ? 'rgba(23,33,47,0.88)' : 'rgba(236,244,255,0.94)';
  const plotGrid = isLight ? 'rgba(23,33,47,0.12)' : 'rgba(160,196,240,0.16)';

  const isZh = settings.language === 'zh';
  
  const copy = isZh ? {
    title: '太阳-光化学敏感性',
    desc: '分析紫外线辐射对不同纬度带臭氧产生效率的影响。',
    loading: '加载光化学数据...',
    noData: '暂无数据或缺少太阳下行辐射变量',
    solarAxis: '太阳辐射 (W/m²)',
    ozoneAxis: '平均臭氧含量 (m-atm cm)',
    lsColor: '太阳黄经 (°)',
    lsText: '太阳黄经',
    fluxHover: '辐射',
    ozoneHover: '臭氧',
    bands: {
      'Equatorial (30S-30N)': '赤道带 (30°S-30°N)',
      'Mid-Lat North (30N-60N)': '北半球中纬度 (30°N-60°N)',
      'Mid-Lat South (30S-60S)': '南半球中纬度 (30°S-60°S)',
      'Polar North (60N-90N)': '北半球高纬度 (60°N-90°N)',
      'Polar South (60S-90S)': '南半球高纬度 (60°S-90°S)'
    }
  } : {
    title: 'Solar-Photochemical Sensitivity',
    desc: 'Analyze how solar flux drives daytime ozone production efficiency.',
    loading: 'Loading chemical data...',
    noData: 'No Data or Solar_Flux_DN missing',
    solarAxis: 'Solar Flux (W/m²)',
    ozoneAxis: 'Mean Ozone (m-atm cm)',
    lsColor: 'Solar Longitude (°)',
    lsText: 'Ls',
    fluxHover: 'Flux',
    ozoneHover: 'O3',
    bands: {
      'Equatorial (30S-30N)': 'Equatorial (30°S-30°N)',
      'Mid-Lat North (30N-60N)': 'Northern Mid-Lat (30°N-60°N)',
      'Mid-Lat South (30S-60S)': 'Southern Mid-Lat (30°S-60°S)',
      'Polar North (60N-90N)': 'Northern High-Lat (60°N-90°N)',
      'Polar South (60S-90S)': 'Southern High-Lat (60°S-90°S)'
    }
  };
  const relationshipCopy = isZh
    ? {
      title: '太阳辐射-O3 关系',
      desc: '展示太阳下行辐射与 O3 的同季节关联；这是关系探索图，不直接表示光化学因果强度。',
    }
    : {
      title: 'Solar Flux-O3 Relationship',
      desc: 'Explore the seasonal association between downwelling solar flux and O3. This is not a direct causal photochemical efficiency estimate.',
    };

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const { requestError, setRequestError, retryToken, retry } = useChartRequestError();
  const [activeBand, setActiveBand, managed] = useMarsChartSetting('solarsens', 'band', BANDS[0]);

  useEffect(() => {
    let active = true;
    setRequestError(null);
    setLoading(true);
    fetchOverviewSolarPhotochemical(marsYear, activeBand, overviewSourceParams)
      .then((res) => {
        if (active) {
          setData(res);
          setLoading(false);
        }
      })
      .catch((err) => {
        console.error(err);
        if (active) setRequestError(err);
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [retryToken, marsYear, activeBand, overviewSourceParams]);

  const diagnostics = useMemo(() => {
    if (!data?.solar?.length || !data?.ozone?.length) return null;
    return {
      correlation: correlation(data.solar, data.ozone),
      solarUnit: 'W/m²',
      ozoneUnit: 'μm-atm',
      solarStats: summarizeInsightSeries(data.solar),
      ozoneStats: summarizeInsightSeries(data.ozone),
      samplePairs: sampleInsightSeries(data.ozone, data.ls || [], 10).map((item) => {
        const idx = item.index;
        return {
          ls: item.x,
          ozone: item.y,
          solar: Number.isFinite(data.solar[idx]) ? data.solar[idx] : null,
        };
      }),
    };
  }, [data]);

  const aiInsightProvider = useCallback(() => ({
    card: 'solarsens',
    marsYear,
    source: buildOverviewSourceSnapshot(overviewSourceParams),
    activeBand,
    activeBandLabel: copy.bands[activeBand] || activeBand,
    valueMeaning: 'Seasonal association between downwelling solar flux and O3 for the selected latitude band; correlation is exploratory, not direct causality.',
    status: requestError ? 'error' : loading ? 'loading' : (data?.ozone?.length ? 'ready' : 'empty'),
    sampleCount: data?.ozone?.length || 0,
    diagnostics,
  }), [activeBand, copy.bands, data, diagnostics, loading, requestError, marsYear, overviewSourceParams]);

  useAiInsightRegistration('solarsens', aiInsightProvider);
  const ozoneHoverText = useMemo(
    () => formatAdaptiveSeries(data?.ozone || [], { fixedDigits: 4 }),
    [data],
  );

  if (requestError) return <ChartRequestError isZh={isZh} onRetry={retry} />;

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 12 }}>
      {!managed ? (
        <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h3 style={{ color: C.ice, margin: '0 0 4px 0', fontSize: 'calc(16px * var(--font-scale, 1))' }}>{relationshipCopy.title}</h3>
            <p style={{ color: C.ice60, fontSize: 'calc(12px * var(--font-scale, 1))', margin: 0 }}>{relationshipCopy.desc}</p>
          </div>
          <select
            value={activeBand}
            onChange={(e) => setActiveBand(e.target.value)}
            style={{
              background: 'rgba(0,0,0,0.5)',
              border: `1px solid ${C.border}`,
              color: C.ice,
              padding: '4px 8px',
              borderRadius: '4px',
              fontSize: 'calc(11px * var(--font-scale, 1))',
              fontFamily: 'var(--font-body)',
              outline: 'none',
              cursor: 'pointer'
            }}
          >
            {BANDS.map(b => <option key={b} value={b}>{copy.bands[b]}</option>)}
          </select>
        </div>
      ) : null}

      <div style={{ height: '360px', position: 'relative' }}>
        {loading && (
           <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.4)', zIndex: 10 }}>
              <span style={{ color: C.ice }}>{copy.loading}</span>
           </div>
        )}
        
        {(!data || !data.ozone) && !loading ? (
             <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', color: C.ice }}>{copy.noData}</div>
        ) : (
          <Plot
            data={[
              {
                x: data?.solar || [],
                y: data?.ozone || [],
                type: 'scatter',
                mode: 'markers',
                marker: {
                  color: data?.ls || [],
                  colorscale: 'Viridis',
                  size: 6,
                  opacity: 0.7,
                  showscale: true,
                  colorbar: {
                    title: copy.lsColor,
                    titleside: 'right',
                    titlefont: { color: plotText, size: 10  },
                    tickfont: { color: plotText, size: 10  },
                    outlinewidth: 0,
                    xpad: 10
                  }
                },
                text: data?.ls ? data.ls.map(v => `${copy.lsText}: ${v.toFixed(1)}°`) : [],
                customdata: ozoneHoverText,
                hovertemplate: `${copy.fluxHover}: %{x:.1f}<br>${copy.ozoneHover}: %{customdata[0]}<br>%{text}<extra></extra>`
              }
            ]}
            layout={{
              autosize: true,
              paper_bgcolor: 'transparent',
              plot_bgcolor: 'transparent',
              margin: { l: 50, r: 20, t: 20, b: 40 },
              xaxis: {
                title: copy.solarAxis,
                gridcolor: plotGrid,
                tickfont: { color: plotText, size: 10  },
                titlefont: { color: plotText, size: 11  }
              },
              yaxis: {
                title: copy.ozoneAxis,
                gridcolor: plotGrid,
                tickfont: { color: plotText, size: 10  },
                titlefont: { color: plotText, size: 11  }
              }
            }}
            config={{ displayModeBar: false, responsive: true }}
            useResizeHandler
            style={{ width: '100%', height: '100%' }}
          />
        )}
      </div>
    </div>
  );
}
