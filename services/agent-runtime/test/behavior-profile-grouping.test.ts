import { describe, expect, test } from "bun:test";
// Relative on purpose: bun resolves no "@/" alias from this package.
import {
  groupByPhysicalModel,
  normalizeOpenAIModel,
  normalizeOpenAIModels,
  resolveProfileId,
  resolveThinkingContract,
  type AgentModel,
  type AgentModelSelection,
} from "../../../shared/agent/models";
import { thinkingAfterModelSelection } from "../../../frontend/src/features/agent/messages/thinking-level-pref";
import {
  readModelThinkingLevel,
  writeModelThinkingLevel,
} from "../../../frontend/src/features/agent/workspace/thinking-level-preference";
import { controllerModelThinkingLevels } from "../src/pi-runtime-models";

// The rows the gateway serves today: three physical models, four aliases. The
// two Qwen rows are one checkpoint served twice, so they carry one
// physicalModelId and one displayName between them.
const LIVE_MODELS = {
  object: "list",
  data: [
    {
      id: "qwen-daily",
      metadata: {
        physicalModelId: "qwen-daily",
        behaviorProfile: "standard",
        behaviorProfileLabel: "Standard",
        behaviorProfileDefault: true,
        displayName: "Qwen3.8-27B",
        contextWindow: 149504,
        maxTokens: 32768,
        reasoning: true,
        nativeReasoning: false,
        vision: true,
      },
    },
    {
      id: "qwen-uncensored",
      metadata: {
        physicalModelId: "qwen-daily",
        behaviorProfile: "uncensored",
        behaviorProfileLabel: "Uncensored",
        displayName: "Qwen3.8-27B",
        contextWindow: 149504,
        maxTokens: 32768,
        reasoning: true,
        nativeReasoning: false,
        vision: true,
      },
    },
    {
      id: "ornith-turbo",
      metadata: {
        physicalModelId: "ornith-turbo",
        displayName: "Ornith-1.5-35B-A3B",
        contextWindow: 196608,
        maxTokens: 32768,
        reasoning: false,
        nativeReasoning: true,
        vision: true,
      },
    },
    {
      id: "gemma-write",
      metadata: {
        physicalModelId: "gemma-write",
        displayName: "Gemma 4 26B-A4B",
        contextWindow: 131072,
        maxTokens: 32768,
        reasoning: false,
        vision: false,
      },
    },
  ],
};

/** The ladder the agent-runtime layer resolves for a row — what lands in
 *  AgentModel.thinkingLevels, and what the picker offers. */
const ladderFor = (model: AgentModel) =>
  controllerModelThinkingLevels(model.reasoning, model.rawId ?? model.id, {
    physicalModelId: model.physicalModelId,
    nativeReasoning: model.nativeReasoning,
  });

function agentModel(overrides: Partial<AgentModel> & { id: string }): AgentModel {
  return {
    name: overrides.id,
    provider: "local-studio",
    physicalModelId: overrides.id,
    contextWindow: 128_000,
    maxTokens: 65_536,
    reasoning: false,
    vision: false,
    active: false,
    ...overrides,
  };
}

