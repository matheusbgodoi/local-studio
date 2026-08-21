"use client";

import type { ReactNode } from "react";
import { Compass, Cpu, Download, HardDrive, Sparkles } from "@/ui/icon-registry";
import type { ModelDownload, ModelInfo, RecipeWithStatus, RuntimeTarget } from "@/lib/types";
import type { RecipeEditor } from "@/features/recipes/recipe-editor";
import { RefreshButton, TabbedPage, Tabs } from "@/ui";
import type { RecipesContentTab } from "./recipes-content-model";
import type { RecipesTableProps } from "./types";
import { DeleteRecipeConfirmModal } from "./delete-recipe-confirm-modal";
import { RecipesTab } from "./recipes-tab";
import { RecipeModal } from "../recipe-modal/recipe-modal";
import { ExploreTab } from "./explore-tab";
import { DownloadsTab } from "./downloads-tab";
import { PicksTab } from "./picks-tab";
import { LocalModelsTab } from "./local-models-tab";

type Props = {
  embedded?: boolean;
  tab: RecipesContentTab;
  setTab: (tab: RecipesContentTab) => void;
  loading: boolean;
  refreshing: boolean;
  recipesError: string | null;
  filter: string;
  setFilter: (value: string) => void;
  modalOpen: boolean;
  modalRecipe: RecipeEditor | null;
  setModalRecipe: (recipe: RecipeEditor | null) => void;
  saving: boolean;
  recipes: RecipeWithStatus[];
  deleteConfirm: string | null;
  deleteRecipeName: string;
  runningRecipeId: string | null;
  runningRecipeName: string | null;
  launchProgressMessage: string | null;
  availableModels: ModelInfo[];
  runtimeTargets: RuntimeTarget[];
  sortedRecipes: RecipeWithStatus[];
  onRefresh: () => void;
  onNewRecipe: () => void;
  onCreateServeFromDownload: (download: ModelDownload) => void;
  onSaveRecipe: () => void;
  onCloseRecipeModal: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
  onEvictModel: () => void;
  table: RecipesTableProps;
};

const MODEL_TABS: Array<{ id: RecipesContentTab; label: string; icon: ReactNode }> = [
  { id: "local", label: "Local", icon: <Cpu className="h-3.5 w-3.5" /> },
  { id: "picks", label: "Picks", icon: <Sparkles className="h-3.5 w-3.5" /> },
  { id: "get", label: "Get", icon: <Compass className="h-3.5 w-3.5" /> },
  { id: "serves", label: "Serves", icon: <HardDrive className="h-3.5 w-3.5" /> },
  { id: "downloads", label: "Downloads", icon: <Download className="h-3.5 w-3.5" /> },
];

const TAB_HEADINGS: Record<RecipesContentTab, { title: string; description: string }> = {
  local: {
    title: "Local models",
    description:
      "The models this backend is serving right now, the GPUs behind them, and which one is resident.",
  },
  picks: {
    title: "Picks",
    description: "Curated model catalog grouped by hardware tier, with per-variant downloads.",
  },
  get: {
    title: "Get",
    description: "Find the right model, check hardware fit, and download its weights.",
  },
  serves: {
    title: "Serves",
    description: "Saved model, runtime, and configuration combinations ready to launch.",
  },
  downloads: {
    title: "Downloads",
    description: "Download queue, progress, retry, and cancel controls.",
  },
};

