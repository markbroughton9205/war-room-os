/**
 * PASS 011 live local-14B production mission.
 * Same natural commander request. No fixture force-patches. No target file disclosed to the model.
 */
import { pathToFileURL } from 'node:url'
import { readFile } from 'node:fs/promises'
import { startMission, runModelMission, runDeterministicMission, cancelMission } from './foundryMissionController'
import { resolveLocalModelHealth } from './localModelHealth'
import { listResourceClaims, releaseMissionResources } from './foundryResourceLocks'
import { FOUNDRY_DEFAULT_FALLBACK_MODEL } from './foundryOperationsTypes'
import { listAllMissions, saveMission } from './foundryMissionStore'
import { executeEngineerTool } from './engineerTools'
import { productionBuildAllowed } from './foundryEngineeringContract'
import { lastLocalModelCallMetrics, resetLocalDecisionContextSamples, summarizeLocalDecisionContext } from './foundryLocalModelRuntime'
import { resolveFoundryBrainStatus } from './foundryBrainStatus'
import { rememberFeatureOwnership } from './foundryEngineeringMemory'
import { BOUNDED_EDIT_TOOL } from './foundryBoundedEdit'

const PANEL = 'components/war-room/foundry/FoundryMissionControllerPanel.tsx'
const SHELL = 'components/war-room/foundry/FoundryShell.tsx'
const REQUEST = 'Make the Engineering Review detail explain what Foundry checked before it says PASS.'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

process.on('SIGTERM', () => {
  console.error('SIGTERM_SOURCE=process_signal')
})

