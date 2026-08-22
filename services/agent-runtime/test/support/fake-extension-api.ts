//
// A stand-in for the SDK's ExtensionAPI, so the control tools can be driven
// exactly as the model drives them without a model, a session or a card.
//
// It records what was registered and lets a test call a tool or fire a hook
// with the same shapes the SDK uses.
//
// Relative on purpose: bun resolves no `@/` alias from this package.
//

export type FakeToolResult = { content: { type: string; text?: string }[]; details?: unknown };

type FakeTool = {
  name: string;
  label: string;
  description: string;
  promptSnippet?: string;
  parameters: unknown;
  execute: (
    id: string,
    params: unknown,
    signal: unknown,
    onUpdate: unknown,
    ctx: FakeExtensionContext,
  ) => Promise<FakeToolResult>;
};

export type FakeExtensionContext = {
  cwd: string;
  model?: { id: string };
  sessionManager: { getSessionId: () => string | null };
};

export type FakeExtensionApi = {
  api: unknown;
  toolNames: () => string[];
  hasTool: (name: string) => boolean;
  callTool: (name: string, params: unknown, ctx?: Partial<FakeExtensionContext>) => Promise<string>;
  emit: <R>(hook: string, event: unknown) => Promise<R | undefined>;
  hookNames: () => string[];
};

const DEFAULT_CONTEXT: FakeExtensionContext = {
  cwd: "/tmp/project",
  model: { id: "fake-model" },
  sessionManager: { getSessionId: () => "pi-session" },
};

export function createFakeExtensionApi(): FakeExtensionApi {
  const tools = new Map<string, FakeTool>();
  const hooks = new Map<string, ((event: unknown, ctx: unknown) => unknown)[]>();
  let toolCallSeq = 0;

  const api = {
    registerTool(tool: FakeTool) {
      tools.set(tool.name, tool);
    },
    on(hook: string, handler: (event: unknown, ctx: unknown) => unknown) {
      const list = hooks.get(hook) ?? [];
      list.push(handler);
      hooks.set(hook, list);
    },
  };

  return {
    api,
    toolNames: () => [...tools.keys()],
    hasTool: (name) => tools.has(name),
    async callTool(name, params, ctx) {
      const tool = tools.get(name);
      if (!tool) throw new Error(`no tool named ${name}`);
      toolCallSeq += 1;
      const result = await tool.execute(
        `call-${toolCallSeq}`,
        params,
        undefined,
        undefined,
        { ...DEFAULT_CONTEXT, ...ctx, sessionManager: ctx?.sessionManager ?? DEFAULT_CONTEXT.sessionManager },
      );
      return result.content
        .filter((block) => block.type === "text")
        .map((block) => block.text ?? "")
        .join("");
    },
    async emit(hook, event) {
      let last: unknown;
      for (const handler of hooks.get(hook) ?? []) {
        const outcome = await handler(event, DEFAULT_CONTEXT);
        if (outcome !== undefined) last = outcome;
      }
      return last as never;
    },
    hookNames: () => [...hooks.keys()],
  };
}
