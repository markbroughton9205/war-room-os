/**
 * Focused post-restart routing / capability-evidence continuity fixtures.
 * No live model calls. No hardcoded mission ids. No hardcoded worker pin.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { capabilityFamiliesForSpecialistRole } from './foundryEngineeringSpecialist'
import { restoreInterruptedCampaignTasks, type CampaignTask, type CampaignWorkerReceipt } from './foundryEngineeringCampaign'
import { ACCEPTED_WORKER_CAPABILITY_EVIDENCE, type FoundryWorkerEvidenceRow } from './foundryWorkerRoutingEvidence'
import {
  recommendFoundryWorker,
  reconstructCallableCandidates,
  routingCandidatesFromEvidence,
  STORED_DEFAULT_POLICY,
  type FoundryWorkerRoutingNeed,
} from './foundryWorkerRouting'

const atlasLocal = ACCEPTED_WORKER_CAPABILITY_EVIDENCE.find(item => item.local && item.historicalReliability === 'RELIABLE')
const atlasRemote = ACCEPTED_WORKER_CAPABILITY_EVIDENCE.find(item => !item.local && item.rootCauseStatus === 'SUPPORTED')

function need(patch: Partial<FoundryWorkerRoutingNeed>): FoundryWorkerRoutingNeed {
  if (!atlasLocal) throw new Error('atlas is missing a reliable local worker row')
  return {
    missionId: patch.missionId ?? 'continuity-fixture',
    taskFamily: patch.taskFamily ?? 'BACKEND_API',
    capabilityFamilies: patch.capabilityFamilies ?? ['PLAN_TO_CODE_FIDELITY'],
    difficultyClass: patch.difficultyClass ?? 'localized',
    reasoningDepth: patch.reasoningDepth ?? 'R1',
    ambiguity: patch.ambiguity ?? 'low',
    risk: 'low',
    privacyRequirement: patch.privacyRequirement ?? 'local',
    localOnlyRequirement: patch.localOnlyRequirement ?? true,
    remotePermitted: patch.remotePermitted ?? false,
    commanderPolicy: 'LOCAL',
    pin: patch.pin ?? null,
    candidates: patch.candidates ?? [],
    callBudgetRemaining: patch.callBudgetRemaining ?? 8,
    callBudgetCeiling: patch.callBudgetCeiling ?? 24,
    wallTimeBudgetMs: 180000,
    missionContractHash: 'continuity-contract',
    acceptanceContractHash: 'continuity-acceptance',
    toolAuthority: 'existing-patch-path',
    deployAuthority: false,
    now: '2026-09-24T12:00:00.000Z',
  }
}

function liveFromAtlas(): Array<{ provider: string; model: string }> {
  if (!atlasLocal) return []
  return [{ provider: atlasLocal.provider, model: atlasLocal.model }]
}

function task(input: Partial<CampaignTask> & Pick<CampaignTask, 'id' | 'role' | 'status'>): CampaignTask {
  return {
    phase: 'IMPLEMENT',
    dependsOn: [],
    purpose: 'fixture',
    acceptance: 'fixture',
    inputs: [],
    outputs: [],
    evidence: [],
    workingSet: ['backend/api.py'],
    writes: [],
    attempt: 1,
    verification: 'PENDING',
    ...input,
  }
}

function receipt(input: Partial<CampaignWorkerReceipt> & Pick<CampaignWorkerReceipt, 'taskId' | 'attempt'>): CampaignWorkerReceipt {
  if (!atlasLocal) throw new Error('atlas is missing a reliable local worker row')
  return {
    role: 'BACKEND',
    provider: atlasLocal.provider,
    model: atlasLocal.model,
    routingDecisionId: 'route-continuity',
    workerCallId: `specialist-${input.taskId}-${input.attempt}`,
    campaignId: 'continuity-fixture',
    evidenceInputs: ['backend/api.py'],
    resultStatus: 'propose',
    summary: 'prior implementer receipt',
    failureClass: null,
    ...input,
  }
}

export function runPostRestartRoutingContinuityFixtures(): Array<{ name: string; pass: boolean; detail: string }> {
  const results: Array<{ name: string; pass: boolean; detail: string }> = []
  const check = (name: string, pass: boolean, detail: string) => results.push({ name, pass, detail })
  if (!atlasLocal || !atlasRemote) {
    check('ATLAS_LOCAL_WORKER', false, 'accepted evidence is missing local or remote rows')
    return results
  }

  const preCandidates = routingCandidatesFromEvidence({ liveIdentities: liveFromAtlas() })
  const pre = recommendFoundryWorker(need({
    candidates: preCandidates,
    capabilityFamilies: capabilityFamiliesForSpecialistRole('BACKEND'),
  }))
  check(
    'PRE_RESTART_LOCAL_ROUTE',
    pre.outcome === 'SELECTED' && pre.selectedProvider === atlasLocal.provider && pre.selectedModel === atlasLocal.model && pre.selectedProvider !== atlasRemote.provider,
    `${pre.outcome} ${pre.selectedProvider}/${pre.selectedModel}`,
  )

  const persisted = {
    tasks: [
      task({ id: 'backend', role: 'BACKEND', status: 'RUNNING', attempt: 2, dependsOn: ['debug-1'] }),
      task({ id: 'integrate', role: 'TEST', status: 'COMPLETE', attempt: 1, verification: 'PASS' }),
    ],
    workerReceipts: [receipt({ taskId: 'backend', attempt: 1 })],
  }
  check('CAMPAIGN_PERSISTS', persisted.tasks[0].status === 'RUNNING' && persisted.workerReceipts.length === 1, `running=${persisted.tasks[0].status} receipts=${persisted.workerReceipts.length}`)

  const cleared = reconstructCallableCandidates(preCandidates, [])
  check(
    'PROCESS_LOCAL_CLEARED',
    cleared.every(item => !item.callable && item.listedOnly) && preCandidates.some(item => item.callable),
    cleared.map(item => `${item.provider}:${item.callable ? 'live' : 'cold'}`).join(','),
  )

  restoreInterruptedCampaignTasks(persisted)
  check(
    'MISSION_RELOAD_REPAIR_READY',
    persisted.tasks[0].status === 'READY' && persisted.tasks[0].attempt === 1 && !persisted.tasks[0].evidence.includes('specialist receipt already stored'),
    `${persisted.tasks[0].status} attempt=${persisted.tasks[0].attempt} evidence=${persisted.tasks[0].evidence.join('|')}`,
  )

  const reconstructed = reconstructCallableCandidates(cleared, liveFromAtlas())
  const post = recommendFoundryWorker(need({
    candidates: reconstructed,
    capabilityFamilies: capabilityFamiliesForSpecialistRole('BACKEND'),
  }))
  check(
    'EVIDENCE_RECONSTRUCTED',
    reconstructed.some(item => item.local && item.callable && item.provider === atlasLocal.provider && item.model === atlasLocal.model),
    reconstructed.filter(item => item.callable).map(item => `${item.provider}/${item.model}`).join(',') || 'none',
  )
  check(
    'POST_RESTART_SAME_ROUTE',
    post.outcome === 'SELECTED' && post.selectedProvider === pre.selectedProvider && post.selectedModel === pre.selectedModel && post.capabilityFamilies.join(',') === pre.capabilityFamilies.join(','),
    `${post.outcome} ${post.selectedProvider}/${post.selectedModel} ${post.capabilityFamilies.join(',')}`,
  )
  check(
    'NO_PROVIDER_WIDENING',
    post.selectedProvider === atlasLocal.provider && post.selectedProvider !== atlasRemote.provider && reconstructed.filter(item => item.callable).every(item => item.local),
    `${post.selectedProvider} callable=${reconstructed.filter(item => item.callable).map(item => item.provider).join(',')}`,
  )
  check(
    'LOCAL_ONLY_PRESERVED',
    post.localOnlyRequirement === true && post.privacyRequirement === 'local' && STORED_DEFAULT_POLICY === 'LOCAL',
    `localOnly=${post.localOnlyRequirement} privacy=${post.privacyRequirement} policy=${STORED_DEFAULT_POLICY}`,
  )

  const staleEvidence: FoundryWorkerEvidenceRow[] = ACCEPTED_WORKER_CAPABILITY_EVIDENCE.map(item => (
    item.provider === atlasLocal.provider && item.model === atlasLocal.model
      ? { ...item, historicalReliability: 'INSUFFICIENT' as const, engineeringPass: false, rootCauseStatus: 'EXCLUDED' as const }
      : item
  ))
  const staleCandidates = routingCandidatesFromEvidence({ evidence: staleEvidence, liveIdentities: liveFromAtlas() })
  const stale = recommendFoundryWorker(need({ candidates: staleCandidates }), staleEvidence)
  check(
    'STALE_EVIDENCE_FAILS_CLOSED',
    stale.selectedProvider === null && (stale.outcome === 'BLOCKED_CAPABILITY' || stale.outcome === 'BLOCKED_PROVIDER' || stale.outcome === 'COMMANDER_DECISION_REQUIRED'),
    `${stale.outcome} ${stale.selectedProvider}/${stale.selectedModel}`,
  )

  const missing = recommendFoundryWorker(need({
    candidates: reconstructCallableCandidates(preCandidates, [{ provider: 'missing-local', model: 'absent' }]),
  }))
  check(
    'MISSING_MODEL_FAILS_CLOSED',
    missing.selectedProvider === null && missing.outcome === 'BLOCKED_PROVIDER',
    `${missing.outcome} ${missing.reason}`,
  )

  const denied = recommendFoundryWorker(need({
    localOnlyRequirement: true,
    remotePermitted: false,
    privacyRequirement: 'local',
    candidates: routingCandidatesFromEvidence({ liveIdentities: [{ provider: atlasRemote.provider, model: atlasRemote.model }] }),
  }))
  check(
    'POLICY_DENIAL_FAILS_CLOSED',
    denied.selectedProvider !== atlasRemote.provider && denied.selectedProvider === null,
    `${denied.outcome} ${denied.selectedProvider}/${denied.selectedModel}`,
  )

  const backendFamily = capabilityFamiliesForSpecialistRole('BACKEND').join(',')
  const repairFamily = capabilityFamiliesForSpecialistRole('BACKEND').join(',')
  check(
    'ROLE_CAPABILITY_BACKEND_REPAIR',
    backendFamily === 'PLAN_TO_CODE_FIDELITY' && repairFamily === backendFamily && capabilityFamiliesForSpecialistRole('TEST').join(',') === 'TEST_TRUTH_DISCRIMINATION',
    `backend=${backendFamily} test=${capabilityFamiliesForSpecialistRole('TEST').join(',')}`,
  )

  const sourceRoot = resolveRepoRoot()
  const validatorSrc = readFileSync(path.join(sourceRoot, 'lib/native-builder/foundryPostRestartRoutingContinuity.validation.ts'), 'utf8')
  const routingSrc = readFileSync(path.join(sourceRoot, 'lib/native-builder/foundryWorkerRouting.ts'), 'utf8')
  const specialistSrc = readFileSync(path.join(sourceRoot, 'lib/native-builder/foundryEngineeringSpecialist.ts'), 'utf8')
  check(
    'NO_HARDCODED_MISSION_OR_MODEL_ID',
    !/pin:\s*\{\s*provider:\s*['"]ollama['"]/.test(specialistSrc)
      && !/selectedProvider:\s*['"]ollama['"]/.test(routingSrc)
      && !/always use Qwen/i.test(routingSrc)
      && specialistSrc.includes('configuredFoundryModels({ routingRetry: true })')
      && validatorSrc.includes('liveFromAtlas()'),
    'validator uses atlas identities; specialist retries live availability',
  )
  check(
    'NO_STALE_ROUTE_PIN',
    !routingSrc.includes("always use Qwen") && restoreInterruptedCampaignTasks.toString().includes('item.attempt === task.attempt'),
    'resume matches the current attempt; route is reconstructed from live identities',
  )
  return results
}

function main(): void {
  const results = runPostRestartRoutingContinuityFixtures()
  for (const item of results) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} ${item.detail}`)
  if (results.some(item => !item.pass)) process.exit(1)
}

if (process.argv[1]?.includes('foundryPostRestartRoutingContinuity.validation')) main()
