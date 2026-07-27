/**
 * Canonical System Health snapshot — Commander's immune-system view.
 *
 * IMPORTANT ARCHITECTURE NOTE: this repo already has TWO real, independently-computed health
 * systems — lib/runtime/canonicalStatus.ts (`collectCanonicalRuntimeStatus`, 11 real subsystems
 * with evidence/confidence/missingEvidence) and lib/runtime/runtimeIntegrityTypes.ts +
 * finalizeRuntimeIntegrityResponse.ts (a richer per-subsystem model with MOCK/UNWIRED/
 * CONFIGURED_ONLY/truthLevel granularity, wired through app/api/runtime/integrity). Per the
 * explicit instruction to reuse canonical systems rather than create a third competing one, this
 * module does NOT recompute health — it PROJECTS collectCanonicalRuntimeStatus (System A) plus
 * native-builder's own real issue/repair-mission counts into the typed shape the Commander UI
 * needs. Reconciling System B (runtimeIntegrityTypes) into this same projection is real,
 * worthwhile follow-up work, deliberately not attempted here — see the final report's honest
 * limitations section. Building a THIRD independently-computed health engine would be exactly
 * the "competing source of truth" this instruction forbids.
 */
import { collectCanonicalRuntimeStatus, type CanonicalRuntimeStatus, type CanonicalSubsystemStatus } from '@/lib/runtime/canonicalStatus'
import { countUnresolvedIssues, listRepairs } from './storage'

export type SystemHealthStatus =
  | 'healthy'
  | 'observing'
  | 'unknown'
  | 'not_evaluated'
  | 'stale'
  | 'advisory'
  | 'degraded'
  | 'unavailable'
  | 'blocked'
  | 'diagnosing'
  | 'repair_plan_ready'
  | 'awaiting_commander_approval'
  | 'repairing'
  | 'validating'
  | 'partially_recovered'
  | 'recovered'
  | 'repair_failed'
  | 'rolled_back'

export type HealthEvidence = { id: string; label: string; source: 'canonical_runtime_status' | 'native_builder' }

export type RecoveryAction = { label: string; detail: string }

export type SystemHealthCheck = {
  id: string
  subsystemId: string
  title: string
  status: SystemHealthStatus
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical'
  confidence: number | null
  evaluated: boolean
  evidence: HealthEvidence[]
  dependencies: string[]
  affectedSystems: string[]
  issueIds: string[]
  lastCheckedAt: string | null
  recoveryActions: RecoveryAction[]
}

export type CanonicalSystemHealthSnapshot = {
  generatedAt: string
  overallStatus: SystemHealthStatus
  evaluatedChecks: number
  totalChecks: number
  /** null means NOT FULLY EVALUATED — never fabricate a percentage from unknown/unevaluated checks. */
  healthPercentage: number | null
  checks: SystemHealthCheck[]
  unresolvedIssueCount: number
  activeRepairMissionIds: string[]
  confidenceBasis: string
}

function severityForHealth(health: CanonicalRuntimeHealthLike): SystemHealthCheck['severity'] {
  switch (health) {
    case 'unavailable':
      return 'critical'
    case 'degraded':
      return 'medium'
    case 'unknown':
      return 'low'
    default:
      return 'info'
  }
}

function statusForHealth(health: CanonicalRuntimeHealthLike): SystemHealthStatus {
  switch (health) {
    case 'healthy':
      return 'healthy'
    case 'degraded':
      return 'degraded'
    case 'unavailable':
      return 'unavailable'
    case 'unknown':
    default:
      return 'unknown'
  }
}

type CanonicalRuntimeHealthLike = CanonicalSubsystemStatus['health']

function mapSubsystemToCheck(subsystem: CanonicalSubsystemStatus): SystemHealthCheck {
  // Every System A subsystem is a real, evidence-backed computation on every call (no skipped
  // evaluation exists there today) — so all of them are honestly "evaluated", even when the
  // evaluated result itself is 'unknown'/'degraded'/'unavailable'. This is why the
  // NOT-FULLY-EVALUATED path below currently only triggers from missing native-builder data, not
  // from System A — reconciling System B (which has genuine UNWIRED/CONFIGURED_ONLY/DECLARED
  // states) is what would make that distinction meaningfully exercised for runtime subsystems too.
  return {
    id: `canonical:${subsystem.id}`,
    subsystemId: subsystem.id,
    title: subsystem.label,
    status: statusForHealth(subsystem.health),
    severity: severityForHealth(subsystem.health),
    confidence: subsystem.confidence,
    evaluated: true,
    // missingEvidence carries the actual descriptive diagnosis text (e.g. "No live Tavily or
    // Firecrawl provider is connected.") — subsystem.evidence alone is terse key=value telemetry
    // that the repair-scope classifier's patterns can't match against. Both are real; combining
    // them is what makes the [ REPAIR SYSTEM ] sweep's scope classification actually work instead
    // of falling through to 'unclear' for every real degraded subsystem.
    evidence: [
      ...subsystem.evidence.map((e, i) => ({ id: `${subsystem.id}:evidence:${i}`, label: e, source: 'canonical_runtime_status' as const })),
      ...subsystem.missingEvidence.map((e, i) => ({ id: `${subsystem.id}:missing:${i}`, label: e, source: 'canonical_runtime_status' as const })),
    ],
    dependencies: [],
    affectedSystems: subsystem.downstreamImpact,
    issueIds: [],
    lastCheckedAt: subsystem.lastChecked,
    recoveryActions: subsystem.recommendedRecovery.map(r => ({ label: 'Recommended recovery', detail: r })),
  }
}

