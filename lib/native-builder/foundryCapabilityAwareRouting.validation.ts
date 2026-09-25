/**
 * Deterministic capability-aware routing fixtures A–J.
 * Shadow mode only. No live model calls.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { applyFoundryRuntimeConfig } from './foundryRuntimeConfig'
import { ACCEPTED_WORKER_CAPABILITY_EVIDENCE } from './foundryWorkerRoutingEvidence'
import {
  CAPABILITY_AWARE_ROUTING_MODES,
  STORED_DEFAULT_POLICY,
  capabilityRoutingTable,
  commanderWorkerRoutingView,
  enableCapabilityAwareRouting,
  getCapabilityAwareRoutingMode,
  loadRoutingDecision,
  persistRoutingDecision,
  recommendFoundryWorker,
  reconsiderFoundryRouting,
  resumeRoutingDecision,
  type FoundryRoutingCandidate,
  type FoundryWorkerRoutingNeed,
} from './foundryWorkerRouting'

const evidence = ACCEPTED_WORKER_CAPABILITY_EVIDENCE
const local = evidence.find(item => item.historicalReliability === 'RELIABLE')!
const remote = evidence.find(item => !item.local && item.capabilityFamily === 'AMBIGUITY_RESOLUTION' && item.rootCauseStatus === 'SUPPORTED')!

function candidates(extra: FoundryRoutingCandidate[] = []): FoundryRoutingCandidate[] {
  return [
    { provider: local.provider, model: local.model, local: true, callable: true, listedOnly: false },
    { provider: remote.provider, model: remote.model, local: false, callable: true, listedOnly: false },
    ...extra,
  ]
}

function need(patch: Partial<FoundryWorkerRoutingNeed>): FoundryWorkerRoutingNeed {
  return {
    missionId: patch.missionId ?? 'route-fixture',
    taskFamily: patch.taskFamily ?? 'BUG_FIX',
    capabilityFamilies: patch.capabilityFamilies ?? ['PLAN_TO_CODE_FIDELITY'],
    difficultyClass: patch.difficultyClass ?? 'localized',
    reasoningDepth: patch.reasoningDepth ?? 'R1',
    ambiguity: patch.ambiguity ?? 'low',
    risk: patch.risk ?? 'low',
    privacyRequirement: patch.privacyRequirement ?? 'any',
    localOnlyRequirement: patch.localOnlyRequirement ?? false,
    remotePermitted: patch.remotePermitted ?? false,
    commanderPolicy: 'LOCAL',
    pin: patch.pin ?? null,
    candidates: patch.candidates ?? candidates(),
    callBudgetRemaining: patch.callBudgetRemaining ?? 4,
    callBudgetCeiling: patch.callBudgetCeiling ?? 6,
    wallTimeBudgetMs: 120000,
    missionContractHash: 'contract-hash',
    acceptanceContractHash: 'acceptance-hash',
    toolAuthority: 'tool-broker',
    deployAuthority: false,
    now: '2026-09-23T12:00:00.000Z',
  }
}

export function runCapabilityRoutingFixtures(): Array<{ name: string; pass: boolean; detail: string }> {
  const results: Array<{ name: string; pass: boolean; detail: string }> = []
  const check = (name: string, pass: boolean, detail: string) => results.push({ name, pass, detail })
  const a = recommendFoundryWorker(need({ missionId: 'A', reasoningDepth: 'R1', ambiguity: 'low', remotePermitted: false }))
  check('FIXTURE_A', a.outcome === 'SELECTED' && a.selectedProvider === local.provider && a.selectedModel === local.model && a.workerClass === 'LOCAL_ROUTINE', `${a.selectedProvider}/${a.selectedModel} ${a.workerClass}`)
  const b = recommendFoundryWorker(need({
    missionId: 'B',
    reasoningDepth: 'R3',
    ambiguity: 'high',
    remotePermitted: true,
    capabilityFamilies: ['AMBIGUITY_RESOLUTION', 'ROOT_CAUSE_DIAGNOSIS'],
    difficultyClass: 'ambiguous-root-cause',
  }))
  check('FIXTURE_B', b.outcome === 'SELECTED' && b.selectedProvider === remote.provider && b.selectedModel === remote.model && b.workerClass === 'STRONG_REASONING', `${b.outcome} ${b.selectedProvider}/${b.selectedModel}`)
  const c = recommendFoundryWorker(need({
    missionId: 'C',
    reasoningDepth: 'R4',
    ambiguity: 'high',
    remotePermitted: true,
    capabilityFamilies: ['AMBIGUITY_RESOLUTION'],
    pin: { provider: local.provider, model: local.model },
  }))
  check('FIXTURE_C', c.outcome === 'SELECTED' && c.selectedProvider === local.provider && c.fallbackCandidates.length === 0 && c.workerClass === 'PINNED', c.reason)
  const d = recommendFoundryWorker(need({
    missionId: 'D',
    remotePermitted: true,
    pin: { provider: remote.provider, model: remote.model },
    candidates: [
      { provider: local.provider, model: local.model, local: true, callable: true, listedOnly: false },
      { provider: remote.provider, model: remote.model, local: false, callable: false, listedOnly: false },
    ],
  }))
  check('FIXTURE_D', d.outcome === 'BLOCKED_PROVIDER' && d.selectedProvider === null && d.fallbackCandidates.length === 0 && !d.rejectedCandidates.some(item => item.reason !== 'PINNED_NO_SUBSTITUTION'), d.outcome)
  const e = recommendFoundryWorker(need({
    missionId: 'E',
    reasoningDepth: 'R4',
    ambiguity: 'high',
    localOnlyRequirement: true,
    remotePermitted: false,
    privacyRequirement: 'local',
    capabilityFamilies: ['AMBIGUITY_RESOLUTION', 'ROOT_CAUSE_DIAGNOSIS'],
  }))
  check('FIXTURE_E', (e.outcome === 'BLOCKED_CAPABILITY' || e.outcome === 'COMMANDER_DECISION_REQUIRED') && e.selectedProvider !== remote.provider, e.outcome)
  const fNeed = need({
    missionId: 'F',
    reasoningDepth: 'R3',
    ambiguity: 'high',
    remotePermitted: true,
    capabilityFamilies: ['AMBIGUITY_RESOLUTION'],
    callBudgetCeiling: 6,
    callBudgetRemaining: 3,
  })
  const f = reconsiderFoundryRouting({ need: fNeed, previousProvider: local.provider, previousModel: local.model, failureType: 'MODEL_CAPABILITY', succeeded: false })
  check('FIXTURE_F', f.reconsideration.decision === 'ESCALATE' && f.decision.selectedProvider === remote.provider && f.decision.callBudgetCeiling === 6 && f.decision.missionContractHash === 'contract-hash' && f.decision.acceptanceContractHash === 'acceptance-hash' && f.decision.deployAuthority === false, `${f.reconsideration.decision} ceiling=${f.decision.callBudgetCeiling}`)
  const g = reconsiderFoundryRouting({ need: need({ missionId: 'G', reasoningDepth: 'R1' }), previousProvider: local.provider, previousModel: local.model, failureType: null, succeeded: true })
  check('FIXTURE_G', g.reconsideration.decision === 'STAY' && g.decision.selectedProvider === local.provider && g.decision.selectedModel === local.model, g.reconsideration.decision)
  const h = recommendFoundryWorker(need({
    missionId: 'H',
    reasoningDepth: 'R3',
    ambiguity: 'high',
    remotePermitted: true,
    capabilityFamilies: ['PERFORMANCE_REASONING'],
  }))
  check('FIXTURE_H', h.reason.includes('PARTIAL') && h.outcome === 'COMMANDER_DECISION_REQUIRED' && h.workerClass !== 'STRONG_REASONING', h.reason)
  const unproven = { provider: 'openai', model: 'listed-unproven', local: false, callable: true, listedOnly: true }
  const i = recommendFoundryWorker(need({ missionId: 'I', reasoningDepth: 'R1', candidates: [...candidates(), unproven] }))
  check('FIXTURE_I', i.selectedProvider === local.provider && i.rejectedCandidates.some(item => item.model === unproven.model && item.reason === 'UNPROVEN_LISTING'), i.rejectedCandidates.map(item => item.reason).join(','))
  const root = mkdtempSync(path.join(tmpdir(), 'foundry-route-'))
  try {
    const jNeed = need({ missionId: 'J', reasoningDepth: 'R1' })
    const stored = recommendFoundryWorker(jNeed)
    persistRoutingDecision(stored, root)
    const proposed = recommendFoundryWorker(need({
      missionId: 'J',
      reasoningDepth: 'R3',
      ambiguity: 'high',
      remotePermitted: true,
      capabilityFamilies: ['AMBIGUITY_RESOLUTION'],
    }))
    const resumed = resumeRoutingDecision('J', root, proposed)
    const loaded = loadRoutingDecision('J', root)
    check('FIXTURE_J', Boolean(resumed && loaded && resumed.selectedProvider === stored.selectedProvider && resumed.selectedModel === stored.selectedModel && resumed.reason === stored.reason && resumed.selectedProvider !== proposed.selectedProvider), `${resumed?.selectedProvider}/${resumed?.selectedModel}`)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
  const table = capabilityRoutingTable()
  check('TABLE_NO_PERCENT', table.every(row => !row.engineeringPassRate.includes('%') && row.engineeringPassRate.startsWith('n=')), table[0]?.engineeringPassRate ?? '')
  check('TABLE_PRODUCTION_NONE', table.every(row => row.productionEvidence === 'none' && row.evidenceLevel !== 'PRODUCTION_PROVEN'), 'none')
  check('ROUTING_MODE_SHADOW_PRESERVED', CAPABILITY_AWARE_ROUTING_MODES.includes('SHADOW') && CAPABILITY_AWARE_ROUTING_MODES.includes('ENABLED'), CAPABILITY_AWARE_ROUTING_MODES.join(','))
  check('STORED_POLICY', applyFoundryRuntimeConfig().providerPolicy === 'LOCAL' && STORED_DEFAULT_POLICY === 'LOCAL', applyFoundryRuntimeConfig().providerPolicy)
  const selection = readFileSync(path.join(resolveRepoRoot(), 'lib/native-builder/foundryWorkerRouting.ts'), 'utf8')
  const branches = selection.match(/===\s*['"](?:qwen|composer|cursor-agent|ollama)|includes\(\s*['"](?:qwen|composer|cursor)/g) ?? []
  check('PROVIDER_SPECIFIC_ROUTING_BRANCH_COUNT', branches.length === 0, String(branches.length))
  const router = readFileSync(path.join(resolveRepoRoot(), 'lib/native-builder/foundryModelRouter.ts'), 'utf8')
  check('ROUTER_UNCHANGED_POLICY', router.includes("policy === 'LOCAL'") && !router.includes('recommendFoundryWorker'), 'LOCAL filter remains')
  const view = commanderWorkerRoutingView()
  check('COMMANDER_UI', view.policy === 'LOCAL' && view.fallbackAllowed === false && (view.mode === 'SHADOW' || view.mode === 'ENABLED'), view.why)
  check('SHADOW_NOT_APPLIED', [a, b, c, e, h, i].every(item => item.appliedToLiveRoute === false), 'false')
  const enableRoot = mkdtempSync(path.join(tmpdir(), 'foundry-route-enable-'))
  const prevContracts = process.env.FOUNDRY_CONTRACTS_ROOT
  process.env.FOUNDRY_CONTRACTS_ROOT = enableRoot
  try {
    const enabled = enableCapabilityAwareRouting({ mission: 'fixture-enable' })
    check('ENABLEMENT_TRANSITION', enabled.ok && enabled.mode === 'ENABLED' && enabled.policy === 'LOCAL' && getCapabilityAwareRoutingMode() === 'ENABLED', `${enabled.previousMode}->${enabled.mode}`)
  } finally {
    if (prevContracts === undefined) delete process.env.FOUNDRY_CONTRACTS_ROOT
    else process.env.FOUNDRY_CONTRACTS_ROOT = prevContracts
    rmSync(enableRoot, { recursive: true, force: true })
  }
  check('GAPS', evidence.some(item => item.caseId === 'REASON-M2-PARTS' && item.rootCauseStatus === 'PARTIAL' && !item.local)
    && evidence.some(item => item.caseId === 'REASON-M2-EVENTS' && item.rootCauseStatus === 'PARTIAL' && !item.local)
    && evidence.some(item => item.caseId === 'REASON-M2-TAG' && item.rootCauseStatus === 'UNSUPPORTED' && !item.local), 'preserved')
  return results
}

function main(): void {
  const results = runCapabilityRoutingFixtures()
  for (const item of results) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} ${item.detail}`)
  if (results.some(item => !item.pass)) process.exit(1)
}

if (process.argv[1]?.includes('foundryCapabilityAwareRouting.validation')) main()
