/**
 * WR-Engineer Phase 1 foundation regression suite.
 *
 * Evaluates the agent ARCHITECTURE itself (identity loading/ordering, state machine, mission
 * context, tool delegation, memory, epistemic labeling) — not model intelligence. Same
 * check()/CaseResult/runXValidation() convention as lib/mission-runtime/missionRuntime.validation.ts,
 * executed the same way: `node --loader ./scripts/ts-extension-loader.mjs
 * --experimental-transform-types lib/wr-engineer/wrEngineer.validation.ts` (wired to
 * `pnpm run validate:wr-engineer`).
 *
 * Uses an isolated, temp-file-backed EngineeringMemoryStore for every memory-touching case so this
 * suite never reads or writes the real .war-room/wr-engineer/memory/records.json.
 */
import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { loadIdentityStack, loadIdentityLayer, stackToOrderedText, IDENTITY_LAYER_ORDER } from './identity/loader'
import { createAgentStateMachine, transitionAgentState, canTransition } from './agentState'
import { createMissionContext, markCriterionMet, resolveMission } from './missionContext'
import * as readSurface from './readSurface'
import { proposeEdit } from './codeEditProposals'
import { JsonFileEngineeringMemoryStore } from './memory/store'
import { isEpistemicStatus, type EpistemicStatus } from './types'
import { UnavailableLocalModelAdapter } from './modelAdapter'
import { WrEngineerRuntime } from './runtime'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

// ---------------------------------------------------------------------------
// 1-5. Identity loading, ordering, and non-collapse.
// ---------------------------------------------------------------------------

async function testIdentityLoading(): Promise<CaseResult[]> {
  const results: CaseResult[] = []

  const identityOnly = await loadIdentityLayer('IDENTITY')
  results.push(check('identity_01_loads_identity_md', identityOnly.content.includes('WR-Engineer'), `${identityOnly.content.length} bytes`))

  const soulOnly = await loadIdentityLayer('SOUL')
  results.push(check('identity_02_loads_soul_md', soulOnly.content.length > 0 && soulOnly.name === 'SOUL', `${soulOnly.content.length} bytes`))

  const userOnly = await loadIdentityLayer('USER')
  results.push(check('identity_03_loads_user_md', userOnly.content.includes("Ra'el"), `${userOnly.content.length} bytes`))

  const stack = await loadIdentityStack()
  const orderMatches = stack.layers.map(l => l.name).every((name, i) => name === IDENTITY_LAYER_ORDER[i])
  results.push(check('identity_04_preserves_layer_ordering', orderMatches, JSON.stringify(stack.layers.map(l => l.name))))

  // Non-collapse proof: each layer's raw content must still be findable, verbatim and distinctly
  // delimited, inside the assembled text — never merged/paraphrased into one blob.
  const assembled = stackToOrderedText(stack)
  const eachLayerPresentVerbatim = stack.layers.every(l => assembled.includes(l.content))
  const delimitersPresent = stack.layers.every(l => assembled.includes(`<<< ${l.name} >>>`) && assembled.includes(`<<< END ${l.name} >>>`))
  results.push(check(
    'identity_05_does_not_collapse_layers',
    eachLayerPresentVerbatim && delimitersPresent,
    `verbatim=${eachLayerPresentVerbatim} delimited=${delimitersPresent}`,
  ))

  // Three genuinely separate files, not one file split by convention.
  const distinctPaths = new Set(stack.layers.map(l => l.path)).size === 3
  results.push(check('identity_06_three_distinct_files_on_disk', distinctPaths, JSON.stringify(stack.layers.map(l => path.basename(l.path)))))

  return results
}

// ---------------------------------------------------------------------------
// 11. Maintains identity as WR-Engineer — never claims to be another system.
// ---------------------------------------------------------------------------

