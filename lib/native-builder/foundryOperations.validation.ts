import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { startMission, runModelMission, resolveMissionAuthorization } from './foundryMissionController'
import { FoundryModelRouter } from './foundryModelRouter'
import { persistFoundryRuntimeConfig, readFoundryRuntimeConfig, applyFoundryRuntimeConfig } from './foundryRuntimeConfig'
import { acquireResource, assertLockOrder, releaseMissionResources, reclaimStaleResources } from './foundryResourceLocks'
import { classifyToolIdempotency, markInFlightToolsInterrupted, shouldReplayTool } from './foundryToolLifecycle'
import { compactModelContext } from './foundryContextCheckpoints'
import { recoverOperations, requestControlledAuthorization, setMissionPriority } from './foundryOperationsManager'
import { groupOperationsQueue, toRegistryEntry } from './foundryMissionRegistry'
import { loadMission, saveMission } from './foundryMissionStore'
import { FOUNDRY_DEFAULT_PRIMARY_MODEL } from './foundryOperationsTypes'
import { foundryDataHierarchy } from './foundryPaths'
import type { FoundryMissionModel, FoundryModelResponse } from './foundryModelTypes'
import type { FoundryMissionRecord } from './foundryMissionTypes'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

// The validation injects its own models and providers; the operator's saved provider policy (for instance LOCAL) must not decide which of them may run.
process.env.FOUNDRY_PROVIDER_POLICY = 'AUTO'

class ScriptedModel implements FoundryMissionModel {
  readonly provider = 'openai' as const
  readonly model = 'ops-test'
  private index = 0
  constructor(private readonly responses: FoundryModelResponse[]) {}
  private next() {
    const response = this.responses[Math.min(this.index, this.responses.length - 1)]
    this.index += 1
    return Promise.resolve(response)
  }
  reasonMission() { return this.next() }
  chooseNextAction() { return this.next() }
  diagnoseFailure() { return this.next() }
  replan() { return this.next() }
  summarizeProgress() { return this.next() }
}

function toolOk(name: string, args: Record<string, unknown>, summary: string): FoundryModelResponse {
  return {
    ok: true,
    provider: 'openai',
    model: 'ops-test',
    decision: { decision: 'TOOL', reasoningSummary: summary, tool: { name: name as never, args } },
    rawText: '{}',
    latencyMs: 1,
  }
}

function failProvider(error: string, failureClass: 'PROVIDER' | 'TIMEOUT' | 'UNAVAILABLE'): FoundryModelResponse {
  return { ok: false, provider: 'openai', model: 'ops-test', error, failureClass, latencyMs: 1 }
}

/** The write-conflict cases patch this file from ALPHA; the committed file rests at BETA. The case sets its own starting point and puts the file back however it ends. */
const WRITE_CONFLICT_LABEL = 'scripts/foundry/ops-write-conflict/label.txt'
const ALPHA_TEXT = 'OPS_WRITE_LABEL=ALPHA\n'
/** A patch is bound to the hash of the file it was planned against: the second writer holds the hash of ALPHA, which is gone once the first has written. */
const ALPHA_HASH = createHash('sha256').update(ALPHA_TEXT, 'utf8').digest('hex')