describe("the alias row carries its physical model", () => {
  test("metadata is read straight through", () => {
    const model = normalizeOpenAIModel(LIVE_MODELS.data[1]);
    expect(model.id).toBe("qwen-uncensored");
    expect(model.physicalModelId).toBe("qwen-daily");
    expect(model.behaviorProfile).toBe("uncensored");
    expect(model.behaviorProfileLabel).toBe("Uncensored");
    expect(model.displayName).toBe("Qwen3.8-27B");
    // The uncensored alias declares no default, and must never acquire one.
    expect(model.behaviorProfileDefault).toBeUndefined();
    expect(normalizeOpenAIModel(LIVE_MODELS.data[0]).behaviorProfileDefault).toBe(true);
  });

  test("a row with no physicalModelId is its own physical model", () => {
    // Older gateways say nothing. The alias must still resolve to a key, and the
    // only honest key is itself.
    const model = normalizeOpenAIModel({ id: "gemma-write", metadata: { vision: false } });
    expect(model.physicalModelId).toBe("gemma-write");
    expect(model.behaviorProfile).toBeUndefined();
    expect(model.behaviorProfileLabel).toBeUndefined();
    expect(model.behaviorProfileDefault).toBeUndefined();
    expect(model.displayName).toBeUndefined();
  });

  test("llama-swap's meta spelling and snake_case keys are read too", () => {
    const model = normalizeOpenAIModel({
      id: "qwen-uncensored",
      meta: {
        physical_model_id: "qwen-daily",
        behavior_profile: "uncensored",
        behavior_profile_label: "Uncensored",
        behavior_profile_default: false,
        display_name: "Qwen3.8-27B",
        native_reasoning: false,
      },
    });
    expect(model.physicalModelId).toBe("qwen-daily");
    expect(model.behaviorProfile).toBe("uncensored");
    expect(model.behaviorProfileLabel).toBe("Uncensored");
    expect(model.behaviorProfileDefault).toBe(false);
    expect(model.displayName).toBe("Qwen3.8-27B");
    expect(model.nativeReasoning).toBe(false);
  });

  test("aliases stay four distinct rows - grouping is a view, not a dedup", () => {
    expect(normalizeOpenAIModels(LIVE_MODELS).map((model) => model.id)).toEqual([
      "gemma-write",
      "ornith-turbo",
      "qwen-daily",
      "qwen-uncensored",
    ]);
  });
});

describe("tool support is the server's statement, never a guess", () => {
  test("a row that publishes tools carries it, either way", () => {
    expect(normalizeOpenAIModel({ id: "alias-a", metadata: { tools: true } }).tools).toBe(true);
    expect(normalizeOpenAIModel({ id: "alias-b", metadata: { tools: false } }).tools).toBe(false);
  });

  test("a row that says nothing carries nothing - no name is read for a capability", () => {
    expect(normalizeOpenAIModel({ id: "alias-c", metadata: {} }).tools).toBeUndefined();
    expect(normalizeOpenAIModel({ id: "alias-tools-agent", metadata: {} }).tools).toBeUndefined();
  });

  test("llama-swap's meta spelling is read too", () => {
    expect(normalizeOpenAIModel({ id: "alias-d", meta: { tools: true } }).tools).toBe(true);
  });
});