async function testIdentityContent(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  const identity = await loadIdentityLayer('IDENTITY')

  results.push(check('identity_content_01_declares_name_wr_engineer', identity.content.includes('## Name\n\nWR-Engineer'), 'name section present'))

  const forbiddenClaims = ["Ra'el", 'Terra', 'Council', 'WRIM', 'Claude', 'ChatGPT', 'Codex', 'Cursor']
  const hasDisclaimerSection = identity.content.includes('## What WR-Engineer is not')
  const listsEveryForbiddenName = forbiddenClaims.every(name => identity.content.includes(name))
  results.push(check(
    'identity_content_02_explicitly_disclaims_other_systems',
    hasDisclaimerSection && listsEveryForbiddenName,
    `section=${hasDisclaimerSection} allNamed=${listsEveryForbiddenName}`,
  ))

  return results
}

// ---------------------------------------------------------------------------
// Agent state machine sanity (supports mission-brief item: agent state).
// ---------------------------------------------------------------------------

function testAgentStateMachine(): CaseResult[] {
  const results: CaseResult[] = []
  let machine = createAgentStateMachine('READY')
  results.push(check('state_01_starts_ready', machine.current === 'READY', machine.current))

  machine = transitionAgentState(machine, 'WORKING')
  results.push(check('state_02_ready_to_working_allowed', machine.current === 'WORKING', machine.current))

  results.push(check('state_03_illegal_transition_rejected', !canTransition('READY', 'COMPLETE'), String(canTransition('READY', 'COMPLETE'))))

  let threw = false
  try {
    transitionAgentState(createAgentStateMachine('READY'), 'COMPLETE')
  } catch {
    threw = true
  }
  results.push(check('state_04_illegal_transition_throws', threw, String(threw)))

  return results
}

// ---------------------------------------------------------------------------
// 6. Can create a mission context.
// ---------------------------------------------------------------------------

function testMissionContext(): CaseResult[] {
  const results: CaseResult[] = []
  const mission = createMissionContext({
    task: 'Prove the mission context can be created',
    scope: 'lib/wr-engineer only',
    acceptanceCriteria: ['mission has an id', 'mission has acceptance criteria'],
  })
  results.push(check('mission_01_created_with_id', Boolean(mission.id), mission.id))
  results.push(check('mission_02_acceptance_criteria_start_unmet', mission.acceptanceCriteria.every(c => !c.met), JSON.stringify(mission.acceptanceCriteria)))

  let refusedFabrication = false
  try {
    resolveMission(mission, 'success', 'fake success', 'OBSERVED')
  } catch {
    refusedFabrication = true
  }
  results.push(check('mission_03_refuses_success_without_evidence', refusedFabrication, String(refusedFabrication)))

  const withEvidence = markCriterionMet(mission, 'mission has an id', `id=${mission.id}`)
  const stillMissingOne = markCriterionMet(withEvidence, 'mission has acceptance criteria', 'n/a — only one of two met')
  const resolved = resolveMission(stillMissingOne, 'success', 'both criteria met', 'OBSERVED')
  results.push(check('mission_04_resolves_success_once_all_criteria_met', resolved.result?.outcome === 'success', JSON.stringify(resolved.result)))

  return results
}

// ---------------------------------------------------------------------------
// 7. Can inspect repo state through its interface (delegated to native-builder/mission-runtime).
// ---------------------------------------------------------------------------

async function testRepoInspection(): Promise<CaseResult[]> {
  const results: CaseResult[] = []

  const pkg = await readSurface.readFile('package.json')
  results.push(check('inspect_01_reads_real_file', pkg.ok && pkg.content.includes('"name"'), pkg.ok ? `${pkg.content.length} bytes` : pkg.error))

  const context = await readSurface.getRepositoryContext()
  results.push(check('inspect_02_git_awareness_present', typeof context.status.currentBranch === 'string' && typeof context.status.repoPath === 'string', JSON.stringify({ branch: context.status.currentBranch })))

  const hits = await readSurface.searchRepository('WrEngineerRuntime', { pathPrefix: 'lib/wr-engineer' })
  results.push(check('inspect_03_search_finds_own_runtime', hits.some(h => h.relPath.endsWith('runtime.ts')), `${hits.length} hits`))

  return results
}

// ---------------------------------------------------------------------------
// 8. Can produce a proposed edit without silently modifying unrelated files.
// ---------------------------------------------------------------------------

