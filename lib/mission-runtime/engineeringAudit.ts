/**
 * Phase K — Observability & Audit. Pure metadata-shaping helpers for the two Engineering Core
 * capabilities that were added by this mission's own earlier phases (E: Council Assist, I:
 * Provider Experience) without ever flowing into lib/war-room/repoAudit.ts's existing
 * logWarRoomRepoAudit() sink — native-builder's own core state transitions already audit-log via
 * runtime.ts's persist(), this file closes the gap for the two newer, mission-runtime-level
 * capabilities.
 *
 * Deliberately pure and side-effect-free: these functions only shape the metadata object; the
 * actual logWarRoomRepoAudit() call happens at the engineeringStrategy.ts call sites. This split
 * exists so the metadata SHAPE is directly unit-testable without needing to intercept or mock the
 * audit sink itself (which, per lib/war-room/auditLog.ts's insertWarRoomAuditLog(), is a
 * network call to Supabase that safely no-ops when Supabase isn't configured — exactly the honest,
 * non-fabricated "empty but real" behavior this environment exhibits, proven in
 * engineeringAudit.validation.ts).
 */
import type { NativeCouncilAssistComposition, NativeCouncilAssistSession } from '@/lib/native-builder/types'
import type { DirectProviderFamily } from '@/lib/council/providerDirectCall'

export type CouncilAssistAuditMetadata = {
  repairId: string
  composition: NativeCouncilAssistComposition
  roster: string[]
  okFamilies: string[]
  failedFamilies: string[]
  sessionId: string
}

/** Shapes the audit metadata for one completed Council Assist session — which families were
 * asked (roster), and, of those, which actually answered ok vs failed. Never claims a family
 * succeeded that didn't: okFamilies/failedFamilies are derived directly from
 * session.results[].ok, the same honest per-family result Council Assist itself already returns
 * to the caller. */
export function buildCouncilAssistAuditMetadata(repairId: string, session: NativeCouncilAssistSession): CouncilAssistAuditMetadata {
  return {
    repairId,
    composition: session.composition,
    roster: session.roster,
    okFamilies: session.results.filter(r => r.ok).map(r => r.family),
    failedFamilies: session.results.filter(r => !r.ok).map(r => r.family),
    sessionId: session.id,
  }
}

export type ProviderResolutionAuditMetadata = {
  repairId: string
  requested: boolean
  requestedFamily?: DirectProviderFamily
  resolvedFamily: DirectProviderFamily | null
  degradedToDeterministic: boolean
}

/** Shapes the audit metadata for one hosted-coder provider resolution decision (create() or
 * autoIterate()) — what was requested, what resolveConfiguredProviderFamily() actually resolved
 * to (see lib/council/providerDirectCall.ts), and whether the request degraded to the
 * deterministic/local-model path because nothing requested was configured. `degradedToDeterministic`
 * is true only when a request was genuinely made (requested === true) and resolution genuinely
 * failed (resolvedFamily === null) — never inferred from absence alone, so a mission that never
 * asked for a hosted coder at all is correctly recorded as "not requested," not "degraded." */
export function buildProviderResolutionAuditMetadata(
  repairId: string,
  requested: { enabled: boolean; family?: DirectProviderFamily } | undefined,
  resolvedFamily: DirectProviderFamily | null,
): ProviderResolutionAuditMetadata {
  const wasRequested = requested?.enabled === true
  return {
    repairId,
    requested: wasRequested,
    requestedFamily: requested?.family,
    resolvedFamily,
    degradedToDeterministic: wasRequested && resolvedFamily === null,
  }
}
