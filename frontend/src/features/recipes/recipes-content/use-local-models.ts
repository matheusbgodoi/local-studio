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

function buildCard(physical: PhysicalModel, residentAlias: string | null): LocalModelCard {
  const isResident = (profile: AgentModel) =>
    profile.active || (residentAlias !== null && profile.id === residentAlias);
  // EVERY FIELD BELOW COMES FROM THE WIRE OR IS ABSENT. That is this tab's entire claim, so
  // each one asks the *declared* value: `contextWindowDeclared` rather than `contextWindow`,
  // which carries a 128,000 fallback, and `visionDeclared` rather than `vision`, which falls
  // back to substring-matching the alias against a 44-entry name table. Reading either
  // fallback here would put a number or a chip on screen that no backend ever sent.
  const declared = physical.profiles.find((profile) => profile.contextWindowDeclared !== undefined);
  return {
    id: physical.physicalModelId,
    displayName: physical.displayName,
    aliases: physical.profiles.map((profile) => profile.id),
    resident: physical.profiles.some(isResident),
    contextWindow: declared?.contextWindowDeclared ?? null,
    tools: physical.profiles.some((profile) => profile.tools === true),
    vision: physical.profiles.some((profile) => profile.visionDeclared === true),
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { status, statusLoading, gpus, connected } = useRealtimeStatusStore();

  const refresh = useCallback(async () => {
    // `loading` goes back up here, not only down in the `finally`. Without this the Refresh
    // button was inert from the first paint on: it never disabled and never spun, so repeated
    // clicks fired concurrent requests at a 30 s timeout with three retries each.
    setLoading(true);
    try {
      const payload = await api.getOpenAIModels();
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
    () => physicalModels.map((physical) => buildCard(physical, residentAlias)),
    [physicalModels, residentAlias],
  );

  const pool = useMemo(() => buildPool(gpus), [gpus]);

  return {
    cards,
    loading,
    error,
    connected,
    // "not connected" and "we have not asked yet" are different states, and the store starts
    // in the second one ({connected: false, statusLoading: true}). Keyed on `connected` alone,
    // a hard load painted a red "offline" pill before /status had answered.
    statusKnown: !statusLoading,
    residentAlias,
    pool,
    refresh,
  };
}
