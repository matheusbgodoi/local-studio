import type { AcceptanceCriterion } from "./agentic-run";

export function requiresRuntimeEvidence(criterion: AcceptanceCriterion): boolean {
  return ["command", "file", "artifact"].includes(criterion.kind);
}

export function criterionIsSatisfied(criterion: AcceptanceCriterion): boolean {
  return (
    criterion.satisfied &&
    (!requiresRuntimeEvidence(criterion) ||
      (criterion.evidenceSource === "runtime_observation" &&
        (!criterion.check || !!criterion.witness)))
  );
}

export function acceptanceReviewReason(criteria: readonly AcceptanceCriterion[]): string | null {
  const pending = criteria.filter(
    (criterion) => requiresRuntimeEvidence(criterion) && !criterionIsSatisfied(criterion),
  );
  if (pending.length === 0) return null;
  return (
    `Independent verification is required for: ${pending.map((c) => c.id).join(", ")}. ` +
    "Model reports cannot verify command, file, or artifact criteria. Exact command/file specifications can be observed by this runtime; legacy description-only criteria and arbitrary artifacts cannot. " +
    "Review the actual outputs and revise the plan explicitly as a review/assertion if appropriate, then resume. Repeating the same report will not satisfy these criteria."
  );
}
