"use client";

import { Plus, Search, Square } from "@/ui/icon-registry";
import type { RecipeWithStatus } from "@/lib/types";
import { ModelLogo } from "@/ui/model-logo";
import { ModelButton, ModelInput } from "@/ui";
import {
  ModelActiveSummary,
  ModelRow,
  ModelSection,
  ModelStatus,
  type ModelSummaryItem,
} from "./model-page";
import { visionModeOverrideLabel } from "@/features/recipes/recipe-vision";
import type { RecipesTableProps } from "./types";
import { RecipesTable } from "./recipes-table";
import { displayNameForModel, useServedModels } from "@/hooks/served-models-store";
import { ModelStopConfirm } from "@/features/dashboard/model-stop-confirm";

type Props = {
  loading: boolean;
  loadError: string | null;
  filter: string;
  setFilter: (value: string) => void;
  recipes: RecipeWithStatus[];
  sortedRecipes: RecipeWithStatus[];
  runningRecipeId: string | null;
  runningRecipeName: string | null;
  launchProgressMessage: string | null;
  onEvictModel: () => Promise<void> | void;
  onNewRecipe: () => void;
  table: RecipesTableProps;
};

const activeRecipeFor = (recipes: RecipeWithStatus[], runningRecipeId: string | null) =>
  recipes.find((recipe) => recipe.id === runningRecipeId) ??
  recipes.find((recipe) => recipe.status === "running") ??
  null;

function ActiveStopAction({
  running,
  supported,
  onStop,
}: {
  running: boolean;
  supported: boolean;
  onStop: () => Promise<void> | void;
}) {
  if (!running || !supported) return null;
  return (
    <ModelStopConfirm
      onStop={onStop}
      trigger={({ open, stopping }) => (
        <ModelButton onClick={open} tone="danger" disabled={stopping}>
          <Square className="h-3 w-3" />
          {stopping ? "Unloading" : "Unload model"}
        </ModelButton>
      )}
    />
  );
}

const parallelismLabel = (recipe: RecipeWithStatus) =>
  `tp/pp ${recipe.tp || recipe.tensor_parallel_size || 1}/${recipe.pp || recipe.pipeline_parallel_size || 1}`;

const contextLabel = (recipe: RecipeWithStatus) =>
  recipe.max_model_len ? `${recipe.max_model_len.toLocaleString()} ctx` : "auto";

const activeDetailsFor = (
  recipe: RecipeWithStatus | null,
  loading: boolean,
  recipeCount: number,
): ModelSummaryItem[] => {
  if (!recipe) {
    return [
      { label: "state", value: loading ? "syncing" : "idle" },
      { label: "profiles", value: recipeCount || "defaults" },
    ];
  }
  const inputMode = visionModeOverrideLabel(recipe);
  return [
    { label: "backend", value: recipe.backend },
    { label: "runtime", value: recipe.runtime?.label ?? recipe.runtime?.kind ?? "legacy" },
    { label: "context", value: contextLabel(recipe) },
    { label: "parallel", value: parallelismLabel(recipe) },
    ...(inputMode ? [{ label: "input", value: inputMode }] : []),
  ];
};

export function RecipesTab({
  loading,
  loadError,
  filter,
  setFilter,
  recipes,
  sortedRecipes,
  runningRecipeId,
  runningRecipeName,
  launchProgressMessage,
  onEvictModel,
  onNewRecipe,
  table,
}: Props) {
  const { physicalModels } = useServedModels();
  const activeRecipe = activeRecipeFor(recipes, runningRecipeId);
  const activeTitle = activeRecipe
    ? (displayNameForModel(physicalModels, activeRecipe.served_model_name) ??
      "Model identity unavailable")
    : "No model loaded";
  const activeSubtitle =
    activeRecipe && runningRecipeName
      ? "Active launch profile"
      : loadError
        ? "This backend did not answer the launch profiles request."
        : "This controller is ready to launch a model.";
  const activeDetails = activeDetailsFor(activeRecipe, loading, sortedRecipes.length);

  return (
    <div className="space-y-6">
      <ModelSection
        title="Launch profiles"
        description="Each profile binds model weights, a runtime, and the settings used to launch it."
        actions={
          <ModelStatus
            tone={runningRecipeId ? "good" : loadError ? "danger" : loading ? "info" : "default"}
          >
            {runningRecipeId
              ? "running"
              : loadError
                ? "unreachable"
                : loading
                  ? "syncing"
                  : "ready"}
          </ModelStatus>
        }
      >
        <ModelRow
          label="Search launch profiles"
          description="Name, model path, runtime, or API model name."
          control={
            <div className="relative">
              <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-(--dim)" />
              <ModelInput
                value={filter}
                onChange={setFilter}
                placeholder="Search profiles, weights, runtimes"
                className="pl-7"
              />
            </div>
          }
          status={<ModelStatus>{sortedRecipes.length || "defaults"}</ModelStatus>}
          actions={
            <ModelButton onClick={onNewRecipe} tone="primary">
              <Plus className="h-3 w-3" />
              New launch profile
            </ModelButton>
          }
        />
        <ModelActiveSummary
          title={activeTitle}
          subtitle={activeSubtitle}
          leading={
            activeRecipe ? (
              <ModelLogo modelId={activeTitle} label={activeTitle} remoteAvatar={false} />
            ) : null
          }
          status={
            <ModelStatus tone={runningRecipeId ? "good" : loading ? "info" : "default"}>
              {runningRecipeId ? "live" : loading ? "syncing" : "idle"}
            </ModelStatus>
          }
          details={activeDetails}
          progress={launchProgressMessage}
          actions={
            <ActiveStopAction
              running={Boolean(runningRecipeId)}
              supported={table.lifecycleSupported}
              onStop={onEvictModel}
            />
          }
        />
      </ModelSection>

      <RecipesTable
        {...table}
        recipes={sortedRecipes}
        loading={loading}
        loadError={loadError}
        filter={filter}
        onNewRecipe={onNewRecipe}
      />
    </div>
  );
}