describe("groupByPhysicalModel", () => {
  const groups = groupByPhysicalModel(normalizeOpenAIModels(LIVE_MODELS));

  test("four aliases over three physical models make three groups", () => {
    expect(groups.map((group) => group.physicalModelId)).toEqual([
      "gemma-write",
      "ornith-turbo",
      "qwen-daily",
    ]);
    expect(groups.map((group) => group.displayName)).toEqual([
      "Gemma 4 26B-A4B",
      "Ornith-1.5-35B-A3B",
      "Qwen3.8-27B",
    ]);
  });

  test("the two-profile group holds both aliases, in the order they arrived", () => {
    const qwen = groups.find((group) => group.physicalModelId === "qwen-daily");
    expect(qwen?.profiles.map((profile) => profile.id)).toEqual(["qwen-daily", "qwen-uncensored"]);
    expect(qwen?.profiles.map((profile) => profile.behaviorProfile)).toEqual([
      "standard",
      "uncensored",
    ]);
    expect(qwen?.profiles.map((profile) => profile.behaviorProfileLabel)).toEqual([
      "Standard",
      "Uncensored",
    ]);
    expect(qwen?.primary.id).toBe("qwen-daily");
  });

  test("the order is the caller's, not a sort of ours", () => {
    const reversed = groupByPhysicalModel([...normalizeOpenAIModels(LIVE_MODELS)].reverse());
    expect(reversed.map((group) => group.physicalModelId)).toEqual([
      "qwen-daily",
      "ornith-turbo",
      "gemma-write",
    ]);
    expect(reversed[0].profiles.map((profile) => profile.id)).toEqual([
      "qwen-uncensored",
      "qwen-daily",
    ]);
    // The ORDER is the caller's; the PRIMARY is not. Reversing the rows moves
    // the uncensored alias to index 0 and changes nothing about which profile
    // this model defaults to, because the server declared it.
    expect(reversed[0].primary.id).toBe("qwen-daily");
  });

  test("a group of one is still a group, and declares no behaviour", () => {
    for (const id of ["ornith-turbo", "gemma-write"]) {
      const group = groups.find((entry) => entry.physicalModelId === id);
      expect(group?.profiles.map((profile) => profile.id)).toEqual([id]);
      expect(group?.profiles[0].behaviorProfile).toBeUndefined();
      expect(group?.profiles[0].behaviorProfileLabel).toBeUndefined();
      expect(group?.primary.id).toBe(id);
    }
  });

  test("the alias is what a profile carries - never the physical id", () => {
    // Routing on the physicalModelId would answer an uncensored request with the
    // standard profile, convincingly.
    expect(groups.flatMap((group) => group.profiles.map((profile) => profile.id))).toEqual([
      "gemma-write",
      "ornith-turbo",
      "qwen-daily",
      "qwen-uncensored",
    ]);
  });

  test("rows that only share a displayName are not one model", () => {
    const groupsOfTwo = groupByPhysicalModel([
      agentModel({ id: "one-alias", physicalModelId: "one", displayName: "Same Name" }),
      agentModel({ id: "other-alias", physicalModelId: "other", displayName: "Same Name" }),
    ]);
    expect(groupsOfTwo).toHaveLength(2);
    expect(groupsOfTwo.map((group) => group.physicalModelId)).toEqual(["one", "other"]);
  });

  test("a physical model per controller: the same alias on two controllers stays two", () => {
    const perController = groupByPhysicalModel([
      agentModel({ id: "qwen-daily", physicalModelId: "qwen-daily" }),
      agentModel({ id: "rig-two/qwen-daily", physicalModelId: "rig-two/qwen-daily" }),
    ]);
    expect(perController.map((group) => group.profiles.length)).toEqual([1, 1]);
  });

  test("no displayName anywhere falls back to the row's own name", () => {
    const [group] = groupByPhysicalModel([agentModel({ id: "some-model", name: "Some Model" })]);
    expect(group.displayName).toBe("Some Model");
  });

  test("nothing in, nothing out", () => {
    expect(groupByPhysicalModel([])).toEqual([]);
  });
});

// D1. The safety defect: `primary = profiles[0]` on the live rows.
describe("the default profile is DECLARED, never whichever sorted first", () => {
  // Both feed paths sort by `name` before grouping, and llama-swap names the
  // real block "Qwen3.8-27B (daily)" while the cloned alias is named plain
  // "Qwen3.8-27B" — which sorts FIRST. The sort here is the real one, run by
  // normalizeOpenAIModels, not an order chosen by this test.
  const liveNames = {
    object: "list",
    data: [
      {
        id: "qwen-uncensored",
        name: "Qwen3.8-27B",
        metadata: {
          physicalModelId: "qwen-daily",
          behaviorProfile: "uncensored",
          behaviorProfileLabel: "Uncensored",
          displayName: "Qwen3.8-27B",
          reasoning: true,
        },
      },
      {
        id: "qwen-daily",
        name: "Qwen3.8-27B (daily)",
        metadata: {
          physicalModelId: "qwen-daily",
          behaviorProfile: "standard",
          behaviorProfileLabel: "Standard",
          behaviorProfileDefault: true,
          displayName: "Qwen3.8-27B",
          reasoning: true,
        },
      },
    ],
  };

  test("the first alias in the group is the uncensored one - the primary is not", () => {
    const [qwen] = groupByPhysicalModel(normalizeOpenAIModels(liveNames));
    // Under `primary = profiles[0]` this read "qwen-uncensored": clicking
    // "Qwen3.8-27B" selected the ablated profile, and starring the row made it
    // the workspace default. AGENTS.md rule 5: that alias is never a default.
    expect(qwen.profiles[0].id).toBe("qwen-uncensored");
    expect(qwen.primary.id).toBe("qwen-daily");
    expect(qwen.primary.behaviorProfile).toBe("standard");
  });

  test("no order at all can move the default", () => {
    const rows = normalizeOpenAIModels(liveNames);
    for (const ordering of [rows, [...rows].reverse()]) {
      const [qwen] = groupByPhysicalModel(ordering);
      expect(qwen.primary.id).toBe("qwen-daily");
    }
  });

  test("a group that declares no default still resolves - index 0 is the fallback", () => {
    // A single-profile model, or a gateway older than the field. The fallback
    // exists so those groups have a primary at all; it is not the mechanism.
    const [group] = groupByPhysicalModel([
      agentModel({ id: "only-alias", physicalModelId: "only" }),
    ]);
    expect(group.primary.id).toBe("only-alias");
  });
});

