"use client";

import { useState } from "react";
import { Plus } from "@/ui/icon-registry";
import { ModelButton } from "@/ui";
import type { RecipeWithStatus } from "@/lib/types";
import { ModelRow, ModelSection, ModelStatus, ModelValue } from "./model-page";
import { AttachLocalAgentsDialog } from "@/features/settings/attach-local-agents-dialog";
import { RecipeRow } from "./recipe-row";
import { displayNameForModel, useServedModels } from "@/hooks/served-models-store";

type Props = {
  recipes: RecipeWithStatus[];
  pinnedRecipes: Set<string>;
  recipeMenuOpen: string | null;
  lifecycleSupported: boolean;
  launching: boolean;
  runningRecipeId: string | null;
  loading: boolean;
  loadError: string | null;
  filter: string;
  onTogglePin: (recipeId: string) => void;
  onToggleMenu: (recipeId: string) => void;
  onLaunch: (recipeId: string) => void;
  onStop: () => void;
  onEdit: (recipe: RecipeWithStatus) => void;
  onRequestDelete: (recipeId: string) => void;
  onNewRecipe: () => void;
};

const TEMPLATE_ROWS = [
  {
    label: "vLLM default",
    description: "CUDA-first OpenAI-compatible launch profile.",
    value: "backend vLLM · tp/pp 1/1",
    status: "template",
  },
  {
    label: "SGLang server",
    description: "Structured generation runtime with metrics enabled by default.",
    value: "backend SGLang · metrics ready",
    status: "template",
  },
  {
    label: "llama.cpp local",
    description: "GGUF-oriented CPU, Metal, or CUDA target.",
    value: "backend llama.cpp · local path",
    status: "template",
  },
];

function profileSummary(count: number, loadError: string | null, loading: boolean) {
  if (loadError) {
    return { tone: "danger" as const, label: count ? "refresh failed" : "unreachable" };
  }
  if (count) return { tone: "good" as const, label: `${count} rows` };
  if (loading) return { tone: "info" as const, label: "syncing" };
  return { tone: "default" as const, label: "defaults" };
}

function ProfileLoadError({ error, hasProfiles }: { error: string | null; hasProfiles: boolean }) {
  if (!error) return null;
  return (
    <ModelRow
      label={
        hasProfiles
          ? "Launch profiles could not be refreshed"
          : "Launch profiles could not be read from this backend"
      }
      description={
        hasProfiles
          ? "The last successful profile list remains visible below."
          : "Nothing is listed because the request failed, not because there are no launch profiles."
      }
      value={<ModelValue dim>{error}</ModelValue>}
      status={<ModelStatus tone="danger">unreachable</ModelStatus>}
    />
  );
}

export function RecipesTable({
  recipes,
  pinnedRecipes,
  recipeMenuOpen,
  lifecycleSupported,
  launching,
  runningRecipeId,
  loading,
  loadError,
  filter,
  onTogglePin,
  onToggleMenu,
  onLaunch,
  onStop,
  onEdit,
  onRequestDelete,
  onNewRecipe,
}: Props) {
  const { physicalModels } = useServedModels();
  const [attachRecipe, setAttachRecipe] = useState<RecipeWithStatus | null>(null);
  const emptyBecauseSearch = Boolean(filter.trim()) && recipes.length === 0;
  const summary = profileSummary(recipes.length, loadError, loading);
  const launchDisabledReason = !lifecycleSupported
    ? "Model lifecycle controls are unavailable on this controller."
    : launching
      ? "A launch is already in progress."
      : runningRecipeId
        ? "Unload the running model before launching another one."
        : null;

  return (
    <ModelSection
      title="Saved launch profiles"
      description={
        lifecycleSupported
          ? "Launch-ready model, runtime, and configuration combinations."
          : "Profiles can be managed here, but this controller cannot launch or unload models."
      }
      actions={<ModelStatus tone={summary.tone}>{summary.label}</ModelStatus>}
    >
      {loading ? (
        <ModelRow
          label="Controller sync"
          description="Launch profile requests are still in flight; stable defaults stay visible below."
          value={<ModelValue dim>Loading launch profiles…</ModelValue>}
          status={<ModelStatus tone="info">syncing</ModelStatus>}
        />
      ) : null}

      {launchDisabledReason ? (
        <ModelRow
          label="Launch controls"
          description={launchDisabledReason}
          value={
            <ModelValue dim>Launch buttons are locked until the controller is ready.</ModelValue>
          }
          status={<ModelStatus tone="info">locked</ModelStatus>}
        />
      ) : null}

      <ProfileLoadError error={loadError} hasProfiles={recipes.length > 0} />

      {recipes.length
        ? recipes.map((recipe) => (
            <RecipeRow
              key={recipe.id}
              recipe={recipe}
              isPinned={pinnedRecipes.has(recipe.id)}
              isMenuOpen={recipeMenuOpen === recipe.id}
              lifecycleSupported={lifecycleSupported}
              launchDisabled={!lifecycleSupported || launching || Boolean(runningRecipeId)}
              launchDisabledReason={launchDisabledReason}
              onTogglePin={onTogglePin}
              onToggleMenu={onToggleMenu}
              onLaunch={onLaunch}
              onStop={onStop}
              onEdit={onEdit}
              onRequestDelete={onRequestDelete}
              onAttachAgents={setAttachRecipe}
              modelDisplayName={
                displayNameForModel(physicalModels, recipe.served_model_name) ??
                "Model identity unavailable"
              }
            />
          ))
        : loadError
          ? null
          : TEMPLATE_ROWS.map((row) => (
              <ModelRow
                key={row.label}
                label={row.label}
                description={
                  emptyBecauseSearch
                    ? `No exact match for "${filter.trim()}". ${row.description}`
                    : row.description
                }
                value={<ModelValue mono>{row.value}</ModelValue>}
                status={<ModelStatus>{row.status}</ModelStatus>}
                actions={
                  <ModelButton onClick={onNewRecipe}>
                    <Plus className="h-3 w-3" />
                    Use
                  </ModelButton>
                }
              />
            ))}

      {attachRecipe ? (
        <AttachLocalAgentsDialog
          modelId={attachRecipe.served_model_name || attachRecipe.id}
          modelName={attachRecipe.name}
          onClose={() => setAttachRecipe(null)}
        />
      ) : null}
    </ModelSection>
  );
}