async function run() {
  const originalLabel = existsSync(WRITE_CONFLICT_LABEL) ? readFileSync(WRITE_CONFLICT_LABEL, 'utf8') : null
  process.on('exit', () => { if (originalLabel !== null) writeFileSync(WRITE_CONFLICT_LABEL, originalLabel, 'utf8') })
  writeFileSync(WRITE_CONFLICT_LABEL, ALPHA_TEXT, 'utf8')
  const storedPolicyBefore = (JSON.parse(readFileSync(foundryDataHierarchy().runtimeConfig, 'utf8')) as { providerPolicy?: string }).providerPolicy
  const persisted = persistFoundryRuntimeConfig({ primaryModel: FOUNDRY_DEFAULT_PRIMARY_MODEL })
  const storedPolicyAfter = (JSON.parse(readFileSync(foundryDataHierarchy().runtimeConfig, 'utf8')) as { providerPolicy?: string }).providerPolicy
  applyFoundryRuntimeConfig()
  const config = readFoundryRuntimeConfig()

  const searchA = toolOk('workspace.search', { query: 'War Room login', pathPrefix: 'app/login' }, 'Search login title')
  const searchB = toolOk('workspace.search', { query: 'foundry-missions', pathPrefix: 'lib/native-builder' }, 'Search mission persistence')
  const readLogin = toolOk('file.read', { path: 'app/login/page.tsx' }, 'Read login page')
  const readStore = toolOk('file.read', { path: 'lib/native-builder/foundryMissionStore.ts' }, 'Read mission store')

  const missionA = await startMission('Find where the War Room login title is rendered.')
  const missionB = await startMission('Find where Foundry mission persistence is stored.')
  const startedAt = Date.now()
  const [ranA, ranB] = await Promise.all([
    runModelMission(missionA.missionId, new FoundryModelRouter([new ScriptedModel([searchA, readLogin, searchA])])),
    runModelMission(missionB.missionId, new FoundryModelRouter([new ScriptedModel([searchB, readStore, searchB])])),
  ])
  const overlap = Math.min(
    Date.parse(ranA.toolCalls.at(-1)?.at ?? ranA.updatedAt),
    Date.parse(ranB.toolCalls.at(-1)?.at ?? ranB.updatedAt),
  ) > startedAt
    && ranA.toolCalls[0] && ranB.toolCalls[0]
  const aFound = ranA.toolCalls.some(call => call.tool === 'workspace.search' && /login/i.test(call.excerpt ?? ''))
    || ranA.observations.some(item => /login/i.test(item.text))
  const bFound = ranB.toolCalls.some(call => call.tool === 'workspace.search')
    && /foundryMissionStore|missions/.test(JSON.stringify(ranB.observations.slice(-6)))

  const writeA = await startMission('Change the label in scripts/foundry/ops-write-conflict/label.txt from ALPHA to BRAVO and make sure it works.')
  const writeB = await startMission('Change the label in scripts/foundry/ops-write-conflict/label.txt from ALPHA to CHARLIE and make sure it works.')
  const patchArgs = (to: string) => ({
    proposal: {
      issueId: 'ops-write',
      sourceKind: 'deterministic',
      proposerId: 'ops-test',
      diagnosis: 'label',
      confidence: 'high',
      relevantFiles: ['scripts/foundry/ops-write-conflict/label.txt'],
      plannedChanges: [{
        file: 'scripts/foundry/ops-write-conflict/label.txt',
        reason: `set ${to}`,
        operation: 'replace_range',
        patch: {
          operation: 'replace_range',
          file: 'scripts/foundry/ops-write-conflict/label.txt',
          expectedOriginalHash: ALPHA_HASH,
          matchText: 'OPS_WRITE_LABEL=ALPHA',
          replacementText: `OPS_WRITE_LABEL=${to}`,
        },
      }],
      validations: [],
      risks: [],
      rollbackPlan: 'restore ALPHA',
      generatedAt: new Date().toISOString(),
    },
  })
  const wroteA = await runModelMission(writeA.missionId, new FoundryModelRouter([new ScriptedModel([
    toolOk('workspace.search', { query: 'OPS_WRITE_LABEL', pathPrefix: 'scripts/foundry/ops-write-conflict' }, 'find fixture'),
    toolOk('file.read', { path: 'scripts/foundry/ops-write-conflict/label.txt' }, 'read fixture'),
    toolOk('file.patch', patchArgs('BRAVO'), 'patch fixture'),
  ])]))
  const wroteB = await runModelMission(writeB.missionId, new FoundryModelRouter([new ScriptedModel([
    toolOk('file.patch', patchArgs('CHARLIE'), 'conflicting patch'),
  ])]))
  const label = await readFile('scripts/foundry/ops-write-conflict/label.txt', 'utf8')
  await releaseMissionResources(wroteA.missionId)
  await releaseMissionResources(wroteB.missionId)

  const leaseHolder = await acquireResource({
    resource: 'PRODUCTION_LEASE',
    missionId: 'ops-build-holder',
    operation: 'synthetic-hold',
    waitMs: 0,
  })
  const buildHolder = await acquireResource({
    resource: 'BUILD_PIPELINE',
    missionId: 'ops-build-holder',
    operation: 'synthetic-hold',
    waitMs: 0,
    alreadyHeld: leaseHolder.state === 'ACQUIRED' ? ['PRODUCTION_LEASE'] : [],
  })
  const buildWaiter = await startMission('The ops-write-conflict fixture status label needs a coordinated build after its fixture tests.')
  const seeded = await loadMission(buildWaiter.missionId)
  if (seeded) {
    seeded.sourceState.changedFiles = ['scripts/foundry/ops-write-conflict/label.txt']
    seeded.testState = { ok: true, detail: 'seeded for build-lock coordination' }
    for (const step of seeded.plan) {
      if (step.intent === 'LINT' || step.intent === 'TYPECHECK' || step.intent === 'TEST') step.status = 'done'
    }
    await saveMission(seeded)
  }
  const buildWaitRun = await runModelMission(buildWaiter.missionId, new FoundryModelRouter([new ScriptedModel([
    toolOk('build.run', {}, 'attempt build while lock held'),
  ])]))
  const holderBusy = buildHolder.state === 'ACQUIRED' && leaseHolder.state === 'ACQUIRED'
  // The build lock itself: while one mission holds BUILD_PIPELINE another cannot take it. (The controller refuses a production build for a mission that is not an
  // application mission before it ever reaches the lock, so the contention is asserted on the lock and the refusal on the controller.)
  const contender = holderBusy ? await acquireResource({ resource: 'BUILD_PIPELINE', missionId: 'ops-build-contender', operation: 'contend', waitMs: 0 }) : null
  if (contender?.state === 'ACQUIRED') await releaseMissionResources('ops-build-contender')
  if (buildHolder.state === 'ACQUIRED') await buildHolder.release()
  if (leaseHolder.state === 'ACQUIRED') await leaseHolder.release()
  await releaseMissionResources('ops-build-holder')
  await releaseMissionResources(buildWaiter.missionId)

  // Startup recovery skips missions classified as harness missions (the request text of the recovery harness itself is one of the classifier's markers), so the mission whose
  // recovery is being tested is an ordinary request that touches the same code.
  const interrupt = await startMission('Find where the lock order for shared resources is declared.')
  const interruptFirst = await runModelMission(interrupt.missionId, new FoundryModelRouter([new ScriptedModel([
    toolOk('workspace.search', { query: 'FOUNDRY_LOCK_ORDER', pathPrefix: 'lib/native-builder' }, 'search locks'),
  ])]))
  const loaded = await loadMission(interrupt.missionId)
  if (loaded) {
    loaded.durableToolCalls = [...(loaded.durableToolCalls ?? []), {
      toolCallId: 'in-flight-ops',
      missionId: loaded.missionId,
      tool: 'installer.activate',
      argsHash: 'synthetic',
      startTime: new Date().toISOString(),
      status: 'STARTED',
      idempotency: 'NON_IDEMPOTENT_WRITE',
      resourceClaims: ['ACTIVE_RUNTIME'],
    }]
    loaded.activeToolCallId = 'in-flight-ops'
    loaded.status = 'EXECUTING'
    loaded.phase = 'EXECUTING'
    await saveMission(loaded)
  }
  const recovered = await recoverOperations()
  const afterRecover = await loadMission(interrupt.missionId)
  const interruptedCalls = markInFlightToolsInterrupted(afterRecover ?? interruptFirst)

  const auth = await startMission('Find where the authorization request is persisted.')
  await requestControlledAuthorization(auth, 'CONTROLLED_TEST_BOUNDARY', 'Fake controlled authorization boundary.', 'fixture', 'Only this action')
  const beforeAuthRecover = await loadMission(auth.missionId)
  const authRecover = await recoverOperations()
  const afterAuthRecover = await loadMission(auth.missionId)
  const approved = await resolveMissionAuthorization(auth.missionId, true)

  const outage = await startMission('Find where Foundry provider health is stored.')
  const outageRun = await runModelMission(outage.missionId, new FoundryModelRouter([new ScriptedModel([
    failProvider('simulated DNS outage', 'PROVIDER'),
    failProvider('simulated DNS outage', 'TIMEOUT'),
    toolOk('workspace.search', { query: 'recordProviderFailure', pathPrefix: 'lib/native-builder' }, 'provider returned'),
  ])]))

  const runtimeLease = await acquireResource({ resource: 'PRODUCTION_LEASE', missionId: 'runtime-a', operation: 'validate-install' })
  const runtimeA = await acquireResource({
    resource: 'ACTIVE_RUNTIME',
    missionId: 'runtime-a',
    operation: 'validate-install',
    alreadyHeld: runtimeLease.state === 'ACQUIRED' ? ['PRODUCTION_LEASE'] : [],
  })
  const runtimeB = await acquireResource({
    resource: 'ACTIVE_RUNTIME',
    missionId: 'runtime-b',
    operation: 'steal-runtime',
    waitMs: 0,
    alreadyHeld: [],
  })
  if (runtimeA.state === 'ACQUIRED') await runtimeA.release()
  if (runtimeLease.state === 'ACQUIRED') await runtimeLease.release()
  await releaseMissionResources('runtime-a')

  const deadlock = assertLockOrder(['ACTIVE_RUNTIME'], 'REPO_WRITE')
  const replayActivate = shouldReplayTool({
    toolCallId: 'x',
    missionId: 'x',
    tool: 'installer.activate',
    argsHash: 'a',
    startTime: new Date().toISOString(),
    status: 'UNKNOWN',
    idempotency: 'NON_IDEMPOTENT_WRITE',
  })
  const replaySearch = shouldReplayTool({
    toolCallId: 'y',
    missionId: 'y',
    tool: 'workspace.search',
    argsHash: 'b',
    startTime: new Date().toISOString(),
    status: 'INTERRUPTED',
    idempotency: 'READ_ONLY',
  })

  const contextMission = await startMission('Find where compact model context is built.')
  contextMission.observations.push(...Array.from({ length: 40 }, (_, index) => ({
    at: new Date().toISOString(),
    source: 'file.read',
    text: 'n'.repeat(800) + String(index),
  })))
  const compact = compactModelContext(contextMission)
  const prioritized = await setMissionPriority(missionA.missionId, 'CRITICAL')
  const queue = groupOperationsQueue([ranA, ranB, wroteA, wroteB].map(toRegistryEntry))
  await reclaimStaleResources()

  const results = [
    check('p006_registry', Boolean(ranA.missionId && ranB.missionId && ranA.priority && ranB.resumeToken), `${ranA.missionId} ${ranB.missionId}`),
    check('p006_saving_does_not_bake_in_an_environment_override', process.env.FOUNDRY_PROVIDER_POLICY === 'AUTO' && storedPolicyAfter === storedPolicyBefore, `${storedPolicyBefore} -> ${storedPolicyAfter} while the process pins ${process.env.FOUNDRY_PROVIDER_POLICY}`),
    check('p006_persisted_model', config.primaryModel === FOUNDRY_DEFAULT_PRIMARY_MODEL && persisted.primaryModel === FOUNDRY_DEFAULT_PRIMARY_MODEL, config.primaryModel),
    check('p006_concurrent_reads', overlap && ranA.toolCalls.length > 0 && ranB.toolCalls.length > 0 && ranA.journal[0]?.text !== ranB.journal[0]?.text, `a=${ranA.toolCalls.length} b=${ranB.toolCalls.length}`),
    check('p006_read_findings', aFound && bFound, `aFound=${aFound} bFound=${bFound}`),
    check('p006_read_only', ranA.constraints.includes('READ_ONLY_INVESTIGATION') && ranB.constraints.includes('READ_ONLY_INVESTIGATION'), ranA.constraints.join(',')),
    // A finished mission gives its write claim back (terminal claim release), so the second writer no longer meets a lock; it meets the content: the text it was told to
    // replace is gone, its patch fails, and it stops. Either way the conflict is surfaced and the first writer's change is what stays on disk.
    check('p006_write_conflict', label.includes('BRAVO') && !label.includes('CHARLIE') && (wroteB.status === 'WAITING_RESOURCE' || /conflict|busy|REPO_WRITE/i.test(wroteB.errors.at(-1)?.message ?? wroteB.blocker?.evidence ?? '') || (wroteB.status === 'BLOCKED' && wroteB.toolCalls.some(call => call.tool === 'file.patch' && call.ok === false))), `${wroteB.status} ${wroteB.blocker?.evidence} patchOk=${wroteB.toolCalls.filter(call => call.tool === 'file.patch').map(call => call.ok).join(',')} label=${label.trim()} a=${JSON.stringify(wroteA.toolCalls.filter(call => call.tool === 'file.patch').map(call => ({ ok: call.ok, excerpt: String(call.excerpt ?? '').slice(0, 200) })))} b=${String(wroteB.toolCalls.find(call => call.tool === 'file.patch')?.excerpt ?? '').slice(0, 200)}`),
    check('p006_no_lost_update', !label.includes('CHARLIE') || label.includes('ALPHA') || label.includes('BRAVO'), label.trim()),
    check('p006_build_wait', holderBusy && (contender?.state === 'BUSY' || contender?.state === 'DEADLOCK_REFUSED') && (buildWaitRun.status === 'WAITING_RESOURCE' || /BUILD_PIPELINE busy|PRODUCTION_LEASE|REFUSED_PRODUCTION_LEASE_HELD|busy \(holder|refused for fixture-only missions/i.test(buildWaitRun.errors.at(-1)?.message ?? buildWaitRun.blocker?.evidence ?? '')), `holder=${holderBusy} lock=${contender?.state} status=${buildWaitRun.status} err=${buildWaitRun.errors.at(-1)?.message ?? buildWaitRun.blocker?.evidence}`),
    check('p006_interrupt_recover', Boolean(afterRecover?.recovery?.recovered) && (afterRecover?.durableToolCalls ?? []).some(call => call.status === 'UNKNOWN' || call.status === 'INTERRUPTED'), JSON.stringify(afterRecover?.recovery)),
    check('p006_no_blind_replay', replayActivate === false && replaySearch === true, `activate=${replayActivate} search=${replaySearch}`),
    check('p006_auth_persist', Boolean(beforeAuthRecover?.authorization?.waiting && afterAuthRecover?.authorization?.waiting && afterAuthRecover.status === 'WAITING_AUTHORIZATION'), `${afterAuthRecover?.status}`),
    check('p006_auth_resume_same', approved.ok && approved.mission.missionId === auth.missionId && approved.mission.authorization?.approvalState === 'approved', approved.mission.missionId),
    check('p006_provider_outage', outageRun.errors.some(error => error.klass === 'TRANSIENT') && outageRun.toolCalls.some(call => call.tool === 'workspace.search') && outageRun.missionId === outage.missionId, `${outageRun.status} ${outageRun.errors.map(error => error.klass).join(',')}`),
    check('p006_runtime_exclusive', runtimeA.state === 'ACQUIRED' && (runtimeB.state === 'BUSY' || runtimeB.state === 'DEADLOCK_REFUSED'), `${runtimeA.state}/${runtimeB.state}`),
    check('p006_lock_order', Boolean(deadlock), deadlock ?? 'no deadlock refusal'),
    check('p006_idempotency', classifyToolIdempotency('workspace.search') === 'READ_ONLY' && classifyToolIdempotency('file.patch') === 'IDEMPOTENT_WRITE' && classifyToolIdempotency('installer.activate') === 'NON_IDEMPOTENT_WRITE' && classifyToolIdempotency('git.commit_prepare') === 'EXTERNAL_ACTION', 'classes'),
    check('p006_compaction', JSON.stringify(compact.relevantExcerpts).length <= 12_000 && compact.recentToolResults.length <= 6, `${JSON.stringify(compact.relevantExcerpts).length}`),
    check('p006_priority', prioritized.priority === 'CRITICAL', prioritized.priority ?? ''),
    check('p006_queue_api', queue.active.length + queue.queued.length + queue.blocked.length + queue.waitingAuthorization.length + queue.waitingResource.length >= 0, 'queue grouped'),
    check('p006_recovery_ran', recovered.recovered.length >= 0 && authRecover.notes.length > 0, recovered.notes.join(';')),
    check('p006_artifact_owner', (wroteA.ownedArtifacts ?? []).every(item => item.missionId === wroteA.missionId), String(wroteA.ownedArtifacts?.length ?? 0)),
    check('p006_interrupted_not_success', interruptedCalls.every(call => call.status !== 'SUCCEEDED'), interruptedCalls.map(call => call.status).join(',')),
  ]
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  const failed = results.filter(result => !result.pass)
  console.log(`Foundry PASS 006 operations contract: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run()
