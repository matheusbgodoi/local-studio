"use client";

import { useCallback, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import api from "@/lib/api/client";
import type { ModelDownload, ModelInfo, RecipeWithStatus, RuntimeTarget } from "@/lib/types";
import type { RecipeEditor } from "@/features/recipes/recipe-editor";
import { useRealtimeStatusStore } from "@/hooks/realtime-status-store";
import { readPageCache, scopedPageCacheKey, writePageCache } from "@/lib/page-data-cache";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { normalizeRecipeForEditor } from "@/features/recipes/normalize-recipe";
import { prepareRecipeForSave } from "@/features/recipes/prepare-recipe";
import { DEFAULT_RECIPE } from "./default-recipe";
import { useRecipesDerived } from "./use-recipes-derived";
import { isRecipeActive } from "./launch-reconciliation";
import { useControllerCapabilities } from "@/hooks/controller-capabilities-store";

export type RecipesContentTab = "local" | "picks" | "get" | "serves" | "downloads";

const requestedTab = (value: string | null): RecipesContentTab =>
  value === "picks" || value === "get" || value === "serves" || value === "downloads"
    ? value
    : "local";

const LEGACY_PINS_KEY = "local-studio-pinned-recipes";
const PINS_MIGRATION_KEY = "local-studio-pinned-recipes:migrated-controller";

function pinsKey(controllerKey: string): string {
  return `local-studio-pinned-recipes:${controllerKey || "default"}`;
}

function parsePins(value: string | null): Set<string> | null {
  if (value === null) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "string")) return null;
    return new Set(parsed);
  } catch {
    return null;
  }
}

function loadPinsForController(storageKey: string): Set<string> {
  try {
    const scoped = parsePins(localStorage.getItem(storageKey));
    if (scoped) return scoped;
    if (localStorage.getItem(PINS_MIGRATION_KEY)) return new Set();
    const legacy = parsePins(localStorage.getItem(LEGACY_PINS_KEY)) ?? new Set<string>();
    localStorage.setItem(storageKey, JSON.stringify([...legacy]));
    localStorage.setItem(PINS_MIGRATION_KEY, storageKey);
    return legacy;
  } catch {
    return new Set();
  }
}

function savePinsForController(storageKey: string, pins: Set<string>): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify([...pins]));
  } catch {}
}

