/**
 * Pure helper for the monotonic-sequence "stale response" guard used by both TerraShell's
 * activateCoordinate (existing, Phase 4) and useTerraRelatedIntelligence.ts (event-intelligence
 * phase): a response is stale exactly when a newer request has been issued since this one started,
 * regardless of arrival order. Extracted to a named, independently testable function rather than
 * left as an inline `!==` at each call site, per this phase's deterministic-coverage requirement
 * for cancellation/idempotency logic.
 */
export function isTerraRequestStale(requestSequence: number, latestSequence: number): boolean {
  return requestSequence !== latestSequence
}
