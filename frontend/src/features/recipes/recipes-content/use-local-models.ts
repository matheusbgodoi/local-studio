"use client";

import { useMemo } from "react";
import { type AgentModel, type PhysicalModel } from "@/features/agent/models";
import { useRealtimeStatusStore } from "@/hooks/realtime-status-store";
import { refreshServedModels, useServedModels } from "@/hooks/served-models-store";
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
  const { physicalModels, loading, stale, error } = useServedModels();
  const { status, statusLoading, gpus, connected } = useRealtimeStatusStore();

  const residentAlias = status?.process?.served_model_name?.trim() || null;

  const cards = useMemo(
    () => physicalModels.map((physical) => buildCard(physical, residentAlias)),
    [physicalModels, residentAlias],
  );

  const pool = useMemo(() => buildPool(gpus), [gpus]);

  return {
    cards,
    loading,
    stale,
    error,
    connected,
    // "not connected" and "we have not asked yet" are different states, and the store starts
    // in the second one ({connected: false, statusLoading: true}). Keyed on `connected` alone,
    // a hard load painted a red "offline" pill before /status had answered.
    statusKnown: !statusLoading,
    residentAlias,
    pool,
    refresh: refreshServedModels,
  };
}
