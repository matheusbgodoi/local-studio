"use client";

import { useCallback, useMemo } from "react";
import type { RecipesTableProps } from "./types";
import { useRecipesContentModel, type RecipesContentTab } from "./recipes-content-model";
import { RecipesContentView } from "./recipes-content-view";
import { useControllerCapabilities } from "@/hooks/controller-capabilities-store";

export function RecipesContent({ embedded = false }: { embedded?: boolean }) {
  const { controllerKey } = useControllerCapabilities();
  return <RecipesContentForController key={controllerKey} embedded={embedded} />;
}

function RecipesContentForController({ embedded }: { embedded: boolean }) {
  const model = useRecipesContentModel();
  const setTab = model.setTab;
  const selectTab = useCallback(
    (tab: RecipesContentTab) => {
      setTab(tab);
      if (!embedded) return;
      const url = new URL(window.location.href);
      url.searchParams.set("tab", tab);
      url.hash = "models";
      window.history.replaceState(null, "", url);
    },
    [embedded, setTab],
  );

  const table = useMemo<RecipesTableProps>(
    () => ({
      recipes: model.derived.sortedRecipes,
      pinnedRecipes: model.pinnedRecipes,
      recipeMenuOpen: model.recipeMenuOpen,
      lifecycleSupported: model.lifecycleSupported,
      launching: model.launching,
      runningRecipeId: model.runningRecipeId,
      onTogglePin: model.togglePin,
      onToggleMenu: model.actions.handleToggleRecipeMenu,
      onLaunch: model.actions.handleLaunchRecipe,
      onStop: model.actions.handleEvictModel,
      onEdit: model.actions.handleEditRecipe,
      onRequestDelete: model.actions.handleRequestDelete,
    }),
    [
      model.actions.handleEditRecipe,
      model.actions.handleEvictModel,
      model.actions.handleLaunchRecipe,
      model.actions.handleRequestDelete,
      model.actions.handleToggleRecipeMenu,
      model.derived.sortedRecipes,
      model.lifecycleSupported,
      model.launching,
      model.pinnedRecipes,
      model.recipeMenuOpen,
      model.runningRecipeId,
      model.togglePin,
    ],
  );

  return (
    <RecipesContentView
      embedded={embedded}
      tab={model.tab}
      lifecycleSupported={model.lifecycleSupported}
      modelIndexSupported={model.modelIndexSupported}
      downloadQueueSupported={model.downloadQueueSupported}
      recipesSupported={model.recipesSupported}
      setTab={selectTab}
      loading={model.loading}
      refreshing={model.refreshing}
      recipesError={model.recipesError}
      filter={model.filter}
      setFilter={model.setFilter}
      modalOpen={model.modalOpen}
      modalRecipe={model.modalRecipe}
      setModalRecipe={model.setModalRecipe}
      saving={model.saving}
      recipes={model.recipes}
      deleteConfirm={model.deleteConfirm}
      deleteRecipeName={model.derived.deleteRecipe?.name ?? ""}
      runningRecipeId={model.runningRecipeId}
      runningRecipeName={model.derived.runningRecipe?.name ?? null}
      launchProgressMessage={model.launchProgress?.message ?? null}
      availableModels={model.availableModels}
      runtimeTargets={model.runtimeTargets}
      sortedRecipes={model.derived.sortedRecipes}
      onRefreshRecipes={model.actions.handleRefreshRecipes}
      onNewRecipe={model.actions.handleNewRecipe}
      onCreateServeFromDownload={
        model.recipesSupported ? model.actions.handleCreateServeFromDownload : undefined
      }
      onSaveRecipe={model.actions.handleSaveRecipe}
      onCloseRecipeModal={model.actions.closeRecipeModal}
      onCancelDelete={() => model.setDeleteConfirm(null)}
      onConfirmDelete={async () => {
        if (model.deleteConfirm) {
          await model.actions.handleDeleteRecipe(model.deleteConfirm);
        }
      }}
      onEvictModel={model.actions.handleEvictModel}
      table={table}
    />
  );
}