export function RecipesContentView(props: Props) {
  const {
    embedded = false,
    tab,
    setTab,
    loading,
    refreshing,
    recipesError,
    filter,
    setFilter,
    modalOpen,
    modalRecipe,
    setModalRecipe,
    saving,
    recipes,
    deleteConfirm,
    deleteRecipeName,
    runningRecipeId,
    runningRecipeName,
    launchProgressMessage,
    availableModels,
    runtimeTargets,
    sortedRecipes,
    onRefresh,
    onNewRecipe,
    onCreateServeFromDownload,
    onSaveRecipe,
    onCloseRecipeModal,
    onCancelDelete,
    onConfirmDelete,
    onEvictModel,
    table,
  } = props;
  const heading = TAB_HEADINGS[tab];
  const content = (
    <section>
      <h2 className="text-[length:var(--fs-2xl)] font-medium tracking-[-0.015em] text-(--ui-fg)">
        {heading.title}
      </h2>
      <p className="mt-1 text-[length:var(--fs-sm)] text-(--ui-muted)">{heading.description}</p>
      <div className="mt-6">
        {tab === "local" ? (
          <LocalModelsTab />
        ) : tab === "serves" ? (
          <RecipesTab
            loading={loading}
            loadError={recipesError}
            filter={filter}
            setFilter={setFilter}
            recipes={recipes}
            sortedRecipes={sortedRecipes}
            runningRecipeId={runningRecipeId}
            runningRecipeName={runningRecipeName}
            launchProgressMessage={launchProgressMessage}
            onEvictModel={onEvictModel}
            onNewRecipe={onNewRecipe}
            table={table}
          />
        ) : tab === "picks" ? (
          <PicksTab />
        ) : tab === "get" ? (
          <ExploreTab />
        ) : (
          <DownloadsTab onCreateServe={onCreateServeFromDownload} />
        )}
      </div>
    </section>
  );

  // THE HEADER REFRESH DOES NOT BELONG ON EVERY TAB.
  //
  // `onRefresh` is `loadRecipes`: it re-fetches /recipes, /models and /runtime-targets. On the
  // Local tab none of those are on screen — that tab reads /v1/models and the realtime status
  // store — so pressing it spun the header, re-requested routes this backend answers 404 for,
  // and left the served-model list beneath it untouched. Making Local the default put the
  // wrong Refresh in the page header.
  //
  // Local keeps the one it already has, sitting directly above the list it refreshes. The
  // alternative — driving the tab's refresh from up here — would mean calling useLocalModels()
  // in this component, and that fetches /v1/models on every tab instead of only the one that
  // shows it.
  const showHeaderRefresh = tab !== "local";
  return (
    <>
      {embedded ? (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-(--ui-separator) pb-3">
            <Tabs variant="pill" items={MODEL_TABS} activeTab={tab} onSelectTab={setTab} />
            {showHeaderRefresh ? (
              <RefreshButton
                onRefresh={onRefresh}
                loading={refreshing || loading}
                label="Refresh models"
                className="h-8 w-8"
              />
            ) : null}
          </div>
          {content}
        </div>
      ) : (
        <TabbedPage
          eyebrow="Model library"
          title="Models"
          description="The models this backend serves, plus the catalog, downloads, and Serves that depend on a controller."
          width="md"
          tabs={MODEL_TABS}
          activeTab={tab}
          onSelectTab={setTab}
          actions={
            showHeaderRefresh ? (
              <RefreshButton
                onRefresh={onRefresh}
                loading={refreshing || loading}
                label="Refresh models"
                className="h-8 w-8"
              />
            ) : null
          }
        >
          {content}
        </TabbedPage>
      )}

      {modalOpen && modalRecipe ? (
        <div className="fixed inset-0 z-50 flex justify-end">
          <button
            type="button"
            aria-label="Close recipe editor"
            className="absolute inset-0 bg-(--color-background)"
            onClick={onCloseRecipeModal}
          />
          <RecipeModal
            recipe={modalRecipe}
            onClose={onCloseRecipeModal}
            onSave={onSaveRecipe}
            onChange={setModalRecipe}
            saving={saving}
            availableModels={availableModels}
            runtimeTargets={runtimeTargets}
            recipes={recipes}
          />
        </div>
      ) : null}

      {deleteConfirm ? (
        <DeleteRecipeConfirmModal
          recipeName={deleteRecipeName}
          onCancel={onCancelDelete}
          onConfirm={onConfirmDelete}
        />
      ) : null}
    </>
  );
}
