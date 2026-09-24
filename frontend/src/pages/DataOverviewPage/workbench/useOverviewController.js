/**
 * 共用分析工作台控制器。
 *
 * 一个 controller 实例同时服务 Mars 与 Earth：全部数值语义来自 adapter，
 * controller 只负责请求身份、取消、过期回包拒绝、播放与选择状态。
 *
 * 星球切换时严格按下列顺序执行（与产品要求一致）：
 *  1. 取消旧星球所有在途请求；
 *  2. 清空旧场、旧点位曲线、播放定时器与已选点；
 *  3. 载入新星球默认变量与时间；
 *  4. 递增 cameraEpoch 并切换 geometry 身份，令三维场景重建相机与几何；
 *  5. 旧回包因 epoch/身份不匹配被丢弃，不会写回新星球状态。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  CARD_STATUS,
  MODE_IDS,
  cardError,
  cardIdle,
  cardLoading,
  cardReady,
  cardUnsupported,
  createCardState,
  dateInSelectedYear,
  geometryKey,
  normalizeSelection,
  nextPlaybackValue,
  playbackFinished,
  pointInsideGeometry,
  requestIdentity,
  resolveModeCards,
  sceneIdentity,
  shouldRequestCard,
  timeValueKey,
  timeValues,
  validateOverviewAdapter,
  yearOfIsoDate,
} from './OverviewAdapter.js';
import { createOverviewCoordinator } from './overviewRequestCoordinator.js';
import { dropCameraPose } from '../../../components/SphericalFieldCanvas.jsx';

export const PLAYBACK_DELAY_MS = 600;

const CHANNELS = ['source', 'field', 'regional', 'point'];
function describeError(error) {
  if (!error) return { code: 'invalid_request', message: '' };
  return {
    code: error.code || 'invalid_request',
    message: error.message || '',
    status: error.status ?? 0,
    availabilityReason: error.availabilityReason ?? null,
  };
}

function emptySelection() {
  return { value: null, variable: null, point: null, mode: MODE_IDS[0], year: null };
}

/**
 * @param {object} options
 * @param {object} options.adapter 星球适配器（见 OverviewAdapter.js 契约）。
 * @param {object} [options.initialSelection] 页面层保存的选择，用于切回时恢复。
 * @param {(selection: object) => void} [options.onSelectionChange] 选择变化回写。
 */
