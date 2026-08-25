"use client";

import { useState } from "react";
import { Schema } from "effect";
import {
  ConnectorsResponseSchema,
  type ConnectorView,
} from "@local-studio/agent-runtime/connector-contract";
import { ApiErrorResponseSchema } from "@local-studio/agent-runtime/api-contract";
import { Button, Checkbox, FormField, Input, ModelButton, Select } from "@/ui";
import { Plus, Trash2 } from "@/ui/icon-registry";
import { ResourceDrawer } from "@/ui/resource-drawer";
import { ResourceLogo } from "@/ui/resource-logo";
import { ModelStatus } from "@/features/recipes/recipes-content/model-page";

export type ConnectorFieldPair = { id: string; key: string; value: string };
type Transport = "http" | "stdio";

const newPair = (): ConnectorFieldPair => ({ id: crypto.randomUUID(), key: "", value: "" });

function slug(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function connectorPairsFromRecord(
  record: Record<string, string> | undefined,
): ConnectorFieldPair[] {
  return Object.entries(record ?? {}).map(([key, value]) => ({
    id: crypto.randomUUID(),
    key,
    value,
  }));
}

export function connectorPairsRecord(
  pairs: ConnectorFieldPair[],
): Record<string, string> | undefined {
  const entries = pairs
    .map((pair) => [pair.key.trim(), pair.value] as const)
    .filter(([key]) => key.length > 0);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function errorMessage(body: unknown, fallback: string): string {
  try {
    return Schema.decodeUnknownSync(ApiErrorResponseSchema)(body).error;
  } catch {
    return fallback;
  }
}

function validHttpEndpoint(value: string): boolean {
  try {
    const endpoint = new URL(value);
    if (endpoint.username || endpoint.password) return false;
    const loopback =
      endpoint.hostname === "localhost" ||
      endpoint.hostname === "127.0.0.1" ||
      endpoint.hostname === "[::1]";
    return endpoint.protocol === "https:" || (endpoint.protocol === "http:" && loopback);
  } catch {
    return false;
  }
}

export function ConnectorKeyValueFields({
  label,
  pairs,
  onChange,
}: {
  label: string;
  pairs: ConnectorFieldPair[];
  onChange: (pairs: ConnectorFieldPair[]) => void;
}) {
  const update = (id: string, field: "key" | "value", value: string) =>
    onChange(pairs.map((pair) => (pair.id === id ? { ...pair, [field]: value } : pair)));
  return (
    <FormField label={label} description="Values are hidden after saving.">
      <div className="space-y-2">
        {pairs.map((pair) => (
          <div
            key={pair.id}
            className="grid grid-cols-[minmax(8rem,0.7fr)_minmax(0,1fr)_auto] gap-2"
          >
            <Input
              value={pair.key}
              onChange={(event) => update(pair.id, "key", event.target.value)}
              placeholder="Name"
              className="font-mono"
            />
            <Input
              value={pair.value}
              onChange={(event) => update(pair.id, "value", event.target.value)}
              placeholder="Value"
              type="password"
              className="font-mono"
            />
            <ModelButton
              tone="danger"
              title={`Remove ${label.toLowerCase()} row`}
              onClick={() => onChange(pairs.filter((candidate) => candidate.id !== pair.id))}
            >
              <Trash2 className="h-3 w-3" />
            </ModelButton>
          </div>
        ))}
        <ModelButton onClick={() => onChange([...pairs, newPair()])}>
          <Plus className="h-3 w-3" /> Add row
        </ModelButton>
      </div>
    </FormField>
  );
}

export function CustomConnectorDrawer({
  onClose,
  onChanged,
}: {
  onClose: () => void;
  onChanged: (connectors: readonly ConnectorView[]) => void;
}) {
  const [name, setName] = useState("");
  const [id, setId] = useState("");
  const [idTouched, setIdTouched] = useState(false);
  const [transport, setTransport] = useState<Transport>("http");
  const [url, setUrl] = useState("");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [headers, setHeaders] = useState<ConnectorFieldPair[]>([]);
  const [environment, setEnvironment] = useState<ConnectorFieldPair[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    const connectorId = slug(id || name);
    if (!name.trim()) return setError("Give this connector a name.");
    if (!/^[a-z0-9][a-z0-9-_]{0,63}$/.test(connectorId)) {
      return setError("Connector ID must use lowercase letters, numbers, dashes, or underscores.");
    }
    if (transport === "http") {
      if (!validHttpEndpoint(url)) {
        return setError("Use HTTPS for remote MCP endpoints. HTTP is allowed only on this Mac.");
      }
    } else if (!command.trim()) {
      return setError("Enter the executable used to start this MCP server.");
    }

    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/agent/connectors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: connectorId,
          name: name.trim(),
          transport,
          url: transport === "http" ? url.trim() : undefined,
          headers: transport === "http" ? connectorPairsRecord(headers) : undefined,
          command: transport === "stdio" ? command.trim() : undefined,
          args:
            transport === "stdio"
              ? args
                  .split("\n")
                  .map((value) => value.trim())
                  .filter(Boolean)
              : undefined,
          env: transport === "stdio" ? connectorPairsRecord(environment) : undefined,
          enabled,
        }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(errorMessage(body, `HTTP ${response.status}`));
      const { connectors } = Schema.decodeUnknownSync(ConnectorsResponseSchema)(body);
      onChanged(connectors);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Connector could not be saved");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ResourceDrawer
      title="New custom connector"
      icon={<ResourceLogo identity={id || name || "mcp"} label={name || "MCP"} />}
      badge={<ModelStatus>advanced</ModelStatus>}
      status="Model Context Protocol"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={saving} onClick={() => void save()}>
            Save connector
          </Button>
        </>
      }
      onClose={onClose}
      width={680}
    >
      <p className="mb-6 text-[length:var(--fs-base)] leading-relaxed text-(--ui-muted)">
        Use this only for an MCP server you trust. Known account integrations should be connected
        from their provider setup instead.
      </p>
      <div className="space-y-4">
        <FormField label="Name" required>
          <Input
            value={name}
            onChange={(event) => {
              const next = event.target.value;
              setName(next);
              if (!idTouched) setId(slug(next));
            }}
            placeholder="My connector"
          />
        </FormField>
        <FormField label="Connector ID" description="Stable identifier used by sessions." required>
          <Input
            value={id}
            onChange={(event) => {
              setIdTouched(true);
              setId(event.target.value);
            }}
            placeholder="my-connector"
            className="font-mono"
          />
        </FormField>
        <FormField label="Transport" required>
          <Select
            value={transport}
            onChange={(event) => setTransport(event.target.value as Transport)}
            options={[
              { value: "http", label: "Remote HTTP endpoint" },
              { value: "stdio", label: "Local command (stdio)" },
            ]}
          />
        </FormField>
        {transport === "http" ? (
          <>
            <FormField label="MCP endpoint" required>
              <Input
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://example.com/mcp"
                className="font-mono"
              />
            </FormField>
            <ConnectorKeyValueFields
              label="Request headers"
              pairs={headers}
              onChange={setHeaders}
            />
          </>
        ) : (
          <>
            <FormField label="Command" required>
              <Input
                value={command}
                onChange={(event) => setCommand(event.target.value)}
                placeholder="npx"
                className="font-mono"
              />
            </FormField>
            <FormField label="Arguments" description="One argument per line.">
              <textarea
                value={args}
                onChange={(event) => setArgs(event.target.value)}
                rows={5}
                className="w-full rounded-[var(--ui-radius)] border border-(--ui-separator) bg-(--ui-surface) px-3 py-2 font-mono text-[length:var(--fs-sm)] text-(--ui-fg) focus:border-(--ui-accent)/60 focus:outline-none"
              />
            </FormField>
            <ConnectorKeyValueFields
              label="Environment variables"
              pairs={environment}
              onChange={setEnvironment}
            />
          </>
        )}
        <Checkbox
          checked={enabled}
          onChange={setEnabled}
          label="Enable in Workbench after saving"
        />
      </div>
      {error ? <p className="mt-4 text-[length:var(--fs-sm)] text-(--ui-danger)">{error}</p> : null}
    </ResourceDrawer>
  );
}
