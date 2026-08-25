import { Schema } from "effect";

export const CapabilityStateSchema = Schema.Literals(["supported", "unsupported", "unknown"]);
export const ControllerModeSchema = Schema.Literals(["full", "inference-gateway", "legacy"]);

export const ControllerFeaturesSchema = Schema.Struct({
  config: CapabilityStateSchema,
  compatibility: CapabilityStateSchema,
  lifecycle: CapabilityStateSchema,
  catalog: CapabilityStateSchema,
  modelIndex: CapabilityStateSchema,
  downloadQueue: CapabilityStateSchema,
  recipes: CapabilityStateSchema,
  rigs: CapabilityStateSchema,
  logs: CapabilityStateSchema,
  openapi: CapabilityStateSchema,
  metrics: CapabilityStateSchema,
  metricsHistory: CapabilityStateSchema,
  usage: CapabilityStateSchema,
});

export const ControllerCapabilitiesSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  controllerVersion: Schema.NullOr(Schema.String),
  mode: ControllerModeSchema,
  features: ControllerFeaturesSchema,
});

export type CapabilityState = typeof CapabilityStateSchema.Type;
export type ControllerFeatures = typeof ControllerFeaturesSchema.Type;
export type ControllerCapabilities = typeof ControllerCapabilitiesSchema.Type;
