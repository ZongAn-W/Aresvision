import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { fetchDataset, fetchEarthField, fetchEarthRegionalSeries, fetchEarthPointSeries } from '../../../services/datasets';
import { createEarthRequestCoordinator } from './earthRequestCoordinator.js';
import {
  EARTH_DATASET_ID,
  canRequestEarthData,
  fieldIdentity,
  initialEarthSelection,
  isValidFieldPayload,
  isValidPointPayload,
  isValidRegionalPayload,
  nextPlaybackDate,
  pointIdentity,
  regionalIdentity,
  shiftDate,
} from './earthOverviewModel.js';

const PLAYBACK_DELAY_MS = 600;
const CHANNEL_FIELD = 'field';
const CHANNEL_REGIONAL = 'regional-series';
const CHANNEL_POINT = 'point-series';

/**
 * Earth 总览的数据与选择状态。
 *
 * 三个数据通道（场、区域序列、点位序列）各自独立取消；回包必须同时通过
 * token 身份与请求身份检查才会写入状态，迟到的响应不会覆盖新选择。
 */
export function useEarthOverview(initialSelection = null) {
  const coordinatorRef = useRef(null);
  if (coordinatorRef.current === null) coordinatorRef.current = createEarthRequestCoordinator();
  const coordinator = coordinatorRef.current;

  const [descriptor, setDescriptor] = useState(null);
  const [descriptorError, setDescriptorError] = useState(null);
  const [descriptorLoading, setDescriptorLoading] = useState(true);

  const [selection, setSelection] = useState(() => ({
    date: initialSelection?.date ?? null,
    variable: initialSelection?.variable ?? 'TO3',
    point: initialSelection?.point ?? null,
  }));
  const [field, setField] = useState(null);
  const [fieldRequestedDate, setFieldRequestedDate] = useState(null);
  const [fieldLoading, setFieldLoading] = useState(false);
  const [fieldError, setFieldError] = useState(null);

  const [regionalSeries, setRegionalSeries] = useState(null);
  const [pointSeries, setPointSeries] = useState(null);
  const [seriesError, setSeriesError] = useState(null);

  const [playing, setPlaying] = useState(false);
  const [outOfCoverage, setOutOfCoverage] = useState(null);

  const fingerprint = descriptor?.dataset_fingerprint ?? null;
  const ready = canRequestEarthData(descriptor);
  const start = descriptor?.time?.start ?? null;
  const end = descriptor?.time?.end ?? null;

  // ── 元信息 ────────────────────────────────────────────────────────
  const loadDescriptor = useCallback(async (signal) => {
    setDescriptorLoading(true);
    setDescriptorError(null);
    try {
      const payload = await fetchDataset(EARTH_DATASET_ID, { signal });
      if (signal?.aborted) return;
      setDescriptor(payload);
      setSelection((previous) => initialEarthSelection(payload, previous));
    } catch (error) {
      if (error?.name === 'AbortError') return;
      setDescriptor(null);
      setDescriptorError({
        code: error?.code || 'invalid_request',
        status: error?.status ?? 0,
        availabilityReason: error?.availabilityReason ?? null,
        message: error?.message || '',
      });
    } finally {
      if (!signal?.aborted) setDescriptorLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadDescriptor(controller.signal);
    return () => controller.abort();
  }, [loadDescriptor]);

  const descriptorAttempts = useRef(0);
  const refreshDescriptor = useCallback(async () => {
    // A version change resets the scene once, without an automatic retry loop.
    if (descriptorAttempts.current >= 1) return;
    descriptorAttempts.current += 1;
    setField(null);
    setRegionalSeries(null);
    setPointSeries(null);
    setPlaying(false);
    await loadDescriptor();
  }, [loadDescriptor]);

  // ── 区域序列（按变量 + fingerprint 请求一次） ────────────────────
  useEffect(() => {
    if (!ready) {
      setRegionalSeries(null);
      return undefined;
    }
    const context = regionalIdentity({
      datasetId: EARTH_DATASET_ID, fingerprint, variable: selection.variable, start, end,
    });
    const token = coordinator.start(CHANNEL_REGIONAL, context);
    fetchEarthRegionalSeries(EARTH_DATASET_ID, {
      variable: selection.variable, fingerprint, signal: token.signal,
    })
      .then((payload) => {
        if (!coordinator.settle(token, context)) return;
        if (!isValidRegionalPayload(payload, {
          datasetId: EARTH_DATASET_ID, fingerprint, variable: selection.variable, start, end,
        })) {
          setSeriesError({ code: 'invalid_response', message: 'invalid regional payload' });
          return;
        }
        setRegionalSeries(payload);
        setSeriesError(null);
      })
      .catch((error) => {
        if (error?.name === 'AbortError') return;
        if (!coordinator.settle(token, context)) return;
        setRegionalSeries(null);
        setSeriesError({
          code: error?.code || 'invalid_request',
          status: error?.status ?? 0,
          availabilityReason: error?.availabilityReason ?? null,
          message: error?.message || '',
        });
      });
    return () => coordinator.cancel(CHANNEL_REGIONAL);
  }, [coordinator, fingerprint, ready, selection.variable, start, end]);

  // ── 点位序列 ──────────────────────────────────────────────────────
  useEffect(() => {
    const point = selection.point;
    if (!ready || !point) {
      setPointSeries(null);
      return undefined;
    }
    const context = pointIdentity({
      datasetId: EARTH_DATASET_ID, fingerprint, variable: selection.variable,
      lat: point.lat, lon: point.lon, start, end,
    });
    const token = coordinator.start(CHANNEL_POINT, context);
    fetchEarthPointSeries(EARTH_DATASET_ID, {
      variable: selection.variable, lat: point.lat, lon: point.lon,
      fingerprint, signal: token.signal,
    })
      .then((payload) => {
        if (!coordinator.settle(token, context)) return;
        if (!isValidPointPayload(payload, {
          datasetId: EARTH_DATASET_ID, fingerprint, variable: selection.variable, start, end,
        })) {
          setSeriesError({ code: 'invalid_response', message: 'invalid point payload' });
          return;
        }
        setPointSeries(payload);
        setSeriesError(null);
      })
      .catch((error) => {
        if (error?.name === 'AbortError') return;
        if (!coordinator.settle(token, context)) return;
        setPointSeries(null);
        setSeriesError({
          code: error?.code || 'invalid_request',
          status: error?.status ?? 0,
          availabilityReason: error?.availabilityReason ?? null,
          message: error?.message || '',
        });
      });
    return () => coordinator.cancel(CHANNEL_POINT);
  }, [coordinator, fingerprint, ready, selection.point, selection.variable, start, end]);

  // ── 场（当前请求日期） ────────────────────────────────────────────
  useEffect(() => {
    const date = selection.date;
    if (!ready || !date) {
      setField(null);
      return undefined;
    }
    setFieldRequestedDate(date);
    setFieldLoading(true);
    const context = fieldIdentity({
      datasetId: EARTH_DATASET_ID, fingerprint, variable: selection.variable, date,
    });
    const token = coordinator.start(CHANNEL_FIELD, context);
    fetchEarthField(EARTH_DATASET_ID, {
      variable: selection.variable, date, fingerprint, signal: token.signal,
    })
      .then((payload) => {
        if (!coordinator.settle(token, context)) return;
        setFieldLoading(false);
        if (!isValidFieldPayload(payload, {
          datasetId: EARTH_DATASET_ID, fingerprint, variable: selection.variable, date,
        })) {
          setField(null);
          setFieldError({ code: 'invalid_response', message: 'invalid field payload' });
          return;
        }
        // 旧场只在新场通过校验后替换；失败时清空而不是伪装成零值。
        setField(payload);
        setFieldError(null);
      })
      .catch((error) => {
        if (error?.name === 'AbortError') return;
        if (!coordinator.settle(token, context)) return;
        setFieldLoading(false);
        setField(null);
        setFieldError({
          code: error?.code || 'invalid_request',
          status: error?.status ?? 0,
          availabilityReason: error?.availabilityReason ?? null,
          message: error?.message || '',
        });
      });
    return () => coordinator.cancel(CHANNEL_FIELD);
  }, [coordinator, fingerprint, ready, selection.date, selection.variable]);

  // 版本变化只重取一次元信息，等待用户继续。
  useEffect(() => {
    if (fieldError?.code === 'dataset_version_changed') refreshDescriptor();
  }, [fieldError?.code, refreshDescriptor]);

  useEffect(() => {
    if (seriesError?.code === 'dataset_version_changed') refreshDescriptor();
  }, [seriesError?.code, refreshDescriptor]);

  // ── 播放 ──────────────────────────────────────────────────────────
  const displayedDate = field?.date ?? null;
  const displayedVariable = field?.variable ?? null;

  useEffect(() => {
    if (!playing) return undefined;
    const next = nextPlaybackDate({
      start, end, displayedDate, requestedDate: selection.date, ready: Boolean(field), playing,
    });
    if (!next) {
      // 展示完最后一天即停止；"从首日重播"由用户显式触发。
      if (displayedDate && end && displayedDate >= end) setPlaying(false);
      return undefined;
    }
    const timer = setTimeout(() => {
      setSelection((previous) => ({ ...previous, date: next }));
    }, PLAYBACK_DELAY_MS);
    return () => clearTimeout(timer);
  }, [displayedDate, end, field, playing, selection.date, start]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') setPlaying(false);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => () => {
    coordinatorRef.current?.invalidateAll();
  }, []);

  // ── 选择动作 ──────────────────────────────────────────────────────
  const chooseDate = useCallback((date) => {
    setPlaying(false);
    setSelection((previous) => ({ ...previous, date }));
  }, []);

  const chooseVariable = useCallback((variable) => {
    setPlaying(false);
    // 换变量时清空旧场与旧曲线，避免温度数值配上 DU 单位。
    setField(null);
    setRegionalSeries(null);
    setPointSeries(null);
    setSelection((previous) => ({ ...previous, variable }));
  }, []);

  const choosePoint = useCallback((point) => {
    setPlaying(false);
    setOutOfCoverage(null);
    setSelection((previous) => ({ ...previous, point: { lat: point.lat, lon: point.lon } }));
  }, []);

  const markOutOfCoverage = useCallback(() => {
    // 只设置提示、暂停播放，不清空已有点位。
    setPlaying(false);
    setOutOfCoverage(true);
  }, []);

  const dismissOutOfCoverage = useCallback(() => setOutOfCoverage(null), []);

  const restart = useCallback(() => {
    setSelection((previous) => ({ ...previous, date: start }));
    setPlaying(true);
  }, [start]);

  const stepDate = useCallback((days) => {
    setPlaying(false);
    setSelection((previous) => {
      if (!previous.date) return previous;
      const next = shiftDate(previous.date, days);
      if (next < start || next > end) return previous;
      return { ...previous, date: next };
    });
  }, [end, start]);

  const pointGrid = useMemo(() => {
    if (pointSeries?.grid_point) return pointSeries.grid_point;
    if (selection.point) return { lat: selection.point.lat, lon: selection.point.lon };
    return null;
  }, [pointSeries, selection.point]);

  return {
    descriptor,
    descriptorLoading,
    descriptorError,
    ready,
    start,
    end,
    selection,
    field,
    displayedDate,
    displayedVariable,
    fieldRequestedDate,
    fieldLoading,
    fieldError,
    regionalSeries,
    pointSeries,
    seriesError,
    pointGrid,
    playing,
    outOfCoverage,
    setPlaying,
    chooseDate,
    chooseVariable,
    choosePoint,
    markOutOfCoverage,
    dismissOutOfCoverage,
    stepDate,
    restart,
    retryDescriptor: loadDescriptor,
  };
}