export function useOverviewController({ adapter, initialSelection = null, onSelectionChange = null }) {
  const validation = useMemo(() => validateOverviewAdapter(adapter), [adapter]);
  if (!validation.ok) {
    // Fail loudly in development instead of rendering a half-configured scene.
    throw new Error(`Invalid overview adapter: ${validation.errors.join('; ')}`);
  }

  const coordinatorRef = useRef(null);
  if (coordinatorRef.current === null) coordinatorRef.current = createOverviewCoordinator();
  const coordinator = coordinatorRef.current;

  // 场景身份 = 星球 + 数据源 + 发布指纹。身份变化即整场景重置。
  const [resolved, setResolved] = useState(null);
  const [sourceStatus, setSourceStatus] = useState(CARD_STATUS.LOADING);
  const [sourceError, setSourceError] = useState(null);

  const [selection, setSelection] = useState(() => ({ ...emptySelection(), ...(initialSelection || {}) }));
  const [field, setField] = useState(null);
  const [fieldStatus, setFieldStatus] = useState(CARD_STATUS.IDLE);
  const [fieldError, setFieldError] = useState(null);
  const [requestedValue, setRequestedValue] = useState(null);

  const [regionalSeries, setRegionalSeries] = useState(null);
  const [regionalStatus, setRegionalStatus] = useState(CARD_STATUS.IDLE);
  const [regionalError, setRegionalError] = useState(null);

  const [pointSeries, setPointSeries] = useState(null);
  const [pointStatus, setPointStatus] = useState(CARD_STATUS.IDLE);
  const [pointError, setPointError] = useState(null);

  const [playing, setPlaying] = useState(false);
  const [outOfCoverage, setOutOfCoverage] = useState(null);
  const [cameraEpoch, setCameraEpoch] = useState(0);

  const [cardStates, setCardStates] = useState({});
  const [expandedCard, setExpandedCard] = useState('');
  const [cardReloadToken, setCardReloadToken] = useState(0);

  const epochRef = useRef(0);
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  const sourceFingerprint = resolved?.sourceFingerprint ?? null;
  const identity = sceneIdentity({
    planet: adapter.planet,
    sourceId: adapter.sourceId,
    sourceFingerprint,
  });
  const identityRef = useRef(identity);
  identityRef.current = identity;

  const ready = sourceStatus === CARD_STATUS.READY && Boolean(identity);
  const time = resolved?.time ?? null;
  const timeAxis = useMemo(() => timeValues(time), [time]);
  const geometry = resolved?.geometry ?? null;
  const geometryIdentity = useMemo(() => geometryKey(geometry), [geometry]);

  // 年度选择与当前日期保持一致：日期跨年时年度分析自动跟随，切换年度则把日期
  // 平移到目标年的同月同日（闰日取该月最后一天）。Mars 没有该语义，year 为 null。
  const year = useMemo(() => {
    if (time?.kind === 'iso-date' && typeof selection.value === 'string') {
      return yearOfIsoDate(selection.value) ?? selection.year ?? null;
    }
    return selection.year ?? null;
  }, [time, selection.value, selection.year]);

  // ── 1/2/4：身份变化 → 取消旧请求、清空旧状态、重置相机与几何 ──────
  useEffect(() => {
    epochRef.current += 1;
    coordinator.cancelAll();
    setResolved(null);
    setSourceStatus(CARD_STATUS.LOADING);
    setSourceError(null);
    setField(null);
    setFieldStatus(CARD_STATUS.IDLE);
    setFieldError(null);
    setRequestedValue(null);
    setRegionalSeries(null);
    setRegionalStatus(CARD_STATUS.IDLE);
    setRegionalError(null);
    setPointSeries(null);
    setPointStatus(CARD_STATUS.IDLE);
    setPointError(null);
    setPlaying(false);
    setOutOfCoverage(null);
    setCardStates({});
    setExpandedCard('');
    setSelection({ ...emptySelection(), ...(initialSelection || {}) });
    // 相机与几何参数必须一起重置，否则新星球会沿用旧星球的视角。
    setCameraEpoch((value) => value + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adapter.planet, adapter.sourceId]);

  // ── 3：解析数据源，得到新星球的时间、变量、几何、能力与卡片目录 ──
  useEffect(() => {
    const epoch = epochRef.current;
    const request = coordinator.start('source', 'source');
    const signal = request.signal;

    setSourceStatus(CARD_STATUS.LOADING);
    setSourceError(null);
    adapter
      .resolve({ signal })
      .then((model) => {
        if (epoch !== epochRef.current) return;
        if (signal.aborted) return;
        if (!model || model.status === 'unsupported') {
          setResolved(model || null);
          setSourceStatus(CARD_STATUS.UNSUPPORTED);
          return;
        }
        setResolved(model);
        setSourceStatus(CARD_STATUS.READY);
        setSelection((previous) => {
          const next = normalizeSelection(
            { ...model, variables: model.variables, time: model.time, defaults: model.defaults },
            { ...previous, ...(initialSelection || {}) },
          );
          return {
            ...next,
            year: next.year ?? (model.time?.kind === 'iso-date' && next.value
              ? yearOfIsoDate(next.value)
              : null),
          };
        });
      })
      .catch((error) => {
        if (epoch !== epochRef.current) return;
        if (error?.name === 'AbortError') return;
        setResolved(null);
        setSourceStatus(CARD_STATUS.ERROR);
        setSourceError(describeError(error));
      });

    return () => coordinator.cancel('source');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adapter.planet, adapter.sourceId, adapter.resolve, cardReloadToken]);

  // 把选择回写到页面层，使 Earth → Mars → Earth 保留各自选择。
  useEffect(() => {
    if (!onSelectionChange) return;
    onSelectionChange({
      value: selection.value,
      date: adapter.planet === 'earth' ? selection.value : undefined,
      variable: selection.variable,
      point: selection.point,
      mode: selection.mode,
      year: selection.year,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection.value, selection.variable, selection.point, selection.mode, selection.year]);

  // ── 场通道 ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!ready || !selection.value || !selection.variable) {
      setField(null);
      setFieldStatus(CARD_STATUS.IDLE);
      return undefined;
    }
    const epoch = epochRef.current;
    const requestId = requestIdentity([identity, selection.variable, selection.value]);
    const request = coordinator.start('field', requestId);
    setRequestedValue(selection.value);
    setFieldStatus(CARD_STATUS.LOADING);
    setFieldError(null);

    adapter
      .loadField({ value: selection.value, variable: selection.variable, signal: request.signal })
      .then((payload) => {
        if (epoch !== epochRef.current) return;
        if (!coordinator.settle(request)) return;
        if (!adapter.validateField(payload, {
          sourceId: adapter.sourceId,
          sourceFingerprint,
          variable: selection.variable,
          value: selection.value,
        })) {
          setField(null);
          setFieldStatus(CARD_STATUS.ERROR);
          setFieldError({ code: 'invalid_response', message: 'invalid field payload' });
          return;
        }
        setField(adapter.normalizeField ? adapter.normalizeField(payload) : payload);
        setFieldStatus(CARD_STATUS.READY);
      })
      .catch((error) => {
        if (epoch !== epochRef.current) return;
        if (error?.name === 'AbortError') return;
        if (!coordinator.settle(request)) return;
        setField(null);
        setFieldStatus(CARD_STATUS.ERROR);
        setFieldError(describeError(error));
      });

    return () => coordinator.cancel('field');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adapter, identity, ready, selection.value, selection.variable, sourceFingerprint]);

  // ── 区域序列通道 ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!ready || !selection.variable) {
      setRegionalSeries(null);
      setRegionalStatus(CARD_STATUS.IDLE);
      return undefined;
    }
    const epoch = epochRef.current;
    const requestId = requestIdentity([identity, 'regional', selection.variable]);
    const request = coordinator.start('regional', requestId);
    setRegionalStatus(CARD_STATUS.LOADING);
    setRegionalError(null);

    adapter
      .loadRegionalSeries({ variable: selection.variable, signal: request.signal })
      .then((payload) => {
        if (epoch !== epochRef.current) return;
        if (!coordinator.settle(request)) return;
        if (!adapter.validateRegionalSeries(payload, {
          sourceId: adapter.sourceId,
          sourceFingerprint,
          variable: selection.variable,
        })) {
          setRegionalSeries(null);
          setRegionalStatus(CARD_STATUS.ERROR);
          setRegionalError({ code: 'invalid_response', message: 'invalid regional payload' });
          return;
        }
        setRegionalSeries(adapter.normalizeRegionalSeries
          ? adapter.normalizeRegionalSeries(payload)
          : payload);
        setRegionalStatus(CARD_STATUS.READY);
      })
      .catch((error) => {
        if (epoch !== epochRef.current) return;
        if (error?.name === 'AbortError') return;
        if (!coordinator.settle(request)) return;
        setRegionalSeries(null);
        setRegionalStatus(CARD_STATUS.ERROR);
        setRegionalError(describeError(error));
      });

    return () => coordinator.cancel('regional');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adapter, identity, ready, selection.variable, sourceFingerprint]);

  // ── 点位序列通道 ──────────────────────────────────────────────────────
  useEffect(() => {
    const point = selection.point;
    if (!ready || !point || !selection.variable) {
      setPointSeries(null);
      setPointStatus(CARD_STATUS.IDLE);
      return undefined;
    }
    const epoch = epochRef.current;
    const requestId = requestIdentity([identity, 'point', selection.variable, point.lat, point.lon]);
    const request = coordinator.start('point', requestId);
    setPointStatus(CARD_STATUS.LOADING);
    setPointError(null);

    adapter
      .loadPointSeries({
        lat: point.lat, lon: point.lon, variable: selection.variable, signal: request.signal,
      })
      .then((payload) => {
        if (epoch !== epochRef.current) return;
        if (!coordinator.settle(request)) return;
        if (!adapter.validatePointSeries(payload, {
          sourceId: adapter.sourceId,
          sourceFingerprint,
          variable: selection.variable,
        })) {
          setPointSeries(null);
          setPointStatus(CARD_STATUS.ERROR);
          setPointError({ code: 'invalid_response', message: 'invalid point payload' });
          return;
        }
        setPointSeries(adapter.normalizePointSeries
          ? adapter.normalizePointSeries(payload)
          : payload);
        setPointStatus(CARD_STATUS.READY);
      })
      .catch((error) => {
        if (epoch !== epochRef.current) return;
        if (error?.name === 'AbortError') return;
        if (!coordinator.settle(request)) return;
        setPointSeries(null);
        setPointStatus(CARD_STATUS.ERROR);
        setPointError(describeError(error));
      });

    return () => coordinator.cancel('point');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adapter, identity, ready, selection.variable, selection.point, sourceFingerprint]);

  // ── 播放 ──────────────────────────────────────────────────────────────
  const displayedValue = field?.value ?? null;

  useEffect(() => {
    if (!playing || !ready) return undefined;
    const next = nextPlaybackValue({
      time,
      values: timeAxis,
      displayedValue,
      requestedValue: selection.value,
      playing,
      ready,
    });
    if (next === null) {
      // 展示完最后一帧即停止，不循环；"从头重播"由用户显式触发。
      if (displayedValue && playbackFinished({ values: timeAxis, displayedValue })) {
        setPlaying(false);
      }
      return undefined;
    }
    const timer = setTimeout(() => {
      setSelection((previous) => ({ ...previous, value: next }));
    }, PLAYBACK_DELAY_MS);
    return () => clearTimeout(timer);
  }, [displayedValue, playing, ready, selection.value, time, timeAxis]);

  useEffect(() => {
    const onVisibility = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        setPlaying(false);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => () => coordinatorRef.current?.cancelAll(), []);

  // ── 选择动作 ──────────────────────────────────────────────────────────
  const selectValue = useCallback((value) => {
    setPlaying(false);
    setSelection((previous) => ({ ...previous, value }));
  }, []);

  const stepValue = useCallback((delta) => {
    setPlaying(false);
    setSelection((previous) => {
      const index = timeAxis.indexOf(previous.value);
      if (index < 0) return previous;
      const next = index + delta;
      if (next < 0 || next >= timeAxis.length) return previous;
      return { ...previous, value: timeAxis[next] };
    });
  }, [timeAxis]);

  const restart = useCallback(() => {
    if (!timeAxis.length) return;
    setSelection((previous) => ({ ...previous, value: timeAxis[0] }));
    setPlaying(true);
  }, [timeAxis]);

  const selectVariable = useCallback((variable) => {
    if (!resolved?.variables?.some((item) => item.id === variable)) return;
    // 重复选择同一变量不能清空场景：否则重新选中当前项会先清空场与曲线，
    // 图例与展示日期短暂消失。
    if (selectionRef.current.variable === variable) return;
    setPlaying(false);
    // 换变量必须清空旧场与旧曲线，避免温度数值配上 DU 单位。
    setField(null);
    setFieldStatus(CARD_STATUS.IDLE);
    setRegionalSeries(null);
    setRegionalStatus(CARD_STATUS.IDLE);
    setPointSeries(null);
    setPointStatus(CARD_STATUS.IDLE);
    setCardStates({});
    setSelection((previous) => ({ ...previous, variable }));
  }, [resolved]);

  const selectPoint = useCallback((point) => {
    setPlaying(false);
    setOutOfCoverage(null);
    const cell = adapter.cellForPoint
      ? adapter.cellForPoint(geometry, point)
      : point;
    setSelection((previous) => ({
      ...previous,
      point: { lat: cell?.lat ?? point.lat, lon: cell?.lon ?? point.lon, requested: { ...point } },
    }));
  }, [adapter, geometry]);

  const clearPoint = useCallback(() => {
    setSelection((previous) => ({ ...previous, point: null }));
    setPointSeries(null);
    setPointStatus(CARD_STATUS.IDLE);
  }, []);

  const markOutOfCoverage = useCallback((detail = null) => {
    // 区域外只提示，不清空已有点位，也不发点位请求。
    setPlaying(false);
    setOutOfCoverage(detail || { code: 'point_outside_coverage' });
  }, []);

  const dismissOutOfCoverage = useCallback(() => setOutOfCoverage(null), []);

  const selectMode = useCallback((mode) => {
    if (!MODE_IDS.includes(mode)) return;
    setSelection((previous) => ({ ...previous, mode }));
    setExpandedCard('');
  }, []);

  const selectYear = useCallback((year) => {
    setSelection((previous) => {
      const next = { ...previous, year };
      // 保留月日；目标年没有该日期时取该月最后一天，绝不落到 3 月 1 日。
      if (typeof previous.value === 'string' && previous.value.length === 10) {
        const shifted = dateInSelectedYear(previous.value, year);
        if (shifted) next.value = shifted;
      }
      return next;
    });
  }, []);

  const resetCamera = useCallback(() => {
    // 丢弃该星球的视角记忆并抑制紧接着的一次保存（重置会重建画布），
    // 否则切走再切回会恢复重置前的视角。
    dropCameraPose(adapter.planet);
    setCameraEpoch((value) => value + 1);
  }, [adapter.planet]);

  const retrySource = useCallback(() => {
    setSourceStatus(CARD_STATUS.LOADING);
    setSourceError(null);
    epochRef.current += 1;
    coordinator.cancelAll();
    setResolved(null);
    setCardReloadToken((value) => value + 1);
  }, [coordinator]);

  const retryField = useCallback(() => {
    setFieldStatus(CARD_STATUS.IDLE);
    setFieldError(null);
    setSelection((previous) => ({ ...previous, value: previous.value }));
    setCardReloadToken((value) => value + 1);
  }, []);

  const retryCards = useCallback(() => setCardReloadToken((value) => value + 1), []);

  // ── 卡片目录与状态 ────────────────────────────────────────────────────
  const capabilities = resolved?.capabilities || {};
  const modeCards = useMemo(
    () => resolveModeCards(resolved, selection.mode),
    [resolved, selection.mode],
  );

  const variableDef = useMemo(
    () => (resolved?.variables || []).find((item) => item.id === selection.variable) || null,
    [resolved, selection.variable],
  );

  // 卡片在“有数据依据 + 有 capability + 已展开”时才请求。
  //
  // 两条关键约定：
  //  1. 卡片身份**不含当前日期**：季节/极区/空间诊断都按年份计算，逐日播放或改日期
  //     不应让卡片重新进入 loading（否则播放时右侧每帧闪一次“正在加载”）。
  //  2. 折叠的卡片不发请求：卡片数据按需加载，展开才拉取；已加载但身份变化的卡片
  //     回到 idle，绝不显示上一个变量/年份的结果。
  //
  // 卡片状态通过 ref 读取而不是放进依赖数组：把 cardStates 放进 deps 会让
  // “设置 loading”本身再次触发 effect，形成自激循环。
  const cardIdentityRef = useRef({});
  const cardStatesRef = useRef(cardStates);
  cardStatesRef.current = cardStates;

  useEffect(() => {
    if (!ready) return undefined;
    const epoch = epochRef.current;
    const requests = [];

    for (const card of modeCards) {
      const channel = `card:${card.key}`;
      if (!shouldRequestCard(card, capabilities)) {
        setCardStates((previous) => ({
          ...previous,
          [card.key]: cardUnsupported(card.reason || 'capability_not_implemented', card.message),
        }));
        continue;
      }
      if (typeof adapter.loadCard !== 'function') {
        // Mars 的卡片由自身组件请求数据，controller 只维护状态占位，
        // 卡片外壳直接渲染子组件（加载态由该组件自己表达）。
        setCardStates((previous) => (
          previous[card.key] ? previous : { ...previous, [card.key]: cardReady(null) }
        ));
        continue;
      }

      const requestId = requestIdentity([identity, card.key, selection.variable, year]);
      const isExpanded = expandedCard === card.key;
      const loaded = cardIdentityRef.current[card.key] === requestId
        && cardStatesRef.current[card.key]?.status === CARD_STATUS.READY;

      if (!isExpanded) {
        // 折叠状态：已加载且身份一致就保留，否则回到 idle，等展开再拉。
        if (loaded) continue;
        cardIdentityRef.current[card.key] = null;
        setCardStates((previous) => (
          previous[card.key]?.status === CARD_STATUS.IDLE
            ? previous
            : { ...previous, [card.key]: cardIdle() }
        ));
        continue;
      }

      // 已展开且数据身份一致：不重新请求，也不闪 loading。
      if (loaded) continue;

      cardIdentityRef.current[card.key] = requestId;
      const request = coordinator.start(channel, requestId);
      setCardStates((previous) => ({ ...previous, [card.key]: cardLoading(previous[card.key]) }));
      requests.push(
        adapter
          .loadCard({
            cardKey: card.key,
            variable: selection.variable,
            year,
            value: selection.value,
            signal: request.signal,
          })
          .then((result) => {
            if (epoch !== epochRef.current) return;
            if (!coordinator.settle(request)) return;
            if (result?.status === 'unsupported') {
              cardIdentityRef.current[card.key] = null;
              setCardStates((previous) => ({
                ...previous,
                [card.key]: cardUnsupported(result.reason || 'capability_not_implemented', result.message),
              }));
              return;
            }
            if (result?.status === 'error' || result?.error) {
              cardIdentityRef.current[card.key] = null;
              setCardStates((previous) => ({
                ...previous,
                [card.key]: cardError(result?.error?.code, result?.error?.message),
              }));
              return;
            }
            setCardStates((previous) => ({
              ...previous,
              [card.key]: cardReady(result?.data ?? result, new Date().toISOString()),
            }));
          })
          .catch((error) => {
            if (epoch !== epochRef.current) return;
            if (error?.name === 'AbortError') return;
            if (!coordinator.settle(request)) return;
            const detail = describeError(error);
            cardIdentityRef.current[card.key] = null;
            setCardStates((previous) => ({
              ...previous,
              [card.key]: cardError(detail.code, detail.message),
            }));
          }),
      );
    }

    return () => {
      for (const card of modeCards) coordinator.cancel(`card:${card.key}`);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    adapter, capabilities, cardReloadToken, expandedCard, identity, modeCards, ready,
    selection.variable, year,
  ]);

  // 展开第一张卡片；切换模式后旧展开项失效。
  useEffect(() => {
    setExpandedCard((previous) => (
      modeCards.some((card) => card.key === previous) ? previous : (modeCards[0]?.key || '')
    ));
  }, [modeCards]);

  const cards = useMemo(
    () => modeCards.map((card) => ({
      ...card,
      state: cardStates[card.key]
        || (card.status === CARD_STATUS.UNSUPPORTED
          ? cardUnsupported(card.reason || 'capability_not_implemented', card.message)
          : createCardState(CARD_STATUS.IDLE)),
    })),
    [cardStates, modeCards],
  );

  /**
   * 手势交互（第二阶段）预留的动作接口。
   *
   * 目前不接入摄像头识别；手势层只需把识别结果映射到这些动作即可，
   * 星球语义仍由 adapter 决定，Earth 的日期不会被转换成 Ls。
   */
  const gestureActions = useMemo(() => ({
    planet: adapter.planet,
    rotate: (dx, dy) => ({ type: 'rotate', dx, dy }),
    zoom: (dDist) => ({ type: 'zoom', dDist }),
    play: () => setPlaying(true),
    pause: () => setPlaying(false),
    togglePlay: () => setPlaying((value) => !value),
    stepForward: () => stepValue(1),
    stepBackward: () => stepValue(-1),
    pickPoint: (lat, lon) => (pointInsideGeometry(geometry, lat, lon)
      ? selectPoint({ lat, lon })
      : markOutOfCoverage({ code: 'point_outside_coverage', lat, lon })),
    clearPoint,
    selectMode,
    resetCamera,
  }), [adapter.planet, clearPoint, geometry, markOutOfCoverage, resetCamera, selectMode, selectPoint, stepValue]);

  return {
    planet: adapter.planet,
    sourceId: adapter.sourceId,
    sourceLabel: resolved?.sourceLabel ?? adapter.sourceLabel ?? adapter.sourceId,
    sourceFingerprint,
    sourceMeta: resolved?.sourceMeta ?? null,
    sourceStatus,
    sourceError,
    status: sourceStatus,
    statusDetail: resolved?.statusDetail ?? null,
    ready,
    limitations: resolved?.limitations || [],

    time,
    timeAxis,
    years: resolved?.time?.years || [],
    variables: resolved?.variables || [],
    geometry,
    geometryIdentity,
    capabilities,
    polarScope: resolved?.polarScope ?? null,

    selection,
    date: selection.value,
    variable: selection.variable,
    variableDef,
    units: field?.unit || variableDef?.unit || null,
    colorRange: field?.colorRange || null,
    year,
    mode: selection.mode,
    field,
    fieldStatus,
    fieldError,
    requestedValue,
    displayedValue,
    regionalSeries,
    regionalStatus,
    regionalError,
    pointSeries,
    pointStatus,
    pointError,
    point: selection.point,
    pointCell: adapter.cellForPoint && selection.point
      ? adapter.cellForPoint(geometry, selection.point.requested || selection.point)
      : selection.point,

    playing,
    outOfCoverage,
    cameraEpoch,
    // 视角记忆键：每个星球一个，切走切回恢复上次视角；
    // 点“重置视角”会删除该键（见 resetCamera）。
    poseKey: adapter.planet,
    sceneKey: `${identity || 'none'}#${geometryIdentity}#${cameraEpoch}`,

    cards,
    expandedCard,
    cardStates,
    setExpandedCard,
    gestureActions,

    selectValue,
    stepValue,
    restart,
    setPlaying,
    selectVariable,
    selectPoint,
    clearPoint,
    markOutOfCoverage,
    dismissOutOfCoverage,
    selectMode,
    selectYear,
    resetCamera,
    retrySource,
    retryField,
    retryCards,
  };
}

export default useOverviewController;
