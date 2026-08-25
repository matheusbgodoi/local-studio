import { getStoredBackendUrl } from "@/lib/api/connection";

export type ControllerIdentity = {
  controllerKey: string;
  generation: number;
};

let observedControllerKey: string | null = null;
let generation = 0;

export function captureControllerIdentity(): ControllerIdentity {
  const controllerKey = getStoredBackendUrl() || "default";
  if (controllerKey !== observedControllerKey) {
    observedControllerKey = controllerKey;
    generation += 1;
  }
  return { controllerKey, generation };
}
