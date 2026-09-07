"use client";

import { useCallback, useMemo, useState } from "react";
import { Button, Checkbox, SegmentedControl, Select, Spinner, Textarea } from "@/ui";
import { Plus, SquarePen, Trash2 } from "@/ui/icon-registry";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import type {
  PersonalKnowledgeMode,
  PersonalMemoryCategory,
  PersonalMemoryDocument,
  PersonalMemoryEntry,
  PersonalMemoryMode,
  PersonalMemorySensitivity,
} from "@shared/agent/personal-memory";
import { SettingsButton, SettingsGroup, SettingsNotice, SettingsRow } from "./settings-ui";
import {
  createPersonalMemory,
  deleteAllPersonalMemories,
  deletePersonalMemories,
  loadPersonalMemory,
  updatePersonalMemory,
  updatePersonalMemorySettings,
} from "./personal-memory-api";

const categories: Array<{ value: PersonalMemoryCategory; label: string }> = [
  { value: "preference", label: "Preference" },
  { value: "communication", label: "Communication" },
  { value: "work", label: "Work style" },
  { value: "identity", label: "Identity" },
  { value: "restriction", label: "Restriction" },
  { value: "goal", label: "Goal" },
  { value: "other", label: "Other" },
];

function sourceLabel(entry: PersonalMemoryEntry): string {
  return entry.source === "conversation" ? "Confirmed in conversation" : "Added manually";
}

export function PersonalMemorySettings() {
  const [document, setDocument] = useState<PersonalMemoryDocument | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      setDocument(await loadPersonalMemory());
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Memory could not be loaded");
    }
  }, []);

  useMountSubscription(() => {
    void load();
  }, [load]);

  const apply = async (operation: () => Promise<PersonalMemoryDocument>) => {
    setBusy(true);
    try {
      setDocument(await operation());
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Memory could not be updated");
    } finally {
      setBusy(false);
    }
  };

  if (!document) {
    return (
      <div className="flex min-h-32 items-center justify-center">
        {error ? <SettingsNotice tone="danger">{error}</SettingsNotice> : <Spinner />}
      </div>
    );
  }

  const removeSelected = () => {
    if (selected.size === 0) return;
    if (!window.confirm(`Forget ${selected.size} selected memory item(s)?`)) return;
    void apply(async () => {
      const next = await deletePersonalMemories([...selected]);
      setSelected(new Set());
      return next;
    });
  };

  const removeAll = () => {
    if (
      !window.confirm(
        "Forget everything CRIAs AI remembers about you? Your chats and Obsidian notes will not be deleted.",
      )
    )
      return;
    void apply(async () => {
      const next = await deleteAllPersonalMemories();
      setSelected(new Set());
      return next;
    });
  };

  return (
    <div className="space-y-10">
      <SettingsGroup
        title="Personal memory"
        description="Short preferences and everyday details you explicitly confirm. This is separate from chat history and Obsidian."
      >
        <SettingsRow
          label="Use personal memory"
          description="Automatic mode can propose a memory during a conversation, but saves it only after you confirm."
          control={
            <SegmentedControl<PersonalMemoryMode>
              size="sm"
              disabled={busy}
              value={document.mode}
              items={[
                { id: "off", label: "Off" },
                { id: "automatic", label: "Automatic" },
              ]}
              onChange={(mode) => void apply(() => updatePersonalMemorySettings({ mode }))}
            />
          }
        />
        <SettingsRow
          label="Obsidian Knowledge"
          description="Controls whether new conversations receive the private Knowledge tools. Manual /mcp commands still override a conversation."
          control={
            <SegmentedControl<PersonalKnowledgeMode>
              size="sm"
              disabled={busy}
              value={document.knowledgeMode}
              items={[
                { id: "off", label: "Off" },
                { id: "automatic", label: "Automatic" },
                { id: "required", label: "Always cite" },
              ]}
              onChange={(knowledgeMode) =>
                void apply(() => updatePersonalMemorySettings({ knowledgeMode }))
              }
            />
          }
        />
      </SettingsGroup>

      <SettingsGroup
        title="What CRIAs AI knows about you"
        description={`${document.entries.length} of 60 memory items. Disabled items stay stored but do not enter the prompt. Local-only items are excluded from cloud models.`}
        actions={
          <div className="flex flex-wrap gap-2">
            {selected.size > 0 ? (
              <SettingsButton tone="danger" onClick={removeSelected} disabled={busy}>
                Forget selected ({selected.size})
              </SettingsButton>
            ) : null}
            {document.entries.length > 0 ? (
              <SettingsButton tone="danger" onClick={removeAll} disabled={busy}>
                Forget all
              </SettingsButton>
            ) : null}
            <SettingsButton
              tone="primary"
              onClick={() => setAdding(true)}
              disabled={busy || adding}
            >
              <Plus className="h-3.5 w-3.5" /> Add
            </SettingsButton>
          </div>
        }
      >
        {adding ? (
          <MemoryForm
            submitLabel="Remember"
            onCancel={() => setAdding(false)}
            onSubmit={(input) =>
              apply(async () => {
                const next = await createPersonalMemory(input);
                setAdding(false);
                return next;
              })
            }
          />
        ) : null}
        {document.entries.length === 0 && !adding ? (
          <div className="px-3 py-8 text-center text-[length:var(--fs-sm)] text-(--ui-muted)">
            Nothing is stored yet. Add a preference manually or let CRIAs AI propose one in a
            conversation.
          </div>
        ) : null}
        {document.entries.map((entry) =>
          editing === entry.id ? (
            <MemoryForm
              key={entry.id}
              entry={entry}
              submitLabel="Save"
              onCancel={() => setEditing(null)}
              onSubmit={(input) =>
                apply(async () => {
                  const next = await updatePersonalMemory(entry.id, input);
                  setEditing(null);
                  return next;
                })
              }
            />
          ) : (
            <MemoryRow
              key={entry.id}
              entry={entry}
              selected={selected.has(entry.id)}
              busy={busy}
              onSelected={(checked) =>
                setSelected((current) => {
                  const next = new Set(current);
                  if (checked) next.add(entry.id);
                  else next.delete(entry.id);
                  return next;
                })
              }
              onEdit={() => setEditing(entry.id)}
              onEnabled={(enabled) => void apply(() => updatePersonalMemory(entry.id, { enabled }))}
              onDelete={() => {
                if (!window.confirm(`Forget “${entry.text}”?`)) return;
                void apply(() => deletePersonalMemories([entry.id]));
              }}
            />
          ),
        )}
      </SettingsGroup>
      {error ? <SettingsNotice tone="danger">{error}</SettingsNotice> : null}
    </div>
  );
}

