"use client";

import type {
  ComposerPromptTemplateRef,
  ComposerSkillRef,
} from "@/features/agent/composer-context";
import { useToolsCatalogueEffects } from "@/features/agent/tools/catalogue-effects";
import type { ConnectorCatalogueRow } from "@/features/agent/tools/types";

type ToolsEffectsBridgeProps = {
  catalogueEnabled: boolean;
  onCatalogueLoaded: (payload: {
    skills: ComposerSkillRef[];
    promptTemplates: ComposerPromptTemplateRef[];
    connectors: ConnectorCatalogueRow[];
  }) => void;
};

export function ToolsEffectsBridge({
  catalogueEnabled,
  onCatalogueLoaded,
}: ToolsEffectsBridgeProps) {
  useToolsCatalogueEffects({
    enabled: catalogueEnabled,
    onLoaded: onCatalogueLoaded,
  });
  return null;
}