// D5/D6. One label, computed once, so the trigger and the list cannot disagree.
describe("PhysicalModel.displayName is the only label", () => {
  test("every alias of the model answers with the same one", () => {
    const [qwen] = groupByPhysicalModel(
      normalizeOpenAIModels(LIVE_MODELS).filter((model) => model.physicalModelId === "qwen-daily"),
    );
    expect(qwen.displayName).toBe("Qwen3.8-27B");
    // Not the alias id, and not llama-swap's per-row name.
    expect(qwen.displayName).not.toBe(qwen.primary.id);
    expect(qwen.profiles.map((profile) => profile.displayName)).toEqual([
      "Qwen3.8-27B",
      "Qwen3.8-27B",
    ]);
  });

  test("a row the server never named falls back to the alias, then to the name", () => {
    const [byRawId] = groupByPhysicalModel([
      agentModel({ id: "local-studio-2/mystery", rawId: "mystery", name: "Mystery · rig two" }),
    ]);
    expect(byRawId.displayName).toBe("mystery");
    const [byName] = groupByPhysicalModel([agentModel({ id: "mystery", name: "Mystery" })]);
    expect(byName.displayName).toBe("Mystery");
  });
});

// D2. Clicking the physical row must not move you, and must not rewrite a
// stored preference on the way.
describe("resolveProfileId", () => {
  const qwen = groupByPhysicalModel(normalizeOpenAIModels(LIVE_MODELS)).find(
    (group) => group.physicalModelId === "qwen-daily",
  )!;

  test("the alias you are already on wins over both defaults", () => {
    expect(resolveProfileId(qwen, "qwen-uncensored", "qwen-daily")).toBe("qwen-uncensored");
    expect(resolveProfileId(qwen, "qwen-daily", "qwen-uncensored")).toBe("qwen-daily");
  });

  test("coming back from another model lands on the STORED default, not the declared one", () => {
    // default = qwen-uncensored -> click Gemma -> click the Qwen row. Returning
    // the declared default here both made the other profile unreachable from the
    // list and rewrote localStorage, because every pick writes the default.
    expect(resolveProfileId(qwen, "gemma-write", "qwen-uncensored")).toBe("qwen-uncensored");
  });

  test("a model that owns neither falls back to the DECLARED default profile", () => {
    expect(resolveProfileId(qwen, "gemma-write", "ornith-turbo")).toBe("qwen-daily");
    expect(resolveProfileId(qwen, "gemma-write", undefined)).toBe("qwen-daily");
    expect(resolveProfileId(qwen, "", "")).toBe("qwen-daily");
  });
});

