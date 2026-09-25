/**
 * Source + disposable proofs for Foundry autonomous multi-agent command center.
 * Does not package, install, commit, push, deploy, or modify Harbor/Lane & Box/Inventory/Terra/WRIM.
 */
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { FOUNDRY_COMMAND_CENTER_GOVERNANCE, FOUNDRY_INSTRUCTION_PRECEDENCE, commandCenterBackgroundLabel } from './foundryAgentTypes'
import { FOUNDRY_ROLE_CATALOG, assignRepairRole, roleAllowsTool } from './foundryAgentRoles'
import { routeModelForRole } from './foundryAgentRouting'
import { composeInstructionContext, ensureFoundryInstructionsFile, loadProjectInstructionSources } from './foundryProjectInstructions'
import { computeMaxConcurrentAgents, measureFoundryResources, scheduleReadyTasks } from './foundryAgentScheduler'
import { createIsolatedWorkspace, writeWorkspaceFile } from './foundryAgentWorkspaces'
import { buildTaskGraph, ticketManagerGraphSeeds } from './foundryTaskGraph'
import { detectWorkspaceConflicts } from './foundryAgentConflicts'
import { loadSkillsForRole } from './foundryAgentSkills'
import {
  cancelCommandCenter,
  enqueueCommandCenterWork,
  executeCommandCenterGraph,
  guideCommandCenter,
  pauseCommandCenter,
  resumeCommandCenter,
  runDisposableCommandCenterAcceptance,
} from './foundryAgentCommandCenter'
import { loadCommandCenterGraph, recoverCommandCenterGraph, saveCommandCenterGraph, duplicateActiveAgentsPerTask } from './foundryAgentStore'
import { stopOwnedProcesses } from './terminalExecutor'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

function source(rel: string): string {
  return readFileSync(path.join(resolveRepoRoot(), rel), 'utf8')
}

