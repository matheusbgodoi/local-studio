import type { AgentSessionRuntime } from "@earendil-works/pi-coding-agent";

//
// Everything here is an ESTIMATE and is labelled as one. The only measured
// number in the report is `reported`, which comes from the backend's own usage
// accounting for the last turn. Four characters per token is the usual rule of
// thumb for this tokenizer family; it is close enough to tell a 400-token tool
// schema from a 4000-token one, which is the question this answers, and not
// close enough to be quoted as a measurement.
//
const CHARS_PER_TOKEN = 4;

export function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export type ContextBudgetEntry = {
  name: string;
  estimatedTokens: number;
};

export type ContextBudgetReport = {
  sessionId: string | null;
  modelId: string | null;
  measured: {
    tokens: number | null;
    contextWindow: number | null;
    percent: number | null;
    compactionThreshold: number | null;
  };
  estimated: {
    systemPrompt: number;
    toolSchemas: number;
    skills: number;
    contextFiles: number;
    conversation: number;
    overheadBeforeConversation: number;
    total: number;
  };
  tools: ContextBudgetEntry[];
  skills: ContextBudgetEntry[];
  contextFiles: ContextBudgetEntry[];
  activeToolCount: number;
  availableToolCount: number;
  note: string;
};

type SessionLike = AgentSessionRuntime["session"];

function toolSchemaTokens(session: SessionLike, name: string): number {
  try {
    const definition = session.getToolDefinition(name);
    if (!definition) return 0;
    // What the model actually pays for is the wire shape: the name, the
    // description and the parameter schema. Handlers and UI labels never leave
    // this process, so counting the whole object would overstate the cost.
    const wire = {
      name: definition.name,
      description: definition.description,
      parameters: definition.parameters,
    };
    return estimateTextTokens(JSON.stringify(wire));
  } catch {
    return 0;
  }
}

export function describeContextBudget(session: SessionLike): ContextBudgetReport {
  const activeNames = session.getActiveToolNames();
  const allTools = session.getAllTools();

  const tools: ContextBudgetEntry[] = activeNames
    .map((name) => ({ name, estimatedTokens: toolSchemaTokens(session, name) }))
    .sort((a, b) => b.estimatedTokens - a.estimatedTokens);

  const loader = session.resourceLoader;
  const loadedSkills = loader.getSkills().skills ?? [];
  const skills: ContextBudgetEntry[] = loadedSkills
    .map((skill) => {
      const record = skill as unknown as Record<string, unknown>;
      const name = typeof record.name === "string" ? record.name : "skill";
      const body = [record.description, record.content, record.instructions]
        .filter((value): value is string => typeof value === "string")
        .join("\n");
      return { name, estimatedTokens: estimateTextTokens(body) };
    })
    .sort((a, b) => b.estimatedTokens - a.estimatedTokens);

  const loadedContextFiles = loader.getAgentsFiles().agentsFiles ?? [];
  const contextFiles: ContextBudgetEntry[] = loadedContextFiles
    .map((file) => {
      const record = file as unknown as Record<string, unknown>;
      const name =
        typeof record.path === "string"
          ? record.path
          : typeof record.name === "string"
            ? record.name
            : "context file";
      const body = typeof record.content === "string" ? record.content : "";
      return { name, estimatedTokens: estimateTextTokens(body) };
    })
    .sort((a, b) => b.estimatedTokens - a.estimatedTokens);

  const systemPrompt = estimateTextTokens(session.systemPrompt ?? "");
  const toolSchemas = tools.reduce((sum, entry) => sum + entry.estimatedTokens, 0);
  const skillTokens = skills.reduce((sum, entry) => sum + entry.estimatedTokens, 0);
  const contextFileTokens = contextFiles.reduce((sum, entry) => sum + entry.estimatedTokens, 0);

  let conversation = 0;
  try {
    for (const message of session.messages) {
      conversation += estimateTextTokens(JSON.stringify(message));
    }
  } catch {
    conversation = 0;
  }

  const overheadBeforeConversation = systemPrompt + toolSchemas + skillTokens + contextFileTokens;
  const usage = session.getContextUsage();
  const settings = session.settingsManager.getCompactionSettings();
  const contextWindow = session.model?.contextWindow ?? null;

  return {
    sessionId: session.sessionId || null,
    modelId: session.model?.id ?? null,
    measured: {
      tokens: typeof usage?.tokens === "number" ? usage.tokens : null,
      contextWindow: contextWindow,
      percent: typeof usage?.percent === "number" ? usage.percent : null,
      compactionThreshold:
        contextWindow && settings.enabled ? contextWindow - settings.reserveTokens : null,
    },
    estimated: {
      systemPrompt,
      toolSchemas,
      skills: skillTokens,
      contextFiles: contextFileTokens,
      conversation,
      overheadBeforeConversation,
      total: overheadBeforeConversation + conversation,
    },
    tools,
    skills,
    contextFiles,
    activeToolCount: activeNames.length,
    availableToolCount: allTools.length,
    note:
      "Every figure under `estimated` is a four-characters-per-token approximation of the " +
      "text that would be sent. Only `measured` comes from the backend's own accounting.",
  };
}