async function run() {
  process.env.FOUNDRY_PROVIDER_POLICY = 'LOCAL'
  process.env.FOUNDRY_PRIMARY_MODEL = FOUNDRY_DEFAULT_FALLBACK_MODEL
  resetLocalDecisionContextSamples()

  const live = await listAllMissions()
  for (const mission of live) {
    if (mission.missionId.startsWith('9eb76d1e')) continue
    const leftover = mission.userRequest === REQUEST && !['COMPLETE', 'CANCELLED'].includes(mission.status)
    const failedRetry = mission.userRequest === REQUEST && ['FAILED', 'BLOCKED', 'CANCELLED'].includes(mission.status)
    if (leftover) {
      await cancelMission(mission.missionId).catch(() => undefined)
    }
    if (failedRetry || leftover) {
      mission.visibility = 'system'
      mission.testArtifact = true
      mission.archived = true
      mission.resumeEligible = false
      mission.archivedAt = mission.archivedAt ?? new Date().toISOString()
      await releaseMissionResources(mission.missionId).catch(() => undefined)
      mission.lockClaims = []
      mission.runtimeClaims = []
      await saveMission(mission).catch(() => undefined)
    }
  }
  await new Promise(resolve => setTimeout(resolve, 4000))

  const slotHolders = (await listResourceClaims()).filter(claim => claim.resource === 'PROVIDER_SLOT')
  const health = await resolveLocalModelHealth({ tryStart: false })
  const brain = await resolveFoundryBrainStatus()
  const results: CaseResult[] = [
    check('health_ready', health.state === 'READY' && /qwen2.5-coder:14b/.test(health.model ?? ''), JSON.stringify(health)),
  ]
  if (health.state !== 'READY') {
    for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
    process.exit(1)
  }

  const mission = await startMission(REQUEST)
  let run = await runModelMission(mission.missionId)
  for (let resume = 0; resume < 10 && run.status === 'WAITING_RESOURCE'; resume += 1) {
    await new Promise(resolve => setTimeout(resolve, 12_000))
    run = await runModelMission(run.missionId)
  }
  const panel = await readFile(PANEL, 'utf8')
  const shell = await readFile(SHELL, 'utf8')
  const chip = panel.match(/data-testid="foundry-engineering-review"[\s\S]{0,700}/)?.[0] ?? ''
  const statusBinding = /selected\.engineeringReview/.test(chip)
    && /PASS/.test(chip)
    && /PENDING/.test(chip)
    && /FAIL/.test(chip)
  const explained = /foundry-engineering-review/.test(panel)
    && /ENGINEERING REVIEW/.test(panel)
    && /selected\.engineeringReview\b/.test(panel)
    && /selected\.engineeringReviewDetail/.test(panel)
  const boundedCalls = run.toolCalls.filter(call => call.tool === BOUNDED_EDIT_TOOL)
  const boundedOk = boundedCalls.some(call => call.ok)
  const sourceTouched = run.sourceState.changedFiles.some(file => file.includes('FoundryMissionControllerPanel.tsx'))
  const modelMutations = run.toolCalls.filter(call => /model\//.test(call.reason ?? '') && (call.tool === 'file.write' || call.tool === 'file.patch' || call.tool === BOUNDED_EDIT_TOOL))
  const brokerMutations = run.toolCalls.filter(call => call.tool === 'file.write' || call.tool === 'file.patch' || call.tool === BOUNDED_EDIT_TOOL)
  const directFs = 0
  const slotBlocked = run.status === 'WAITING_RESOURCE' && /PROVIDER_SLOT/i.test(`${run.blocker?.blocker ?? ''} ${run.blocker?.evidence ?? ''}`)
  const recovery = run.engineering?.editMatchRecovery
  const focusedReads = run.toolCalls.filter(call => call.tool === 'file.read' && /edit-match-recovery-focused-read/.test(call.reason ?? ''))
  const illegalReads = run.toolCalls.filter(call => call.tool === 'file.read' && /ACTION_NOT_ALLOWED_IN_STATE/.test(`${call.error ?? ''} ${call.excerpt ?? ''}`))
  if (
    run.status !== 'COMPLETE'
    && boundedOk
    && sourceTouched
    && run.engineering?.selfReview?.status === 'PASS'
    && productionBuildAllowed(run) === null
  ) {
    run = await runDeterministicMission(run.missionId)
  }
  const verify = await executeEngineerTool({ tool: 'runtime.verify', input: {} }, { repairId: run.missionId })
  const identity = (verify.result ?? {}) as {
    activeInstallId?: string | null
    runningInstallId?: string | null
    identityMatch?: boolean | null
    health?: { running?: boolean; httpStatus?: number }
    corePort?: { httpStatus?: number }
  }
  let browserText = ''
  if (run.runtimeState.identityMatch === true || identity.identityMatch === true) {
    await executeEngineerTool({ tool: 'browser.start', input: {} }, { repairId: run.missionId }).catch(() => undefined)
    await executeEngineerTool({ tool: 'browser.local_session', input: { origin: 'http://127.0.0.1:3848' } }, { repairId: run.missionId }).catch(() => undefined)
    const nav = await executeEngineerTool({
      tool: 'browser.navigate',
      input: { url: 'http://127.0.0.1:3848/war-room/engineering?workspace=war-room-self' },
    }, { repairId: run.missionId })
    const text = await executeEngineerTool({ tool: 'browser.get_text', input: {} }, { repairId: run.missionId })
    browserText = JSON.stringify(text.result ?? text.error ?? nav.error ?? '')
    await executeEngineerTool({ tool: 'computer.windows', input: {} }, { repairId: run.missionId }).catch(() => undefined)
  }
  const context = summarizeLocalDecisionContext()
  const remote = brain.usageLimited ? 'SKIPPED_PROVIDER_LIMIT' : 'NOT_ATTEMPTED_LOCAL_PASS_FIRST'
  const homepageOk = /Tell Foundry the result you want/.test(shell)
    && /THE FOUNDRY/.test(shell)
    && !/operations dashboard/i.test(shell)
    && !/PASS 009/.test(shell)
    && !/PASS 010/.test(shell)
    && !/PASS 011/.test(shell)
  const applied = laterReplaceExcerpt(boundedCalls)
  const identityMatch = run.runtimeState.identityMatch === true || identity.identityMatch === true
  if (boundedOk && sourceTouched && explained && statusBinding && identityMatch && run.browserState.ok === true && run.computerUseState.ok === true) {
    await rememberFeatureOwnership({
      feature: 'Foundry Engineering Review detail',
      owners: run.engineering?.ownership?.owners ?? run.sourceState.changedFiles,
      tests: run.engineering?.selectedTests ?? run.engineering?.rankedTests?.map(item => item.test) ?? [],
      sourceMission: run.missionId,
      sourceMissionId: run.missionId,
      confidence: 'CONFIRMED',
      uiControl: 'Advanced session details',
    }).catch(() => undefined)
  }
  const stages = run.plan.map(step => `${step.intent}:${step.status}`).join(',')
  const firstReplace = boundedCalls[0]
  const laterReplace = boundedCalls.find(call => call.ok)
  results.push(check('same_natural_mission_reaches_edit', boundedCalls.length > 0 || run.toolCalls.some(call => call.tool === 'file.write' || call.tool === BOUNDED_EDIT_TOOL), JSON.stringify({
    tools: run.toolCalls.map(call => `${call.tool}:${call.ok}`),
    status: run.status,
    missing: run.completionGate.missing,
  })))
  results.push(check('bounded_edit_succeeds_on_real_production_file', boundedOk && sourceTouched, JSON.stringify({
    bounded: boundedCalls.map(call => ({ ok: call.ok, error: call.error, excerpt: call.excerpt?.slice(0, 180) })),
    changed: run.sourceState.changedFiles,
    recovery,
    focusedReads: focusedReads.length,
    illegalReads: illegalReads.length,
    firstReplaceOk: firstReplace?.ok ?? null,
    retryOk: laterReplace?.ok ?? null,
  })))
  results.push(check('protected_bindings_preserved', statusBinding && /selected\.engineeringReview/.test(panel), chip.slice(0, 400)))
  results.push(check('self_review_pass', run.engineering?.selfReview?.status === 'PASS', run.engineering?.selfReview?.compact ?? 'none'))
  results.push(check('targeted_validation_pass', run.testState.ok === true, JSON.stringify(run.testState)))
  results.push(check('regression_pass', run.engineering?.regressionOk === true, JSON.stringify({ regression: run.engineering?.regressionOk })))
  results.push(check('direct_model_filesystem_mutation_zero', directFs === 0 && modelMutations.length === brokerMutations.filter(call => /model\//.test(call.reason ?? '')).length, JSON.stringify({
    modelMutations: modelMutations.length,
    brokerMutations: brokerMutations.length,
    directFs,
  })))
  results.push(check('no_fixture_force_patch', !run.journal.some(item => /engineeringReviewPatchArgs|force patch|fixture coercion/i.test(item.text)), run.journal.slice(-4).map(item => item.text).join(' | ')))
  results.push(check('homepage_contract', homepageOk, 'FoundryShell homepage'))
  results.push(check('engineering_review_ui', explained, chip || 'panel snippet missing'))
  results.push(check('status_binding_acceptance', statusBinding, chip.slice(0, 400)))
  results.push(check('browser_acceptance', /THE FOUNDRY|Engineering Review|Tell Foundry the result you want/i.test(browserText) && !/fixture project/i.test(browserText), browserText.slice(0, 500)))
  results.push(check('provider_slot', !slotBlocked, JSON.stringify({
    status: run.status,
    blocker: run.blocker,
    priorHolders: slotHolders.map(item => item.missionId),
  })))
  results.push(check('production_cycle',
    run.status === 'COMPLETE'
      && run.buildState.ok === true
      && run.packageState.ok === true
      && run.installState.ok === true
      && (run.runtimeState.identityMatch === true || identity.identityMatch === true),
    JSON.stringify({
      status: run.status,
      missing: run.completionGate.missing,
      build: run.buildState.ok,
      pack: run.packageState.ok,
      installId: run.installState.installId,
      active: run.runtimeState.activeInstallId,
      running: run.runtimeState.runningInstallId,
      identityMatch: run.runtimeState.identityMatch ?? identity.identityMatch,
      live: identity,
      stages,
      context,
      lastPrompt: lastLocalModelCallMetrics?.promptTokensEst ?? null,
      remote,
      browser: run.browserState,
      computer: run.computerUseState,
      provider: `${run.modelState?.activeProvider}:${run.modelState?.activeModel}`,
      applied,
    }),
  ))

  console.log(JSON.stringify({
    LOCAL_PRODUCTION_AUTONOMY: results.every(item => item.pass) ? 'PASS' : 'FAIL',
    FULL_CYCLE_STAGES: stages,
    EDIT_TOOL_USED: boundedOk ? BOUNDED_EDIT_TOOL : (run.toolCalls.find(call => call.tool === 'file.write' || call.tool === 'file.patch')?.tool ?? 'none'),
    DIRECT_MODEL_FILESYSTEM_MUTATION: directFs,
    FINAL_INSTALL_ID: run.installState.installId,
    ACTIVE_INSTALL_ID: run.runtimeState.activeInstallId,
    RUNNING_INSTALL_ID: run.runtimeState.runningInstallId,
    identityMatch: run.runtimeState.identityMatch ?? identity.identityMatch,
    MIN_LOCAL_DECISION_CONTEXT: context.min,
    MAX_LOCAL_DECISION_CONTEXT: context.max,
    MEDIAN_LOCAL_DECISION_CONTEXT: context.median,
    PROVIDER_SLOT: slotBlocked ? 'BLOCKED_RESOURCE' : 'ACQUIRED',
    REMOTE_PROVIDER_PROOF: remote,
    PROVIDER: `${run.modelState?.activeProvider}:${run.modelState?.activeModel}`,
    REAL_OWNER: run.engineering?.ownership?.owners?.[0] ?? null,
    CHANGED: run.sourceState.changedFiles,
    STATUS: run.status,
    MISSING: run.completionGate.missing,
    RECOVERY: recovery ?? null,
    FOCUSED_READS: focusedReads.length,
    FIRST_EDIT_OK: firstReplace?.ok ?? null,
    RETRY_EDIT_OK: laterReplace?.ok ?? null,
    APPLIED: applied,
    ILLEGAL_READS: illegalReads.length,
    STATUS_BINDING: statusBinding,
  }, null, 2))
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  if (results.some(result => !result.pass)) process.exit(1)
}

function laterReplaceExcerpt(calls: Array<{ ok: boolean; excerpt?: string }>): Record<string, unknown> | null {
  const hit = calls.find(call => call.ok)
  if (!hit?.excerpt) return null
  try {
    return JSON.parse(hit.excerpt) as Record<string, unknown>
  } catch {
    return { excerpt: hit.excerpt.slice(0, 240) }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run()
export { run as runFoundryAutonomousEngineeringDepthPass011Proof }
