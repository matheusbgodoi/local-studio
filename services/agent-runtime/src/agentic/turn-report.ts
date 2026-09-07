import { criterionIsSatisfied, acceptanceReviewReason } from "../../../../shared/agent/acceptance";
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
  const byId = new Map(
    report.evidence.map((entry) => [entry.criterionId, entry.evidence] as const),
  );
  const newlySatisfied: string[] = [];
  const next = acceptance.map((criterion) => {
    const evidence = byId.get(criterion.id);
    if (criterionIsSatisfied(criterion) || evidence === undefined) return criterion;
    if (criterionIsSatisfied({ ...criterion, satisfied: true, evidenceSource: "model_report" }))
      newlySatisfied.push(criterion.id);
    return {
      ...criterion,
      satisfied: criterionIsSatisfied({
        ...criterion,
        satisfied: true,
        evidenceSource: "model_report",
      }),
      evidence,
      evidenceSource: "model_report" as const,
    };
  });
  const outstanding = next
    .filter((criterion) => !criterionIsSatisfied(criterion))
    .map((criterion) => criterion.id);
  const satisfied = next.length === 0 ? report.claimedComplete : outstanding.length === 0;
  return { acceptance: next, satisfied, newlySatisfied, outstanding };
}

export function acceptanceRejection(outcome: AcceptanceOutcome, report: TurnReport): string | null {
  if (!report.claimedComplete || outcome.satisfied) return null;
  const review = acceptanceReviewReason(outcome.acceptance);
  if (review) return review;
  if (outcome.acceptance.length === 0) return null;
  const lines = outcome.outstanding.map((id) => `TASK_EVIDENCE ${id}: <what proves it>`);
  return `claimed complete with unmet acceptance criteria: ${outcome.outstanding.join(", ")}. Emit one line per criterion, exactly: ${lines.join(" | ")}`;
}
