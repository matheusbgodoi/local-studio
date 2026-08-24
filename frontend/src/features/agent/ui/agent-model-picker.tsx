"use client";

import {
  useCallback,
  useMemo,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from "react";
import Link from "next/link";
import { Check, ChevronDown, ChevronLeft, ChevronRight, Pin } from "@/ui/icon-registry";
import { AGENT_THINKING_LEVELS, type AgentThinkingLevel } from "@/features/agent/contracts";
import type { AgentModel } from "@/features/agent/workspace/types";
import { POPOVER_MENU_CLASS } from "@/ui/popover";
import { cx } from "@/ui/utils";
import { splitVisibleAgentModels } from "./model-visibility";
import {
  groupByPhysicalModel,
  isNativeAlwaysOnThinkingModel,
  physicalModelOwnsProfile as ownsProfile,
  resolveProfileId,
  type AgentModelSelection,
  type PhysicalModel,
} from "@shared/agent/models";

type AgentModelPickerProps = {
  models: AgentModel[];
  selectedModel: string;
  defaultModel?: string;
  onSelect: (selection: AgentModelSelection) => void;
  onSetDefault?: (id: string) => void;
  loading: boolean;
  reasoningLevel?: AgentThinkingLevel;
  reasoningLevels?: readonly AgentThinkingLevel[];
  reasoningDisabled?: boolean;
  onSelectReasoning?: (level: AgentThinkingLevel) => void;
};

type ModelGroup = { key: string; name: string; physicalModels: PhysicalModel[] };
/** Every list in this popover emits a pick AND what that pick means, so a list
 *  added later cannot quietly reintroduce a profile switch that reads as a model
 *  switch. */
type SelectModel = (modelId: string, physicalModel: AgentModelSelection["physicalModel"]) => void;
type ModelSelection = {
  active: AgentModel | null;
  /** The physical model's one label — the same string the Model list renders. */
  label: string | undefined;
  profiles: AgentModel[];
  behaviorLabel: string | undefined;
};
type PickerView = "root" | "models" | "reasoning" | "behavior";

const REASONING_LABELS: Record<AgentThinkingLevel, string> = {
  off: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "XHigh",
  max: "Max",
};

/** A model whose template opens the reasoning block itself has exactly one state,
 *  and it is not a rung on a ladder. Naming it "High" would invite the user to
 *  look for the level below it. */
function reasoningTriggerLabel(
  active: AgentModel | null,
  effectiveReasoning: AgentThinkingLevel,
): string {
  // Resolved from what the row states, not from its name alone, so a new alias
  // of an always-on checkpoint reads "Native" here for the same reason the
  // runtime gives it one fixed level.
  const nativeAlwaysOn = isNativeAlwaysOnThinkingModel({
    modelId: active?.rawId ?? active?.id,
    physicalModelId: active?.physicalModelId,
    nativeReasoning: active?.nativeReasoning,
  });
  return nativeAlwaysOn ? "Native" : REASONING_LABELS[effectiveReasoning];
}

export function AgentModelPicker({
  models,
  selectedModel,
  defaultModel,
  onSelect,
  onSetDefault,
  loading,
  reasoningLevel,
  reasoningLevels = [],
  reasoningDisabled = false,
  onSelectReasoning,
}: AgentModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<PickerView>("root");
  const [showOtherModels, setShowOtherModels] = useState(false);
  const selection = useMemo(
    () => resolveModelSelection(models, selectedModel),
    [models, selectedModel],
  );
  const active = selection.active;
  const supportsBehavior = selection.profiles.length > 1;
  const visible = useMemo(
    () => splitVisibleAgentModels(models, showOtherModels),
    [models, showOtherModels],
  );
  const groups = useMemo(
    () => groupModelsByController(visible.visibleModels),
    [visible.visibleModels],
  );
  const disabled = loading;
  const modelLabel = modelTriggerLabel(selection, selectedModel, visible.controllerModels.length);
  // ONE TURN LOCK, TWO LISTS. `reasoningDisabled` is Boolean(running) at the call
  // site, and the Behavior list freezes with it. No longer because picking a
  // profile moves the reasoning level — the pick now states that the checkpoint is
  // unchanged and the level is carried across — but because the alias is read
  // again while the turn runs: the queued send, a steer, a follow-up, a retry and
  // a compaction all send with the session's current modelId, so flipping Standard
  // to Uncensored mid-turn answers the rest of that turn with the ablated weights
  // and splits one turn across two rows in Usage, which attributes per alias. The
  // Model list carries the same hazard and is not locked; that gap is older and
  // wider than this control and is not narrowed here.
  const turnRunning = reasoningDisabled;
  const supportsReasoning = Boolean(reasoningLevel && onSelectReasoning);
  const requestedReasoning = reasoningLevel ?? "off";
  const effectiveReasoning = reasoningLevels.includes(requestedReasoning)
    ? requestedReasoning
    : (reasoningLevels.at(-1) ?? "off");
  const reasoningLabel = reasoningTriggerLabel(active, effectiveReasoning);
  const triggerLabel = supportsReasoning ? `${modelLabel} ${reasoningLabel}` : modelLabel;
  const showRoot = supportsReasoning || supportsBehavior;
  const selectedModelNotRunning = !loading && Boolean(active && active.active === false);
  const close = useCallback(() => {
    setOpen(false);
    setView("root");
  }, []);
  // ONE FUNNEL, TWO MEANINGS, AND THE ROW KNOWS WHICH. The Behavior list and the
  // Model list both end here, so the callee cannot tell a behaviour switch from a
  // model switch unless the row says. The Behavior list knows it structurally —
  // every row it draws is a profile of the group that owns the selection — and
  // the Model list already computed it for its checkmark. `effectiveReasoning` is
  // attached here because this is the level the trigger is displaying; the lists
  // never see it.
  const select = useCallback(
    (modelId: string, physicalModel: AgentModelSelection["physicalModel"]) => {
      onSelect({ modelId, physicalModel, thinkingLevel: effectiveReasoning });
      close();
    },
    [close, onSelect, effectiveReasoning],
  );

  return (
    <div
      className="relative min-w-0 shrink"
      onBlur={(event) => {
        const nextTarget = event.relatedTarget;
        if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
        close();
      }}
      onPointerDown={stopToolbarEvent}
      onMouseDown={stopToolbarEvent}
    >
      <ModelPickerTrigger
        label={triggerLabel}
        title={active?.name || triggerLabel}
        disabled={disabled}
        open={open}
        notRunning={selectedModelNotRunning}
        onToggle={() => {
          if (disabled) return;
          if (open) close();
          else {
            setView(showRoot ? "root" : "models");
            setOpen(true);
          }
        }}
      />
      {open ? (
        <div
          className={`absolute bottom-full right-0 z-[300] mb-1.5 w-80 max-w-[calc(100vw-2rem)] ${POPOVER_MENU_CLASS}`}
          role="menu"
          aria-label="Model and reasoning"
          onKeyDown={(event) => handleMenuKeyDown(event, view, setView, close)}
        >
          {view === "root" ? (
            <PickerRoot
              modelLabel={modelLabel}
              behaviorLabel={selection.behaviorLabel}
              reasoningLabel={reasoningLabel}
              reasoningFixed={reasoningLevels.length <= 1}
              onOpenModels={() => setView("models")}
              onOpenBehavior={() => setView("behavior")}
              onOpenReasoning={() => setView("reasoning")}
            />
          ) : null}
          {view === "models" ? (
            <ModelList
              groups={groups}
              selectedModel={selectedModel}
              defaultModel={defaultModel}
              showOtherModels={showOtherModels}
              otherModelCount={visible.otherModels.length}
              onBack={showRoot ? () => setView("root") : undefined}
              onSelect={select}
              onSetDefault={onSetDefault}
              onToggleOtherModels={() => setShowOtherModels((current) => !current)}
              onClose={close}
            />
          ) : null}
          {view === "behavior" ? (
            <BehaviorList
              profiles={selection.profiles}
              selectedModel={selectedModel}
              disabled={turnRunning}
              onBack={() => setView("root")}
              onSelect={select}
            />
          ) : null}
          {view === "reasoning" && onSelectReasoning ? (
            <ReasoningList
              value={effectiveReasoning}
              levels={reasoningLevels}
              disabled={reasoningDisabled}
              onBack={() => setView("root")}
              onSelect={(level) => {
                onSelectReasoning(level);
                close();
              }}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function PickerRoot({
  modelLabel,
  behaviorLabel,
  reasoningLabel,
  reasoningFixed,
  onOpenModels,
  onOpenBehavior,
  onOpenReasoning,
}: {
  modelLabel: string;
  behaviorLabel?: string;
  reasoningLabel: string;
  reasoningFixed: boolean;
  onOpenModels: () => void;
  onOpenBehavior: () => void;
  onOpenReasoning: () => void;
}) {
  return (
    <div className="grid gap-0.5">
      <PickerRootRow label="Model" value={modelLabel} onClick={onOpenModels} />
      {behaviorLabel === undefined ? null : (
        <PickerRootRow label="Behavior" value={behaviorLabel} onClick={onOpenBehavior} />
      )}
      <PickerRootRow
        label="Reasoning"
        value={reasoningLabel}
        disabled={reasoningFixed}
        onClick={onOpenReasoning}
      />
    </div>
  );
}

function PickerRootRow({
  label,
  value,
  disabled = false,
  onClick,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className="flex h-10 min-w-0 items-center gap-3 rounded-lg px-2.5 text-[length:var(--fs-base)] text-(--fg) transition-colors hover:bg-(--hover) disabled:cursor-default disabled:opacity-55"
    >
      <span className="w-20 shrink-0 text-left font-medium">{label}</span>
      <span className="min-w-0 flex-1 truncate text-right text-(--fg)/60">{value}</span>
      {disabled ? (
        <span className="w-3.5" />
      ) : (
        <ChevronRight className="h-3.5 w-3.5 text-(--dim)" />
      )}
    </button>
  );
}

function PickerHeader({ title, onBack }: { title: string; onBack?: () => void }) {
  return (
    <div className="flex h-9 items-center gap-1 border-b border-(--border) px-1 pb-1">
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-(--dim) hover:bg-(--hover) hover:text-(--fg)"
          aria-label="Back"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      ) : null}
      <span className="px-1 text-[length:var(--fs-sm)] font-medium text-(--dim)">{title}</span>
    </div>
  );
}

function ModelList({
  groups,
  selectedModel,
  defaultModel,
  showOtherModels,
  otherModelCount,
  onBack,
  onSelect,
  onSetDefault,
  onToggleOtherModels,
  onClose,
}: {
  groups: ModelGroup[];
  selectedModel: string;
  defaultModel?: string;
  showOtherModels: boolean;
  otherModelCount: number;
  onBack?: () => void;
  onSelect: SelectModel;
  onSetDefault?: (modelId: string) => void;
  onToggleOtherModels: () => void;
  onClose: () => void;
}) {
  return (
    <div>
      <PickerHeader title="Model" onBack={onBack} />
      {otherModelCount > 0 ? (
        <button
          type="button"
          role="menuitemcheckbox"
          aria-checked={showOtherModels}
          onClick={onToggleOtherModels}
          className="mt-1 flex min-h-10 w-full items-center gap-3 rounded-lg px-2.5 text-left text-[length:var(--fs-base)] text-(--fg) transition-colors hover:bg-(--hover)"
        >
          <span className="min-w-0 flex-1">
            <span className="block font-medium">Other models</span>
            <span className="block truncate text-[length:var(--fs-xs)] text-(--dim)">
              Pi and connected providers · {otherModelCount}
            </span>
          </span>
          <span
            aria-hidden="true"
            className={cx(
              "relative h-5 w-9 shrink-0 rounded-full border border-(--border) bg-(--color-input) transition-colors",
              showOtherModels && "border-(--accent) bg-(--accent)",
            )}
          >
            <span
              className={cx(
                "absolute left-0.5 top-0.5 h-3.5 w-3.5 rounded-full bg-(--fg) transition-transform",
                showOtherModels && "translate-x-4",
              )}
            />
          </span>
        </button>
      ) : null}
      <div className="max-h-[min(24rem,55vh)] overflow-y-auto pt-1">
        {groups.length === 0 ? (
          <div className="w-64 px-2.5 py-2 text-[length:var(--fs-sm)] text-(--dim)">
            <p>
              {otherModelCount > 0
                ? "No controller models are available."
                : "No chat models are available."}
            </p>
            <Link
              href="/models"
              onClick={onClose}
              className="mt-2 inline-flex h-7 items-center rounded-lg bg-(--active) px-2.5 text-(--fg) hover:bg-(--hover)"
            >
              Open Models
            </Link>
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.key} className="not-first:mt-1.5">
              {groups.length > 1 ? (
                <div className="flex h-7 items-center justify-between px-2.5 text-[length:var(--fs-xs)] font-medium text-(--dim)">
                  <span className="truncate">{group.name}</span>
                  <span className="font-mono text-[length:var(--fs-2xs)]">
                    {group.physicalModels.length}
                  </span>
                </div>
              ) : null}
              <ModelOptions
                physicalModels={group.physicalModels}
                selectedModel={selectedModel}
                defaultModel={defaultModel}
                onSelect={onSelect}
                onSetDefault={onSetDefault}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function BehaviorList({
  profiles,
  selectedModel,
  disabled,
  onBack,
  onSelect,
}: {
  profiles: AgentModel[];
  selectedModel: string;
  disabled: boolean;
  onBack: () => void;
  onSelect: SelectModel;
}) {
  if (profiles.length < 2) return null;
  return (
    <div>
      <PickerHeader title="Behavior" onBack={onBack} />
      <div className="grid gap-0.5 pt-1">
        {profiles.map((profile) => (
          <PickerOptionRow
            key={profile.id}
            label={behaviorProfileLabel(profile)}
            selected={profile.id === selectedModel}
            disabled={disabled}
            onSelect={() => onSelect(profile.id, "unchanged")}
          />
        ))}
      </div>
    </div>
  );
}

function ReasoningList({
  value,
  levels,
  disabled,
  onBack,
  onSelect,
}: {
  value: AgentThinkingLevel;
  levels: readonly AgentThinkingLevel[];
  disabled: boolean;
  onBack: () => void;
  onSelect: (level: AgentThinkingLevel) => void;
}) {
  return (
    <div>
      <PickerHeader title="Reasoning" onBack={onBack} />
      <div className="grid gap-0.5 pt-1">
        {AGENT_THINKING_LEVELS.filter((level) => levels.includes(level)).map((level) => (
          <PickerOptionRow
            key={level}
            label={REASONING_LABELS[level]}
            selected={level === value}
            disabled={disabled}
            onSelect={() => onSelect(level)}
          />
        ))}
      </div>
      {/* The level is not a runtime switch: the chat template renders it as a
          sentence at the very top of the prompt, so changing it moves every
          token after it and the server has no cached prefix left to reuse. On a
          long conversation that is a full re-read before the next reply starts,
          and the wait is otherwise indistinguishable from the app hanging. */}
      <p className="border-t border-(--border) px-2.5 pb-1 pt-2 text-[length:var(--fs-sm)] leading-snug text-(--dim)">
        Changing this rewrites the start of the prompt, so the model re-reads the conversation
        before the next reply. Long chats take a while.
      </p>
    </div>
  );
}

function PickerOptionRow({
  label,
  selected,
  disabled = false,
  onSelect,
}: {
  label: string;
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cx(
        "flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[length:var(--fs-base)] text-(--fg) transition-colors hover:bg-(--hover) disabled:opacity-45",
        selected && "bg-(--color-input)",
      )}
    >
      <span className="flex-1">{label}</span>
      {selected ? <Check className="h-3.5 w-3.5" /> : null}
    </button>
  );
}

function ModelPickerTrigger({
  label,
  title,
  disabled,
  open,
  notRunning,
  onToggle,
}: {
  label: string;
  title: string;
  disabled: boolean;
  open: boolean;
  notRunning: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onPointerDown={stopToolbarEvent}
      onMouseDown={stopToolbarEvent}
      onClick={onToggle}
      disabled={disabled}
      className={cx(
        // Codex: the model control sits at the shared chat size (16px) with
        // primary-strength text; only the chevron reads dim.
        "group/model inline-flex !h-[30px] !min-h-[30px] !min-w-0 max-w-full items-center justify-between gap-1 rounded-lg bg-transparent pl-2 pr-1.5 text-[length:var(--fs-base)] whitespace-nowrap text-(--fg)/85 transition-colors hover:bg-(--hover) hover:text-(--fg) active:translate-y-px disabled:opacity-60",
        open && "bg-(--hover) text-(--fg)",
      )}
      title={notRunning ? `${title} is not running — launch it or pick a running model` : title}
      aria-label={`Model: ${title}${notRunning ? " (not running)" : ""}`}
      aria-expanded={open}
      aria-haspopup="menu"
    >
      <span className="min-w-0 max-w-[180px] truncate text-left">{label}</span>
      {notRunning ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-(--warn)" /> : null}
      <ChevronDown className="pointer-events-none h-3.5 w-3.5 shrink-0 text-(--dim)" />
    </button>
  );
}

function ModelOptions({
  physicalModels,
  selectedModel,
  defaultModel,
  onSelect,
  onSetDefault,
}: {
  physicalModels: PhysicalModel[];
  selectedModel: string;
  defaultModel?: string;
  onSelect: SelectModel;
  onSetDefault?: (modelId: string) => void;
}) {
  return physicalModels.map((physical) => (
    <ModelOption
      key={physical.physicalModelId}
      physical={physical}
      selectedModel={selectedModel}
      defaultModel={defaultModel}
      onSelect={onSelect}
      onSetDefault={onSetDefault}
    />
  ));
}

function ModelOption({
  physical,
  selectedModel,
  defaultModel,
  onSelect,
  onSetDefault,
}: {
  physical: PhysicalModel;
  selectedModel: string;
  defaultModel?: string;
  onSelect: SelectModel;
  onSetDefault?: (modelId: string) => void;
}) {
  // The label the shared layer computed. Recomputing it here is how the popover
  // root came to read "qwen-daily" over a list reading "Qwen3.8-27B".
  const label = physical.displayName;
  const selected = ownsProfile(physical, selectedModel);
  const targetId = resolveProfileId(physical, selectedModel, defaultModel);
  return (
    <div
      className={cx(
        "flex min-h-8 w-full min-w-0 items-center rounded-lg text-[length:var(--fs-base)] text-(--fg) transition-colors hover:bg-(--hover)",
        selected && "bg-(--color-input)",
      )}
    >
      <button
        type="button"
        role="menuitemradio"
        aria-checked={selected}
        // `selected` is the same binding that draws the checkmark, so the arm cannot disagree
        // with what the row shows. Clicking the row that is ALREADY checked reports
        // "unchanged" and therefore files the displayed level under the alias it is already
        // on — a write on a visual no-op, and deliberate: the level shown is the level in
        // use, and pinning it is the same thing the pane does when the level itself changes.
        onClick={() => onSelect(targetId, selected ? "unchanged" : "changed")}
        className="flex min-h-8 min-w-0 flex-1 items-center gap-2 rounded-lg pl-2.5 text-left focus-visible:outline-none active:translate-y-px"
      >
        <span className="min-w-0 flex-1 truncate" title={label}>
          {label}
        </span>
        {selected ? <Check className="h-3.5 w-3.5 shrink-0 text-(--fg)" /> : null}
      </button>
      {onSetDefault ? (
        <DefaultModelPin
          physical={physical}
          defaultModel={defaultModel}
          onSetDefault={onSetDefault}
        />
      ) : null}
    </div>
  );
}

/**
 * The pin states what IS, and does exactly what it says.
 *
 * It used to disagree with itself twice over. `isDefault` was true if ANY alias
 * in the group held the default, while the click emitted an id derived from the
 * SELECTION — so with the default on one profile and the pane on another model,
 * the row rendered a filled pin reading "… is the default model" and clicking
 * it MOVED the default to a different profile, leaving the pin filled so that
 * nothing on screen changed.
 *
 * Both halves now name the same profile. A group that already owns the default
 * renders an inert pin that says WHICH profile holds it; a group that does not
 * offers to set the model's declared default profile, and says so — the row is
 * the physical model, so pinning it can never store an alias the product says
 * is never a default.
 */
function DefaultModelPin({
  physical,
  defaultModel,
  onSetDefault,
}: {
  physical: PhysicalModel;
  defaultModel?: string;
  onSetDefault: (modelId: string) => void;
}) {
  const multiProfile = physical.profiles.length > 1;
  // "Qwen3.8-27B is the default" does not say which Qwen3.8-27B, and the two
  // differ in exactly the way that matters.
  const nameOf = (profile: AgentModel) =>
    multiProfile
      ? `${physical.displayName} · ${behaviorProfileLabel(profile)}`
      : physical.displayName;
  const current = physical.profiles.find((profile) => profile.id === defaultModel);
  return (
    <button
      type="button"
      disabled={Boolean(current)}
      onClick={() => onSetDefault(physical.primary.id)}
      aria-label={
        current
          ? `${nameOf(current)} is the default model`
          : `Set ${nameOf(physical.primary)} as default model`
      }
      title={current ? `Default model: ${nameOf(current)}` : "Set as default"}
      className={cx(
        "mr-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-(--dim) transition-colors focus-visible:outline-none",
        current ? "cursor-default text-(--fg)" : "hover:bg-(--active) hover:text-(--fg)",
      )}
    >
      <Pin className={cx("h-3.5 w-3.5", current && "fill-current")} strokeWidth={1.5} />
    </button>
  );
}

function handleMenuKeyDown(
  event: ReactKeyboardEvent<HTMLDivElement>,
  view: PickerView,
  setView: (view: PickerView) => void,
  close: () => void,
) {
  if (event.key !== "Escape") return;
  event.preventDefault();
  if (view === "root" || view === "models") close();
  else setView("root");
}

/** ONE LABEL. The trigger names the physical model with the very string the
 *  Model list renders, so the two halves of the same popover cannot disagree. */
function modelTriggerLabel(
  selection: ModelSelection,
  selectedModel: string,
  modelCount: number,
): string {
  const fallbackLabel = selectedModel || (modelCount === 0 ? "No models" : "model");
  return selection.label || selection.active?.rawId || selection.active?.name || fallbackLabel;
}

function behaviorProfileLabel(model: AgentModel): string {
  return model.behaviorProfileLabel || model.behaviorProfile || model.rawId || model.name;
}

function resolveModelSelection(models: AgentModel[], selectedModel: string): ModelSelection {
  const active = models.find((model) => model.id === selectedModel) ?? null;
  const physical = groupByPhysicalModel(models).find((group) => ownsProfile(group, selectedModel));
  // A single-profile model still has a label — it just has no behaviour to pick.
  const multiProfile = (physical?.profiles.length ?? 0) > 1;
  return {
    active,
    label: physical?.displayName,
    profiles: multiProfile && physical ? physical.profiles : [],
    behaviorLabel: multiProfile && active ? behaviorProfileLabel(active) : undefined,
  };
}

function controllerGroupKey(model: AgentModel): string {
  return model.controllerUrl ?? model.controllerName ?? "primary";
}

function groupModelsByController(models: AgentModel[]): ModelGroup[] {
  const groups = new Map<string, { key: string; name: string; models: AgentModel[] }>();
  for (const model of models) {
    const key = controllerGroupKey(model);
    const existing = groups.get(key);
    if (existing) existing.models.push(model);
    else groups.set(key, { key, name: model.controllerName ?? "local", models: [model] });
  }
  return [...groups.values()].map((group) => ({
    key: group.key,
    name: group.name,
    physicalModels: groupByPhysicalModel(group.models),
  }));
}

function stopToolbarEvent(event: MouseEvent | PointerEvent) {
  event.stopPropagation();
}
