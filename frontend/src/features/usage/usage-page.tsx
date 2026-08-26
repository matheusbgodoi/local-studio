"use client";

import { useMemo, useRef, useState } from "react";
import { AppPage, PageContainer, PageState, RefreshButton, Select, SegmentedControl } from "@/ui";
import { useUsage } from "@/features/usage/use-usage";
import { UsageSkeleton } from "@/features/usage/usage-skeleton";
import { classifyUsageFailure } from "@/features/usage/usage-unavailable";
import { EmptyNote } from "@/features/usage/usage-panels";
import { instantLabel } from "@/features/usage/usage-formatters";
import { UsageTokensTab } from "@/features/usage/usage-tokens-tab";
import { UsageEnergyTab } from "@/features/usage/usage-energy-tab";
import { UsageEfficiencyTab } from "@/features/usage/usage-efficiency-tab";
import { useEnergyPreferences } from "@/features/usage/energy-preferences";
import type { UsageFilters, UsagePeriod } from "@/lib/types";
import { Upload } from "@/ui/icon-registry";
import {
  ProfileAvatar,
  profileImageFromFile,
  useLocalProfile,
} from "@/features/shell/local-profile";
import { useControllerCapabilities } from "@/hooks/controller-capabilities-store";

type UsageTab = "tokens" | "energy" | "efficiency";

const TABS = [
  { id: "tokens", label: "Tokens" },
  { id: "energy", label: "Energy" },
  { id: "efficiency", label: "Efficiency" },
] satisfies Array<{ id: UsageTab; label: string }>;

const PERIODS = [
  { id: "today", label: "Today" },
  { id: "7d", label: "7D" },
  { id: "30d", label: "30D" },
  { id: "365d", label: "365D" },
  { id: "all", label: "All" },
] satisfies Array<{ id: UsagePeriod; label: string }>;

const ALL_MODELS = "all";

/** ONE ROW PER PHYSICAL MODEL, NAMED THE WAY THE CHAT NAMES IT.
 *
 * The filter listed `supported_models` raw — the union of what the router serves with every
 * alias that ever recorded a row. The owner saw six entries while the chat's picker showed
 * three, by full name. Two different faults produced that gap: qwen-daily and qwen-uncensored
 * are ONE checkpoint behind two behaviour profiles, and two more were retired aliases
 * surviving only in their own history.
 *
 * Labels come off the wire (the router's displayName), so this file names no model — the same
 * rule the chat's picker follows.
 *
 * History-only aliases are DROPPED. They were grouped under a "No longer served" heading first,
 * on the argument that their rows are real measurements — but the owner runs three models and
 * asked twice not to be shown the others, and a filter is a list of things you can choose, not
 * an archive. Nothing is lost from any total: their traffic still aggregates into "All models",
 * and the host still publishes them with `served: false`, so restoring the group is a one-line
 * change here rather than a schema change.
 *
 * Lifted out of UsagePage because inlining it pushed that component past the complexity gate. */
function buildModelOptions(filters: UsageFilters | undefined) {
  const all = { value: ALL_MODELS, label: "All models" };
  const models = filters?.models ?? [];
  if (models.length === 0) {
    return [all];
  }
  return [all, ...models.filter((m) => m.served).map((m) => ({ value: m.id, label: m.label }))];
}

export default function UsagePage() {
  const { controllerKey } = useControllerCapabilities();
  return <UsagePageForController key={controllerKey} controllerKey={controllerKey} />;
}

