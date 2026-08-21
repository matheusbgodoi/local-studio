import { describe, expect, test } from "bun:test";
// Relative on purpose: bun resolves no `@/` alias from this package.
import {
  planIsSettled,
  resolveReadiness,
  selectNextTask,
  validatePlan,
  type TaskNode,
} from "../src/agentic/dag";

const node = (id: string, dependencies: string[] = [], status: TaskNode["status"] = "PENDING"): TaskNode => ({
  id,
  status,
  dependencies,
});

describe("a plan is validated before it is scheduled, not when the scheduler starves", () => {
  test("a acyclic plan returns a topological order", () => {
    const result = validatePlan([node("a"), node("b", ["a"]), node("c", ["a", "b"])]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.order.indexOf("a")).toBeLessThan(result.order.indexOf("b"));
      expect(result.order.indexOf("b")).toBeLessThan(result.order.indexOf("c"));
    }
  });

  test("a cycle is rejected and the cycle itself is reported", () => {
    const result = validatePlan([node("a", ["c"]), node("b", ["a"]), node("c", ["b"])]);
    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === "cycle") {
      expect(result.cycle.length).toBeGreaterThan(0);
    } else {
      throw new Error("expected a cycle");
    }
  });

  test("a task depending on itself is a cycle of one and is named as such", () => {
    const result = validatePlan([node("a", ["a"])]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("self-dependency");
  });

  test("a dependency on a task that is not in the plan is rejected", () => {
    const result = validatePlan([node("a", ["ghost"])]);
    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === "unknown-dependency") {
      expect(result.dependencyId).toBe("ghost");
    } else {
      throw new Error("expected an unknown dependency");
    }
  });

  test("two tasks with one id is rejected before anything reads either", () => {
    const result = validatePlan([node("a"), node("a")]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("duplicate-task");
  });

  test("an empty plan is valid and orders nothing", () => {
    const result = validatePlan([]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.order).toEqual([]);
  });
});

describe("READY is derived from dependency state, never stored as an opinion", () => {
  test("a task with no dependencies is ready", () => {
    expect(resolveReadiness([node("a")]).ready).toEqual(["a"]);
  });

  test("a task waits while any dependency is unfinished", () => {
    const resolution = resolveReadiness([node("a"), node("b", ["a"])]);
    expect(resolution.ready).toEqual(["a"]);
    expect(resolution.blocked).toEqual(["b"]);
  });

  test("every dependency SUCCEEDED makes the dependent ready", () => {
    const resolution = resolveReadiness([node("a", [], "SUCCEEDED"), node("b", ["a"])]);
    expect(resolution.ready).toEqual(["b"]);
  });

  test("a FAILED dependency blocks rather than merely delays: nothing will satisfy it", () => {
    const resolution = resolveReadiness([node("a", [], "FAILED"), node("b", ["a"])]);
    expect(resolution.blocked).toEqual(["b"]);
    expect(resolution.ready).toEqual([]);
  });

  test("a CANCELLED dependency blocks the same way", () => {
    expect(resolveReadiness([node("a", [], "CANCELLED"), node("b", ["a"])]).blocked).toEqual(["b"]);
  });

  test("RUNNING, WAITING_USER and terminal tasks are left alone", () => {
    const resolution = resolveReadiness([
      node("a", [], "RUNNING"),
      node("b", [], "WAITING_USER"),
      node("c", [], "SUCCEEDED"),
    ]);
    expect(resolution.unchanged.sort()).toEqual(["a", "b", "c"]);
    expect(resolution.ready).toEqual([]);
  });
});

describe("one local inference slot means one selected task", () => {
  test("a RUNNING task keeps the slot rather than being preempted", () => {
    expect(selectNextTask([node("a", [], "RUNNING"), node("b")])).toBe("a");
  });

  test("with nothing running the earliest ready task in topological order wins", () => {
    expect(selectNextTask([node("b", ["a"]), node("a", [], "SUCCEEDED"), node("c", ["a"])])).toBe("b");
  });

  test("nothing ready selects nothing instead of inventing work", () => {
    expect(selectNextTask([node("a", [], "FAILED"), node("b", ["a"])])).toBeNull();
  });

  test("a plan is settled only when every task is terminal", () => {
    expect(planIsSettled([node("a", [], "SUCCEEDED"), node("b", [], "FAILED")])).toBe(true);
    expect(planIsSettled([node("a", [], "SUCCEEDED"), node("b")])).toBe(false);
  });
});
