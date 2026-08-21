"use client";

import { RefreshCw } from "@/ui/icon-registry";
import { ModelButton } from "@/ui";
import { ModelLogo } from "@/ui/model-logo";
import { cx } from "@/ui/utils";
import { formatNumber } from "@/lib/formatters";
import {
  ModelRow,
  ModelSection,
  ModelStatus,
  ModelValue,
  type ModelStatusTone,
} from "./model-page";
import { useLocalModels, type LocalModelCard } from "./use-local-models";

function capabilityFacts(card: LocalModelCard): string {
  return [
    card.contextWindow ? `${formatNumber(card.contextWindow)} ctx` : null,
    card.tools ? "tools" : null,
    card.vision ? "vision" : null,
    card.nativeThinking ? "thinking" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function ProfileList({ card }: { card: LocalModelCard }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[length:var(--fs-xs)] text-(--ui-muted)">
      {card.profiles.map((profile) => (
        <span key={profile.id} className="min-w-0">
          <span className="text-(--ui-fg)">{profile.label}</span> {profile.id}
          {profile.isDefault ? " · default" : ""}
          {profile.resident ? " · resident" : ""}
        </span>
      ))}
    </div>
  );
}

function LocalModelRow({ card }: { card: LocalModelCard }) {
  const facts = capabilityFacts(card);
  return (
    <ModelRow
      label={card.displayName}
      description={card.aliases.join(" · ")}
      leading={<ModelLogo modelId={card.id} label={card.displayName} />}
      value={facts ? <ModelValue mono>{facts}</ModelValue> : undefined}
      status={
        <ModelStatus tone={card.resident ? "good" : "default"}>
          {card.resident ? "resident" : "not loaded"}
        </ModelStatus>
      }
    >
      {card.profiles.length > 1 ? <ProfileList card={card} /> : null}
    </ModelRow>
  );
}

type ServedSummary = { tone: ModelStatusTone; label: string; empty: string };

function servedSummary(loading: boolean, error: string | null, count: number): ServedSummary {
  if (error) return { tone: "danger", label: "error", empty: error };
  if (loading) return { tone: "info", label: "loading", empty: "Waiting for the backend…" };
  if (count === 0) return { tone: "default", label: "empty", empty: "Nothing served" };
  return { tone: "good", label: `${count} models`, empty: "" };
}

export function LocalModelsTab() {
  const { cards, loading, error, connected, residentAlias, pool, refresh } = useLocalModels();
  const served = servedSummary(loading, error, cards.length);

  return (
    <div className="space-y-6">
      <ModelSection
        title="This machine"
        description="Hardware and the model held in VRAM right now, as the backend reports them."
        actions={
          <ModelStatus tone={connected ? "good" : "danger"}>
            {connected ? "connected" : "offline"}
          </ModelStatus>
        }
      >
        {pool ? (
          <ModelRow
            label={pool.label}
            description="Total VRAM across every GPU the backend can see."
            value={
              <ModelValue mono>
                {pool.usedGb} / {pool.totalGb} GB used
              </ModelValue>
            }
          />
        ) : null}
        <ModelRow
          label="Resident model"
          description="The alias currently loaded into the inference process."
          value={residentAlias ? <ModelValue mono>{residentAlias}</ModelValue> : undefined}
          status={
            <ModelStatus tone={residentAlias ? "good" : "default"}>
              {residentAlias ? "loaded" : "idle"}
            </ModelStatus>
          }
        />
      </ModelSection>

      <ModelSection
        title="Served models"
        description="Every alias this backend serves, grouped by the checkpoint behind it."
        actions={
          <div className="flex items-center gap-2.5">
            <ModelStatus tone={served.tone}>{served.label}</ModelStatus>
            <ModelButton onClick={() => void refresh()} disabled={loading}>
              <RefreshCw className={cx("h-3 w-3", loading ? "animate-spin" : "")} />
              Refresh
            </ModelButton>
          </div>
        }
      >
        {error ? (
          <ModelRow
            label="The served model list could not be read"
            description="This is the one route the page depends on, so nothing below is current."
            value={<ModelValue dim>{error}</ModelValue>}
            status={<ModelStatus tone="danger">error</ModelStatus>}
          />
        ) : null}
        {!error && cards.length === 0 ? (
          <ModelRow
            label={loading ? "Reading the served model list" : "This backend serves no models"}
            description="Aliases appear here as soon as the backend publishes them."
            value={<ModelValue dim>{served.empty}</ModelValue>}
            status={<ModelStatus tone={served.tone}>{served.label}</ModelStatus>}
          />
        ) : null}
        {cards.map((card) => (
          <LocalModelRow key={card.id} card={card} />
        ))}
      </ModelSection>
    </div>
  );
}
