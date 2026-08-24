/**
 * SingleAgentEngineeringStrategy — the first and only MissionExecutionStrategy implemented in
 * Phase 1. Every mutating operation below delegates to an existing lib/native-builder/runtime.ts
 * function; this file adds no execution logic of its own beyond request/response projection.
 *
 * "Single agent" here means two things, both already true of native-builder without any change:
 *   1. Execution is a single sequential pipeline (inspect -> plan -> apply -> validate -> verify),
 *      never a multi-family deliberation — the opposite of Council's simultaneous multi-provider
 *      gather. This is native-builder's existing shape; nothing was restructured to fit it.
 *   2. When a provider is invoked at all, it is exactly one family, not the Council roster. See
 *      requestSingleAgentOpinion below.
 *
 * Do not add a second execution engine here. If native-builder's runtime.ts doesn't do something
 * this strategy needs, that is a signal to extend runtime.ts narrowly (with Commander
 * authorization) — not to reimplement it in this file.
 */
import {
  reportIssue,
  planRepair,
  approveAndApply,
  commanderResolve,
  rollbackNow,
} from '@/lib/native-builder/runtime'
import { getIssue, getRepair, listRepairs, saveRepair } from '@/lib/native-builder/storage'
import { issueFromCommanderReport } from '@/lib/native-builder/issueIngest'
import type { NativeIssueRecord, NativeRepairRecord, NativeCouncilAssistComposition } from '@/lib/native-builder/types'
import { requestCouncilAssist } from '@/lib/native-builder/councilAssist'
import {
  invokeDirectCouncilProvider,
  type DirectProviderFamily,
} from '@/lib/council/providerDirectCall'
import {
  ENGINEERING_MISSION_CAPABILITIES,
  ENGINEERING_MISSION_POLICY,
  missionStatusFromRepairState,
  type EngineeringMissionRequest,
  type MissionExecutionStrategy,
  type RuntimeMission,
  type RuntimeMissionProviderOpinion,
} from './types'

/**
 * Runs exactly one provider call, outside of and prior to native-builder's own planning step.
 * This proves the "Providers" capability and the single-agent execution model end to end using
 * the real, key-gated adapter (lib/council/providerDirectCall.ts) — not a mock. In an environment
 * without the relevant API key configured, invokeDirectCouncilProvider already returns an honest
 * `{ok: false, transportStatus: 'unavailable', error: '<KEY> not configured'}` rather than a fake
 * success; that honest failure is surfaced in RuntimeMission.providerOpinions unchanged, exactly
 * as lib/providers/health.ts reports MISSING_KEY rather than pretending a provider is reachable.
 *
 * The opinion produced here is advisory only — it is never turned into a patch and never affects
 * which proposal native-builder's planRepair() selects. It exists to prove the capability is
 * wired through real production code, matching the same advisory-only discipline
 * lib/native-builder/repairPlanner.ts already enforces for Council-family opinions.
 */
async function requestSingleAgentOpinion(
  request: EngineeringMissionRequest,
): Promise<RuntimeMissionProviderOpinion | null> {
  const cfg = request.singleAgentProvider
  if (!cfg?.enabled) return null
  const family: DirectProviderFamily = cfg.family ?? 'claude'
  const prompt = `Engineering mission request.\nTitle: ${request.title}\nSubsystem: ${request.subsystem}\nDescription: ${request.description}\nGive a 1-2 sentence assessment of what likely needs to change. Do not propose exact code.`
  const result = await invokeDirectCouncilProvider(family, prompt, { timeoutMs: 15_000 })
  return { family, ok: result.ok, text: result.ok ? result.text : '', error: result.ok ? undefined : result.error }
}

/** Strips the durability-only `recordedAt` stamp back down to the projection shape. */
function toRuntimeOpinions(repair: NativeRepairRecord): RuntimeMissionProviderOpinion[] {
  return (repair.advisoryProviderOpinions ?? []).map(({ family, ok, text, error }) => ({ family, ok, text, error }))
}

function project(issue: NativeIssueRecord, repair: NativeRepairRecord): RuntimeMission {
  const providerOpinions = toRuntimeOpinions(repair)
  return {
    id: repair.id,
    kind: 'engineering',
    status: missionStatusFromRepairState(repair.state),
    title: issue.title,
    description: issue.rawEvidenceText,
    policy: ENGINEERING_MISSION_POLICY,
    capabilities: ENGINEERING_MISSION_CAPABILITIES,
    createdAt: repair.createdAt,
    updatedAt: repair.updatedAt,
    nativeBuilder: { issueId: issue.id, repairId: repair.id },
    proposalSummary: repair.selectedProposal
      ? {
          hasProposal: true,
          sourceKind: repair.selectedProposal.sourceKind,
          diagnosis: repair.selectedProposal.diagnosis,
          relevantFiles: repair.selectedProposal.relevantFiles,
        }
      : { hasProposal: false },
    providerOpinions,
    councilAssistSessions: repair.councilAssistSessions ?? [],
    validationResults: repair.validationResults,
    verification: repair.verification,
    diff: repair.diffEvidence,
    auditable: true,
    raw: { issue, repair },
  }
}

