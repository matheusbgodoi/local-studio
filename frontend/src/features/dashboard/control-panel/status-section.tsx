"use client";

import type { GPU, Metrics, ProcessInfo, RecipeWithStatus, RuntimePlatformKind } from "@/lib/types";
import { StatusHeader, StatusMetricStrip } from "./status-section-parts";
import { MetricTrends, useMetricSamples } from "./status-section-trends";
import { resolveStatusSectionView } from "./status-section-view";
import {
  displayNameForModel,
  physicalIdForModel,
  useServedModels,
} from "@/hooks/served-models-store";
import { useControllerCapabilities } from "@/hooks/controller-capabilities-store";

interface StatusSectionProps {
  currentProcess: ProcessInfo | null;
  currentRecipe: RecipeWithStatus | null;
  metrics: Metrics | null;
  metricsObservedAt: number;
  gpusObservedAt: number;
  gpus: GPU[];
  isConnected: boolean;
  isStatusLoading: boolean;
  platformKind?: RuntimePlatformKind | null;
  inferencePort?: number;
  onNavigateLogs: () => void;
  onBenchmark: () => void;
  benchmarking: boolean;
  benchmarkResult: number | null;
  recipes?: RecipeWithStatus[];
  lifecycleStatus?: "idle" | "starting" | "ready" | "error";
  lifecycleError?: string | null;
  onLaunch?: (recipeId: string) => Promise<void>;
  onNewRecipe?: () => void;
  onViewAll?: () => void;
}

export function StatusSection({
  currentProcess,
  currentRecipe,
  metrics,
  metricsObservedAt,
  gpusObservedAt,
  gpus,
  isConnected,
  isStatusLoading,
  platformKind,
  inferencePort,
  onNavigateLogs,
  onBenchmark,
  benchmarking,
  benchmarkResult,
  recipes,
  lifecycleStatus = "idle",
  lifecycleError,
  onLaunch,
  onNewRecipe,
  onViewAll,
}: StatusSectionProps) {
  const { controllerKey } = useControllerCapabilities();
  const { physicalModels } = useServedModels();
  const modelDisplayName = displayNameForModel(physicalModels, currentProcess?.served_model_name);
  const physicalModelId = physicalIdForModel(physicalModels, currentProcess?.served_model_name);
  const view = resolveStatusSectionView({
    currentProcess,
    currentRecipe,
    gpus,
    inferencePort,
    metrics,
    modelDisplayName,
    physicalModelId,
    platformKind,
  });
  const trendData = useMetricSamples(
    view.sampleInput,
    { gpus: gpusObservedAt, metrics: metricsObservedAt },
    controllerKey,
  );

  return (
    <section className="px-2 pt-2 pb-5">
      <StatusHeader
        backend={view.backend}
        benchmarking={benchmarking}
        benchmarkResult={benchmarkResult}
        currentRecipeId={currentRecipe?.id}
        displayPlatformKind={view.displayPlatformKind}
        displayPort={view.displayPort}
        isConnected={isConnected}
        isRunning={view.isRunning}
        isStatusLoading={isStatusLoading}
        lifecycleStatus={lifecycleStatus}
        lifecycleError={lifecycleError}
        modelName={view.modelName}
        onBenchmark={onBenchmark}
        onLaunch={onLaunch}
        onNavigateLogs={onNavigateLogs}
        onNewRecipe={onNewRecipe}
        onViewAll={onViewAll}
        recipes={recipes}
      />
      <StatusMetricStrip compactMetrics={view.compactMetrics} metricColumns={view.metricColumns} />
      <MetricTrends
        key={controllerKey}
        controllerKey={controllerKey}
        samples={trendData.samples}
        peaks={trendData.peaks}
      />
    </section>
  );
}
