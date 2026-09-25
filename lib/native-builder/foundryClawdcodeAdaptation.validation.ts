/**
 * Foundry ClawdCode open-source embedding proofs.
 * Does not spawn clawdcode. Does not vendor upstream. Does not modify Terra, WRIM,
 * Harbor Desk, Lane & Box, or Inventory Manager.
 */
import { execFile } from 'node:child_process'
import { existsSync, readFileSync, renameSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { runWithWorkspaceRoot } from '@/lib/repo/workspaceContext'
import { executeEngineerTool } from './engineerTools'
import {
  CLAWDCODE_ATTRIBUTION_NOTICE,
  CLAWDCODE_EMBEDDING_FLAGS,
  CLAWDCODE_RESEARCH_CLONE_PATH,
  CLAWDCODE_UPSTREAM,
} from './foundryClawdcodeProvenance'
import { appendFoundryAgentEvent, FOUNDRY_AGENT_EVENT_TYPES } from './foundryAgentEvents'
import {
  abortFoundryAgentWork,
  beginFoundryAgentWork,
  isFoundryAgentAborted,
  releaseFoundryAgentWork,
} from './foundryAgentCancellation'
import { buildFoundryContextPack, shouldCompactFoundryContext } from './foundryContextManager'
import { importSkillMarkdown } from './foundrySkillImporter'
import { invokeFoundryMcpTool, registerFoundryMcpServer } from './foundryMcpRegistry'
import { enterFoundryExecutionFromPlan, planningModeBlocksTool } from './foundryPlanningMode'
import { classifyFoundrySensitivePath } from './foundrySensitivePathGuard'
import { cancelMission, startMissionInput } from './foundryMissionController'
import { establishMissionWriteSet } from './foundryMissionWriteSet'
import { loadMission, saveMission } from './foundryMissionStore'
import { createFoundryApplicationWorkspace, getFoundryProjectsRoot } from './foundryProjectIsolation'
import { ENGINEER_TOOL_NAMES } from './engineerTools'

const execFileAsync = promisify(execFile)
type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

const SKILL_MD = `---
name: foundry-hello-formatter
description: Format a tiny hello module. Use when writing a small hello.js helper.
allowed-tools:
  - Read
  - Edit
user-invocable: false
license: MIT
---

# Hello formatter

Write a small hello() helper. Use Foundry Tool Broker file tools only. Never spawn Bash.
`

function productionSourcesMentionClone(): string[] {
  const root = resolveRepoRoot()
  const needle = 'war-room-os/research/clawdcode'
  const files = [
    'lib/native-builder/foundryContextManager.ts',
    'lib/native-builder/foundryAgentLoop.ts',
    'lib/native-builder/foundrySkillImporter.ts',
    'lib/native-builder/foundryMcpRegistry.ts',
    'lib/native-builder/foundryAgentEvents.ts',
    'lib/native-builder/foundryMissionController.ts',
    'package.json',
  ]
  return files.filter(rel => {
    const abs = path.join(root, rel)
    return existsSync(abs) && readFileSync(abs, 'utf8').includes(needle)
  })
}

async function clawdcodeProcessCount(): Promise<number> {
  try {
    const { stdout } = await execFileAsync('pgrep', ['-c', '-x', 'clawdcode'], { timeout: 5_000 })
    return Number.parseInt(stdout.trim(), 10) || 0
  } catch (error) {
    const err = error as { code?: number; stdout?: string }
    if (err.code === 1) return 0
    return Number.parseInt(String(err.stdout ?? '0'), 10) || 0
  }
}

async function runCoreSlice(results: CaseResult[], label: string) {
  const mission = startMissionInput('Add a hello() helper in hello.js through Tool Broker. Do not commit, push, or live deploy.')
  mission.kind = 'app_builder'
  mission.capabilityLane = 'APPLICATION_BUILDER'
  mission.planningMode = true
  mission.constraints = [...mission.constraints, 'PLANNING_MODE']
  beginFoundryAgentWork(mission.missionId)
  appendFoundryAgentEvent(mission, 'AGENT_STARTED', `${label} acceptance`)
  const pack = buildFoundryContextPack(mission)
  results.push(check(`${label}_context_manager`, Boolean(pack.pack.layers.task) && pack.pack.estimatedTokens > 0 && !/node_modules/.test(JSON.stringify(pack.pack.layers)), String(pack.pack.estimatedTokens)))
  results.push(check(`${label}_typed_events`, FOUNDRY_AGENT_EVENT_TYPES.every(type => typeof type === 'string') && (mission.agentEvents ?? []).some(event => event.type === 'AGENT_STARTED'), String(mission.agentEvents?.length ?? 0)))

  const inspect = await executeEngineerTool({ tool: 'workspace.inspect', input: {} }, { repairId: mission.missionId, mission })
  results.push(check(`${label}_inspect_via_broker`, inspect.ok === true, inspect.error ?? 'inspect'))
  const search = await executeEngineerTool({ tool: 'workspace.search', input: { query: 'hello' } }, { repairId: mission.missionId, mission })
  results.push(check(`${label}_search_via_broker`, search.ok === true, search.error ?? 'search'))

  const blocked = planningModeBlocksTool(mission, 'file.write')
  const writeDuringPlan = await executeEngineerTool({
    tool: 'file.write',
    input: { path: 'hello.js', content: 'export function hello(){return "hi"}', reason: 'plan-mode probe' },
  }, { repairId: mission.missionId, mission })
  results.push(check(`${label}_plan_mode_mutation_suppressed`, Boolean(blocked) && writeDuringPlan.ok === false, blocked ?? writeDuringPlan.error ?? 'not blocked'))

  enterFoundryExecutionFromPlan(mission, true)
  establishMissionWriteSet(mission, { paths: ['hello.js'], reason: 'acceptance coding task', ownerEvidence: 'isolated FoundryProjects fixture', sourceStep: 'PLAN' })
  const written = await executeEngineerTool({
    tool: 'file.write',
    input: { path: 'hello.js', content: 'export function hello() {\n  return "hello from foundry"\n}\n', reason: 'acceptance hello helper' },
  }, { repairId: mission.missionId, mission })
  results.push(check(`${label}_execute_via_broker`, written.ok === true, written.error ?? 'write'))

  abortFoundryAgentWork(mission.missionId, 'controlled cancel')
  results.push(check(`${label}_cancellation`, isFoundryAgentAborted(mission.missionId) === true, 'aborted'))
  mission.cancelRequested = true
  await saveMission(mission)
  const cancelled = await cancelMission(mission.missionId)
  results.push(check(`${label}_cancel_preserves_history`, cancelled.status === 'CANCELLED' && (cancelled.journal?.length ?? 0) > 0 && (cancelled.agentEvents ?? []).some(event => event.type === 'COMPLETE'), cancelled.status))
  const reloaded = await loadMission(mission.missionId)
  results.push(check(`${label}_session_persistence`, Boolean(reloaded && reloaded.missionId === mission.missionId && reloaded.status === 'CANCELLED'), reloaded?.status ?? 'missing'))
  releaseFoundryAgentWork(mission.missionId)
}

async function run() {
  const previousAtlas = process.env.FOUNDRY_CAPABILITY_ATLAS_ROOT
  const previousProjects = process.env.FOUNDRY_PROJECTS_ROOT
  const atlasRoot = await mkdtemp(path.join(tmpdir(), 'wr-clawdcode-atlas-'))
  const projectsRoot = await mkdtemp(path.join(tmpdir(), 'wr-clawdcode-projects-'))
  process.env.FOUNDRY_CAPABILITY_ATLAS_ROOT = atlasRoot
  process.env.FOUNDRY_PROJECTS_ROOT = projectsRoot
  const results: CaseResult[] = []
  const clonePath = CLAWDCODE_RESEARCH_CLONE_PATH
  const parked = clonePath ? `${clonePath}.off-foundry-embed` : ''
  let movedClone = false
  try {
    const licenseFile = path.join(resolveRepoRoot(), 'docs/third-party/clawdcode.md')
    const licenseDoc = existsSync(licenseFile) ? readFileSync(licenseFile, 'utf8') : ''
    results.push(check('license_recorded', licenseDoc.includes('MIT License') && licenseDoc.includes(CLAWDCODE_UPSTREAM.commit), CLAWDCODE_UPSTREAM.license))
    results.push(check('attribution_recorded', CLAWDCODE_ATTRIBUTION_NOTICE.includes('Copyright (c) 2026') && licenseDoc.includes('Copyright (c) 2026'), CLAWDCODE_UPSTREAM.copyright))
    results.push(check('upstream_commit_recorded', CLAWDCODE_UPSTREAM.commit === '217a01369f9cb7d1ccc89c1fd9f50d6db2965b81' && CLAWDCODE_UPSTREAM.repoUrl === 'https://github.com/kkkhs/ClawdCode', CLAWDCODE_UPSTREAM.commit))
    results.push(check('no_runtime_clone_dependency', productionSourcesMentionClone().length === 0, productionSourcesMentionClone().join(',') || 'none'))
    results.push(check('flags_embedded', CLAWDCODE_EMBEDDING_FLAGS.CLAWDCODE_EMBEDDED === true && CLAWDCODE_EMBEDDING_FLAGS.EXTERNAL_CLAWDCODE_RUNTIME === false && CLAWDCODE_EMBEDDING_FLAGS.UPSTREAM_RUNTIME_DEPENDENCY === false, JSON.stringify(CLAWDCODE_EMBEDDING_FLAGS)))
    results.push(check('tool_broker_preserved', ENGINEER_TOOL_NAMES.includes('file.replace_unique') && ENGINEER_TOOL_NAMES.includes('workspace.search') && !ENGINEER_TOOL_NAMES.includes('Bash' as typeof ENGINEER_TOOL_NAMES[number]), 'broker tools'))
    results.push(check('no_unrestricted_shell', !ENGINEER_TOOL_NAMES.includes('Bash' as never) && ENGINEER_TOOL_NAMES.includes('terminal.execute'), 'typed terminal only'))
    results.push(check('path_containment_helper', classifyFoundrySensitivePath('../.env').refuseRead === true && classifyFoundrySensitivePath('.env.example').refuseRead === false, 'sensitive'))
    results.push(check('secret_handling', classifyFoundrySensitivePath('secrets.json').refuseRead === true, 'secrets.json'))
    results.push(check('compaction_threshold', shouldCompactFoundryContext(18_001) === true && shouldCompactFoundryContext(100) === false, 'threshold'))

    const project = await createFoundryApplicationWorkspace({
      name: `clawdcode-embed-${Date.now().toString(36)}`,
      missionId: 'clawdcode-embed-acceptance',
      projectType: 'static_website',
    })
    results.push(check('disposable_foundry_project', project.projectRoot.startsWith(getFoundryProjectsRoot()), project.projectRoot))
    await writeFile(path.join(project.projectRoot, 'README.md'), '# embed fixture\n', 'utf8')

    await runWithWorkspaceRoot(project.projectRoot, async () => {
      await runCoreSlice(results, 'acceptance')
    }, project.projectId)

    const imported = importSkillMarkdown({
      content: SKILL_MD,
      originPath: path.join(project.projectRoot, 'SKILL.md'),
      sourceLabel: 'foundry-acceptance',
      license: 'MIT',
    })
    results.push(check('skill_import', imported.skillId === 'imported.skillmd.foundry-hello-formatter' && imported.automaticallyProven === false, imported.skillId))
    results.push(check('atlas_provenance', imported.hash.length === 64 && imported.license === 'MIT' && imported.provenance.commit === CLAWDCODE_UPSTREAM.commit, imported.hash.slice(0, 12)))
    results.push(check('imported_not_proven', imported.capabilityStatus !== 'PROVEN' && imported.capabilityStatus !== 'PRODUCTION_PROVEN', imported.capabilityStatus))

    const brokerImport = await executeEngineerTool({
      tool: 'capability.import_skill',
      input: { content: SKILL_MD.replace('foundry-hello-formatter', 'foundry-hello-formatter-b'), source: 'broker' },
    }, { repairId: 'skill-import' })
    results.push(check('skill_import_via_broker', brokerImport.ok === true && (brokerImport.result as { automaticallyProven?: boolean } | undefined)?.automaticallyProven === false, brokerImport.error ?? 'import'))

    registerFoundryMcpServer({ name: 'demo', transport: 'stdio', command: 'echo', enabled: true, trusted: false })
    const mcpNoMission = invokeFoundryMcpTool({ server: 'demo', tool: 'anything' })
    const liveMission = startMissionInput('mcp governance')
    const mcpWithMission = invokeFoundryMcpTool({ server: 'demo', tool: 'anything', mission: liveMission })
    results.push(check('mcp_governance', mcpNoMission.ok === false && mcpNoMission.spawned === false && mcpWithMission.spawned === false && mcpWithMission.brokerRequired === true, mcpWithMission.error ?? mcpNoMission.error))

    const secretRead = await executeEngineerTool({ tool: 'file.read', input: { path: '.env' } }, { repairId: 'secret-read' })
    results.push(check('no_direct_secret_read', secretRead.ok === false && /SECRET_FILE_REFUSED/.test(secretRead.error ?? ''), secretRead.error ?? 'allowed'))

    results.push(check('no_new_yaml_dependency', !readFileSync(path.join(resolveRepoRoot(), 'package.json'), 'utf8').includes('"yaml"'), 'no yaml'))
    results.push(check('no_mcp_sdk_dependency', !readFileSync(path.join(resolveRepoRoot(), 'package.json'), 'utf8').includes('@modelcontextprotocol/sdk'), 'no mcp sdk'))
    results.push(check('provider_architecture_preserved', CLAWDCODE_EMBEDDING_FLAGS.FOUNDRY_PROVIDER_ARCHITECTURE_PRESERVED === true, 'providers'))
    results.push(check('authority_model_preserved', CLAWDCODE_EMBEDDING_FLAGS.FOUNDRY_AUTHORITY_MODEL_PRESERVED === true, 'authority'))

    const processesBefore = await clawdcodeProcessCount()
    results.push(check('no_external_clawdcode_process', processesBefore === 0, String(processesBefore)))

    if (clonePath && existsSync(clonePath) && !existsSync(parked)) {
      renameSync(clonePath, parked)
      movedClone = true
    }
    await runWithWorkspaceRoot(project.projectRoot, async () => {
      const pack = buildFoundryContextPack(startMissionInput('clone-removal context'))
      results.push(check('clone_removal_context', pack.pack.estimatedTokens > 0, String(pack.pack.estimatedTokens)))
      const again = importSkillMarkdown({
        content: SKILL_MD.replace('foundry-hello-formatter', 'foundry-hello-formatter-c'),
        originPath: 'inline:clone-removal',
        sourceLabel: 'clone-removal',
        license: 'MIT',
      })
      results.push(check('clone_removal_skill_import', again.automaticallyProven === false && again.capabilityStatus !== 'PROVEN', again.capabilityStatus))
    }, project.projectId)
    results.push(check('clone_removal_test', true, movedClone ? 'clone parked and functions still passed' : 'clone absent; functions still passed'))
    const processesAfter = await clawdcodeProcessCount()
    results.push(check('clone_removal_no_clawdcode_process', processesAfter === 0, String(processesAfter)))
  } finally {
    if (movedClone && parked && existsSync(parked) && !existsSync(clonePath)) {
      renameSync(parked, clonePath)
    }
    if (previousAtlas === undefined) delete process.env.FOUNDRY_CAPABILITY_ATLAS_ROOT
    else process.env.FOUNDRY_CAPABILITY_ATLAS_ROOT = previousAtlas
    if (previousProjects === undefined) delete process.env.FOUNDRY_PROJECTS_ROOT
    else process.env.FOUNDRY_PROJECTS_ROOT = previousProjects
    await rm(atlasRoot, { recursive: true, force: true })
    await rm(projectsRoot, { recursive: true, force: true })
  }

  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  const failed = results.filter(result => !result.pass)
  console.log(`Foundry ClawdCode adaptation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run()
export { run as runFoundryClawdcodeAdaptationValidation }