function MemoryRow({
  entry,
  selected,
  busy,
  onSelected,
  onEdit,
  onEnabled,
  onDelete,
}: {
  entry: PersonalMemoryEntry;
  selected: boolean;
  busy: boolean;
  onSelected: (checked: boolean) => void;
  onEdit: () => void;
  onEnabled: (enabled: boolean) => void;
  onDelete: () => void;
}) {
  const category = categories.find((option) => option.value === entry.category)?.label;
  return (
    <div className="grid gap-3 px-3 py-4 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-start">
      <Checkbox checked={selected} onChange={onSelected} disabled={busy} />
      <div className={entry.enabled ? "min-w-0" : "min-w-0 opacity-55"}>
        <p className="text-[length:var(--fs-base)] leading-relaxed text-(--ui-fg)">{entry.text}</p>
        <p className="mt-1 text-[length:var(--fs-xs)] text-(--ui-muted)">
          {category} · {sourceLabel(entry)} ·{" "}
          {entry.sensitivity === "local_only" ? "Local only" : "Standard"}
        </p>
      </div>
      <div className="flex items-center justify-end gap-1">
        <Checkbox checked={entry.enabled} onChange={onEnabled} label="Use" disabled={busy} />
        <Button size="sm" variant="ghost" onClick={onEdit} disabled={busy} aria-label="Edit memory">
          <SquarePen className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onDelete}
          disabled={busy}
          aria-label="Forget memory"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

function MemoryForm({
  entry,
  submitLabel,
  onCancel,
  onSubmit,
}: {
  entry?: PersonalMemoryEntry;
  submitLabel: string;
  onCancel: () => void;
  onSubmit: (input: {
    text: string;
    category: PersonalMemoryCategory;
    sensitivity: PersonalMemorySensitivity;
  }) => void;
}) {
  const [text, setText] = useState(entry?.text ?? "");
  const [category, setCategory] = useState<PersonalMemoryCategory>(entry?.category ?? "preference");
  const [sensitivity, setSensitivity] = useState<PersonalMemorySensitivity>(
    entry?.sensitivity ?? "standard",
  );
  const remaining = useMemo(() => 280 - text.trim().length, [text]);
  return (
    <form
      className="grid gap-3 px-3 py-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!text.trim() || remaining < 0) return;
        onSubmit({ text: text.trim(), category, sensitivity });
      }}
    >
      <Textarea
        autoFocus
        value={text}
        maxLength={280}
        onChange={(event) => setText(event.currentTarget.value)}
        placeholder="Example: I prefer direct answers in Brazilian Portuguese."
        className="min-h-24"
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <Select
          value={category}
          onChange={(event) => setCategory(event.currentTarget.value as PersonalMemoryCategory)}
          options={categories}
        />
        <Select
          value={sensitivity}
          onChange={(event) =>
            setSensitivity(event.currentTarget.value as PersonalMemorySensitivity)
          }
          options={[
            { value: "standard", label: "Standard" },
            { value: "local_only", label: "Local/self-hosted models only" },
          ]}
        />
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[length:var(--fs-xs)] text-(--ui-muted)">
          {remaining} characters left
        </span>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="submit"
            size="sm"
            variant="primary"
            disabled={!text.trim() || remaining < 0}
          >
            {submitLabel}
          </Button>
        </div>
      </div>
    </form>
  );
}
