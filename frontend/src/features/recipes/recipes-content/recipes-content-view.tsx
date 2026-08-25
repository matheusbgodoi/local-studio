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
  lifecycleSupported: boolean;
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
  { id: "serves", label: "Launch profiles", icon: <HardDrive className="h-3.5 w-3.5" /> },
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
    title: "Launch profiles",
    description: "Saved combinations of model weights, runtime, and launch settings.",
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
    lifecycleSupported,
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
  const modelTabs = lifecycleSupported
    ? MODEL_TABS
    : MODEL_TABS.filter((candidate) => candidate.id === "local");
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

  const showHeaderRefresh = lifecycleSupported && tab !== "local";
  return (
    <>
      {embedded ? (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-(--ui-separator) pb-3">
            <Tabs variant="pill" items={modelTabs} activeTab={tab} onSelectTab={setTab} />
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
          description={
            lifecycleSupported
              ? "Models currently served, plus catalogs, downloads, and launch profiles."
              : "Models currently served by this inference gateway."
          }
          width="md"
          tabs={modelTabs}
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
