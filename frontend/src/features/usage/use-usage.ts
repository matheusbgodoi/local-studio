"use client";

import { useCallback, useRef, useState } from "react";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import api from "@/lib/api/client";
import { readPageCache, scopedPageCacheKey, writePageCache } from "@/lib/page-data-cache";
import type { UsagePeriod, UsageStats } from "@/lib/types";
import { normalizeUsageStats } from "@/features/usage/normalize-usage-stats";

export interface UsageQuery {
  period: UsagePeriod;
  model: string;
  timezone: string;
}

const cacheKey = (query: UsageQuery): string =>
  `usage:stats:provider:${query.period}:${query.model}:${query.timezone}`;

interface UsageState {
  key: string;
  stats: UsageStats | null;
  loading: boolean;
  error: string | null;
}

function responseMatchesQuery(stats: UsageStats, query: UsageQuery): boolean {
  return (
    stats.filters?.period === query.period &&
    stats.filters.model === query.model &&
    stats.timezone === query.timezone
  );
}

export function useUsage(query: UsageQuery, controllerKey: string) {
  const statsCacheKey = scopedPageCacheKey(controllerKey, cacheKey(query));
  const [state, setState] = useState<UsageState>(() => ({
    key: statsCacheKey,
    stats: readPageCache<UsageStats>(statsCacheKey),
    loading: true,
    error: null,
  }));
  const requestSequence = useRef(0);
  const activeRef = useRef(false);

  useMountSubscription(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
      requestSequence.current += 1;
    };
  }, [controllerKey]);

  const loadStats = useCallback(async () => {
    const requestId = ++requestSequence.current;
    try {
      setState((current) => ({
        key: statsCacheKey,
        stats: current.key === statsCacheKey ? current.stats : null,
        loading: true,
        error: null,
      }));
      const normalized = normalizeUsageStats(
        await api.getUsageStats({
          period: query.period,
          model: query.model,
          tz: query.timezone,
        }),
      );
      if (!responseMatchesQuery(normalized, query)) {
        throw new Error("Usage response does not match the requested filters");
      }
      if (!activeRef.current || requestId !== requestSequence.current) return;
      writePageCache(statsCacheKey, normalized);
      setState({ key: statsCacheKey, stats: normalized, loading: false, error: null });
    } catch (cause) {
      if (activeRef.current && requestId === requestSequence.current) {
        setState((current) => ({
          key: statsCacheKey,
          stats: current.key === statsCacheKey ? current.stats : null,
          loading: false,
          error: (cause as Error).message,
        }));
      }
    }
  }, [query, statsCacheKey]);

  useMountSubscription(() => {
    setState({
      key: statsCacheKey,
      stats: readPageCache<UsageStats>(statsCacheKey),
      loading: true,
      error: null,
    });
    void loadStats();
  }, [loadStats, statsCacheKey]);

  const current = state.key === statsCacheKey ? state : null;
  return {
    stats: current?.stats ?? null,
    loading: current?.loading ?? true,
    error: current?.error ?? null,
    loadStats,
  };
}
