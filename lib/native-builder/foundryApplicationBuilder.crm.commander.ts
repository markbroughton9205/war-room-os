/**
 * Persistent Commander Application Builder run — second real app (local CRM).
 * Uses ~/FoundryProjects. Does not reuse or delete the transportation website.
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { startMission, runModelMission } from './foundryMissionController'
import { executeFoundryBrowserTool } from './foundryBrowserService'
import { getFoundryProjectsRoot, listProjectFiles } from './foundryProjectIsolation'
import { findLiveProjectPreview } from './foundryProjectProcessRegistry'
import { discoverResearchProviders } from './foundryInternetResearch'
import { releaseMissionWrapperResources } from './foundryApplicationBuilderLifecycle'
import { CRM_BRAND } from './foundryCrmFactory'

const OUTCOME = 'Build me a small business lead and customer CRM. I want to be able to add leads, store contact information, track company/business name, track what service they are interested in, give each lead a status, add notes, search leads, filter by status, edit a lead, convert a lead into a customer, see basic dashboard counts, and keep the data after the app restarts. Research what a simple small-business CRM normally needs. Keep it local. Do not deploy it.'
const CONTINUATION = 'Open the CRM and add a task/follow-up date to leads so I can see who needs a follow-up.'

async function run() {
  process.env.FOUNDRY_APP_BUILDER_INJECT_FAILURE = process.env.FOUNDRY_APP_BUILDER_INJECT_FAILURE ?? '1'
  const providers = discoverResearchProviders()
  const projectsRoot = getFoundryProjectsRoot()
  if (projectsRoot.startsWith('/tmp') || /\/tmp\//.test(projectsRoot) || projectsRoot.includes(os.tmpdir())) {
    throw new Error(`Refusing disposable root ${projectsRoot}`)
  }
  const home = os.homedir()
  if (projectsRoot !== path.join(home, 'FoundryProjects') && !process.env.FOUNDRY_PROJECTS_ROOT?.trim()) {
    throw new Error(`Unexpected projects root ${projectsRoot}`)
  }

  const firstStart = await startMission(OUTCOME, 'Harbor Desk CRM')
  firstStart.testArtifact = false
  firstStart.visibility = 'commander'
  firstStart.classification = 'COMMANDER_REAL'
  const first = await runModelMission(firstStart.missionId)
  const firstBuilder = first.applicationBuilder
  const root = firstBuilder?.project?.projectRoot ?? ''
  const firstId = firstBuilder?.project?.projectId ?? ''

  await executeFoundryBrowserTool('browser.stop', {}, { repairId: first.missionId }).catch(() => undefined)
  await releaseMissionWrapperResources({
    missionId: first.missionId,
    retainPreview: true,
    previewRecordId: firstBuilder?.evidence.previewRecordId as string | undefined,
    closeResearchTransportIfIdle: true,
  })

  const secondStart = await startMission(CONTINUATION, 'Harbor Desk follow-up date')
  secondStart.testArtifact = false
  secondStart.visibility = 'commander'
  const second = await runModelMission(secondStart.missionId)
  const secondBuilder = second.applicationBuilder
  await releaseMissionWrapperResources({
    missionId: second.missionId,
    retainPreview: true,
    previewRecordId: secondBuilder?.evidence.previewRecordId as string | undefined,
    closeResearchTransportIfIdle: true,
  })

  const files = root && existsSync(root) ? await listProjectFiles(root) : []
  const dbFile = path.join(root, 'data', 'crm.sqlite')
  const serverSrc = root && existsSync(path.join(root, 'server.mjs')) ? await readFile(path.join(root, 'server.mjs'), 'utf8') : ''
  const dbSrc = root && existsSync(path.join(root, 'db.mjs')) ? await readFile(path.join(root, 'db.mjs'), 'utf8') : ''
  const appJs = root && existsSync(path.join(root, 'public', 'app.js')) ? await readFile(path.join(root, 'public', 'app.js'), 'utf8') : ''
  const indexHtml = root && existsSync(path.join(root, 'public', 'index.html')) ? await readFile(path.join(root, 'public', 'index.html'), 'utf8') : ''
  const warRoom = await readFile(path.join(resolveRepoRoot(), 'lib/native-builder/foundryMissionController.ts'), 'utf8')
  const live = root ? await findLiveProjectPreview({ projectId: firstId, projectRoot: root }) : null
  const transportRoot = path.join(projectsRoot, 'professional-website-for-a')
  const blob = [indexHtml, appJs, serverSrc].join('\n')

  const report = {
    projectId: firstId,
    persistentProjectRoot: root,
    commanderOutcome: OUTCOME,
    availableResearchProviders: providers.available,
    configuredResearchProviders: providers.configured,
    selectedResearchProvider: firstBuilder?.selectedResearchProvider ?? firstBuilder?.researchProviders?.selected,
    fallbackProvider: providers.fallback,
    searchQueries: firstBuilder?.researchQueries,
    sourcesUsed: firstBuilder?.research.filter(item => item.source.startsWith('http')).map(item => ({
      source: item.source,
      title: item.title,
      kind: item.kind,
      query: item.query,
      retrievedAt: item.retrievedAt,
    })),
    factFindings: firstBuilder?.research.filter(item => item.kind === 'RESEARCHED_FACT' && item.source.startsWith('http')).map(item => item.claim.slice(0, 180)),
    observationFindings: firstBuilder?.research.filter(item => item.kind === 'OBSERVATION').map(item => item.claim.slice(0, 180)),
    designDecisions: first.journal.filter(item => /DESIGN:/.test(item.text)).map(item => item.text),
    factsAwaitingCommander: firstBuilder?.requirements?.unknownBusinessFacts,
    requirements: firstBuilder?.requirements,
    selectedStack: firstBuilder?.stack?.stack,
    alternativesConsidered: firstBuilder?.stack?.alternativesConsidered,
    database: 'node:sqlite file data/crm.sqlite',
    filesCreated: files,
    dependencies: 'none (Node stdlib + node:sqlite)',
    controlledFailure: firstBuilder?.evidence.controlledFailure ?? null,
    failureClassification: firstBuilder?.repairs[0]?.failureClass ?? null,
    autonomousRepair: firstBuilder?.repairs[0] ?? null,
    tests: first.testState,
    runtime: first.runtimeState.detail,
    routesVerified: firstBuilder?.routesChecked,
    desktop: firstBuilder?.viewportResults.find(item => item.name === 'desktop'),
    tablet: firstBuilder?.viewportResults.find(item => item.name === 'tablet'),
    mobile: firstBuilder?.viewportResults.find(item => item.name === 'mobile'),
    evidence: firstBuilder?.evidence,
    continuationEvidence: secondBuilder?.evidence,
    continuation: {
      request: CONTINUATION,
      status: second.status,
      sameProjectId: secondBuilder?.project?.projectId === firstId,
      continuationOf: secondBuilder?.continuationOf,
      followUpPresent: /follow-up-date|follow_up_date/.test(dbSrc) && /follow-up-date/.test(indexHtml),
      reusedResearch: secondBuilder?.reusedResearch,
      refreshedResearch: secondBuilder?.refreshedResearch,
      preview: secondBuilder?.preview,
    },
    warRoomWriteAttempts: first.sourceState.changedFiles.filter(file => /^(lib|app|components)\//.test(file)),
    projectPreserved: existsSync(root) && existsSync(path.join(root, 'foundry-memory.json')) && existsSync(dbFile),
    transportProjectPreserved: existsSync(path.join(transportRoot, 'index.html')),
    previewUrl: secondBuilder?.preview?.localPreview ?? firstBuilder?.preview?.localPreview,
    previewPid: live?.pid ?? firstBuilder?.evidence.previewPid,
    deploymentReadiness: secondBuilder?.preview?.deploymentReadiness ?? firstBuilder?.preview?.deploymentReadiness,
    hostFsBypass: /rm -rf \//.test(warRoom),
    workingBrand: CRM_BRAND,
  }

  console.log(JSON.stringify(report, null, 2))

  const gates = [
    ['PERSISTENT_PROJECT', root.startsWith(projectsRoot) && !root.includes('/tmp/')],
    ['ISOLATED_PROJECT_ROOT', !root.includes(resolveRepoRoot())],
    ['NOT_TRANSPORT_PROJECT', !/professional-website-for-a|box-truck-transport/.test(root)],
    ['TRANSPORT_PRESERVED', report.transportProjectPreserved === true],
    ['REAL_PUBLIC_WEB_SEARCH', (firstBuilder?.research.filter(item => item.source.startsWith('https://')).length ?? 0) >= 5],
    ['FACT_VS_DESIGN', first.journal.some(item => item.text.startsWith('FACT:')) && first.journal.some(item => item.text.startsWith('DESIGN:'))],
    ['REQUIREMENTS_GENERATION', Boolean(firstBuilder?.requirements?.acceptanceCriteria.length)],
    ['STACK_SQLITE', /sqlite/i.test(firstBuilder?.stack?.stack ?? '')],
    ['REAL_BACKEND', files.includes('server.mjs') && files.includes('db.mjs') && /CREATE TABLE IF NOT EXISTS leads/.test(dbSrc)],
    ['REAL_DATABASE', existsSync(dbFile) && !/in-memory-only/.test(dbSrc)],
    ['PARAMETERIZED_SQL', /\.prepare\(/.test(dbSrc) && !/\+ req\.url/.test(serverSrc)],
    ['CONVERT_ROUTE', /CONVERT_TO_CUSTOMER/.test(serverSrc)],
    ['UI_NOT_FIXTURE', /crm-shell/.test(indexHtml) && !/\bPASS\b/.test(blob) && !/Foundry Demo/.test(blob)],
    ['CONTROLLED_FAILURE_RECOVERY', Boolean(firstBuilder?.evidence.controlledFailure) && (firstBuilder?.repairs.length ?? 0) > 0 && first.testState.ok === true],
    ['CREATE_LEAD', firstBuilder?.evidence.createLead === true],
    ['SEARCH_LEADS', firstBuilder?.evidence.search === true],
    ['FILTER_LEADS', firstBuilder?.evidence.filter === true],
    ['EDIT_LEAD', firstBuilder?.evidence.edit === true],
    ['NOTES', firstBuilder?.evidence.note === true],
    ['STATUS_CHANGE', firstBuilder?.evidence.status === true],
    ['CONVERT_TO_CUSTOMER', firstBuilder?.evidence.convert === true],
    ['DASHBOARD_COUNTS', firstBuilder?.evidence.dashboard === true],
    ['SERVER_RESTART_PERSISTENCE', firstBuilder?.evidence.restartPersistence === true],
    ['DESKTOP_VERIFY', firstBuilder?.viewportResults.some(item => item.name === 'desktop' && item.ok) === true],
    ['MOBILE_VERIFY', firstBuilder?.viewportResults.some(item => item.name === 'mobile' && item.ok) === true],
    ['PROJECT_READY', first.status === 'COMPLETE' && firstBuilder?.preview?.status === 'PROJECT_READY'],
    ['PROJECT_CONTINUATION', second.status === 'COMPLETE' && report.continuation.followUpPresent === true],
    ['SAME_PROJECT_ID', report.continuation.sameProjectId === true],
    ['PREVIOUS_DATA_PRESERVED', secondBuilder?.evidence.dataPreserved === true],
    ['FOLLOW_UP_FIELD', secondBuilder?.evidence.followUp === true],
    ['DIRECT_MODEL_HOST_FS_BYPASS', report.warRoomWriteAttempts.length === 0 && !report.hostFsBypass],
    ['UNAUTHORIZED_DEPLOY', /NOT AUTHORIZED/.test(report.deploymentReadiness ?? '')],
    ['PREVIEW_RETAINED', Boolean(live?.pid) && Boolean(report.previewUrl)],
  ] as const

  let failed = 0
  for (const [name, pass] of gates) {
    console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`)
    if (!pass) failed += 1
  }
  console.log(`Foundry second real application CRM: ${gates.length - failed}/${gates.length} PASS`)
  if (failed) process.exit(1)
  process.exit(0)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run()
export { run as runFoundryCrmCommander }
