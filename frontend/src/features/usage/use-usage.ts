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

export function useUsage(query: UsageQuery, controllerKey: string) {
  const statsCacheKey = scopedPageCacheKey(controllerKey, cacheKey(query));
  const [stats, setStats] = useState<UsageStats | null>(() =>
    readPageCache<UsageStats>(statsCacheKey),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
      setLoading(true);
      setError(null);
      const normalized = normalizeUsageStats(
        await api.getUsageStats({
          period: query.period,
          model: query.model,
          tz: query.timezone,
        }),
      );
      if (!activeRef.current || requestId !== requestSequence.current) return;
      writePageCache(statsCacheKey, normalized);
      setStats(normalized);
    } catch (cause) {
      if (activeRef.current && requestId === requestSequence.current) {
        setError((cause as Error).message);
      }
    } finally {
      if (activeRef.current && requestId === requestSequence.current) setLoading(false);
    }
  }, [query, statsCacheKey]);

  useMountSubscription(() => {
    setStats(readPageCache<UsageStats>(statsCacheKey));
    void loadStats();
  }, [loadStats, statsCacheKey]);

  return { stats, loading, error, loadStats };
}
