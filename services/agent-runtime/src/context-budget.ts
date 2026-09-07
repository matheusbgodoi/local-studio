import { contextUsageIsMeasured } from "./context-usage-provenance";
import { formatSkillsForPrompt } from "@earendil-works/pi-coding-agent";
import type { AgentSessionRuntime } from "@earendil-works/pi-coding-agent";

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
    sdkContextTokens: number | null;
    systemPrompt: number;
    toolSchemas: number;
    conversation: number;
    overheadBeforeConversation: number;
    total: number;
  };
  withinSystemPrompt: {
    skillsCatalogue: number;
    contextFiles: number;
    remainder: number;
  };
  skillBodiesNotSent: number;
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
  const skillsCatalogue = estimateTextTokens(formatSkillsForPrompt(loadedSkills));
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
  const skillBodies = skills.reduce((sum, entry) => sum + entry.estimatedTokens, 0);
  const contextFileTokens = contextFiles.reduce((sum, entry) => sum + entry.estimatedTokens, 0);

  let conversation = 0;
  try {
    for (const message of session.messages) {
      conversation += estimateTextTokens(JSON.stringify(message));
    }
  } catch {
    conversation = 0;
  }

  const overheadBeforeConversation = systemPrompt + toolSchemas;
  const usage = session.getContextUsage();
  const isMeasured = contextUsageIsMeasured(usage?.tokens, session.messages);
  const settings = session.settingsManager.getCompactionSettings();
  const contextWindow = session.model?.contextWindow ?? null;

  return {
    sessionId: session.sessionId || null,
    modelId: session.model?.id ?? null,
    measured: {
      tokens: isMeasured ? (usage?.tokens ?? null) : null,
      contextWindow: contextWindow,
      percent: isMeasured ? (usage?.percent ?? null) : null,
      compactionThreshold:
        contextWindow && settings.enabled ? contextWindow - settings.reserveTokens : null,
    },
    estimated: {
      sdkContextTokens: !isMeasured && typeof usage?.tokens === "number" ? usage.tokens : null,
      systemPrompt,
      toolSchemas,
      conversation,
      overheadBeforeConversation,
      total: overheadBeforeConversation + conversation,
    },
    withinSystemPrompt: {
      skillsCatalogue,
      contextFiles: contextFileTokens,
      remainder: Math.max(0, systemPrompt - skillsCatalogue - contextFileTokens),
    },
    skillBodiesNotSent: skillBodies,
    tools,
    skills,
    contextFiles,
    activeToolCount: activeNames.length,
    availableToolCount: allTools.length,
    note:
      "sdkContextTokens is the SDK hybrid of prior usage plus estimated trailing messages. Other figures under `estimated` are four-characters-per-token approximations of the " +
      "text that would be sent. Only `measured` comes from the backend's own accounting. " +
      "`withinSystemPrompt` decomposes the system prompt rather than adding to it, and " +
      "`skillBodiesNotSent` is never sent — skills are loaded on demand.",
  };
}