async function testProposeEditIsNonMutating(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  const before = await readSurface.getRepositoryContext()

  const proposal = proposeEdit({
    missionId: randomUUID(),
    diagnosis: 'Fixture-only proposal for the WR-Engineer eval suite — never applied.',
    confidence: 'low',
    changes: [
      {
        file: 'lib/wr-engineer/__fixtures__/does-not-exist.ts',
        reason: 'eval fixture only',
        patch: {
          operation: 'create_file',
          file: 'lib/wr-engineer/__fixtures__/does-not-exist.ts',
          newFileContent: '// eval fixture — never written to disk\n',
        },
      },
    ],
    risks: ['none — this proposal is never applied'],
    rollbackPlan: 'n/a — never applied',
  })

  results.push(check('propose_01_produces_structured_proposal', proposal.plannedChanges.length === 1 && proposal.plannedChanges[0].operation === 'create_file', JSON.stringify(proposal.plannedChanges)))
  results.push(check('propose_02_runs_structural_policy_preview', typeof proposal.policyPreview.ok === 'boolean', JSON.stringify(proposal.policyPreview)))
  results.push(check('propose_03_epistemic_status_not_overclaimed', proposal.epistemicStatus === 'NOT_VERIFIED', proposal.epistemicStatus))

  const after = await readSurface.getRepositoryContext()
  results.push(check(
    'propose_04_no_filesystem_mutation_from_proposing',
    after.status.uncommittedFilesCount === before.status.uncommittedFilesCount,
    `${before.status.uncommittedFilesCount} -> ${after.status.uncommittedFilesCount}`,
  ))

  return results
}

// ---------------------------------------------------------------------------
// 9. Can capture a validation result (delegated to native-builder's validationRunner).
// ---------------------------------------------------------------------------

async function testValidationCapture(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  const { runGitDiffCheck } = await import('./validation')
  const result = await runGitDiffCheck()
  results.push(check(
    'validation_01_captures_real_result_shape',
    typeof result.ok === 'boolean' && typeof result.exitCode !== 'undefined' && typeof result.durationMs === 'number',
    JSON.stringify({ ok: result.ok, exitCode: result.exitCode, durationMs: result.durationMs }),
  ))
  return results
}

// ---------------------------------------------------------------------------
// 10. Can record engineering memory — isolated temp-file store, cleaned up after.
// ---------------------------------------------------------------------------

async function testEngineeringMemory(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  const tmpPath = path.join(os.tmpdir(), `wr-engineer-eval-memory-${randomUUID()}.json`)
  const store = new JsonFileEngineeringMemoryStore(tmpPath)

  const record = await store.record({
    category: 'DECISION',
    summary: 'Eval-suite fixture decision record',
    detail: 'Recorded solely to prove the memory interface works — not a real engineering decision.',
    epistemicStatus: 'OBSERVED',
    tags: ['eval-fixture'],
  })
  results.push(check('memory_01_records_and_returns_id', Boolean(record.id), record.id))

  const fetched = await store.get(record.id)
  results.push(check('memory_02_get_returns_same_record', fetched?.id === record.id, JSON.stringify(fetched)))

  const queried = await store.query({ category: 'DECISION', tag: 'eval-fixture' })
  results.push(check('memory_03_query_finds_record_by_category_and_tag', queried.some(r => r.id === record.id), `${queried.length} matches`))

  const wrongCategory = await store.query({ category: 'BUG' })
  results.push(check('memory_04_query_excludes_non_matching_category', !wrongCategory.some(r => r.id === record.id), `${wrongCategory.length} matches`))

  await rm(tmpPath, { force: true })
  return results
}

// ---------------------------------------------------------------------------
// 12. Distinguishes OBSERVED vs INFERENCE vs UNKNOWN (vs NOT_VERIFIED).
// ---------------------------------------------------------------------------

