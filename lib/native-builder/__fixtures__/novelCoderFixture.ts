/**
 * Deliberately broken, isolated fixture for the hosted-model coder proposal regression suite
 * (General-Purpose Coder Proposal Generation phase). Never imported by real app code — safe to
 * detect, patch, validate, and roll back repeatedly, same discipline as knownIssueFixture.ts.
 *
 * This bug's shape does NOT match either existing deterministic template
 * (off_by_one_loop_bound_length_minus_one / duplicate_import_line — see repairPlanner.ts), so
 * buildDeterministicProposal() correctly returns null for it. That is the point: any proposal
 * selected for a repair against this fixture proves it came from the hosted-model path, not a
 * template match — this is what "previously unseen coding task" means operationally.
 *
 * Seeded bug: uses `>` instead of `>=`, so isAdult(18) incorrectly returns false.
 */
export function isAdult(age: number): boolean {
  return age > 18
}