/**
 * Persists advisory provider opinions onto the authoritative NativeRepairRecord itself (Engineering
 * Core Foundation Hardening §2), replacing the prior in-process `providerOpinionsByRepairId` Map.
 * Reuses native-builder's own saveRepair() — the same persistence mechanism runtime.ts already
 * uses for every other field — so this is not a second persistence system, and a process restart
 * no longer loses the advisory text: the next get() reads it straight back off
 * repair.advisoryProviderOpinions via requireRepair()/getRepair(), just like every other field.
 */
async function persistAdvisoryOpinions(
  repair: NativeRepairRecord,
  opinions: RuntimeMissionProviderOpinion[],
): Promise<NativeRepairRecord> {
  if (!opinions.length) return repair
  const recordedAt = new Date().toISOString()
  const updated: NativeRepairRecord = {
    ...repair,
    advisoryProviderOpinions: opinions.map(o => ({ ...o, recordedAt })),
  }
  await saveRepair(updated)
  return updated
}

export const SingleAgentEngineeringStrategy: MissionExecutionStrategy<EngineeringMissionRequest> = {
  kind: 'engineering',
  policy: ENGINEERING_MISSION_POLICY,
  capabilities: ENGINEERING_MISSION_CAPABILITIES,

  async create(request) {
    const opinion = await requestSingleAgentOpinion(request)
    const input = issueFromCommanderReport({
      title: request.title,
      description: request.description,
      subsystem: request.subsystem,
      severity: request.severity,
    })
    const { issue, repair } = await reportIssue(input)
    if (!repair) {
      throw new Error(
        `native-builder merged this into an existing open issue (fingerprint ${issue.fingerprint}) without opening a new repair — call get() with the existing repair id instead of create() again for the same issue.`,
      )
    }
    const hostedCoder = request.coderProvider?.enabled
      ? { family: request.coderProvider.family ?? 'claude', invoke: invokeDirectCouncilProvider }
      : undefined
    const planned = await planRepair(repair.id, {
      targetFiles: request.targetFiles,
      hostedCoder,
      commanderRequestText: `${request.title}: ${request.description}`,
    })
    const withOpinions = opinion ? await persistAdvisoryOpinions(planned, [opinion]) : planned
    return project(issue, withOpinions)
  },

  async get(missionId) {
    const repair = await getRepair(missionId)
    if (!repair) return null
    const issue = await getIssue(repair.issueId)
    if (!issue) return null
    return project(issue, repair)
  },

  async approve(missionId, approvalGranted) {
    // approveAndApply itself throws if approvalGranted !== true (defense-in-depth, same as
    // native-builder's own /approve route) — this call is not a second gate, it's the same one.
    const repair = await approveAndApply(missionId, approvalGranted)
    const issue = await getIssue(repair.issueId)
    if (!issue) throw new Error(`No issue found for repair ${missionId} after approveAndApply.`)
    return project(issue, repair)
  },

  async decide(missionId, accepted) {
    const repair = await commanderResolve(missionId, accepted)
    const issue = await getIssue(repair.issueId)
    if (!issue) throw new Error(`No issue found for repair ${missionId} after commanderResolve.`)
    return project(issue, repair)
  },

  async rollback(missionId) {
    const repair = await rollbackNow(missionId)
    const issue = await getIssue(repair.issueId)
    if (!issue) throw new Error(`No issue found for repair ${missionId} after rollbackNow.`)
    return project(issue, repair)
  },

  /**
   * Phase E: advisory-only Council Assist. Runs the requested composition against the mission's
   * title/description, persists the resulting session onto the authoritative repair record via
   * the same saveRepair() durability mechanism advisoryProviderOpinions already uses (Foundation
   * Hardening §2), and returns the re-projected mission. Never calls planRepair()/approveAndApply
   * — advisory text only, exactly like requestSingleAgentOpinion above.
   */
  async councilAssist(missionId: string, composition: NativeCouncilAssistComposition) {
    const repair = await getRepair(missionId)
    if (!repair) throw new Error(`No repair found for mission ${missionId}.`)
    const issue = await getIssue(repair.issueId)
    if (!issue) throw new Error(`No issue found for repair ${missionId}.`)
    const session = await requestCouncilAssist({ title: issue.title, description: issue.rawEvidenceText }, composition)
    const updated: NativeRepairRecord = {
      ...repair,
      councilAssistSessions: [...(repair.councilAssistSessions ?? []), session],
    }
    await saveRepair(updated)
    return project(issue, updated)
  },

  /**
   * Phase D: active-missions list for the War Room Engineering Mission UI's mission switcher.
   * Pure read-side projection over the same storage.listRepairs() every other method already
   * reads through — no new list, no separate index, nothing that could drift from the
   * authoritative repair records. Bounded (most-recently-updated first, capped) rather than an
   * unbounded dump, matching this module's "no full-repo/full-history dumps" discipline elsewhere.
   */
  async list() {
    const repairs = await listRepairs()
    const sorted = [...repairs].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).slice(0, 100)
    const missions: RuntimeMission[] = []
    for (const repair of sorted) {
      const issue = await getIssue(repair.issueId)
      if (!issue) continue
      missions.push(project(issue, repair))
    }
    return missions
  },
}
