import { describe, expect, test } from "bun:test";

/**
 * THE DEFECT THIS PINS: a progressive transcript appended instead of replacing itself.
 *
 * The on-device engine emits volatile results — "quero", then "quero que", then "quero que
 * você" — and the composer's existing handler appended each one, which produces
 * "quero quero que quero que você". So the composer tracks the SPAN this utterance owns and
 * every partial rewrites exactly that range.
 *
 * The logic under test is `handleTranscript` in use-chat-pane-composer-actions.ts. It lives
 * inside a React hook, so the reducible part is reproduced here EXACTLY — same branches, same
 * order — and the test's job is to pin the behaviour that reduction has to keep. If the hook
 * and this diverge, the divergence is the bug; the shape is deliberately small enough that it
 * can be compared by eye.
 */

type Phase = "partial" | "final";
type Span = { start: number; length: number } | null;

function applyTranscript(
  current: string,
  transcript: string,
  phase: Phase,
  open: Span,
): { next: string; caret: number; span: Span } {
  const text = transcript.trim();
  let start: number;
  let before: string;
  let after: string;

  if (open && open.start + open.length <= current.length) {
    start = open.start;
    before = current.slice(0, start);
    after = current.slice(start + open.length);
  } else {
    const head = current.trimEnd();
    before = head ? `${head} ` : "";
    start = before.length;
    after = "";
  }

  if (!text && !open) return { next: current, caret: current.length, span: null };

  const next = text
    ? `${before}${text}${after}`
    : `${after ? before : before.trimEnd()}${after}`;
  return {
    next,
    caret: text ? start + text.length : next.length,
    span: phase === "partial" ? { start, length: text.length } : null,
  };
}

/** Replay a whole utterance the way the helper emits it. */
function dictate(start: string, events: Array<[string, Phase]>): string {
  let input = start;
  let span: Span = null;
  for (const [text, phase] of events) {
    const result = applyTranscript(input, text, phase, span);
    input = result.next;
    span = result.span;
  }
  return input;
}

describe("a partial replaces the span it wrote, it does not append", () => {
  test("the growing-sentence case, which is what appending destroyed", () => {
    expect(
      dictate("", [
        ["quero", "partial"],
        ["quero que", "partial"],
        ["quero que você", "partial"],
        ["quero que você leia", "final"],
      ]),
    ).toBe("quero que você leia");
  });

  test("a partial that gets SHORTER still replaces the whole span", () => {
    // The recogniser is allowed to change its mind. Leftover characters from a longer previous
    // guess would be text the user never said.
    expect(
      dictate("", [
        ["mandar isso agora", "partial"],
        ["mandar isso", "partial"],
        ["mandar", "final"],
      ]),
    ).toBe("mandar");
  });

  test("it appends after text the user already typed, with exactly one space", () => {
    expect(dictate("olha só", [["isso aqui", "final"]])).toBe("olha só isso aqui");
    expect(dictate("olha só   ", [["isso aqui", "final"]])).toBe("olha só isso aqui");
    expect(dictate("", [["isso aqui", "final"]])).toBe("isso aqui");
  });

  test("a final closes the span, so the NEXT utterance does not eat the last one", () => {
    expect(
      dictate("", [
        ["primeira frase", "final"],
        ["segunda", "partial"],
        ["segunda frase", "final"],
      ]),
    ).toBe("primeira frase segunda frase");
  });

  test("two utterances of partials in a row stay separate sentences", () => {
    expect(
      dictate("", [
        ["um", "partial"],
        ["um dois", "final"],
        ["três", "partial"],
        ["três quatro", "final"],
      ]),
    ).toBe("um dois três quatro");
  });
});

describe("the span cannot corrupt text it does not own", () => {
  test("a span pointing past the end of the input is abandoned, not applied", () => {
    // The composer was cleared (a turn was sent) while a partial was in flight. Slicing on a
    // stale offset would splice the sentence into the middle of whatever is there now.
    const result = applyTranscript("", "chegou tarde", "final", { start: 40, length: 12 });
    expect(result.next).toBe("chegou tarde");
  });

  test("text typed AFTER the span survives a later partial", () => {
    // span owns [0,5); the user then typed " e mais" by hand.
    const result = applyTranscript("falar e mais", "falando", "partial", {
      start: 0,
      length: 5,
    });
    expect(result.next).toBe("falando e mais");
    expect(result.span).toEqual({ start: 0, length: 7 });
  });

  test("the caret lands at the end of what was just written, not the end of the box", () => {
    const result = applyTranscript("falar e mais", "falando", "partial", {
      start: 0,
      length: 5,
    });
    expect(result.caret).toBe(7);
    expect(result.next.slice(0, result.caret)).toBe("falando");
  });

  test("an empty final with nothing dictated is a no-op, not a trailing space", () => {
    // The user pressed stop before saying anything. The first version of this appended the
    // separator anyway and left "já tinha texto " behind.
    expect(dictate("já tinha texto", [["", "final"]])).toBe("já tinha texto");
    expect(dictate("", [["", "final"]])).toBe("");
  });

  test("emptying an owned span takes its separator with it", () => {
    // A partial landed, then the recogniser withdrew it. What is left must be what was there
    // before, not that plus a gap.
    expect(
      dictate("já tinha texto", [
        ["talvez", "partial"],
        ["", "final"],
      ]),
    ).toBe("já tinha texto");
  });

  test("but not when the user typed after it — the gap is theirs to keep", () => {
    const result = applyTranscript("falar e mais", "", "final", { start: 0, length: 5 });
    expect(result.next).toBe(" e mais");
  });
});