async function testEpistemicLabeling(): Promise<CaseResult[]> {
  const results: CaseResult[] = []

  results.push(check('epistemic_01_valid_statuses_recognized', ['OBSERVED', 'INFERENCE', 'UNKNOWN', 'NOT_VERIFIED'].every(isEpistemicStatus), 'all four recognized'))
  results.push(check('epistemic_02_invalid_status_rejected', !isEpistemicStatus('CONFIDENT'), String(isEpistemicStatus('CONFIDENT'))))

  // A model adapter with no backing model must report UNKNOWN, never fabricate OBSERVED.
  const unavailable = new UnavailableLocalModelAdapter()
  const result = await unavailable.invoke({ systemPrompt: '', userPrompt: 'anything' })
  results.push(check('epistemic_03_unavailable_adapter_reports_unknown_not_fabricated', result.epistemicStatus === 'UNKNOWN' && result.ok === false, JSON.stringify(result)))

  // A freshly authored proposal (no validation/application evidence yet) must never claim OBSERVED.
  const proposal = proposeEdit({
    missionId: randomUUID(),
    diagnosis: 'fixture',
    confidence: 'low',
    changes: [],
    risks: [],
    rollbackPlan: 'n/a',
  })
  const distinctFromObserved: EpistemicStatus = proposal.epistemicStatus
  results.push(check('epistemic_04_unvalidated_proposal_not_labeled_observed', distinctFromObserved !== 'OBSERVED', distinctFromObserved))

  return results
}

// ---------------------------------------------------------------------------
// Runtime integration — proves the pieces above actually compose through WrEngineerRuntime.
// ---------------------------------------------------------------------------

async function testRuntimeIntegration(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  const tmpPath = path.join(os.tmpdir(), `wr-engineer-eval-runtime-memory-${randomUUID()}.json`)
  const store = new JsonFileEngineeringMemoryStore(tmpPath)
  const runtime = new WrEngineerRuntime(new UnavailableLocalModelAdapter(), store)

  let threwBeforeInit = false
  try {
    runtime.getIdentityStack()
  } catch {
    threwBeforeInit = true
  }
  results.push(check('runtime_01_identity_unavailable_before_initialize', threwBeforeInit, String(threwBeforeInit)))

  await runtime.initialize()
  results.push(check('runtime_02_identity_available_after_initialize', runtime.getIdentityStack().layers.length === 3, String(runtime.getIdentityStack().layers.length)))
  results.push(check('runtime_03_starts_in_ready_state', runtime.getState() === 'READY', runtime.getState()))

  runtime.startMission({
    task: 'Runtime integration fixture mission',
    scope: 'eval suite only',
    acceptanceCriteria: ['runtime transitions to WORKING'],
  })
  results.push(check('runtime_04_starting_mission_transitions_to_working', runtime.getState() === 'WORKING', runtime.getState()))

  const context = await runtime.assembleContext()
  const orderOk = ['IDENTITY', 'SOUL', 'USER', 'MISSION', 'REPOSITORY_CONTEXT', 'ENGINEERING_MEMORY']
    .map(marker => context.indexOf(`<<< ${marker}`))
    .every((idx, i, arr) => idx !== -1 && (i === 0 || idx > arr[i - 1]))
  results.push(check('runtime_05_assembled_context_follows_mandated_load_order', orderOk, 'identity->soul->user->mission->repo->memory'))

  runtime.markCriterionMet('runtime transitions to WORKING', `state=${runtime.getState()}`)
  const resolved = runtime.completeMission('success', 'fixture mission complete', 'OBSERVED')
  results.push(check('runtime_06_completes_mission_and_transitions_complete', resolved.result?.outcome === 'success' && runtime.getState() === 'COMPLETE', runtime.getState()))

  await rm(tmpPath, { force: true })
  return results
}

export async function runWrEngineerValidation(): Promise<CaseResult[]> {
  return [
    ...(await testIdentityLoading()),
    ...(await testIdentityContent()),
    ...testAgentStateMachine(),
    ...testMissionContext(),
    ...(await testRepoInspection()),
    ...(await testProposeEditIsNonMutating()),
    ...(await testValidationCapture()),
    ...(await testEngineeringMemory()),
    ...(await testEpistemicLabeling()),
    ...(await testRuntimeIntegration()),
  ]
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await runWrEngineerValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(r => !r.pass)
  console.log(`WR-Engineer Phase 1 validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