function UsagePageForController({ controllerKey }: { controllerKey: string }) {
  const [tab, setTab] = useState<UsageTab>("tokens");
  const [period, setPeriod] = useState<UsagePeriod>("today");
  const [model, setModel] = useState(ALL_MODELS);
  const [preferences, savePreferences] = useEnergyPreferences();
  const [profile, updateProfile] = useLocalProfile();
  const [imageError, setImageError] = useState("");
  const imageInputRef = useRef<HTMLInputElement>(null);

  const query = useMemo(
    () => ({ period, model, timezone: preferences.timezone }),
    [period, model, preferences.timezone],
  );
  const { stats, loading, error, loadStats } = useUsage(query, controllerKey);

  const updateImage = async (file: File | undefined) => {
    if (!file) return;
    try {
      setImageError("");
      updateProfile({ imageUrl: await profileImageFromFile(file) });
    } catch (cause) {
      setImageError((cause as Error).message);
    }
  };

  if (loading && !stats) return <UsageSkeleton />;

  const failure = stats ? null : classifyUsageFailure(error);
  if (failure) {
    return (
      <AppPage>
        <PageContainer width="sm" className="pt-5 sm:pt-7">
          <div className="mx-auto mt-24 max-w-[34rem] text-center">
            <h1 className="text-[length:var(--fs-lg)] font-medium text-(--ui-fg)">
              {failure.title}
            </h1>
            <p className="mt-2 text-[length:var(--fs-sm)] leading-relaxed text-(--ui-muted)">
              {failure.detail}
            </p>
            <div className="mt-5 flex justify-center">
              <RefreshButton onRefresh={loadStats} loading={loading} className="mt-1 h-7 w-7" />
            </div>
          </div>
        </PageContainer>
      </AppPage>
    );
  }

  const pageState = PageState({
    loading,
    data: stats,
    hasData: Boolean(stats),
    error,
    onLoad: loadStats,
  });
  if (pageState) return <AppPage>{pageState}</AppPage>;
  if (!stats) return null;

  const timezone = stats.timezone ?? preferences.timezone;
  const modelOptions = buildModelOptions(stats.filters);
  const tokensSince = instantLabel(stats.collection_started_at, timezone);
  const energySince = instantLabel(stats.energy_collection_started_at, timezone);

  return (
    <AppPage>
      <PageContainer width="sm" className="pt-5 sm:pt-7">
        <header className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => imageInputRef.current?.click()}
              className="group relative shrink-0 rounded-full"
              title="Update profile image"
              aria-label="Update profile image"
            >
              <ProfileAvatar profile={profile} size={38} />
              <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/55 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                <Upload className="h-4 w-4 text-white" />
              </span>
            </button>
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => void updateImage(event.currentTarget.files?.[0])}
            />
            <div className="min-w-0">
              <h1 className="text-[length:var(--fs-xs)] font-medium uppercase tracking-[0.12em] text-(--ui-muted)">
                Usage
              </h1>
              <input
                value={profile.name}
                onChange={(event) => updateProfile({ name: event.target.value })}
                onBlur={() => {
                  if (!profile.name.trim()) updateProfile({ name: "Studio" });
                }}
                aria-label="Profile display name"
                className="mt-0.5 block h-7 max-w-56 bg-transparent text-[length:var(--fs-lg)] font-medium text-(--ui-fg) outline-none placeholder:text-(--ui-muted)"
                placeholder="Studio"
              />
              {imageError ? (
                <p className="mt-1 text-[length:var(--fs-xs)] text-(--err)">{imageError}</p>
              ) : null}
            </div>
          </div>
          <RefreshButton onRefresh={loadStats} loading={loading} className="h-7 w-7" />
        </header>

        <div className="mt-5 flex flex-wrap items-center gap-2.5">
          <SegmentedControl items={TABS} value={tab} onChange={setTab} size="sm" />
          <div className="grow" />
          <SegmentedControl items={PERIODS} value={period} onChange={setPeriod} size="sm" />
          <Select
            className="h-7 w-auto text-[length:var(--fs-xs)]"
            value={model}
            onChange={(event) => setModel(event.target.value)}
            options={modelOptions}
            aria-label="Filter by model"
          />
        </div>

        <p className="pt-3 text-[length:var(--fs-xs)] leading-relaxed text-(--ui-muted)">
          {tokensSince
            ? `Token accounting since ${tokensSince}. Earlier requests were never recorded, so they are absent rather than estimated.`
            : "Token accounting has not started on this rig yet."}
          {energySince
            ? ` GPU energy accounting since ${energySince}; days before it are blank, not zero.`
            : " GPU energy accounting has not started; the Energy and Efficiency tabs stay empty rather than showing zeros."}
        </p>

        {stats.tokens ? (
          <>
            {tab === "tokens" ? (
              <UsageTokensTab tokens={stats.tokens} filters={stats.filters} timezone={timezone} />
            ) : null}
            {tab === "energy" && stats.energy ? (
              <UsageEnergyTab
                energy={stats.energy}
                filters={stats.filters}
                preferences={preferences}
                onPreferences={savePreferences}
                collectionStartedAt={stats.energy_collection_started_at ?? null}
              />
            ) : null}
            {/* Not gated on stats.efficiency: the bench rates are a measurement, not a
                reading of this period's traffic, so they are just as true on a rig whose
                telemetry has nothing to say yet. */}
            {tab === "efficiency" ? (
              <UsageEfficiencyTab
                efficiency={stats.efficiency}
                tokens={stats.tokens}
                rates={stats.energy_rates}
                filters={stats.filters}
                preferences={preferences}
                onPreferences={savePreferences}
              />
            ) : null}
          </>
        ) : (
          <EmptyNote>
            This controller answered but reports no token, energy or efficiency accounting. Nothing
            is wrong with the rig — this build simply does not measure it.
          </EmptyNote>
        )}
      </PageContainer>
    </AppPage>
  );
}
