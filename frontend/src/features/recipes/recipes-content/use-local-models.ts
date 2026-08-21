"use client";

import { useCallback, useMemo, useState } from "react";
import api from "@/lib/api/client";
import {
  groupByPhysicalModel,
  normalizeOpenAIModels,
  type AgentModel,
  type OpenAIModelListItem,
  type PhysicalModel,
} from "@/features/agent/models";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { useRealtimeStatusStore } from "@/hooks/realtime-status-store";
import { toGBFromMB } from "@/lib/formatters";
import type { GPU } from "@/lib/types";

const CONTEXT_KEYS = ["contextWindow", "context_window", "max_model_len"] as const;

export interface LocalModelProfile {
  id: string;
  label: string;
  isDefault: boolean;
  resident: boolean;
}

export interface LocalModelCard {
  id: string;
  displayName: string;
  aliases: string[];
  resident: boolean;
  contextWindow: number | null;
  tools: boolean;
  vision: boolean;
  nativeThinking: boolean;
  profiles: LocalModelProfile[];
}

export interface LocalVramPool {
  label: string;
  totalGb: number;
  usedGb: number;
}

function declaresContextWindow(row: OpenAIModelListItem): boolean {
  const extras = { ...row.meta, ...row.metadata };
  return CONTEXT_KEYS.some(
    (key) => typeof row[key] === "number" || typeof extras[key] === "number",
  );
}

function profileLabel(profile: AgentModel): string {
  return profile.behaviorProfileLabel ?? profile.behaviorProfile ?? profile.name;
}

function buildPool(gpus: GPU[]): LocalVramPool | null {
  if (gpus.length === 0) return null;
  let totalGb = 0;
  let usedGb = 0;
  for (const gpu of gpus) {
    totalGb += toGBFromMB(gpu.memory_total_mb);
    usedGb += toGBFromMB(gpu.memory_used_mb);
  }
  return {
    label: gpus.length === 1 ? (gpus[0]?.name ?? "GPU") : `${gpus.length} GPUs`,
    totalGb: Math.round(totalGb * 10) / 10,
    usedGb: Math.round(usedGb * 10) / 10,
  };
}

function buildCard(
  physical: PhysicalModel,
  residentAlias: string | null,
  declaredContext: ReadonlySet<string>,
): LocalModelCard {
  const isResident = (profile: AgentModel) =>
    profile.active || (residentAlias !== null && profile.id === residentAlias);
  const withContext = physical.profiles.find((profile) => declaredContext.has(profile.id));
  return {
    id: physical.physicalModelId,
    displayName: physical.displayName,
    aliases: physical.profiles.map((profile) => profile.id),
    resident: physical.profiles.some(isResident),
    contextWindow: withContext?.contextWindow ?? null,
    tools: physical.profiles.some((profile) => profile.tools === true),
    vision: physical.profiles.some((profile) => profile.vision),
    nativeThinking: physical.profiles.some((profile) => profile.nativeReasoning === true),
    profiles: physical.profiles.map((profile) => ({
      id: profile.id,
      label: profileLabel(profile),
      isDefault: profile.behaviorProfileDefault === true,
      resident: isResident(profile),
    })),
  };
}

export function useLocalModels() {
  const [physicalModels, setPhysicalModels] = useState<PhysicalModel[]>([]);
  const [declaredContext, setDeclaredContext] = useState<ReadonlySet<string>>(() => new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { status, gpus, connected } = useRealtimeStatusStore();

  const refresh = useCallback(async () => {
    try {
      const payload = await api.getOpenAIModels();
      const rows = payload.data ?? [];
      setDeclaredContext(
        new Set(rows.filter(declaresContextWindow).map((row) => String(row.id).trim())),
      );
      setPhysicalModels(groupByPhysicalModel(normalizeOpenAIModels(payload)));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Served models could not be read");
    } finally {
      setLoading(false);
    }
  }, []);

  useMountSubscription(() => {
    void refresh();
  }, [refresh]);

  const residentAlias = status?.process?.served_model_name?.trim() || null;

  const cards = useMemo(
    () => physicalModels.map((physical) => buildCard(physical, residentAlias, declaredContext)),
    [physicalModels, residentAlias, declaredContext],
  );

  const pool = useMemo(() => buildPool(gpus), [gpus]);

  return { cards, loading, error, connected, residentAlias, pool, refresh };
}
