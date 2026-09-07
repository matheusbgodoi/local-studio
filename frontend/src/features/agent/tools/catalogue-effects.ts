import { useRef } from "react";
import { Effect } from "effect";
import type {
  ComposerPromptTemplateRef,
  ComposerSkillRef,
} from "@/features/agent/composer-context";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import type { ConnectorCatalogueRow } from "@/features/agent/tools/types";
import { PERSONAL_CONNECTORS } from "@shared/agent/personal-connectors";

function loadCatalogueListEffect<TItem>(url: string, key: string): Effect.Effect<TItem[]> {
  return Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: () => fetch(url, { cache: "no-store" }),
      catch: (error) => error,
    });
    const payload = yield* Effect.tryPromise({
      try: () => response.json() as Promise<Record<string, TItem[] | undefined>>,
      catch: (error) => error,
    });
    return payload[key] ?? [];
  }).pipe(Effect.catch(() => Effect.succeed([])));
}

/** The personal connectors that are actually present + enabled in
 *  connectors.json, described by the shared alias table. Registered != active:
 *  nothing here is on the wire until `/mcp <name>` arms it for a session. */
function loadConnectorCatalogueEffect(): Effect.Effect<ConnectorCatalogueRow[]> {
  return loadCatalogueListEffect<string>("/api/agent/connectors/session", "registered").pipe(
    Effect.map((registered) => {
      const present = new Set(registered);
      return PERSONAL_CONNECTORS.filter((entry) => present.has(entry.connectorId)).map((entry) => ({
        connectorId: entry.connectorId,
        alias: entry.alias,
        label: entry.label,
        description: entry.description,
      }));
    }),
  );
}

function loadToolsCatalogueEffect(): Effect.Effect<{
  skills: ComposerSkillRef[];
  promptTemplates: ComposerPromptTemplateRef[];
  connectors: ConnectorCatalogueRow[];
}> {
  return Effect.gen(function* () {
    const [skills, promptTemplates, connectors] = yield* Effect.all([
      loadCatalogueListEffect<ComposerSkillRef>("/api/agent/skills", "skills"),
      loadCatalogueListEffect<ComposerPromptTemplateRef>(
        "/api/agent/prompt-templates",
        "templates",
      ),
      loadConnectorCatalogueEffect(),
    ] as const);
    return { skills, promptTemplates, connectors };
  });
}

type UseToolsCatalogueEffectsOptions = {
  enabled: boolean;
  onLoaded: (payload: {
    skills: ComposerSkillRef[];
    promptTemplates: ComposerPromptTemplateRef[];
    connectors: ConnectorCatalogueRow[];
  }) => void;
};

export function useToolsCatalogueEffects({
  enabled,
  onLoaded,
}: UseToolsCatalogueEffectsOptions): void {
  const onLoadedRef = useRef(onLoaded);
  useMountSubscription(() => {
    if (!enabled) return;
    let cancelled = false;
    void Effect.runPromise(
      loadToolsCatalogueEffect().pipe(
        Effect.map((payload) => {
          if (!cancelled) onLoadedRef.current(payload);
        }),
      ),
    );
    return () => {
      cancelled = true;
    };
  }, [enabled]);
}
