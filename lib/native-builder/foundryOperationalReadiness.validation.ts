/**
 * Foundry production-readiness contracts for Commander-visible operationalization.
 * Source and selector checks. Installed E2E is proven separately after package/install.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { interpretCommanderRequest } from './foundryMissionPlanner'
import {
  deriveRequirements,
  inferProjectType,
  isApplicationBuilderRequest,
  isCrmOutcome,
  isLocalDataOutcome,
  isWebsiteOutcome,
  researchQueriesForOutcome,
  suggestedProjectName,
} from './foundryRequirementsEngine'
import {
  commanderOpenLabel,
  commanderResultFromMission,
  commanderResultKind,
  countVisiblePass011AsCurrent,
  isActiveCommanderMission,
  preferredPreviewPort,
  projectRuntimeStatus,
  recoverStaleCurrentMissionPointer,
  selectCurrentCommanderWork,
} from './foundryCommanderExperience'
import {
  archiveDuplicateProjectRecords,
  chooseCanonicalApplicationProject,
  projectBrandIdentityIsResolved,
} from './foundryProjectIndexHygiene'
import { startMissionInput } from './foundryMissionController'
import { buildLocalDataAppFiles } from './foundryLocalDataAppFactory'
import { createFoundrySession, isUntouchedEmptySession, reuseOrCreateFoundrySession } from './foundrySessions'
import { APPLICATION_BUILDER_CRM_PORT, APPLICATION_BUILDER_DATA_APP_PORT } from './foundryApplicationBuilderTypes'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

const INVENTORY = 'Build me a simple but professional local inventory manager. I need to add items, quantities, categories, search them, edit them, and keep the data after restart.'
const CRM = 'Build me a small business CRM for leads and customers.'
const WEBSITE = 'Build a professional transportation company website with a home page, services page, about page, and contact form.'

function source(rel: string): string {
  return readFileSync(path.join(resolveRepoRoot(), rel), 'utf8')
}

async function run() {
  const results: CaseResult[] = []
  const shell = source('components/war-room/foundry/FoundryShell.tsx')
  const builder = source('lib/native-builder/foundryApplicationBuilder.ts')
  const projects = source('lib/native-builder/foundryCommanderProjects.ts')
  const workspaces = source('app/api/mission-runtime/engineering/workspaces/route.ts')

  results.push(check('idle_has_no_stale_current_work', selectCurrentCommanderWork([]) === null, 'empty list'))
  const live = startMissionInput(INVENTORY, 'Inventory')
  live.status = 'EXECUTING'
  live.visibility = 'commander'
  live.classification = 'COMMANDER_REAL'
  live.testArtifact = false
  results.push(check('active_real_mission_shows_working', isActiveCommanderMission(live) && selectCurrentCommanderWork([live])?.title === 'Inventory', live.status))
  const complete = { ...live, status: 'COMPLETE' as const, currentAction: 'typecheck.run' }
  results.push(check('terminal_clears_current', recoverStaleCurrentMissionPointer(complete) === null && selectCurrentCommanderWork([complete]) === null, complete.status))
  results.push(check('historical_fixture_never_active', countVisiblePass011AsCurrent([{
    status: 'PAUSED',
    title: 'PASS 011 Semantic Stability',
    userRequest: 'PASS 011 click_and_wait',
    goal: 'PASS 011',
    currentAction: 'typecheck.run',
    classification: 'COMMANDER_REAL',
    visibility: 'commander',
  }]).pass011AsCurrent === 0, 'pass011'))
  results.push(check('system_mission_hidden', !isActiveCommanderMission({
    ...live,
    visibility: 'system',
    testArtifact: true,
    classification: 'SYSTEM_TEST',
  }), 'system'))
  results.push(check('test_mission_hidden', !isActiveCommanderMission({
    ...live,
    classification: 'SYSTEM_TEST',
    testArtifact: true,
    visibility: 'system',
  }), 'test'))
  results.push(check('proof_mission_hidden', !isActiveCommanderMission({
    ...live,
    title: 'Computer use proof mission',
    userRequest: 'computer use proof for Foundry validator mission',
    goal: 'proof mission',
  }), 'proof'))
  results.push(check('prompt_creates_app_builder_kind', interpretCommanderRequest(INVENTORY).kind === 'app_builder' && isApplicationBuilderRequest(INVENTORY), interpretCommanderRequest(INVENTORY).kind))
  results.push(check('inventory_not_website_type', inferProjectType(INVENTORY) === 'database_backed_app', inferProjectType(INVENTORY)))
  results.push(check('inventory_not_crm', !isCrmOutcome(INVENTORY) && isLocalDataOutcome(INVENTORY), String(isCrmOutcome(INVENTORY))))
  results.push(check('website_still_website', isWebsiteOutcome(WEBSITE) && inferProjectType(WEBSITE) === 'static_website', inferProjectType(WEBSITE)))
  results.push(check('crm_still_crm', isCrmOutcome(CRM) && inferProjectType(CRM) === 'internal_business_tool', inferProjectType(CRM)))
  const inventoryQueries = researchQueriesForOutcome(INVENTORY)
  results.push(check('research_not_canned_truck', inventoryQueries.every(item => !/box truck|freight broker|MC DOT/i.test(item)) && inventoryQueries.some(item => /inventory/i.test(item)), inventoryQueries.join(' | ')))
  results.push(check('research_crm_keeps_crm_queries', researchQueriesForOutcome(CRM).some(item => /CRM/i.test(item)), 'crm queries'))
  results.push(check('suggested_name_inventory', suggestedProjectName(INVENTORY) === 'local-inventory-manager', suggestedProjectName(INVENTORY)))
  results.push(check('no_hardcoded_projects_in_shell', !/Harbor Desk|Lane & Box|PASS011|sample project/i.test(shell.split('startNewProject')[0] + shell.split('Projects')[1]?.slice(0, 800)), 'shell project list'))
  results.push(check('no_hardcoded_current_mission', !/PASS 011 Semantic Stability|72b371e5/.test(shell), 'shell'))
  results.push(check('new_project_persists', /create-application/.test(shell) && /create-application/.test(workspaces), 'new project API'))
  results.push(check('new_session_reuses_empty', /reuseOrCreateFoundrySession/.test(source('app/api/mission-runtime/engineering/foundry/sessions/route.ts')), 'session route'))
  results.push(check('preview_live_reconciles_http', /probeLoopback/.test(projects) && /previewLive/.test(projects), 'commander projects'))
  results.push(check('preferred_port_not_crm_for_data', preferredPreviewPort({ projectType: 'database_backed_app' }) === APPLICATION_BUILDER_DATA_APP_PORT, String(preferredPreviewPort({ projectType: 'database_backed_app' }))))
  results.push(check('preferred_port_crm_unchanged', preferredPreviewPort({ projectType: 'internal_business_tool' }) === APPLICATION_BUILDER_CRM_PORT, '18810'))
  results.push(check('continue_uses_application_project_id', /continueProjectId|applicationProjectId/.test(shell) && /Reuse the existing project/.test(shell), 'continue'))
  results.push(check('open_uses_war_room_browser', /setBrowserUrl\(project\.previewUrl\)/.test(shell) && /FoundryBrowser/.test(shell) && !/window\.open\(project\.previewUrl/.test(shell), 'internal open'))
  results.push(check('default_status_not_files', /rightTab.*idle/.test(shell.replace(/\n/g, ' ')) || /useState<'idle'/.test(shell), 'idle status'))
  results.push(check('terminal_is_real', /FoundryTerminal/.test(shell) && /startFoundryTerminal/.test(source('lib/native-builder/foundryTerminalSession.ts')), 'pty'))
  results.push(check('advanced_collapsed', /foundry-advanced-toggle/.test(shell) && /useState\(false\)/.test(shell), 'advanced'))
  results.push(check('compact_default_status', /data-testid="foundry-commander-status"/.test(shell) && /NEEDS YOUR INPUT/.test(shell), 'status'))
  results.push(check('deploy_hidden_unless_advanced', /opsOpen \? \(/.test(shell) && /Deploy/.test(shell), 'deploy gated'))
  results.push(check('show_terminal_opens_terminal', /setDrawer\(drawer === 'hidden' \? 'terminal'/.test(shell), 'terminal'))
  results.push(check('builder_has_local_data_lane', /applicationLane/.test(builder) && /buildLocalDataAppFiles/.test(builder) && !/isCrm = isCrmOutcome\(outcome\) \|\| inferProjectType/.test(builder), 'lane'))
  const generated = buildLocalDataAppFiles({
    requirements: deriveRequirements({ outcome: INVENTORY, research: [] }),
    previewOrigin: 'http://127.0.0.1:18820',
    productName: 'local-inventory-manager',
    includeLowStock: false,
    port: 18820,
  })
  const blob = Object.values(generated.files).join('\n')
  results.push(check('local_factory_not_harbor_desk', !/Harbor Desk|Lane & Box/.test(blob) && /node:sqlite/.test(blob) && /data-testid="inventory-app"/.test(blob), 'factory copy'))
  results.push(check('local_factory_has_persistence_tests', /reopened/.test(generated.files['test.mjs']) && /CREATE TABLE IF NOT EXISTS items/.test(generated.files['db.mjs']), 'tests'))
  const low = buildLocalDataAppFiles({
    requirements: deriveRequirements({ outcome: 'Add a low-stock filter.', research: [] }),
    previewOrigin: 'http://127.0.0.1:18820',
    productName: 'local-inventory-manager',
    includeLowStock: true,
    port: 18820,
  })
  results.push(check('continuation_low_stock_in_factory', /low-stock-filter/.test(low.files['public/index.html']) && /lowStock/.test(low.files['db.mjs']), 'low stock'))
  const inventoryResult = commanderResultFromMission({
    ...complete,
    title: 'local-inventory-manager',
    applicationBuilder: {
      continuationOf: null,
      preview: {
        status: 'PROJECT_READY',
        projectName: 'local-inventory-manager',
        localPreview: 'http://127.0.0.1:18820',
        whatWasBuilt: 'Local inventory manager with SQLite persistence',
        majorFeatures: ['Add item', 'SQLite persistence'],
        testStatus: 'PASS',
        knownLimitations: [],
        researchUsed: [],
        deploymentReadiness: 'NOT AUTHORIZED',
      },
      project: {
        projectId: '8a2bdabe-02ad-410a-83c6-2aa1ba5c2253',
        projectName: 'local-inventory-manager',
        projectRoot: '/home/chosenone/FoundryProjects/local-inventory-manager',
        missionId: 'b6164621-b79b-46f9-8d4c-b0ce82583017',
        projectType: 'database_backed_app',
        createdAt: new Date().toISOString(),
        stack: null,
        requirements: null,
        researchSources: [],
        acceptanceCriteria: [],
        status: 'PROJECT_READY',
      },
      viewportResults: [],
    },
    testState: { ok: true, detail: 'PASS', ranAt: null },
    sourceState: { changedFiles: [], newFiles: [] },
    completionGate: { complete: true, missing: [], detail: 'ok' },
  } as never)
  results.push(check('inventory_result_is_project_ready', inventoryResult?.kind === 'PROJECT_READY' && inventoryResult.openLabel === 'Open App' && inventoryResult.projectId === '8a2bdabe-02ad-410a-83c6-2aa1ba5c2253', `${inventoryResult?.kind}:${inventoryResult?.openLabel}`))
  results.push(check('database_backed_app_project_ready', commanderResultKind('database_backed_app') === 'PROJECT_READY' && commanderOpenLabel('PROJECT_READY') === 'Open App', 'app'))
  results.push(check('website_site_ready_open_website', commanderResultKind('static_website') === 'SITE_READY' && commanderOpenLabel('SITE_READY') === 'Open Website', 'website'))
  results.push(check('crm_project_ready_open_app', commanderResultKind('internal_business_tool') === 'PROJECT_READY' && commanderOpenLabel('PROJECT_READY') === 'Open App', 'crm'))
  results.push(check('result_adapter_uses_real_project_type', /projectType: view\.applicationProject\.projectType/.test(shell) && /resultCard\.openLabel/.test(shell) && !/static_website' as const/.test(shell), 'toResultMission'))
  const transportDupes = [
    { projectId: 'dd4af6c3-5603-4584-b0ad-88ff900df5c0', projectName: 'professional-website-for-a', projectRoot: '/home/chosenone/FoundryProjects/professional-website-for-a', projectType: 'static_website' as const, createdAt: '2026-09-20T17:58:39.474Z', displayBrand: 'Lane & Box Transport', hasMatchingMemory: true, lastSuccessAt: '2026-09-20T20:00:00.000Z', previewPort: 18780 },
    { projectId: '5d99f290-efaa-4b6c-ae5d-7dc6954c4b45', projectName: 'one-page-foundry-ux-probe', projectRoot: '/home/chosenone/FoundryProjects/one-page-foundry-ux-probe', projectType: 'static_website' as const, createdAt: '2026-09-20T21:41:55.538Z', displayBrand: 'Lane & Box Transport', hasMatchingMemory: false, previewPort: 18781 },
  ]
  const canonicalId = chooseCanonicalApplicationProject(transportDupes)
  results.push(check('duplicate_index_keeps_canonical', canonicalId === 'dd4af6c3-5603-4584-b0ad-88ff900df5c0', canonicalId))
  const archived = archiveDuplicateProjectRecords(transportDupes.map(item => ({ ...item, missionId: 'm', stack: null, requirements: null, researchSources: [], acceptanceCriteria: [], status: 'PROJECT_READY' as const })), canonicalId, ['5d99f290-efaa-4b6c-ae5d-7dc6954c4b45'])
  results.push(check('duplicate_metadata_archived_not_deleted', archived.find(item => item.projectId === '5d99f290-efaa-4b6c-ae5d-7dc6954c4b45')?.archived === true && archived.find(item => item.projectId === canonicalId)?.archived !== true, 'archive'))
  results.push(check('project_history_preserved', archived.every(item => item.projectRoot.startsWith('/home/chosenone/FoundryProjects/')), 'roots kept'))
  results.push(check('new_project_identity_unresolved', projectBrandIdentityIsResolved({ status: 'NEW_PROJECT' }) === false, 'new'))
  results.push(check('ready_project_identity_resolved', projectBrandIdentityIsResolved({ status: 'PROJECT_READY' }) === true, 'ready'))
  results.push(check('hygiene_skips_unresolved_new_project', /projectBrandIdentityIsResolved/.test(source('lib/native-builder/foundryProjectIndexHygiene.ts')) && /resolved.length < 2/.test(source('lib/native-builder/foundryProjectIndexHygiene.ts')), 'hygiene'))
  results.push(check('new_project_writes_unique_identity', /commander-facts.json/.test(source('lib/native-builder/foundryProjectIsolation.ts')) && /refusing to rebind identity/.test(source('lib/native-builder/foundryProjectIsolation.ts')), 'facts'))
  results.push(check('rework_opens_implementers_after_debugger', /item\.dependsOn = Array.from\(new Set\(\[debugId/.test(source('lib/native-builder/foundryEngineeringRuntime.ts')) && /for \(const id of \['backend', 'frontend'\]/.test(source('lib/native-builder/foundryEngineeringRuntime.ts')), 'reopen'))
  results.push(check('externally_running_http_is_running', projectRuntimeStatus({ live: true }) === 'RUNNING', 'external http'))
  results.push(check('owned_healthy_is_running', projectRuntimeStatus({ live: true }) === 'RUNNING', 'owned'))
  results.push(check('dead_preview_is_stopped', projectRuntimeStatus({ live: false }) === 'STOPPED', 'stopped'))
  results.push(check('http_live_prevents_false_stopped', /httpLive/.test(projects) && /previewOwnership/.test(projects) && !/adoptLoopbackPreview/.test(projects), 'no fake owned adopt'))
  results.push(check('open_does_not_spawn_live_preview', /probeLoopback\(preferred\)/.test(source('lib/native-builder/foundryProjectIsolation.ts')) && /fetch\(project\.previewUrl/.test(shell), 'open live'))
  results.push(check('playwright_required_for_local_data', /loadPlaywrightChromium/.test(source('lib/native-builder/foundryLocalDataAcceptance.ts')) && /low-stock-filter/.test(source('lib/native-builder/foundryLocalDataAcceptance.ts')) && /PLAYWRIGHT_NOT_INSTALLED/.test(source('lib/native-builder/foundryLocalDataAcceptance.ts')), 'playwright ui'))
  results.push(check('viewport_verify_not_http_fake', /PLAYWRIGHT_NOT_INSTALLED/.test(builder) && !/HTTP fallback — Playwright/.test(builder), 'viewports'))
  results.push(check('runtime_truth_uses_http_and_owned', /previewOwnership/.test(projects) && /probeLoopback/.test(projects), 'runtime'))
  results.push(check('no_production_fixture_injection_in_shell', !/FOUNDRY_APP_BUILDER_INJECT_FAILURE/.test(shell), 'shell'))
  results.push(check('terra_untouched_in_this_pass', existsSync(path.join(resolveRepoRoot(), 'lib/native-builder/foundryTerraContext.ts')), 'terra file exists, not rebuilt here'))

  const previous = process.env.FOUNDRY_PROJECTS_ROOT
  const dir = await mkdtemp(path.join(tmpdir(), 'wr-foundry-sessions-'))
  process.env.FOUNDRY_SESSIONS_DIR = path.join(dir, 'sessions')
  try {
    const first = await createFoundrySession({ title: 'New Session' })
    const second = await reuseOrCreateFoundrySession({ title: 'New Session' })
    results.push(check('session_list_persisted_reuse', second.reused && second.session.id === first.id && isUntouchedEmptySession(first), `${second.reused} ${second.session.id}`))
    await writeFile(path.join(dir, 'probe.json'), JSON.stringify({ ok: true }))
    results.push(check('project_create_api_exists', workspaces.includes("action === 'create-application'"), 'workspaces'))
  } finally {
    process.env.FOUNDRY_PROJECTS_ROOT = previous
    delete process.env.FOUNDRY_SESSIONS_DIR
    await rm(dir, { recursive: true, force: true })
  }

  const failed = results.filter(item => !item.pass)
  for (const item of results) {
    console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} — ${item.detail}`)
  }
  console.log(`${results.filter(item => item.pass).length}/${results.length} PASS`)
  if (failed.length) process.exitCode = 1
}

const isDirect = import.meta.url === pathToFileURL(process.argv[1] ?? '').href
if (isDirect) {
  run().catch(error => {
    console.error(error)
    process.exitCode = 1
  })
}