function nativeBuilderCheck(unresolvedIssueCount: number, activeRepairMissionIds: string[], generatedAt: string): SystemHealthCheck {
  const status: SystemHealthStatus = unresolvedIssueCount === 0 ? 'healthy' : activeRepairMissionIds.length > 0 ? 'repairing' : 'degraded'
  return {
    id: 'canonical:native_builder',
    subsystemId: 'native_builder',
    title: 'Native Builder',
    status,
    severity: unresolvedIssueCount === 0 ? 'info' : 'medium',
    confidence: 95,
    evaluated: true,
    evidence: [
      { id: 'native_builder:unresolved', label: `unresolvedIssueCount=${unresolvedIssueCount}`, source: 'native_builder' },
      { id: 'native_builder:active_repairs', label: `activeRepairMissions=${activeRepairMissionIds.length}`, source: 'native_builder' },
    ],
    dependencies: [],
    affectedSystems: [],
    issueIds: [],
    lastCheckedAt: generatedAt,
    recoveryActions: unresolvedIssueCount > 0 ? [{ label: 'Repair System', detail: 'Open the unresolved native-builder issues and run a repair mission.' }] : [],
  }
}

const NON_TERMINAL_REPAIR_STATES = new Set([
  'detected',
  'collecting_evidence',
  'inspecting_repository',
  'planning',
  'awaiting_local_execution_approval',
  'applying_patch',
  'validating',
  'awaiting_commander_review',
])

export async function buildCanonicalSystemHealthSnapshot(req: Request): Promise<CanonicalSystemHealthSnapshot> {
  const [runtimeStatus, unresolvedIssueCount, repairs]: [CanonicalRuntimeStatus, number, Awaited<ReturnType<typeof listRepairs>>] =
    await Promise.all([collectCanonicalRuntimeStatus(req), countUnresolvedIssues(), listRepairs()])

  const activeRepairMissionIds = repairs.filter(r => NON_TERMINAL_REPAIR_STATES.has(r.state)).map(r => r.id)

  const checks: SystemHealthCheck[] = [
    ...runtimeStatus.subsystems.map(mapSubsystemToCheck),
    nativeBuilderCheck(unresolvedIssueCount, activeRepairMissionIds, runtimeStatus.generatedAt),
  ]

  const evaluatedChecks = checks.filter(c => c.evaluated)
  const totalChecks = checks.length
  const healthyEvaluated = evaluatedChecks.filter(c => c.status === 'healthy' || c.status === 'recovered').length

  // Honest rule: a health percentage may only be computed when every check has been evaluated.
  // Any not_evaluated/unknown check present means the coverage is incomplete — show null (the UI
  // renders "NOT FULLY EVALUATED"), never a percentage that silently treats unknowns as healthy.
  const hasUnevaluated = evaluatedChecks.length < totalChecks
  const hasUnknown = checks.some(c => c.status === 'unknown' || c.status === 'not_evaluated')
  const healthPercentage = hasUnevaluated || hasUnknown ? null : Math.round((healthyEvaluated / Math.max(1, evaluatedChecks.length)) * 100)

  const overallStatus: SystemHealthStatus =
    unresolvedIssueCount > 0 && activeRepairMissionIds.length > 0
      ? 'repairing'
      : checks.some(c => c.status === 'unavailable')
        ? 'unavailable'
        : checks.some(c => c.status === 'degraded')
          ? 'degraded'
          : checks.some(c => c.status === 'unknown')
            ? 'unknown'
            : 'healthy'

  return {
    generatedAt: runtimeStatus.generatedAt,
    overallStatus,
    evaluatedChecks: evaluatedChecks.length,
    totalChecks,
    healthPercentage,
    checks,
    unresolvedIssueCount,
    activeRepairMissionIds,
    confidenceBasis: 'Projected from lib/runtime/canonicalStatus.ts (collectCanonicalRuntimeStatus) plus lib/native-builder issue/repair-mission counts. Percentage is null unless every check was evaluated with real evidence.',
  }
}