async function run(): Promise<void> {
  const results: CaseResult[] = []
  const repo = resolveRepoRoot()
  const projectsRoot = mkdtempSync(path.join(tmpdir(), 'wr-cc-projects-'))
  const ccRoot = mkdtempSync(path.join(tmpdir(), 'wr-cc-store-'))
  const wsRoot = mkdtempSync(path.join(tmpdir(), 'wr-cc-ws-'))
  const previousProjects = process.env.FOUNDRY_PROJECTS_ROOT
  const previousCc = process.env.FOUNDRY_COMMAND_CENTER_ROOT
  const previousWs = process.env.FOUNDRY_AGENT_WORKSPACES_ROOT
  const previousContracts = process.env.FOUNDRY_CONTRACTS_ROOT
  process.env.FOUNDRY_PROJECTS_ROOT = projectsRoot
  process.env.FOUNDRY_COMMAND_CENTER_ROOT = ccRoot
  process.env.FOUNDRY_AGENT_WORKSPACES_ROOT = wsRoot
  process.env.FOUNDRY_CONTRACTS_ROOT = path.join(ccRoot, 'contracts')

  try {
    const center = source('lib/native-builder/foundryAgentCommandCenter.ts')
    const ui = source('components/war-room/foundry/FoundryAgentCommandCenter.tsx')
    const shell = source('components/war-room/foundry/FoundryShell.tsx')
    const api = source('app/api/foundry/command-center/route.ts')
    const types = source('lib/native-builder/foundryAgentTypes.ts')
    const factory = source('lib/native-builder/foundryTicketManagerFactory.ts')

    results.push(check(
      'task_queue_persistence',
      /saveCommandCenterGraph/.test(center) && /graphs/.test(source('lib/native-builder/foundryAgentStore.ts')),
      'command-center graphs persist under foundry data',
    ))
    results.push(check(
      'superseded_status_exists',
      /SUPERSEDED/.test(types) && /enforceSingleActiveExecution/.test(source('lib/native-builder/foundryAgentStore.ts')),
      'leftover unfinished agents become SUPERSEDED',
    ))

    const snapshot = measureFoundryResources({ activeBrowsers: 0, activeBuilds: 0, activeModelSlots: 0, activePtys: 0 })
    const max = computeMaxConcurrentAgents({ ...snapshot, ramUsedRatio: 0.99, ramFreeMb: 200 })
    results.push(check('bounded_concurrency', max <= 2 && computeMaxConcurrentAgents(snapshot) <= 4, `tight=${max} default=${computeMaxConcurrentAgents(snapshot)}`))
    results.push(check('resource_scheduler', snapshot.cpuCount >= 1 && snapshot.ramFreeMb >= 0 && 'vramUsedMb' in snapshot, JSON.stringify({ cpu: snapshot.cpuCount, ram: snapshot.ramFreeMb, vram: snapshot.vramUsedMb })))

    const seeds = ticketManagerGraphSeeds()
    const graph = buildTaskGraph({
      missionId: 'm1',
      projectId: 'p1',
      projectName: 'demo',
      projectRoot: projectsRoot,
      goal: 'demo',
      specId: 'SPEC-1',
      specVersion: '1',
      specApproved: true,
      tasks: seeds,
    })
    const backend = graph.tasks.find(task => task.role === 'BACKEND')!
    const frontend = graph.tasks.find(task => task.role === 'FRONTEND')!
    results.push(check(
      'task_dependency_graph',
      backend.dependsOn.length > 0 && frontend.dependsOn.join() === backend.dependsOn.join() && seeds.length >= 6,
      `${backend.taskId} deps=${backend.dependsOn} ${frontend.taskId} deps=${frontend.dependsOn}`,
    ))

    const gitDir = mkdtempSync(path.join(tmpdir(), 'wr-cc-git-'))
    spawnSync('git', ['init'], { cwd: gitDir })
    writeFileSync(path.join(gitDir, 'README.md'), 'x\n')
    spawnSync('git', ['add', '.'], { cwd: gitDir })
    spawnSync('git', ['-c', 'user.email=cc@foundry', '-c', 'user.name=Foundry', 'commit', '-m', 'init'], { cwd: gitDir })
    const gitWs = createIsolatedWorkspace({
      projectId: 'git-p',
      projectRoot: gitDir,
      missionId: 'm-git',
      taskId: 'TASK-001',
      agentId: 'backend-1',
      graphId: 'g-git',
      mutating: true,
    })
    results.push(check('workspace_isolation_git_worktree', gitWs.kind === 'git-worktree' || gitWs.kind === 'snapshot', gitWs.kind))
    const snapWs = createIsolatedWorkspace({
      projectId: 'snap-p',
      projectRoot: projectsRoot,
      missionId: 'm-snap',
      taskId: 'TASK-002',
      agentId: 'frontend-1',
      graphId: 'g-snap',
      mutating: true,
    })
    results.push(check('workspace_isolation_snapshot', snapWs.kind === 'snapshot' && snapWs.sourceRoot !== projectsRoot && snapWs.persistentDataRoot.endsWith(`${path.sep}data`), `${snapWs.kind} ${snapWs.sourceRoot}`))
    const denied = writeWorkspaceFile(snapWs, 'data/app.sqlite', 'nope')
    results.push(check('non_git_does_not_destroy_persistent_data', !denied.ok, denied.ok ? 'wrote data' : denied.error))

    results.push(check('role_tool_boundaries', roleAllowsTool('REVIEWER', 'engineering.review') && !roleAllowsTool('RESEARCHER', 'file.write') && Boolean(FOUNDRY_ROLE_CATALOG.BACKEND.tools.includes('file.write')), 'researcher cannot file.write'))
    const routing = routeModelForRole('ARCHITECT')
    results.push(check('model_routing_record', Boolean(routing.provider && routing.model && routing.reason && routing.switchedMidTask === false), JSON.stringify(routing)))

    const instrRoot = mkdtempSync(path.join(tmpdir(), 'wr-cc-instr-'))
    writeFileSync(path.join(instrRoot, 'AGENTS.md'), 'DO NOT OVERWRITE\n')
    ensureFoundryInstructionsFile(instrRoot)
    const agentsBefore = readFileSync(path.join(instrRoot, 'AGENTS.md'), 'utf8')
    ensureFoundryInstructionsFile(instrRoot, '# replacement should not overwrite existing foundry file either if present')
    const sources = loadProjectInstructionSources({
      projectRoot: instrRoot,
      commanderInstruction: 'Make the layout simpler.',
      approvedSpec: 'SPEC-1 REQ-003',
      skillGuidance: 'generic skill text that must not win',
      workspaceTruth: 'repo uses sqlite',
    })
    const composed = composeInstructionContext(sources)
    results.push(check('instructions_loading', existsSync(path.join(instrRoot, '.foundry/instructions.md')) && sources.some(item => item.origin === '.foundry/instructions.md' && item.loaded), 'foundry instructions present'))
    results.push(check('agents_md_compatibility', agentsBefore === 'DO NOT OVERWRITE\n' && sources.some(item => item.origin === 'AGENTS.md' && item.loaded) && composed.indexOf('Make the layout simpler.') < composed.indexOf('generic skill text'), 'AGENTS.md preserved; commander precedes skills'))
    results.push(check('instruction_precedence_order', FOUNDRY_INSTRUCTION_PRECEDENCE[0] === 'COMMANDER_CURRENT' && FOUNDRY_INSTRUCTION_PRECEDENCE.at(-1) === 'SKILL_GUIDANCE', FOUNDRY_INSTRUCTION_PRECEDENCE.join('>')))

    const skills = loadSkillsForRole({ role: 'BACKEND', missionText: 'sqlite http node ticket manager' })
    results.push(check('skill_loading_on_demand', skills.skillIds.length >= 1 && skills.packText.length < 4000, skills.skillIds.join(',')))

    const queued = await enqueueCommandCenterWork({
      goal: 'Fix login bug',
      projectName: 'queue-demo',
      kind: 'research',
      priority: 'HIGH',
    })
    results.push(check('task_queue_not_start_everything', queued.tasks.some(task => task.status === 'QUEUED' || task.status === 'READY') && queued.status !== 'COMPLETE', queued.tasks.map(task => task.status).join(',')))
    const paused = await pauseCommandCenter({ graphId: queued.graphId })
    results.push(check('pause_resume', paused.paused === true && paused.tasks.every(task => task.status === 'PAUSED' || task.status === 'COMPLETE' || task.status === 'CANCELLED'), paused.status))
    const resumed = await resumeCommandCenter({ graphId: queued.graphId })
    results.push(check('pause_resume_legal', resumed.paused === false && resumed.tasks.some(task => task.status === 'READY' || task.status === 'QUEUED'), resumed.status))
    const guided = guideCommandCenter(queued.graphId, queued.tasks[0].taskId, 'Do not change the API.')
    results.push(check('commander_live_guidance', guided.tasks[0].guidance.some(item => /Do not change the API/.test(item)), guided.tasks[0].guidance.join(';')))
    const cancelled = await cancelCommandCenter(queued.graphId)
    results.push(check('cancellation_preserves_history', cancelled.status === 'CANCELLED' && Boolean(loadCommandCenterGraph(queued.graphId)), cancelled.tasks.map(task => task.status).join(',')))

    const conflictGraph = buildTaskGraph({
      missionId: 'c1', projectId: 'same', projectName: 'c', projectRoot: projectsRoot, goal: 'c', specApproved: true,
      tasks: [{ title: 'a', role: 'BACKEND', writeSet: ['server.mjs'] }, { title: 'b', role: 'FRONTEND', writeSet: ['server.mjs'] }],
    })
    const left = createIsolatedWorkspace({ projectId: 'same', projectRoot: projectsRoot, missionId: 'c1', taskId: 'TASK-001', agentId: 'a1', graphId: conflictGraph.graphId, mutating: true })
    const right = createIsolatedWorkspace({ projectId: 'same', projectRoot: projectsRoot, missionId: 'c1', taskId: 'TASK-002', agentId: 'a2', graphId: conflictGraph.graphId, mutating: true })
    writeWorkspaceFile(left, 'server.mjs', 'A')
    writeWorkspaceFile(right, 'server.mjs', 'B')
    conflictGraph.workspaces = [left, right]
    const conflicts = detectWorkspaceConflicts(conflictGraph)
    results.push(check('conflict_detection', conflicts.some(item => item.path === 'server.mjs'), JSON.stringify(conflicts)))

    results.push(check('repair_role_assignment', assignRepairRole('sqlite schema failed') === 'DATABASE' && assignRepairRole('layout css broken') === 'FRONTEND', 'typed repair'))

    results.push(check(
      'no_auto_commit_push_deploy',
      FOUNDRY_COMMAND_CENTER_GOVERNANCE.AUTO_COMMIT === 0
        && FOUNDRY_COMMAND_CENTER_GOVERNANCE.AUTO_PUSH === 0
        && FOUNDRY_COMMAND_CENTER_GOVERNANCE.AUTO_DEPLOY === 0
        && !/git commit/.test(center)
        && !/git push/.test(center)
        && !/liveDeploy:\s*true/.test(center),
      JSON.stringify(FOUNDRY_COMMAND_CENTER_GOVERNANCE),
    ))
    results.push(check(
      'no_mock_agent_cards',
      FOUNDRY_COMMAND_CENTER_GOVERNANCE.MOCK_AGENT_CARDS === 0
        && /data-mock="0"/.test(ui)
        && /Decorative cards are not shown/.test(ui)
        && /FoundryAgentCommandCenter/.test(shell),
      'UI binds snapshot graphs only',
    ))
    results.push(check(
      'complete_previewable_apps_remain_visible',
      /const previewable = graphs.filter\(graph => Boolean\(graph\.preview\?\.localPreview\)\)/.test(ui)
        && /\[\.\.\.live, \.\.\.previewable/.test(ui)
        && /seen\.has\(graph\.graphId\)/.test(ui)
        && !/const cards = live\.length \? live/.test(ui),
      'COMPLETE previewable graphs stay in Agents cards while other graphs are live',
    ))
    results.push(check(
      'war_room_browser_preview_contract',
      /foundry-open-app/.test(ui) && /FoundryBrowser/.test(shell) && /warRoomBrowser:\s*true/.test(center) && /COMMANDER_APPROVAL_REQUIRED/.test(types),
      'OPEN APP uses FoundryBrowser; local preview authoritative',
    ))
    results.push(check(
      'planning_mode_spec_binding',
      /specId/.test(types) && /planningMode/.test(center) && /Approved spec required/.test(center),
      'spec id/version bind before mutating execute',
    ))
    results.push(check(
      'harbor_lane_inventory_terra_wrim_untouched',
      /Never clones Harbor Desk, Lane & Box, or Inventory Manager/.test(factory)
        && !/wave 5/i.test(center)
        && !existsSync(path.join(projectsRoot, 'Harbor Desk'))
        && !existsSync(path.join(projectsRoot, 'Lane & Box')),
      'disposable tmp projects only; factory does not clone products',
    ))

    const planning = await enqueueCommandCenterWork({
      goal: 'Plan only',
      projectName: 'planning-demo',
      planningMode: true,
      specApproved: false,
      kind: 'ticket-manager',
    })
    const planned = await executeCommandCenterGraph(planning.graphId)
    results.push(check('spec_binding_blocks_unapproved', planned.status === 'PLANNING' && planned.tasks.every(task => task.status === 'PLANNING'), planned.status))

    process.env.FOUNDRY_CC_INJECT_TEST_FAILURE = '1'
    const proof = await runDisposableCommandCenterAcceptance({ secondProjectName: 'indexing-research' })
    await stopOwnedProcesses(proof.ticket.missionId).catch(() => undefined)
    await stopOwnedProcesses(proof.research.missionId).catch(() => undefined)

    const ticketFiles = proof.ticket.result?.filesChanged ?? proof.ticket.workspaces.flatMap(ws => ws.filesChanged)
    results.push(check('parallel_task_scheduling', proof.parallel && proof.ticket.agents.filter(agent => agent.role === 'BACKEND' || agent.role === 'FRONTEND').length >= 2, `workspaces=${proof.ticket.workspaces.length} agents=${proof.ticket.agents.map(a => a.role).join(',')}`))
    results.push(check(
      'real_parallel_overlap',
      Boolean(proof.overlap?.overlapped),
      JSON.stringify(proof.overlap),
    ))
    results.push(check(
      'repair_loop_injected',
      proof.ticket.tasks.some(task => task.role === 'TEST' && task.retryCount >= 1 && task.tests.ok === true && task.repairHistory.length >= 1),
      proof.ticket.tasks.filter(t => t.role === 'TEST').map(t => `${t.status} retries=${t.retryCount} ok=${t.tests.ok} history=${t.repairHistory.join('|')}`).join(','),
    ))
    results.push(check('project_isolation', proof.isolated && proof.research.projectId !== proof.ticket.projectId, `${proof.ticket.projectRoot} vs ${proof.research.projectRoot}`))
    results.push(check('background_persistence', Boolean(loadCommandCenterGraph(proof.ticket.graphId)), proof.ticket.graphId))
    results.push(check(
      'restart_recovery_no_duplicate',
      proof.recovered.recoveryCount >= 1
        && proof.recovered.agents.filter(agent => agent.status === 'RUNNING').length === 0
        && proof.recovered.agents.filter(agent => agent.status === 'WAITING').length === 0
        && duplicateActiveAgentsPerTask(proof.recovered) === 0,
      `recoveryCount=${proof.recovered.recoveryCount} agents=${proof.recovered.agents.map(a => `${a.status}:${a.executionGeneration}`).join(',')}`,
    ))
    results.push(check(
      'recovered_task_one_current_generation',
      proof.recovered.tasks.filter(task => task.status === 'READY' || task.status === 'RUNNING' || task.status === 'WAITING').every(task => {
        const active = proof.recovered.agents.filter(agent => agent.taskId === task.taskId && (agent.status === 'WAITING' || agent.status === 'RUNNING' || agent.status === 'READY'))
        return active.length <= 1
      }),
      proof.recovered.tasks.map(task => `${task.taskId}:${task.status}`).join(','),
    ))
    results.push(check(
      'superseded_agent_not_waiting',
      proof.recovered.agents.some(agent => agent.status === 'SUPERSEDED')
        && proof.recovered.agents.every(agent => agent.status !== 'WAITING'),
      proof.recovered.agents.map(agent => `${agent.agentId}:${agent.status}:g${agent.executionGeneration}`).join(','),
    ))
    results.push(check(
      'complete_task_no_active_previous_agents',
      proof.ticket.tasks.filter(task => task.status === 'COMPLETE').every(task => {
        const active = proof.ticket.agents.filter(agent => agent.taskId === task.taskId && (agent.status === 'WAITING' || agent.status === 'RUNNING' || agent.status === 'READY'))
        return active.length === 0
      }),
      proof.ticket.agents.map(agent => `${agent.taskId}:${agent.status}`).join(','),
    ))
    results.push(check(
      'recovery_twice_idempotent',
      proof.recoveredAgain.agents.length === proof.recovered.agents.length
        && proof.recoveredAgain.workspaces.length === proof.recovered.workspaces.length
        && duplicateActiveAgentsPerTask(proof.recoveredAgain) === 0
        && proof.recoveredAgain.tasks.filter(task => task.status === 'COMPLETE').length === proof.recovered.tasks.filter(task => task.status === 'COMPLETE').length,
      `agents ${proof.recovered.agents.length}->${proof.recoveredAgain.agents.length} workspaces ${proof.recovered.workspaces.length}->${proof.recoveredAgain.workspaces.length}`,
    ))
    results.push(check(
      'no_duplicate_workspace',
      new Set(proof.ticket.workspaces.map(ws => ws.workspaceId)).size === proof.ticket.workspaces.length
        && new Set(proof.recoveredAgain.workspaces.map(ws => ws.workspaceId)).size === proof.recoveredAgain.workspaces.length,
      `ticket=${proof.ticket.workspaces.length} recovered=${proof.recoveredAgain.workspaces.length}`,
    ))
    results.push(check(
      'no_duplicate_task_execution',
      duplicateActiveAgentsPerTask(proof.ticket) === 0 && duplicateActiveAgentsPerTask(proof.recovered) === 0,
      `ticketDup=${duplicateActiveAgentsPerTask(proof.ticket)} recoveredDup=${duplicateActiveAgentsPerTask(proof.recovered)}`,
    ))

    const leftover = JSON.parse(JSON.stringify(proof.ticket)) as typeof proof.ticket
    leftover.graphId = `${proof.ticket.graphId}-leftover-waiting`
    const completeTask = leftover.tasks.find(task => task.status === 'COMPLETE') ?? leftover.tasks[0]
    const seedAgent = leftover.agents[0]
    if (completeTask && seedAgent) {
      leftover.agents.push({
        ...seedAgent,
        agentId: 'database-leftover-waiting',
        taskId: completeTask.taskId,
        status: 'WAITING',
        executionGeneration: 2,
        latestAction: 'Recovered leftover WAITING fixture',
        finishedAt: null,
      })
      saveCommandCenterGraph(leftover)
      const cleaned = recoverCommandCenterGraph(leftover)
      const leftoverActive = cleaned.agents.filter(agent => agent.taskId === completeTask.taskId && (agent.status === 'WAITING' || agent.status === 'RUNNING' || agent.status === 'READY'))
      results.push(check(
        'leftover_waiting_on_complete_superseded',
        leftoverActive.length === 0 && cleaned.agents.some(agent => agent.agentId === 'database-leftover-waiting' && agent.status === 'SUPERSEDED'),
        cleaned.agents.filter(agent => agent.taskId === completeTask.taskId).map(agent => `${agent.agentId}:${agent.status}:g${agent.executionGeneration}`).join(','),
      ))
    } else {
      results.push(check('leftover_waiting_on_complete_superseded', false, 'missing complete task or seed agent'))
    }
    results.push(check('integration_stage', proof.ticket.tasks.some(task => task.role === 'RELEASE' && task.status === 'COMPLETE' && /Integration complete/.test(task.result)), proof.ticket.tasks.filter(t => t.role === 'RELEASE').map(t => t.status + t.result).join('|')))
    results.push(check('independent_review', proof.ticket.artifacts.some(item => item.kind === 'review') && proof.ticket.tasks.some(task => task.role === 'REVIEWER' && task.status === 'COMPLETE'), proof.ticket.tasks.filter(t => t.role === 'REVIEWER').map(t => `${t.status}:${t.result}`).join('|') || 'no reviewer'))
    results.push(check('real_task_artifacts', proof.ticket.artifacts.some(item => item.kind === 'api_contract') && proof.ticket.artifacts.some(item => item.kind === 'task_result'), proof.ticket.artifacts.map(a => a.kind).join(',')))
    results.push(check('requirement_traceability', proof.ticket.traces.some(trace => trace.requirementId.startsWith('REQ-') && trace.taskId.startsWith('TASK-')), JSON.stringify(proof.ticket.traces.slice(0, 3))))
    results.push(check('browser_preview_launched', Boolean(proof.ticket.preview?.localPreview) && proof.ticket.preview?.shareContract.localAuthoritative === true && proof.ticket.preview?.shareContract.publicDeploy === 'COMMANDER_APPROVAL_REQUIRED', JSON.stringify(proof.ticket.preview)))
    results.push(check('disposable_ticket_manager_ready', proof.ticket.status === 'COMPLETE' && proof.ticket.tasks.every(task => task.status === 'COMPLETE' || task.status === 'CANCELLED'), `${proof.ticket.status} ready=${proof.ticket.result?.projectReady} tests=${proof.ticket.result?.tests}`))
    results.push(check('no_workspace_crossover', !ticketFiles.some(file => file.includes(proof.research.projectRoot)) && existsSync(path.join(proof.ticket.projectRoot, 'server.mjs')) && existsSync(path.join(proof.ticket.projectRoot, 'public/index.html')), proof.ticket.projectRoot))
    results.push(check(
      'ui_api_wired',
      /\/api\/foundry\/command-center/.test(shell) && /action === 'enqueue'/.test(api) && /FoundryAgentCommandCenter/.test(shell) && /foundry-background-status/.test(shell),
      'command center API + shell chip',
    ))
    results.push(check(
      'session_row_accessible',
      /data-testid="foundry-session-row"/.test(shell) && /aria-label=\{s\.title\}/.test(shell) && /aria-hidden="true"/.test(shell),
      'session rows expose button accessible name',
    ))
    results.push(check(
      'background_status_label',
      commandCenterBackgroundLabel(3) === 'FOUNDRY · 3 TASKS RUNNING' && commandCenterBackgroundLabel(1) === 'FOUNDRY · 1 TASK RUNNING',
      commandCenterBackgroundLabel(3),
    ))
    results.push(check('repair_loop_bound', proof.ticket.tasks.every(task => task.retryCount <= task.maxRetries), proof.ticket.tasks.map(t => `${t.taskId}:${t.retryCount}/${t.maxRetries}`).join(',')))
  } finally {
    if (previousProjects === undefined) delete process.env.FOUNDRY_PROJECTS_ROOT
    else process.env.FOUNDRY_PROJECTS_ROOT = previousProjects
    if (previousCc === undefined) delete process.env.FOUNDRY_COMMAND_CENTER_ROOT
    else process.env.FOUNDRY_COMMAND_CENTER_ROOT = previousCc
    if (previousWs === undefined) delete process.env.FOUNDRY_AGENT_WORKSPACES_ROOT
    else process.env.FOUNDRY_AGENT_WORKSPACES_ROOT = previousWs
    if (previousContracts === undefined) delete process.env.FOUNDRY_CONTRACTS_ROOT
    else process.env.FOUNDRY_CONTRACTS_ROOT = previousContracts
    delete process.env.FOUNDRY_CC_INJECT_TEST_FAILURE
    rmSync(projectsRoot, { recursive: true, force: true })
    rmSync(ccRoot, { recursive: true, force: true })
    rmSync(wsRoot, { recursive: true, force: true })
  }

  const failed = results.filter(item => !item.pass)
  console.log(JSON.stringify({ ok: failed.length === 0, passed: results.filter(item => item.pass).length, failed: failed.length, results }, null, 2))
  if (failed.length) {
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void run()
}

export { run as runFoundryAgentCommandCenterValidation }