// D7. The thinking contract follows the checkpoint, not the alias string.
describe("one physical model, one thinking ladder", () => {
  const rowsById = Object.fromEntries(
    normalizeOpenAIModels(LIVE_MODELS).map((model) => [model.id, model]),
  );

  test("qwen-daily and qwen-uncensored resolve identically", () => {
    expect(ladderFor(rowsById["qwen-uncensored"])).toEqual(ladderFor(rowsById["qwen-daily"]));
    expect(ladderFor(rowsById["qwen-daily"])).toEqual(["off", "low", "medium", "xhigh"]);
  });

  test("an unknown alias of a known physical model inherits, it does not guess", () => {
    // The reviewer's case: a third Qwen profile. Keyed by its own string it
    // resolved to ["high","max"], a ladder the chat template rejects.
    expect(controllerModelThinkingLevels(true, "qwen-creative")).toEqual(["high", "max"]);
    expect(
      controllerModelThinkingLevels(true, "qwen-creative", { physicalModelId: "qwen-daily" }),
    ).toEqual(["off", "low", "medium", "xhigh"]);
    // And the always-on case, where guessing from the string produced ["off"]
    // for a model whose template opens <think> unconditionally.
    expect(controllerModelThinkingLevels(false, "ornith-uncensored")).toEqual(["off"]);
    expect(
      controllerModelThinkingLevels(false, "ornith-uncensored", {
        physicalModelId: "ornith-turbo",
      }),
    ).toEqual(["high"]);
  });

  test("the server outranks the table: nativeReasoning needs no declaration", () => {
    expect(resolveThinkingContract({ modelId: "never-heard-of-it" })).toBeUndefined();
    expect(resolveThinkingContract({ modelId: "never-heard-of-it", nativeReasoning: true })).toBe(
      "native-always-on",
    );
    expect(
      controllerModelThinkingLevels(false, "never-heard-of-it", { nativeReasoning: true }),
    ).toEqual(["high"]);
    expect(ladderFor(rowsById["ornith-turbo"])).toEqual(["high"]);
  });

  test("the models the table already covers keep exactly the levels they had", () => {
    expect(ladderFor(rowsById["gemma-write"])).toEqual(["off"]);
    expect(controllerModelThinkingLevels(true, "qwen-daily")).toEqual([
      "off",
      "low",
      "medium",
      "xhigh",
    ]);
    expect(controllerModelThinkingLevels(true, "ornith-turbo")).toEqual(["high"]);
    expect(controllerModelThinkingLevels(false, "ornith-turbo")).toEqual(["high"]);
    expect(controllerModelThinkingLevels(true, "inkling-small")).toEqual([
      "off",
      "minimal",
      "low",
      "medium",
      "high",
      "max",
    ]);
    expect(controllerModelThinkingLevels(true, "some-reasoner")).toEqual(["high", "max"]);
    expect(controllerModelThinkingLevels(false, "some-reasoner")).toEqual(["off"]);
  });
});

