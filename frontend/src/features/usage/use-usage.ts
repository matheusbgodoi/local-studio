"use client";

import { useCallback, useRef, useState } from "react";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import api from "@/lib/api/client";
import { readPageCache, writePageCache } from "@/lib/page-data-cache";
import type { UsagePeriod, UsageStats } from "@/lib/types";
import { normalizeUsageStats } from "@/features/usage/normalize-usage-stats";

export interface UsageQuery {
  period: UsagePeriod;
  model: string;
  timezone: string;
}

const cacheKey = (query: UsageQuery): string =>
  `usage:stats:provider:${query.period}:${query.model}:${query.timezone}`;

export function useUsage(query: UsageQuery) {
  const [stats, setStats] = useState<UsageStats | null>(() =>
    readPageCache<UsageStats>(cacheKey(query)),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestSequence = useRef(0);

  const loadStats = useCallback(async () => {
    const requestId = ++requestSequence.current;
    const key = cacheKey(query);
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
      if (requestId !== requestSequence.current) return;
      writePageCache(key, normalized);
      setStats(normalized);
    } catch (cause) {
      if (requestId === requestSequence.current) setError((cause as Error).message);
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }, [query]);

  useMountSubscription(() => {
    setStats(readPageCache<UsageStats>(cacheKey(query)));
    void loadStats();
  }, [loadStats]);

  return { stats, loading, error, loadStats };
}