export function useRecipesContentModel() {
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<RecipesContentTab>(() => requestedTab(searchParams.get("tab")));
  const { capabilities, controllerKey } = useControllerCapabilities();
  const lifecycleSupported = capabilities.features.lifecycle === "supported";
  const catalogSupported = capabilities.features.catalog === "supported";
  const modelIndexSupported = capabilities.features.modelIndex === "supported";
  const downloadQueueSupported = capabilities.features.downloadQueue === "supported";
  const recipesSupported = capabilities.features.recipes === "supported";
  const recipesCacheKey = scopedPageCacheKey(controllerKey, "recipes:list");
  const modelsCacheKey = scopedPageCacheKey(controllerKey, "recipes:models");
  const pinnedRecipesKey = pinsKey(controllerKey);
  // Stale-while-revalidate: paint the last-loaded recipe list instantly on
  // navigation while the fresh fetch runs in the background.
  const cachedRecipes = readPageCache<RecipeWithStatus[]>(recipesCacheKey);
  const [loading, setLoading] = useState(cachedRecipes === null);
  const [refreshing, setRefreshing] = useState(false);
  const [recipes, setRecipes] = useState<RecipeWithStatus[]>(() => cachedRecipes ?? []);
  const recipesRef = useRef<RecipeWithStatus[]>(cachedRecipes ?? []);
  const [recipesError, setRecipesError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [pinnedRecipes, setPinnedRecipes] = useState<Set<string>>(new Set());
  const [recipeMenuOpen, setRecipeMenuOpen] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [runningRecipeId, setRunningRecipeId] = useState<string | null>(
    () => cachedRecipes?.find((recipe) => recipe.status === "running")?.id ?? null,
  );
  const [launching, setLaunching] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalRecipe, setModalRecipe] = useState<RecipeEditor | null>(null);
  const [saving, setSaving] = useState(false);

  const [availableModels, setAvailableModels] = useState<ModelInfo[]>(
    () => readPageCache<ModelInfo[]>(modelsCacheKey) ?? [],
  );
  const [runtimeTargets, setRuntimeTargets] = useState<RuntimeTarget[]>([]);

  const { launchProgress } = useRealtimeStatusStore();

  useMountSubscription(() => {
    setPinnedRecipes(loadPinsForController(pinnedRecipesKey));
  }, [pinnedRecipesKey]);

  const togglePin = useCallback(
    (recipeId: string) => {
      setPinnedRecipes((prev) => {
        const next = new Set(prev);
        if (next.has(recipeId)) {
          next.delete(recipeId);
        } else {
          next.add(recipeId);
        }
        savePinsForController(pinnedRecipesKey, next);
        return next;
      });
    },
    [pinnedRecipesKey],
  );

  const loadRecipes = useCallback(async (): Promise<RecipeWithStatus[]> => {
    if (!recipesSupported) {
      setRecipesError(null);
      setLoading(false);
      return recipesRef.current;
    }
    try {
      const [recipesResult, modelsResult, runtimeResult] = await Promise.allSettled([
        api.getRecipes(),
        catalogSupported ? api.getModels() : Promise.resolve({ models: [] }),
        api.getRuntimeTargets(),
      ]);
      let result = recipesRef.current;
      if (recipesResult.status === "fulfilled") {
        result = recipesResult.value.recipes;
        recipesRef.current = result;
        writePageCache(recipesCacheKey, result);
        setRecipes(result);
        setRunningRecipeId(result.find((recipe) => recipe.status === "running")?.id ?? null);
        setRecipesError(null);
      } else {
        setRecipesError(
          recipesResult.reason instanceof Error
            ? recipesResult.reason.message
            : "Launch profiles could not be loaded",
        );
      }
      if (modelsResult.status === "fulfilled") {
        const models = modelsResult.value.models ?? [];
        writePageCache(modelsCacheKey, models);
        setAvailableModels(models);
      }
      if (runtimeResult.status === "fulfilled") {
        setRuntimeTargets(runtimeResult.value.targets ?? []);
      }
      return result;
    } catch (e) {
      console.error("Failed to load recipes:", e);
      return recipesRef.current;
    }
  }, [catalogSupported, modelsCacheKey, recipesCacheKey, recipesSupported]);

  useMountSubscription(() => {
    void (async () => {
      try {
        await loadRecipes();
      } finally {
        setLoading(false);
      }
    })();
  }, [loadRecipes]);

  const handleRefreshRecipes = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadRecipes();
    } finally {
      setRefreshing(false);
    }
  }, [loadRecipes]);

  const handleNewRecipe = useCallback(() => {
    if (!recipesSupported) return;
    setModalRecipe(normalizeRecipeForEditor({ ...DEFAULT_RECIPE }));
    setModalOpen(true);
  }, [recipesSupported]);

  useMountSubscription(() => {
    if (!recipesSupported || searchParams.get("new") !== "1") return;
    setTab("serves");
    handleNewRecipe();
  }, [handleNewRecipe, recipesSupported, searchParams]);

  const handleCreateServeFromDownload = useCallback(
    (download: ModelDownload) => {
      if (!recipesSupported) return;
      const modelName = download.model_id.split("/").filter(Boolean).at(-1) ?? download.model_id;
      setModalRecipe(
        normalizeRecipeForEditor({
          ...DEFAULT_RECIPE,
          name: modelName,
          model_path: download.target_dir,
          served_model_name: modelName,
        }),
      );
      setModalOpen(true);
    },
    [recipesSupported],
  );

  const handleEditRecipe = useCallback(
    (recipe: RecipeWithStatus) => {
      if (!recipesSupported) return;
      setModalRecipe(normalizeRecipeForEditor(recipe));
      setModalOpen(true);
      setRecipeMenuOpen(null);
    },
    [recipesSupported],
  );

  const handleSaveRecipe = useCallback(async () => {
    if (!recipesSupported || !modalRecipe) return;

    const recipeToSave = prepareRecipeForSave(modalRecipe);

    setSaving(true);
    try {
      if (recipeToSave.id) {
        await api.updateRecipe(recipeToSave.id, recipeToSave);
      } else {
        const slug = recipeToSave.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "");
        // A name with no ASCII alphanumerics slugs to "" — an empty id creates
        // a ghost recipe that can't be edited, deleted, or launched.
        const id = slug || `recipe-${Date.now()}`;
        await api.createRecipe({ ...recipeToSave, id });
      }
      await loadRecipes();
      setModalOpen(false);
      setModalRecipe(null);
    } catch (e) {
      alert("Failed to save recipe: " + (e as Error).message);
    } finally {
      setSaving(false);
    }
  }, [loadRecipes, modalRecipe, recipesSupported]);

  const handleDeleteRecipe = useCallback(
    async (recipeId: string) => {
      if (!recipesSupported) return;
      try {
        await api.deleteRecipe(recipeId);
        await loadRecipes();
        setDeleteConfirm(null);
        setRecipeMenuOpen(null);
      } catch (e) {
        alert("Failed to delete: " + (e as Error).message);
      }
    },
    [loadRecipes, recipesSupported],
  );

  const handleLaunchRecipe = useCallback(
    async (recipeId: string) => {
      if (!lifecycleSupported) return;
      setLaunching(true);
      try {
        await api.launchRecipe(recipeId);
        await loadRecipes();
      } catch (e) {
        const reconciled = await loadRecipes();
        if (!isRecipeActive(reconciled, recipeId)) {
          alert("Failed to launch: " + (e as Error).message);
        }
      } finally {
        setLaunching(false);
      }
    },
    [lifecycleSupported, loadRecipes],
  );

  const handleEvictModel = useCallback(async () => {
    if (!lifecycleSupported) return;
    await api.evict();
    await loadRecipes();
  }, [lifecycleSupported, loadRecipes]);

  const handleToggleRecipeMenu = useCallback((recipeId: string) => {
    setRecipeMenuOpen((current) => (current === recipeId ? null : recipeId));
  }, []);

  const handleRequestDelete = useCallback(
    (recipeId: string) => {
      if (!recipesSupported) return;
      setDeleteConfirm(recipeId);
      setRecipeMenuOpen(null);
    },
    [recipesSupported],
  );

  const closeRecipeModal = useCallback(() => {
    setModalOpen(false);
    setModalRecipe(null);
  }, []);

  const derived = useRecipesDerived({
    recipes,
    filter,
    pinnedRecipes,
    runningRecipeId,
    deleteConfirm,
  });

  return {
    tab:
      (tab === "serves" && !recipesSupported) ||
      (tab === "picks" && !modelIndexSupported) ||
      ((tab === "get" || tab === "downloads") && !downloadQueueSupported)
        ? "local"
        : tab,
    setTab,
    lifecycleSupported,
    catalogSupported,
    modelIndexSupported,
    downloadQueueSupported,
    recipesSupported,
    loading,
    refreshing,
    recipes,
    recipesError,
    filter,
    setFilter,
    togglePin,
    pinnedRecipes,
    recipeMenuOpen,
    deleteConfirm,
    setDeleteConfirm,
    runningRecipeId,
    launching,
    modalOpen,
    modalRecipe,
    setModalRecipe,
    saving,
    availableModels,
    runtimeTargets,
    launchProgress,
    derived: {
      sortedRecipes: derived.sortedRecipes,
      runningRecipe: derived.runningRecipe,
      deleteRecipe: derived.deleteRecipe,
    },
    actions: {
      handleRefreshRecipes,
      handleNewRecipe,
      handleCreateServeFromDownload,
      handleEditRecipe,
      handleSaveRecipe,
      handleDeleteRecipe,
      handleLaunchRecipe,
      handleEvictModel,
      handleToggleRecipeMenu,
      handleRequestDelete,
      closeRecipeModal,
    },
  };
}
