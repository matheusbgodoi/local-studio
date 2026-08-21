//
// What the agent claims, and what the runtime is willing to believe.
//
// "Done" is a candidate for validation and nothing more. A task succeeds when
// every acceptance criterion carries evidence — the runtime reads the markers
// out of the turn's final text and gates on the criteria, not on the word.
//

import type { AcceptanceCriterion } from "./contract";

export type TurnReport = {
  evidence: { criterionId: string; evidence: string }[];
  claimedComplete: boolean;
  blockedReason: string | null;
  userQuestion: string | null;
  errors: string[];
};

const EVIDENCE_PATTERN = /^\s*TASK_EVIDENCE\s+([A-Za-z0-9._-]+)\s*:\s*(.+)$/;
const BLOCKED_PATTERN = /^\s*TASK_BLOCKED\s*:?\s*(.*)$/;
const NEEDS_USER_PATTERN = /^\s*NEEDS_USER\s*:?\s*(.*)$/;
const COMPLETE_PATTERN = /\bTASK_COMPLETE\b/;

export function parseTurnReport(finalText: string): TurnReport {
  const report: TurnReport = {
    evidence: [],
    claimedComplete: COMPLETE_PATTERN.test(finalText),
    blockedReason: null,
    userQuestion: null,
    errors: [],
  };
  for (const line of finalText.split("\n")) {
    const evidence = EVIDENCE_PATTERN.exec(line);
    if (evidence?.[1] && evidence[2]) {
      report.evidence.push({ criterionId: evidence[1], evidence: evidence[2].trim() });
      continue;
    }
    const blocked = BLOCKED_PATTERN.exec(line);
    if (blocked) {
      report.blockedReason = blocked[1]?.trim() || "no reason given";
      continue;
    }
    const needsUser = NEEDS_USER_PATTERN.exec(line);
    if (needsUser) {
      report.userQuestion = needsUser[1]?.trim() || "a decision is required";
    }
  }
  return report;
}

export type AcceptanceOutcome = {
  acceptance: AcceptanceCriterion[];
  satisfied: boolean;
  newlySatisfied: string[];
  outstanding: string[];
};

export function applyEvidence(
  acceptance: readonly AcceptanceCriterion[],
  report: TurnReport,
): AcceptanceOutcome {
  const byId = new Map(report.evidence.map((entry) => [entry.criterionId, entry.evidence] as const));
  const newlySatisfied: string[] = [];
  const next = acceptance.map((criterion) => {
    const evidence = byId.get(criterion.id);
    if (criterion.satisfied || evidence === undefined) return criterion;
    newlySatisfied.push(criterion.id);
    return { ...criterion, satisfied: true, evidence };
  });
  const outstanding = next.filter((criterion) => !criterion.satisfied).map((criterion) => criterion.id);
  return {
    acceptance: next,
    satisfied: next.length > 0 && outstanding.length === 0,
    newlySatisfied,
    outstanding,
  };
}

//
// A claim of completion with criteria still owed is not a failure of the run,
// it is a rejected candidate: the attempt ends, the task stays RUNNING, and
// the missing evidence is what the next attempt is told about.
//
export function acceptanceRejection(outcome: AcceptanceOutcome, report: TurnReport): string | null {
  if (!report.claimedComplete || outcome.satisfied) return null;
  if (outcome.acceptance.length === 0) return null;
  return `claimed complete with unmet acceptance criteria: ${outcome.outstanding.join(", ")}`;
}
