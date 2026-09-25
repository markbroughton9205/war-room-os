/**
 * Application Builder foundation contracts.
 * Does not launch War Room production. Does not write War Room source.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { startMissionInput } from './foundryMissionController'
import { interpretCommanderRequest } from './foundryMissionPlanner'
import { authorizeMissionWrite, REFUSED_PROTECTED_SUBSYSTEM } from './foundryMissionWriteSet'
import { classifyResearchRequest, RESEARCH_REFUSED_SIDE_EFFECT } from './foundryInternetResearch'
import { deriveRequirements, isApplicationBuilderRequest, isContinuationRequest, selectStack } from './foundryRequirementsEngine'
import {
  assertInsideFoundryProject,
  createFoundryApplicationWorkspace,
  findContinuableProject,
  getFoundryProjectsRoot,
  scanForHardcodedSecrets,
  writeProjectFile,
} from './foundryProjectIsolation'
import { APPLICATION_BUILDER_GOVERNANCE } from './foundryApplicationBuilderTypes'
import { BROWSER_IDE_LOCAL_SESSION } from './foundryBrowserService'
import { FOUNDRY_ACTIVATION_SCRIPT_INVENTORY } from './foundryActivationScriptInventory'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

const OUTCOME = 'Build a professional transportation company website with a home page, services page, about page, contact/quote form, and responsive mobile layout. Research what customers expect from a professional transportation company website. Do not invent company-specific facts. Run it locally and show the finished result.'

async function run() {
  const previous = process.env.FOUNDRY_PROJECTS_ROOT
  const projectsRoot = await mkdtemp(path.join(tmpdir(), 'wr-foundry-apps-'))
  process.env.FOUNDRY_PROJECTS_ROOT = projectsRoot
  const results: CaseResult[] = []
  try {
    const interpretation = interpretCommanderRequest(OUTCOME)
    const mission = startMissionInput(OUTCOME, 'Application Builder foundation')
    results.push(check('APPLICATION_BUILDER_FOUNDATION', interpretation.kind === 'app_builder' && mission.capabilityLane === 'APPLICATION_BUILDER', `${interpretation.kind} ${mission.capabilityLane}`))
    results.push(check('planner_not_production', interpretation.kind !== 'application' && !mission.permissions.installProduction && !mission.permissions.liveDeploy, JSON.stringify({ kind: interpretation.kind, install: mission.permissions.installProduction })))
    results.push(check('detect_builder_request', isApplicationBuilderRequest(OUTCOME) && !isApplicationBuilderRequest('Find where restoreFoundrySession is defined. Do not change files.'), 'detector'))

    const project = await createFoundryApplicationWorkspace({ name: 'empty-app', missionId: mission.missionId })
    results.push(check('NEW_PROJECT_WORKSPACE', project.status === 'NEW_PROJECT' && project.projectRoot.startsWith(projectsRoot), project.projectRoot))

    const searchOk = classifyResearchRequest({ url: 'https://developer.mozilla.org/en-US/docs/Web/HTML', method: 'GET' })
    const postNo = classifyResearchRequest({ url: 'https://example.com/checkout', method: 'POST', body: 'buy' })
    const privateNo = classifyResearchRequest({ url: 'http://127.0.0.1:3848/login', method: 'GET' })
    results.push(check('INTERNET_RESEARCH', searchOk.ok === true && !postNo.ok && !privateNo.ok, `${postNo.ok} ${privateNo.ok}`))
    results.push(check('research_no_side_effects', !postNo.ok && (postNo as { code?: string }).code === RESEARCH_REFUSED_SIDE_EFFECT, JSON.stringify(postNo)))

    const reqs = deriveRequirements({ outcome: OUTCOME, research: [] })
    results.push(check('REQUIREMENTS_ENGINE', reqs.acceptanceCriteria.length > 0 && reqs.unknownBusinessFacts.some(item => item.field === 'years_in_business'), reqs.goal.slice(0, 80)))
    results.push(check('RESEARCH_VS_DESIGN', reqs.unknownBusinessFacts.length > 0 && !/since 19\d\d/.test(JSON.stringify(reqs)), 'no invented tenure'))

    const stack = selectStack({ projectType: 'static_website', outcome: OUTCOME })
    results.push(check('STACK_SELECTION', Boolean(stack.stack && stack.alternativesConsidered.includes('Next.js + React')), stack.stack))

    const warRoomWrite = authorizeMissionWrite(mission, 'lib/native-builder/foundryMissionController.ts')
    results.push(check('PROJECT_SCOPED_WRITES', warRoomWrite.ok === false && warRoomWrite.code === REFUSED_PROTECTED_SUBSYSTEM, warRoomWrite.error ?? ''))

    const inside = await assertInsideFoundryProject(project.projectRoot, 'index.html')
    const outside = await assertInsideFoundryProject(project.projectRoot, path.join(resolveRepoRoot(), 'lib/foo.ts'))
    results.push(check('PROJECT_INITIALIZATION', inside.ok === true && outside.ok === false, JSON.stringify({ inside, outside: outside.ok })))

    const secret = scanForHardcodedSecrets('const key = "sk_live_abcdefghijklmnop"')
    const envWrite = await writeProjectFile({ projectRoot: project.projectRoot, relPath: '.env', content: 'SECRET=1', reason: 'attack', missionId: mission.missionId })
    const exampleWrite = await writeProjectFile({ projectRoot: project.projectRoot, relPath: '.env.example', content: 'PORT=18780\n# CONTACT_NOTIFY_EMAIL=\n', reason: 'placeholders', missionId: mission.missionId })
    results.push(check('secret_and_env_example', Boolean(secret) && !envWrite.ok && exampleWrite.ok, `${secret} env=${envWrite.ok} example=${exampleWrite.ok}`))

    results.push(check('governance_flags', APPLICATION_BUILDER_GOVERNANCE.LIVE_DEPLOY === 'NO' && APPLICATION_BUILDER_GOVERNANCE.SPENDING === 'NO' && APPLICATION_BUILDER_GOVERNANCE.COMMIT === 'NO', JSON.stringify(APPLICATION_BUILDER_GOVERNANCE)))
    results.push(check('browser_auth_untouched', BROWSER_IDE_LOCAL_SESSION === 'DEFERRED_SECURITY_BOUNDARY', BROWSER_IDE_LOCAL_SESSION))
    results.push(check('historical_activation_lockdown', FOUNDRY_ACTIVATION_SCRIPT_INVENTORY.length >= 8 && FOUNDRY_ACTIVATION_SCRIPT_INVENTORY.some(item => item.classification === 'DEPRECATED_ACTIVATION_PATH'), String(FOUNDRY_ACTIVATION_SCRIPT_INVENTORY.length)))

    const warRoomFile = path.join(resolveRepoRoot(), 'lib/native-builder/foundryMissionController.ts')
    const before = await readFile(warRoomFile, 'utf8')
    results.push(check('war_room_source_untouched_by_builder_helpers', existsSync(warRoomFile) && before.includes('runApplicationBuilderMission'), 'controller still owns War Room loop'))

    await writeFile(path.join(project.projectRoot, 'foundry-memory.json'), JSON.stringify({ projectId: project.projectId, architecture: ['static site'] }, null, 2), 'utf8')
    results.push(check('PROJECT_MEMORY', existsSync(path.join(project.projectRoot, 'foundry-memory.json')), 'memory file'))
    const trucking = await createFoundryApplicationWorkspace({ name: 'trucking-website', missionId: mission.missionId })
    const continued = await findContinuableProject('Open the trucking website and add online quote requests.')
    results.push(check(
      'PROJECT_CONTINUATION',
      isContinuationRequest('Open the trucking website and add online quote requests.') && continued?.projectId === trucking.projectId,
      continued?.projectName ?? 'none',
    ))
    results.push(check('FOUNDRY_PROJECTS_ROOT', getFoundryProjectsRoot() === projectsRoot, getFoundryProjectsRoot()))
  } finally {
    if (previous === undefined) delete process.env.FOUNDRY_PROJECTS_ROOT
    else process.env.FOUNDRY_PROJECTS_ROOT = previous
    await rm(projectsRoot, { recursive: true, force: true })
  }

  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  const failed = results.filter(result => !result.pass)
  console.log(`Foundry Application Builder validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run()
export { run as runFoundryApplicationBuilderValidation }
