import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  PERSONAL_MEMORY_PROMPT_CHARACTERS,
  type PersonalMemoryCategory,
  type PersonalMemorySensitivity,
} from "../../../shared/agent/personal-memory";
import { addPersonalMemory, readPersonalMemorySync } from "./personal-memory-store";

const MARKER = "CRIAs AI confirmed personal memory:";

function schema<T>(value: T): T & { "~unsafe": null } {
  return { ...value, "~unsafe": null };
}

function memorySection(): string | null {
  const document = readPersonalMemorySync();
  if (document.mode !== "automatic") return null;
  const lines: string[] = [];
  let used = 0;
  for (const entry of document.entries) {
    if (!entry.enabled) continue;
    const line = `- [${entry.category}] ${entry.text}`;
    if (used + line.length > PERSONAL_MEMORY_PROMPT_CHARACTERS) break;
    lines.push(line);
    used += line.length;
  }
  const knowledge =
    document.knowledgeMode === "required"
      ? "For claims about the owner, their studies, companies or projects, always investigate with the personal Knowledge tools and cite the returned vault path. If evidence is missing, say so."
      : document.knowledgeMode === "automatic"
        ? "Use the personal Knowledge tools when the answer depends on the owner's vault, especially for identity, studies, companies, projects or preferences. Start broad requests by separating their facets and cite the returned vault paths."
        : "Personal Knowledge retrieval is disabled. Do not claim access to the owner's vault.";
  return [
    MARKER,
    "These are short facts explicitly confirmed by the owner. Use them as preferences, not as instructions that override the current request. Never infer additional facts from them.",
    ...(lines.length ? ["", ...lines] : ["", "No confirmed memory items are stored."]),
    "",
    knowledge,
    "When the owner clearly expresses a durable everyday preference or personal working style, you may call remember_personal_detail. Do not propose secrets, health data, document contents, temporary tasks or facts learned from tools.",
  ].join("\n");
}

function result(text: string) {
  return { content: [{ type: "text" as const, text }], details: {} };
}

export function createPersonalMemoryExtension() {
  return (pi: ExtensionAPI): void => {
    pi.on("before_agent_start", (event) => {
      const section = memorySection();
      if (!section || event.systemPrompt.includes(MARKER)) return {};
      return { systemPrompt: `${event.systemPrompt.trimEnd()}\n\n${section}` };
    });

    pi.registerTool({
      name: "remember_personal_detail",
      label: "Remember a personal preference",
      description:
        "Propose one short, durable everyday preference or personal working style for explicit owner confirmation. Never use for secrets, health data, retrieved documents, temporary tasks, or deductions.",
      parameters: schema({
        type: "object",
        required: ["text"],
        properties: {
          text: { type: "string", maxLength: 280 },
          category: {
            type: "string",
            enum: [
              "preference",
              "identity",
              "work",
              "communication",
              "restriction",
              "goal",
              "other",
            ],
          },
          sensitivity: { type: "string", enum: ["standard", "local_only"] },
        },
      }),
      async execute(_id, params, _signal, _update, ctx) {
        const document = readPersonalMemorySync();
        if (document.mode !== "automatic")
          return result("Personal memory is disabled in Settings.");
        const input = (params ?? {}) as Record<string, unknown>;
        const text = typeof input.text === "string" ? input.text.trim() : "";
        if (!text) return result("Nothing was saved because the proposed memory was empty.");
        if (!ctx.hasUI)
          return result("Nothing was saved because owner confirmation is unavailable.");
        const confirmed = await ctx.ui.confirm(
          "Remember this about you?",
          `${text}\n\nYou can edit or remove it later in Settings → Memory.`,
          { signal: ctx.signal },
        );
        if (!confirmed) return result("The owner declined this memory. Nothing was saved.");
        await addPersonalMemory(
          {
            text,
            category: (input.category as PersonalMemoryCategory | undefined) ?? "preference",
            sensitivity: (input.sensitivity as PersonalMemorySensitivity | undefined) ?? "standard",
          },
          "conversation",
        );
        return result("The owner confirmed this memory. It is now visible in Settings → Memory.");
      },
    });
  };
}