// D8. Changing the BEHAVIOUR must change nothing but the behaviour.
//
// The picker's Behavior list and its Model list funnelled into one callback, so
// every pick adopted the level filed under the id being switched TO. Levels are
// filed per alias, and two profiles of one checkpoint are two keys, so choosing
// Uncensored on a pane running at Medium reset it to Off — the never-written
// default of a key that names a LoRA scale rather than a model. The pick now
// states whether the checkpoint changed, and the rule below is the only place
// that decides what that means for the effort.
describe("a behaviour profile is not a model", () => {
  const rows = normalizeOpenAIModels(LIVE_MODELS);
  const qwen = groupByPhysicalModel(rows).find((group) => group.profiles.length > 1)!;
  // Derived, never named: the pair is "the checkpoint that serves two profiles",
  // which is the same statement the product makes on the wire.
  const standard = qwen.primary;
  const uncensored = qwen.profiles.find((profile) => profile.id !== standard.id)!;
  const otherModel = rows.find((row) => row.physicalModelId !== qwen.physicalModelId)!;

  function memoryStorage() {
    const entries = new Map<string, string>();
    return {
      entries,
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => {
        entries.set(key, value);
      },
    };
  }

  // Both picker mounts do exactly this: resolve the level for the row picked,
  // then file it under that row when the rule calls it a preference. The write is
  // half the fix and lives here so it is pinned rather than reviewed —
  // persistThinkingLevelByModel deliberately skips a level that did not change,
  // and a carried level never changes.
  function pick(
    storage: ReturnType<typeof memoryStorage>,
    target: AgentModel,
    selection: Omit<AgentModelSelection, "modelId">,
  ) {
    const result = thinkingAfterModelSelection(
      { ...selection, modelId: target.id },
      ladderFor(target),
      readModelThinkingLevel(storage, target.id),
    );
    if (result.remember) writeModelThinkingLevel(storage, target.id, result.level);
    return result.level;
  }

  test("switching behaviour keeps the effort the pane is running at", () => {
    const storage = memoryStorage();
    writeModelThinkingLevel(storage, standard.id, "medium");
    // What the old rule read, and what it reset the pane to.
    expect(readModelThinkingLevel(storage, uncensored.id)).toBe("off");

    expect(pick(storage, uncensored, { physicalModel: "unchanged", thinkingLevel: "medium" })).toBe(
      "medium",
    );
    // And back, with the profile the user left still remembering its own answer.
    expect(pick(storage, standard, { physicalModel: "unchanged", thinkingLevel: "medium" })).toBe(
      "medium",
    );
  });

  test("the carried effort does not snap back on the next switch", () => {
    const storage = memoryStorage();
    writeModelThinkingLevel(storage, standard.id, "xhigh");
    pick(storage, uncensored, { physicalModel: "unchanged", thinkingLevel: "xhigh" });

    // The alias now HAS the history it lacked. Without the write the level was
    // right on screen and wrong one switch later: leave for another model, come
    // back, and the adopt read the untouched key.
    expect(readModelThinkingLevel(storage, uncensored.id)).toBe("xhigh");
    pick(storage, otherModel, { physicalModel: "changed", thinkingLevel: "xhigh" });
    expect(
      pick(storage, uncensored, {
        physicalModel: "changed",
        thinkingLevel: ladderFor(otherModel)[0]!,
      }),
    ).toBe("xhigh");
  });

  test("a genuinely different model still adopts its own remembered level", () => {
    const storage = memoryStorage();
    writeModelThinkingLevel(storage, standard.id, "xhigh");

    // Arriving from elsewhere at whatever that model was showing: the target's own
    // memory wins, which is the rule this change narrows rather than replaces.
    expect(
      pick(storage, standard, {
        physicalModel: "changed",
        thinkingLevel: ladderFor(otherModel)[0]!,
      }),
    ).toBe("xhigh");

    // And a model with nothing remembered opens at Off without being given a key
    // it never had — the model-switch path writes nothing at all.
    const before = new Map(storage.entries);
    expect(pick(storage, otherModel, { physicalModel: "changed", thinkingLevel: "xhigh" })).toBe(
      "off",
    );
    expect([...storage.entries]).toEqual([...before]);
  });

  test("a profile used for the first time inherits from its sibling, never from another model", () => {
    const storage = memoryStorage();
    writeModelThinkingLevel(storage, otherModel.id, "xhigh");

    // Nothing has ever been filed under either Qwen profile. Coming from a
    // different checkpoint, the fresh profile answers Off — the level of the model
    // being left is not its to inherit.
    expect(pick(storage, uncensored, { physicalModel: "changed", thinkingLevel: "xhigh" })).toBe(
      "off",
    );
    // Coming from its own sibling, the same fresh profile keeps the effort: one
    // checkpoint, one llama-server, one reasoning contract.
    expect(pick(storage, uncensored, { physicalModel: "unchanged", thinkingLevel: "medium" })).toBe(
      "medium",
    );
    expect(readModelThinkingLevel(storage, otherModel.id)).toBe("xhigh");
  });

  test("a profile that cannot honour the effort is not given it", () => {
    // Two profiles share a ladder only while both draw it from the checkpoint;
    // nativeReasoning is a per-row wire field and short-circuits ahead of it, so a
    // gateway can declare a pair that disagrees.
    const narrow = agentModel({
      id: `${uncensored.id}-native`,
      physicalModelId: qwen.physicalModelId,
      reasoning: true,
      nativeReasoning: true,
    });
    expect(ladderFor(narrow)).toEqual(["high"]);

    const storage = memoryStorage();
    expect(pick(storage, narrow, { physicalModel: "unchanged", thinkingLevel: "medium" })).toBe(
      "high",
    );
    // The level in force is what gets filed. An unsupported one is never stored.
    expect(readModelThinkingLevel(storage, narrow.id)).toBe("high");
  });
});
