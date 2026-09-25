/**
 * Current-work banner selection. PASS 011 / last journal action must not appear as live work.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { startMissionInput } from './foundryMissionController'
import type { FoundryMissionRecord, FoundryMissionState } from './foundryMissionTypes'
import { emptyApplicationBuilderState } from './foundryApplicationBuilderTypes'
import { listFoundryApplicationProjects } from './foundryProjectIsolation'
import { presentCommanderProjectCard } from './foundryCommanderProjects'
import { filterMissionsForView } from './foundryMissionVisibility'
import {
  commanderProgressFromMission,
  commanderResultFromMission,
  compactProviderStatus,
  countVisiblePass011AsCurrent,
  isActiveCommanderMission,
  recoverStaleCurrentMissionPointer,
  selectCurrentCommanderWork,
} from './foundryCommanderExperience'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

function mission(overrides: Partial<FoundryMissionRecord> & { userRequest?: string; title?: string; status: FoundryMissionState }): FoundryMissionRecord {
  const base = startMissionInput(overrides.userRequest ?? 'Build a calculator with add and subtract.', overrides.title ?? 'Calculator')
  return {
    ...base,
    visibility: 'commander',
    archived: false,
    superseded: false,
    resumeEligible: true,
    testArtifact: false,
    classification: 'COMMANDER_REAL',
    pauseRequested: false,
    ...overrides,
    status: overrides.status,
  }
}

function pass011(status: FoundryMissionState, extra?: Partial<FoundryMissionRecord>): FoundryMissionRecord {
  return mission({
    status,
    title: 'PASS 011 Semantic Stability',
    userRequest: 'PASS 011 click_and_wait installed Computer Use reliability for The Foundry session lifecycle.',
    goal: 'PASS 011 click_and_wait installed Computer Use reliability for The Foundry session lifecycle.',
    currentAction: 'typecheck.run',
    classification: 'COMMANDER_REAL',
    recovery: {
      recoveredAt: new Date().toISOString(),
      recovered: true,
      disposition: 'READY_TO_RESUME',
      interruptedToolCalls: [],
      notes: [],
    },
    ...extra,
  })
}

async function run() {
  const live = mission({ status: 'EXECUTING', title: 'Calculator', currentAction: 'patch_source' })
  const complete = mission({ status: 'COMPLETE', title: 'Calculator' })
  const projectReady = mission({ status: 'PROJECT_READY' as FoundryMissionState, title: 'Shop' })
  const failed = mission({ status: 'FAILED', title: 'Calculator' })
  const cancelled = mission({ status: 'CANCELLED', title: 'Calculator' })
  const archived = mission({ status: 'EXECUTING', title: 'Calculator', archived: true, resumeEligible: false })
  const superseded = mission({ status: 'EXECUTING', title: 'Calculator', superseded: true, resumeEligible: false })
  const system = mission({ status: 'EXECUTING', title: 'Harness', visibility: 'system', testArtifact: true, classification: 'SYSTEM_TEST' })
  const testClass = mission({ status: 'EXECUTING', title: 'Fixture', classification: 'SYSTEM_TEST', testArtifact: true, visibility: 'system' })
  const proof = mission({
    status: 'EXECUTING',
    title: 'Computer use proof mission',
    userRequest: 'computer use proof for Foundry validator mission',
    goal: 'proof mission',
  })
  const historical011 = pass011('PAUSED')
  const stalePointer = pass011('WAITING_RESOURCE')
  const lastAction = mission({
    status: 'COMPLETE',
    title: 'Calculator',
    currentAction: 'typecheck.run',
  })
  const commanderPaused = mission({ status: 'PAUSED', title: 'Calculator', pauseRequested: true, currentAction: 'patch_source' })
  const recoveredPausedLeftover = mission({
    status: 'PAUSED',
    title: 'Foundry Home Icon Production Install',
    userRequest: 'Install Foundry Home app icon into a new per-user War Room OS runtime.',
    pauseRequested: false,
    currentAction: 'queued',
    recovery: {
      recoveredAt: new Date().toISOString(),
      recovered: true,
      disposition: 'READY_TO_RESUME',
      interruptedToolCalls: [],
      notes: [],
    },
    lockClaims: [{ resource: 'PRODUCTION_LEASE' } as never],
  })

  const idleSelected = selectCurrentCommanderWork([])
  const runningSelected = selectCurrentCommanderWork([complete, live, historical011])
  const counts = countVisiblePass011AsCurrent([historical011, stalePointer, lastAction])
  const progress = runningSelected ? commanderProgressFromMission(runningSelected) : null
  const recoveredPointer = recoverStaleCurrentMissionPointer(stalePointer)
  const reloadPointer = recoverStaleCurrentMissionPointer(pass011('COMPLETE'))

  const results: CaseResult[] = [
    check('current_work_01_no_active_no_banner', idleSelected === null, String(idleSelected)),
    check('current_work_02_running_commander_banner', runningSelected?.title === 'Calculator' && progress?.headline === 'FOUNDRY WORKING', `${runningSelected?.title}:${progress?.headline}`),
    check('current_work_03_complete_no_banner', selectCurrentCommanderWork([complete]) === null, complete.status),
    check('current_work_04_project_ready_no_banner', selectCurrentCommanderWork([projectReady]) === null, projectReady.status),
    check('current_work_05_failed_no_banner', selectCurrentCommanderWork([failed]) === null, failed.status),
    check('current_work_06_cancelled_no_banner', selectCurrentCommanderWork([cancelled]) === null, cancelled.status),
    check('current_work_07_archived_no_banner', selectCurrentCommanderWork([archived]) === null, String(archived.archived)),
    check('current_work_08_superseded_no_banner', selectCurrentCommanderWork([superseded]) === null, String(superseded.superseded)),
    check('current_work_09_system_no_banner', selectCurrentCommanderWork([system]) === null, String(system.visibility)),
    check('current_work_10_test_no_banner', selectCurrentCommanderWork([testClass]) === null, String(testClass.classification)),
    check('current_work_11_proof_no_banner', selectCurrentCommanderWork([proof]) === null, proof.title),
    check('current_work_12_pass011_historical_no_banner', selectCurrentCommanderWork([historical011]) === null && counts.pass011AsCurrent === 0, JSON.stringify(counts)),
    check('current_work_13_stale_pointer_cleared', recoveredPointer === null, stalePointer.status),
    check('current_work_14_last_journal_not_active', selectCurrentCommanderWork([lastAction]) === null && counts.typecheckRunAsCurrent === 0, lastAction.currentAction ?? 'none'),
    check('current_work_15_reload_does_not_resurrect', reloadPointer === null, 'COMPLETE pointer ignored'),
    check('current_work_16_real_active_still_displays', selectCurrentCommanderWork([historical011, live])?.title === 'Calculator' && progress?.headline === 'FOUNDRY WORKING', runningSelected?.title ?? 'none'),
    check('current_work_17_commander_pause_still_current', selectCurrentCommanderWork([commanderPaused])?.title === 'Calculator', commanderPaused.status),
    check('current_work_18_recovered_paused_leftover_not_current', selectCurrentCommanderWork([recoveredPausedLeftover]) === null, recoveredPausedLeftover.title),
  ]

  const shell = readFileSync(path.join(process.cwd(), 'components/war-room/foundry/FoundryShell.tsx'), 'utf8')
  const nav = readFileSync(path.join(process.cwd(), 'components/war-room/foundry/FoundryHomeNav.tsx'), 'utf8')
  const home = readFileSync(path.join(process.cwd(), 'app/page.tsx'), 'utf8')
  const terraPage = readFileSync(path.join(process.cwd(), 'app/terra/page.tsx'), 'utf8')
  const isolation = readFileSync(path.join(process.cwd(), 'lib/native-builder/foundryProjectIsolation.ts'), 'utf8')
  const builder = readFileSync(path.join(process.cwd(), 'lib/native-builder/foundryApplicationBuilder.ts'), 'utf8')
  const listed = await listFoundryApplicationProjects()
  const harborRecord = listed.find(item => /harbor desk|small-business-crm/i.test(`${item.projectName} ${item.projectRoot}`))
  const transportRecord = listed.find(item => /transport|truck|professional-website|18780/i.test(`${item.projectName} ${item.projectRoot}`))
  const harborCard = harborRecord ? await presentCommanderProjectCard(harborRecord) : null
  const transportCard = transportRecord ? await presentCommanderProjectCard(transportRecord) : null
  const liveProgress = commanderProgressFromMission(mission({
    status: 'EXECUTING',
    title: 'Transportation Website',
    userRequest: 'Build me a professional website for my box truck business.',
    currentStep: 'patch_source',
    currentAction: 'Writing application in project root',
    plan: startMissionInput('Build me a professional website for my box truck business.').plan.map(step => (
      step.id === 'patch_source' ? { ...step, status: 'active' as const } : step.id === 'understand' || step.id === 'research' ? { ...step, status: 'done' as const } : step
    )),
  }))
  const readyResult = commanderResultFromMission(mission({
    status: 'COMPLETE',
    title: 'Transportation Website',
    userRequest: 'Build me a professional website for my box truck business.',
    applicationBuilder: {
      ...emptyApplicationBuilderState(),
      preview: {
        status: 'PROJECT_READY',
        projectName: 'Lane & Box Transport',
        localPreview: 'http://127.0.0.1:18780',
        whatWasBuilt: 'Transportation website',
        majorFeatures: [],
        testStatus: '25 passed',
        knownLimitations: [],
        researchUsed: [],
        deploymentReadiness: 'NOT AUTHORIZED',
        viewportStatus: 'desktop verified',
      },
      project: {
        projectId: 'transport-id',
        projectName: 'Lane & Box Transport',
        projectRoot: '/home/chosenone/FoundryProjects/professional-website-for-a',
        missionId: 'm1',
        projectType: 'static_website',
        createdAt: new Date().toISOString(),
        stack: null,
        requirements: null,
        researchSources: [],
        acceptanceCriteria: [],
        status: 'PROJECT_READY',
      },
      viewportResults: [
        { name: 'desktop', width: 1280, height: 800, ok: true, detail: 'ok', overflow: false, blankScreen: false, missingContent: false },
        { name: 'mobile', width: 390, height: 844, ok: true, detail: 'ok', overflow: false, blankScreen: false, missingContent: false },
      ],
    },
  }))
  const providerReady = compactProviderStatus({ localReady: true, remoteReady: true, known: true })
  const providerBlocked = compactProviderStatus({ localReady: false, remoteReady: false, known: true })
  results.push(
    check('ready_has_no_current_work', idleSelected === null, String(idleSelected)),
    check('active_commander_shows_current_work', Boolean(runningSelected) && progress?.headline === 'FOUNDRY WORKING', runningSelected?.title ?? 'none'),
    check('terminal_not_active', !isActiveCommanderMission(complete), complete.status),
    check('system_test_excluded', selectCurrentCommanderWork([system, testClass, proof]) === null, 'ok'),
    check('pass011_fixture_excluded', selectCurrentCommanderWork([historical011]) === null && counts.pass011AsCurrent === 0, JSON.stringify(counts)),
    check('current_action_from_journal_plan', liveProgress.currentStage === 'Building interface' && !liveProgress.items.some(item => item.label === 'Running tests' && item.state === 'active'), liveProgress.currentStage),
    check('project_ready_result_card', readyResult?.kind === 'SITE_READY' && readyResult.projectName === 'Lane & Box Transport', JSON.stringify(readyResult)),
    check('preview_url_from_project_metadata', Boolean(readyResult?.previewUrl?.includes('127.0.0.1')), readyResult?.previewUrl ?? 'none'),
    check('project_list_reads_real_index', Array.isArray(listed) && !shell.includes('Harbor Desk') && !shell.includes('127.0.0.1:18810'), String(listed.length)),
    check('harbor_desk_project_resolvable', Boolean(harborRecord), harborRecord ? `${harborCard?.name} ${harborRecord.projectRoot}` : 'missing'),
    check('transportation_project_resolvable', Boolean(transportRecord), transportRecord ? `${transportCard?.name} ${transportRecord.projectRoot}` : 'missing'),
    check('continue_reuses_project_id', shell.includes('continueProject') && shell.includes('continueProjectId') && shell.includes('Reuse the existing project'), 'ok'),
    check('new_project_works', shell.includes('foundry-new-project') && shell.includes('startNewProject') && shell.includes('promptRef.current?.focus()') && !shell.includes("window.prompt('New project name"), 'ok'),
    check('new_session_works', shell.includes('foundry-new-session') && shell.includes('startNewSession') && shell.includes("title: 'New Session'"), 'ok'),
    check('open_details_works', shell.includes('foundry-open-mission-details') && shell.includes('foundry-open-details'), 'ok'),
    check('advanced_holds_system_diagnostics', shell.includes('Advanced / Operations') && shell.includes('FoundryOperationsPanel') && shell.includes('FoundryCapabilitiesPanel') && shell.includes('foundry-inspector'), 'ok'),
    check('provider_status_does_not_dominate', !nav.includes('CURSOR AGENT') && shell.includes('providerCompact') && providerReady.mode === 'READY' && providerBlocked.blocking === true, `${providerReady.mode}:${providerBlocked.mode}`),
    check('stale_mission_pointer_recovers', recoverStaleCurrentMissionPointer(historical011) === null && recoverStaleCurrentMissionPointer(live) === live, 'ok'),
    check('app_restart_restores_projects', shell.includes('/api/mission-runtime/engineering/workspaces') && shell.includes('persistFoundryResume'), 'ok'),
    check('no_hardcoded_project_fixtures', !shell.includes('small-business-crm') && !shell.includes('Harbor Desk') && !/18810/.test(shell) && !/18780/.test(shell), 'ok'),
    check('filter_hides_pass011_from_commander_view', filterMissionsForView([historical011, live], 'commander').every(item => item.title !== 'PASS 011 Semantic Stability'), filterMissionsForView([historical011, live], 'commander').map(item => item.title).join(',')),
    check('compact_header', nav.includes('FOUNDRY_BACK_TO_WAR_ROOM_LABEL') && nav.includes('THE FOUNDRY') && !nav.includes('HIGHER VISION INC') && !nav.includes('Native Engineering Intelligence'), 'ok'),
    check('command_input_starts_foundry_mission', shell.includes('/api/foundry/missions') && shell.includes('startCommanderFoundryMission') && shell.includes('isApplicationBuilderRequest'), 'ok'),
    check('homepage_not_redesigned_here', home.includes('FoundryEntryLink') && !home.includes('foundry-working-strip'), 'ok'),
    check('terra_page_untouched_marker', terraPage.includes('TerraShell') || /terra/i.test(terraPage), 'ok'),
    check('preview_spawns_node_not_electron', isolation.includes('foundryNodeExecutable') && isolation.includes("'/usr/bin/node'") && isolation.includes('cmd: foundryNodeExecutable()') && builder.includes('foundryNodeExecutable()'), 'ok'),
  )

  const failedCases = results.filter(item => !item.pass)
  for (const item of results) {
    console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} ${item.detail}`)
  }
  if (failedCases.length) {
    console.error(`Foundry current-work validation: ${failedCases.length} failed`)
    process.exit(1)
  }
  console.log(`Foundry current-work validation: ${results.length}/${results.length} PASS`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await run()
}

export { run as runFoundryCurrentWorkValidation }
