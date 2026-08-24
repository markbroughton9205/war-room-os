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
import { getIssue, getRepair } from '@/lib/native-builder/storage'
import { issueFromCommanderReport } from '@/lib/native-builder/issueIngest'
import type { NativeIssueRecord, NativeRepairRecord } from '@/lib/native-builder/types'
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

function project(
  issue: NativeIssueRecord,
  repair: NativeRepairRecord,
  providerOpinions: RuntimeMissionProviderOpinion[],
): RuntimeMission {
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
    validationResults: repair.validationResults,
    verification: repair.verification,
    diff: repair.diffEvidence,
    auditable: true,
    raw: { issue, repair },
  }
}

/** Provider opinions are not part of NativeRepairRecord (native-builder's own record has no field
 * for them — Council-family opinions there are folded into advisory proposals instead). This
 * module keeps them in a small in-process map keyed by repairId so a mission's projection can
 * include them across create()/get() calls without adding a persisted field to native-builder's
 * own record shape. This is deliberately NOT a mission state store: losing this map on process
 * restart loses only the advisory text, never the mission's actual status, proposal, validation,
 * or diff evidence, all of which remain fully owned by native-builder's file-based storage. */
const providerOpinionsByRepairId = new Map<string, RuntimeMissionProviderOpinion[]>()

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
    const planned = await planRepair(repair.id, { targetFiles: request.targetFiles })
    const opinions = opinion ? [opinion] : []
    if (opinions.length) providerOpinionsByRepairId.set(repair.id, opinions)
    return project(issue, planned, opinions)
  },

  async get(missionId) {
    const repair = await getRepair(missionId)
    if (!repair) return null
    const issue = await getIssue(repair.issueId)
    if (!issue) return null
    return project(issue, repair, providerOpinionsByRepairId.get(repair.id) ?? [])
  },

  async approve(missionId, approvalGranted) {
    // approveAndApply itself throws if approvalGranted !== true (defense-in-depth, same as
    // native-builder's own /approve route) — this call is not a second gate, it's the same one.
    const repair = await approveAndApply(missionId, approvalGranted)
    const issue = await getIssue(repair.issueId)
    if (!issue) throw new Error(`No issue found for repair ${missionId} after approveAndApply.`)
    return project(issue, repair, providerOpinionsByRepairId.get(repair.id) ?? [])
  },

  async decide(missionId, accepted) {
    const repair = await commanderResolve(missionId, accepted)
    const issue = await getIssue(repair.issueId)
    if (!issue) throw new Error(`No issue found for repair ${missionId} after commanderResolve.`)
    return project(issue, repair, providerOpinionsByRepairId.get(repair.id) ?? [])
  },

  async rollback(missionId) {
    const repair = await rollbackNow(missionId)
    const issue = await getIssue(repair.issueId)
    if (!issue) throw new Error(`No issue found for repair ${missionId} after rollbackNow.`)
    return project(issue, repair, providerOpinionsByRepairId.get(repair.id) ?? [])
  },
}
