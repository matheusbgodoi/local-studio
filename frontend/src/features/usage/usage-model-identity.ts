import type {
  UsageEnergyModel,
  UsageFilterModel,
  UsageFilters,
  UsageTokenModel,
} from "@/lib/types";

export type UsageModelIdentity = {
  key: string;
  label: string;
  model: UsageFilterModel | null;
};

export function usageModelIdentity(
  modelId: string,
  filters: UsageFilters | undefined,
): UsageModelIdentity {
  const model =
    filters?.models.find((entry) => entry.id === modelId || entry.aliases.includes(modelId)) ??
    null;
  return model
    ? { key: model.id, label: model.label, model }
    : { key: `unmapped:${modelId}`, label: "Model identity unavailable", model: null };
}

export function usageModelLabel(modelId: string, filters: UsageFilters | undefined): string {
  return usageModelIdentity(modelId, filters).label;
}

function combinedRate(
  rows: UsageTokenModel[],
  tokens: (row: UsageTokenModel) => number,
  rate: (row: UsageTokenModel) => number | null,
): number | null {
  let tokenTotal = 0;
  let secondsTotal = 0;
  for (const row of rows) {
    const count = tokens(row);
    if (count <= 0) continue;
    const measuredRate = rate(row);
    if (measuredRate === null || measuredRate <= 0) return null;
    tokenTotal += count;
    secondsTotal += count / measuredRate;
  }
  return tokenTotal > 0 && secondsTotal > 0 ? tokenTotal / secondsTotal : null;
}

export type PhysicalTokenRow = UsageTokenModel & { key: string; label: string };

export function physicalTokenRows(
  rows: UsageTokenModel[],
  filters: UsageFilters | undefined,
): PhysicalTokenRow[] {
  const groups = new Map<string, { identity: UsageModelIdentity; rows: UsageTokenModel[] }>();
  for (const row of rows) {
    const identity = usageModelIdentity(row.model, filters);
    const group = groups.get(identity.key) ?? { identity, rows: [] };
    group.rows.push(row);
    groups.set(identity.key, group);
  }
  return [...groups.values()].map(({ identity, rows: members }) => {
    const sum = (value: (row: UsageTokenModel) => number) =>
      members.reduce((total, row) => total + value(row), 0);
    const requests = sum((row) => row.requests);
    const successful = sum((row) => row.successful);
    return {
      key: identity.key,
      label: identity.label,
      model: identity.key,
      requests,
      successful,
      success_rate: requests > 0 ? (successful / requests) * 100 : 0,
      processed_tokens: sum((row) => row.processed_tokens),
      logical_tokens: sum((row) => row.logical_tokens),
      fresh_prompt_tokens: sum((row) => row.fresh_prompt_tokens),
      cached_input_tokens: sum((row) => row.cached_input_tokens),
      generated_tokens: sum((row) => row.generated_tokens),
      logical_prompt_tokens: sum((row) => row.logical_prompt_tokens),
      decode_tps: combinedRate(
        members,
        (row) => row.generated_tokens,
        (row) => row.decode_tps,
      ),
      prefill_tps: combinedRate(
        members,
        (row) => row.fresh_prompt_tokens,
        (row) => row.prefill_tps,
      ),
    };
  });
}

export type PhysicalEnergyRow = UsageEnergyModel & { key: string; label: string };

export function physicalEnergyRows(
  rows: UsageEnergyModel[],
  filters: UsageFilters | undefined,
): PhysicalEnergyRow[] {
  const groups = new Map<
    string,
    { key: string; label: string; rows: UsageEnergyModel[]; unattributed: boolean }
  >();
  for (const row of rows) {
    const identity =
      row.model === null
        ? { key: "unattributed", label: "Unattributed" }
        : usageModelIdentity(row.model, filters);
    const group = groups.get(identity.key) ?? {
      key: identity.key,
      label: identity.label,
      rows: [],
      unattributed: row.model === null,
    };
    group.rows.push(row);
    groups.set(identity.key, group);
  }
  return [...groups.values()].map((group) => {
    const energy = group.rows.reduce((total, row) => total + row.energy_kwh, 0);
    const measuredSeconds = group.rows.reduce((total, row) => total + row.measured_seconds, 0);
    const inferenceValues = group.rows.map((row) => row.inference_kwh);
    const otherValues = group.rows.map((row) => row.other_gpu_work_kwh);
    return {
      key: group.key,
      label: group.label,
      model: group.unattributed ? null : group.key,
      energy_kwh: energy,
      inference_kwh: inferenceValues.every((value) => value !== null)
        ? inferenceValues.reduce<number>((total, value) => total + (value ?? 0), 0)
        : null,
      other_gpu_work_kwh: otherValues.every((value) => value !== null)
        ? otherValues.reduce<number>((total, value) => total + (value ?? 0), 0)
        : null,
      measured_seconds: measuredSeconds,
      avg_power_w: measuredSeconds > 0 ? (energy * 3_600_000) / measuredSeconds : null,
      peak_power_w: group.rows.reduce<number | null>(
        (peak, row) =>
          row.peak_power_w === null
            ? peak
            : peak === null
              ? row.peak_power_w
              : Math.max(peak, row.peak_power_w),
        null,
      ),
    };
  });
}

export function usageModelLabels(modelIds: string[], filters: UsageFilters | undefined): string[] {
  return [...new Set(modelIds.map((modelId) => usageModelLabel(modelId, filters)))];
}
