import { describe, expect, test } from "bun:test";
// Relative on purpose: bun resolves no `@/` alias from this package.
import { createPriorityInferenceGate } from "../src/agentic/inference-gate";

//
// One card decodes one thing at a time, and the owner never waits behind the
// night's work. Both are properties of the queue, so both are pinned here.
//

const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("one decode at a time, whoever asked", () => {
  test("concurrent work never overlaps, whichever priority it came in at", async () => {
    const gate = createPriorityInferenceGate();
    let live = 0;
    let peak = 0;

    const job = (priority: "interactive" | "background") =>
      gate.run(priority, async () => {
        live += 1;
        peak = Math.max(peak, live);
        await settle(5);
        live -= 1;
      });

    await Promise.all([
      job("background"),
      job("interactive"),
      job("background"),
      job("interactive"),
    ]);
    expect(peak).toBe(1);
    expect(gate.depth().busy).toBe(false);
  });

  test("an interactive turn goes ahead of the background work already queued", async () => {
    const gate = createPriorityInferenceGate();
    const order: string[] = [];

    // Occupy the gate so everything after this genuinely queues.
    const occupied = gate.run("background", async () => {
      await settle(20);
      order.push("running");
    });

    await settle(1);
    const queued = [
      gate.run("background", async () => {
        order.push("overnight-1");
      }),
      gate.run("background", async () => {
        order.push("overnight-2");
      }),
      gate.run("interactive", async () => {
        order.push("owner");
      }),
    ];

    await Promise.all([occupied, ...queued]);
    expect(order[0]).toBe("running");
    expect(order[1]).toBe("owner");
    expect(order.slice(2).sort()).toEqual(["overnight-1", "overnight-2"]);
  });

  test("a failed turn releases the card instead of wedging it", async () => {
    const gate = createPriorityInferenceGate();
    await expect(
      gate.run("interactive", async () => {
        throw new Error("the provider refused");
      }),
    ).rejects.toThrow("refused");
    expect(await gate.run("background", async () => "next")).toBe("next");
    expect(gate.depth()).toEqual({ interactive: 0, background: 0, busy: false });
  });

  test("the queue reports what is waiting, so a stall is visible rather than inferred", async () => {
    const gate = createPriorityInferenceGate();
    const held = gate.run("background", () => settle(15));
    await settle(1);
    const waiting = [gate.run("interactive", async () => undefined), gate.run("background", async () => undefined)];
    const depth = gate.depth();
    expect(depth.busy).toBe(true);
    expect(depth.interactive).toBe(1);
    expect(depth.background).toBe(1);
    await Promise.all([held, ...waiting]);
  });
});
