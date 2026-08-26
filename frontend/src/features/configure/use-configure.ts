"use client";

import { useCallback, useRef, useState } from "react";
import type { CapabilityState } from "@local-studio/contracts/capabilities";
import api from "@/lib/api/client";
import type { RigNodePayload } from "@/lib/api/rigs";
import { readPageCache, scopedPageCacheKey, writePageCache } from "@/lib/page-data-cache";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import type { Rig, RigsPayload } from "@/lib/types";

const RIGS_CACHE_KEY = "configure:rigs";

export interface ConfigureState {
  rigs: Rig[];
  localNodeId: string;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  reload: () => Promise<void>;
  createRig: (name: string) => Promise<void>;
  renameRig: (rigId: string, name: string) => Promise<void>;
  describeRig: (rigId: string, description: string) => Promise<void>;
  deleteRig: (rigId: string) => Promise<void>;
  addNode: (rigId: string, payload: RigNodePayload & { name: string }) => Promise<void>;
  updateNode: (rigId: string, nodeId: string, payload: RigNodePayload) => Promise<void>;
  deleteNode: (rigId: string, nodeId: string) => Promise<void>;
}

export function useConfigure(
  rigsCapability: CapabilityState,
  controllerKey: string,
): ConfigureState {
  const rigsCacheKey = scopedPageCacheKey(controllerKey, RIGS_CACHE_KEY);
  const [rigsPayload, setRigsPayload] = useState<RigsPayload | null>(() =>
    rigsCapability === "supported" ? readPageCache<RigsPayload>(rigsCacheKey) : null,
  );
  const [loading, setLoading] = useState(
    rigsCapability === "unknown" || (rigsCapability === "supported" && rigsPayload === null),
  );
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeRef = useRef(false);
  const requestSequence = useRef(0);

  useMountSubscription(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
      requestSequence.current += 1;
    };
  }, [controllerKey]);

  const reload = useCallback(async () => {
    if (rigsCapability !== "supported") return;
    const requestId = ++requestSequence.current;
    setRefreshing(true);
    setError(null);
    try {
      const rigs = await api.getRigs();
      if (!activeRef.current || requestId !== requestSequence.current) return;
      writePageCache(rigsCacheKey, rigs);
      setRigsPayload(rigs);
    } catch (e) {
      if (activeRef.current && requestId === requestSequence.current) {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (activeRef.current && requestId === requestSequence.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [rigsCacheKey, rigsCapability]);

  useMountSubscription(() => {
    if (rigsCapability === "supported") {
      void reload();
      return;
    }
    setRigsPayload(null);
    setLoading(rigsCapability === "unknown");
    setRefreshing(false);
    setError(null);
  }, [reload, rigsCapability]);

  const applyRig = useCallback(
    (rig: Rig) => {
      if (!activeRef.current) return;
      setRigsPayload((current) => {
        if (!current) return current;
        const rigs = current.rigs.some((entry) => entry.id === rig.id)
          ? current.rigs.map((entry) => (entry.id === rig.id ? rig : entry))
          : [...current.rigs, rig];
        const next = { ...current, rigs };
        writePageCache(rigsCacheKey, next);
        return next;
      });
    },
    [rigsCacheKey],
  );

  const createRig = useCallback(
    async (name: string) => {
      if (rigsCapability !== "supported") throw new Error("Machines are unavailable");
      const result = await api.createRig({ name });
      applyRig(result.rig);
    },
    [applyRig, rigsCapability],
  );

  const renameRig = useCallback(
    async (rigId: string, name: string) => {
      if (rigsCapability !== "supported") throw new Error("Machines are unavailable");
      const result = await api.updateRig(rigId, { name });
      applyRig(result.rig);
    },
    [applyRig, rigsCapability],
  );

  const describeRig = useCallback(
    async (rigId: string, description: string) => {
      if (rigsCapability !== "supported") throw new Error("Machines are unavailable");
      const result = await api.updateRig(rigId, { description: description || null });
      applyRig(result.rig);
    },
    [applyRig, rigsCapability],
  );

  const deleteRig = useCallback(
    async (rigId: string) => {
      if (rigsCapability !== "supported") throw new Error("Machines are unavailable");
      await api.deleteRig(rigId);
      await reload();
    },
    [reload, rigsCapability],
  );

  const addNode = useCallback(
    async (rigId: string, payload: RigNodePayload & { name: string }) => {
      if (rigsCapability !== "supported") throw new Error("Machines are unavailable");
      const result = await api.addRigNode(rigId, payload);
      applyRig(result.rig);
    },
    [applyRig, rigsCapability],
  );

  const updateNode = useCallback(
    async (rigId: string, nodeId: string, payload: RigNodePayload) => {
      if (rigsCapability !== "supported") throw new Error("Machines are unavailable");
      const result = await api.updateRigNode(rigId, nodeId, payload);
      applyRig(result.rig);
    },
    [applyRig, rigsCapability],
  );

  const deleteNode = useCallback(
    async (rigId: string, nodeId: string) => {
      if (rigsCapability !== "supported") throw new Error("Machines are unavailable");
      const result = await api.deleteRigNode(rigId, nodeId);
      applyRig(result.rig);
    },
    [applyRig, rigsCapability],
  );

  return {
    rigs: rigsPayload?.rigs ?? [],
    localNodeId: rigsPayload?.local_node_id ?? "local",
    loading,
    refreshing,
    error,
    reload,
    createRig,
    renameRig,
    describeRig,
    deleteRig,
    addNode,
    updateNode,
    deleteNode,
  };
}
