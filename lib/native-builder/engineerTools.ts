/**
 * Structured Engineer tools. The model may name these; the Engineering Core validates
 * the payload and executes through existing native-builder machinery. No arbitrary tool strings.
 */
import { mkdir, rename } from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { getActiveWorkspaceRootOverride, runWithWorkspaceRoot } from '@/lib/repo/workspaceContext'
import { assertCanonicalRepoPath, readRepoFile, resolveRepoRelativePath, searchRepoText } from './repositoryInspector'
import { applyProposal } from './patchApplier'
import { refuseIfDirtyCommanderBuffer } from './foundryWorkbenchDirtyGuard'
import { buildRepoMap } from './repoMap'
import { executeTypedTerminal, ownedProcessStatus, startOwnedProcess, stopOwnedProcesses } from './terminalExecutor'
import { terminalRepoDiff, terminalRepoStatus } from './terminalExecutor'
import { buildCommitPreparation } from './commitPreparation'
import { getIssue, getRepair } from './storage'
import { classifyArgv } from './commandPolicy'
import { recordBoundaryViolation } from './boundaryLog'
import { inspectLocalPage } from './browserInspector'
import { executeFoundryBrowserTool, FOUNDRY_BROWSER_TOOL_NAMES, isFoundryBrowserToolName } from './foundryBrowserService'
import { HVS_FOUNDRY_TOOL_NAMES, isHvsFoundryToolName } from './foundryHvsAdapter'
import { isEngineeringToolName } from './foundryEngineeringDepth'
import { isCapabilityAtlasToolName } from './capability-atlas/tools'
import { executeComputerTool, COMPUTER_TOOL_NAMES, isComputerToolName } from './foundryComputerUse'
import { executeExternalAppTool, EXTERNAL_APP_TOOL_NAMES, isExternalAppToolName } from './external-app/tools'
import { executeDeployTool, DEPLOY_TOOL_NAMES, isDeployToolName } from './foundryDeploy'
import {
  closeTerminalSession,
  openTerminalSession,
  readTerminalSession,
  sendTerminalSessionInput,
} from './terminalSession'
import { runtimeHealth, runtimeLaunch, runtimeLaunchInstalled, runtimeStop, runtimeStopInstalled, runtimeTransitionToActive, runtimeVerify } from './runtimeControl'
import {
  installerActivate,
  installerActiveStatus,
  installerInstall,
  installerInstallProduction,
  installerRollbackActivation,
  installerRollbackTarget,
  installerStatus,
} from './installerTool'
import { buildRun, lintRun, listTestSuites, testRun, typecheckRun } from './qualityTools'
import { packageRun } from './packageTool'
import { processInspect, processList } from './processInspector'
import { portInspect } from './portInspector'
import { logsCapture, logsSearch, logsTail, LOG_SOURCES, type LogSource } from './logsTool'
import type { NativeRepairProposal, NativeValidationOperation } from './types'
import { compactFileRead, executeReplaceUnique } from './foundryBoundedEdit'

function isLogSource(value: unknown): value is LogSource {
  return typeof value === 'string' && (LOG_SOURCES as readonly string[]).includes(value)
}

export const ENGINEER_TOOL_NAMES = [
  'workspace.inspect',
  'workspace.search',
  'code.owners',
  'code.symbol',
  'code.refs',
  'code.dependents',
  'code.impact',
  'code.roles',
  'engineering.review',
  'engineering.baseline',
  'engineering.diagnose',
  'engineering.memory_recall',
  'engineering.memory_remember',
  'engineering.plan',
  'engineering.boundary',
  'engineering.consistency',
  'engineering.test_review',
  'engineering.contracts',
  'engineering.dead_code',
  'engineering.write_set_expand',
  'file.read',
  'file.write',
  'file.patch',
  'file.replace_unique',
  'file.move',
  'file.delete',
  'terminal.execute',
  'terminal.open_session',
  'terminal.session_send',
  'terminal.session_read',
  'terminal.session_kill',
  'process.start',
  'process.status',
  'process.stop',
  'git.status',
  'git.diff',
  'git.log',
  'git.branch',
  'git.commit_prepare',
  'validation.run',
  ...FOUNDRY_BROWSER_TOOL_NAMES,
  'runtime.health',
  'runtime.verify',
  'runtime.launch',
  'runtime.stop',
  'runtime.launch_installed',
  'runtime.stop_installed',
  'runtime.transition_to_active',
  'installer.install',
  'installer.status',
  'installer.install_production',
  'installer.rollback_target',
  'installer.active_status',
  'installer.activate',
  'installer.rollback_activation',
  'build.run',
  'test.run',
  'lint.run',
  'typecheck.run',
  'test.list_suites',
  'package.run',
  'process.list',
  'process.inspect',
  'port.inspect',
  'logs.tail',
  'logs.search',
  'logs.capture',
  'mission.start',
  'mission.status',
  'mission.run',
  'mission.cancel',
  'mission.journal',
  'mission.complete',
  'mission.list',
  'mission.inspect',
  'mission.pause',
  'mission.resume',
  'mission.set_priority',
  'mission.request_authorization',
  'research.search',
  'research.fetch',
  'research.record',
  'capability.scoreboard',
  'capability.query',
  'capability.resolve',
  'capability.pack',
  'capability.inspect',
  'capability.gap',
  'capability.self_knowledge',
  'capability.import_skill',
  'project.create',
  'project.inspect',
  'project.command',
  'project.preview',
  ...HVS_FOUNDRY_TOOL_NAMES,
  ...COMPUTER_TOOL_NAMES,
  ...EXTERNAL_APP_TOOL_NAMES,
  ...DEPLOY_TOOL_NAMES,
] as const

export type EngineerToolName = (typeof ENGINEER_TOOL_NAMES)[number]

export function isEngineerToolName(value: string): value is EngineerToolName {
  return (ENGINEER_TOOL_NAMES as readonly string[]).includes(value)
}

export type EngineerToolCall = {
  tool: EngineerToolName
  input: Record<string, unknown>
}

export type EngineerToolResult = {
  ok: boolean
  tool: EngineerToolName
  result?: unknown
  error?: string
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

async function containedRel(rel: string): Promise<string> {
  const abs = resolveRepoRelativePath(rel)
  await assertCanonicalRepoPath(abs, true)
  return path.relative(resolveRepoRoot(), abs).split(path.sep).join('/')
}

export async function executeEngineerTool(call: EngineerToolCall, ctx: { repairId: string; mission?: import('./foundryMissionTypes').FoundryMissionRecord | null }): Promise<EngineerToolResult> {
  if (!getActiveWorkspaceRootOverride() && ctx.mission?.workspace && (ctx.mission.kind === 'app_builder' || ctx.mission.capabilityLane === 'APPLICATION_BUILDER')) {
    return runWithWorkspaceRoot(ctx.mission.workspace, () => executeEngineerTool(call, ctx), ctx.mission.applicationBuilder?.project?.projectId)
  }
  const { tool, input } = call
  let resourceAction: { missionId: string; actionId: string; kind: import('./foundryResourceGovernorTypes').FoundryResourceActionKind } | null = null
  try {
    if (ctx.mission) {
      const { planningModeBlocksTool } = await import('./foundryPlanningMode')
      const blocked = planningModeBlocksTool(ctx.mission, tool)
      if (blocked) return { ok: false, tool, error: blocked }
      const { standaloneEngineerBlocksMutation } = await import('./foundryVerdictLayer')
      const { isMutatingBrokerTool } = await import('./foundryMissionWriteSet')
      if (isMutatingBrokerTool(tool)) {
        const contractBlock = standaloneEngineerBlocksMutation(ctx.mission, tool)
        if (contractBlock) return { ok: false, tool, error: contractBlock }
      }
      const { authorizeResourceAction, beginResourceUsage, classifyEngineerToolFamily, completeResourceUsage } = await import('./foundryResourceGovernor')
      const family = classifyEngineerToolFamily(tool)
      const resourceGate = authorizeResourceAction({
        missionId: ctx.mission.missionId,
        kind: family,
        createIfMissing: ctx.mission.engineeringClass === 'STANDALONE_ENGINEER',
      })
      if (!resourceGate.ok) return { ok: false, tool, error: resourceGate.reason }
      resourceAction = { missionId: ctx.mission.missionId, actionId: `tool-${randomUUID()}`, kind: family }
      beginResourceUsage({ missionId: resourceAction.missionId, kind: family, actionId: resourceAction.actionId, tool })
    }
    const { isMutatingBrokerTool, assertBrokerWriteAuthorized } = await import('./foundryMissionWriteSet')
    if (isMutatingBrokerTool(tool)) {
      const mission = ctx.mission ?? (await import('./foundryMissionStore').then(mod => mod.loadMission(ctx.repairId)))
      const verdict = await assertBrokerWriteAuthorized(mission, tool, input)
      if (!verdict.ok) return { ok: false, tool, error: verdict.error }
    }
    if (isComputerToolName(tool)) {
      const result = await executeComputerTool(tool, input, ctx)
      return { ok: result.ok, tool, result: result.result, error: result.error }
    }
    if (isExternalAppToolName(tool)) {
      const result = await executeExternalAppTool(tool, input, ctx)
      return { ok: result.ok, tool, result: result.result, error: result.error }
    }
    if (isDeployToolName(tool)) {
      const result = await executeDeployTool(tool, input, ctx)
      return { ok: result.ok, tool, result: result.result, error: result.error }
    }
    if (isFoundryBrowserToolName(tool) && tool !== 'browser.inspect_local') {
      const result = await executeFoundryBrowserTool(tool, input, ctx)
      return { ok: result.ok, tool, result: result.result, error: result.error }
    }
    if (isEngineeringToolName(tool)) {
      const { executeEngineeringTool } = await import('./foundryEngineeringDepth')
      const result = await executeEngineeringTool(tool, input, ctx)
      return { ok: result.ok, tool, result: result.result, error: result.error }
    }
    if (isCapabilityAtlasToolName(tool)) {
      const { executeCapabilityAtlasTool } = await import('./capability-atlas/tools')
      const result = executeCapabilityAtlasTool(tool, input)
      return { ok: result.ok, tool, result: result.result, error: result.error }
    }
    if (isHvsFoundryToolName(tool)) {
      const { executeFoundryHvsTool } = await import('./foundryHvsAdapter')
      const result = await executeFoundryHvsTool(tool, input, ctx)
      return { ok: result.ok, tool, result: result.result, error: result.error }
    }
    {
      const { isApplicationBuilderToolName, executeApplicationBuilderTool } = await import('./foundryApplicationBuilder')
      if (isApplicationBuilderToolName(tool)) {
        return executeApplicationBuilderTool(call, ctx)
      }
    }
    switch (tool) {
      case 'workspace.inspect':
        return { ok: true, tool, result: await buildRepoMap() }
      case 'workspace.search': {
        const query = String(input.query ?? '')
        const pathPrefix = typeof input.pathPrefix === 'string' && input.pathPrefix ? input.pathPrefix : undefined
        return { ok: true, tool, result: await searchRepoText(query, { pathPrefix }) }
      }
      case 'file.read': {
        const rel = String(input.path ?? input.file ?? '')
        const { classifyFoundrySensitivePath } = await import('./foundrySensitivePathGuard')
        const sensitivity = classifyFoundrySensitivePath(rel)
        if (sensitivity.refuseRead) {
          return { ok: false, tool, error: `SECRET_FILE_REFUSED: ${sensitivity.reason ?? 'sensitive file'}` }
        }
        const read = await compactFileRead({
          ...input,
          query: typeof input.query === 'string' ? input.query : ctx.mission?.userRequest,
        }, ctx.mission)
        return { ok: read.ok, tool, result: read.result, error: read.error }
      }
      case 'file.write': {
        const file = await containedRel(String(input.path ?? ''))
        const content = String(input.content ?? '')
        const dirtyHold = refuseIfDirtyCommanderBuffer(resolveRepoRelativePath(file))
        if (dirtyHold.blocked) {
          return { ok: false, tool, error: dirtyHold.reason }
        }
        const existing = await readRepoFile(file)
        const proposal: NativeRepairProposal = existing.ok
          ? {
              issueId: ctx.repairId,
              sourceKind: 'deterministic',
              proposerId: 'engineer-tool:file.write',
              diagnosis: 'Full-file rewrite via Engineer tool.',
              confidence: 'medium',
              relevantFiles: [file],
              plannedChanges: [{
                file,
                reason: String(input.reason ?? 'file.write'),
                operation: 'replace_range',
                patch: {
                  operation: 'replace_range',
                  file,
                  expectedOriginalHash: sha256(existing.content),
                  matchText: existing.content,
                  replacementText: content,
                },
              }],
              validations: [],
              risks: [],
              rollbackPlan: 'Snapshot rollback.',
              generatedAt: new Date().toISOString(),
            }
          : {
              issueId: ctx.repairId,
              sourceKind: 'deterministic',
              proposerId: 'engineer-tool:file.write',
              diagnosis: 'Create file via Engineer tool.',
              confidence: 'medium',
              relevantFiles: [file],
              plannedChanges: [{
                file,
                reason: String(input.reason ?? 'file.write'),
                operation: 'create_file',
                patch: { operation: 'create_file', file, newFileContent: content },
              }],
              validations: [],
              risks: [],
              rollbackPlan: 'Snapshot rollback.',
              generatedAt: new Date().toISOString(),
            }
        const applied = await applyProposal(ctx.repairId, proposal)
        return { ok: applied.ok, tool, result: applied, error: applied.ok ? undefined : applied.outcomes.map(o => o.detail).join('; ') }
      }
      case 'file.patch': {
        const proposal = input.proposal as NativeRepairProposal
        if (!proposal?.plannedChanges) return { ok: false, tool, error: 'file.patch requires a StructuredPatch proposal.' }
        const applied = await applyProposal(ctx.repairId, proposal)
        return { ok: applied.ok, tool, result: applied, error: applied.ok ? undefined : applied.outcomes.map(o => o.detail).join('; ') }
      }
      case 'file.replace_unique': {
        const applied = await executeReplaceUnique(input, ctx)
        return { ok: applied.ok, tool, result: applied.result, error: applied.error }
      }
      case 'file.move': {
        const from = await containedRel(String(input.from ?? ''))
        const to = await containedRel(String(input.to ?? ''))
        const fromAbs = resolveRepoRelativePath(from)
        const toAbs = resolveRepoRelativePath(to)
        await mkdir(path.dirname(toAbs), { recursive: true })
        await rename(fromAbs, toAbs)
        return { ok: true, tool, result: { from, to } }
      }
      case 'file.delete': {
        if (input.commanderConfirmed !== true) return { ok: false, tool, error: 'file.delete requires commanderConfirmed: true.' }
        const file = await containedRel(String(input.path ?? ''))
        const existing = await readRepoFile(file)
        if (!existing.ok) return { ok: false, tool, error: existing.error }
        const proposal: NativeRepairProposal = {
          issueId: ctx.repairId,
          sourceKind: 'deterministic',
          proposerId: 'engineer-tool:file.delete',
          diagnosis: 'Delete file via Engineer tool.',
          confidence: 'medium',
          relevantFiles: [file],
          plannedChanges: [{
            file,
            reason: String(input.reason ?? 'file.delete'),
            operation: 'delete_file',
            patch: {
              operation: 'delete_file',
              file,
              expectedOriginalHash: sha256(existing.content),
              commanderConfirmed: true,
            },
          }],
          validations: [],
          risks: [],
          rollbackPlan: 'Snapshot restore.',
          generatedAt: new Date().toISOString(),
        }
        const applied = await applyProposal(ctx.repairId, proposal)
        return { ok: applied.ok, tool, result: applied }
      }
      case 'terminal.execute': {
        const operation = input.operation as NativeValidationOperation
        if (!operation?.id) return { ok: false, tool, error: 'terminal.execute requires a typed NativeValidationOperation.' }
        const result = await executeTypedTerminal({ operation, repairId: ctx.repairId })
        return { ok: result.ok, tool, result }
      }
      case 'process.start': {
        const cmd = String(input.cmd ?? '')
        const args = Array.isArray(input.args) ? input.args.map(String) : []
        const policy = classifyArgv(cmd, args)
        if (policy.policyClass !== 'SAFE_LOCAL') return { ok: false, tool, error: policy.reason }
        return { ok: true, tool, result: await startOwnedProcess({ repairId: ctx.repairId, cmd, args, label: String(input.label ?? `${cmd} ${args.join(' ')}`) }) }
      }
      case 'process.status':
        return { ok: true, tool, result: ownedProcessStatus(ctx.repairId) }
      case 'process.stop':
        return { ok: true, tool, result: await stopOwnedProcesses(ctx.repairId) }
      case 'git.status':
        return { ok: true, tool, result: await terminalRepoStatus() }
      case 'git.diff':
        return { ok: true, tool, result: await terminalRepoDiff(Array.isArray(input.paths) ? input.paths.map(String) : undefined) }
      case 'git.log':
      case 'git.branch': {
        const status = await terminalRepoStatus()
        return { ok: true, tool, result: { branch: status.currentBranch, status } }
      }
      case 'git.commit_prepare': {
        const repair = await getRepair(ctx.repairId)
        const issue = repair ? await getIssue(repair.issueId) : null
        if (!repair || !issue) return { ok: false, tool, error: 'Mission not found.' }
        return { ok: true, tool, result: buildCommitPreparation(issue, repair) }
      }
      case 'validation.run': {
        const operation = input.operation as NativeValidationOperation
        if (!operation?.id) return { ok: false, tool, error: 'validation.run requires a typed operation.' }
        const result = await executeTypedTerminal({ operation, repairId: ctx.repairId })
        return { ok: result.ok, tool, result }
      }
      case 'terminal.open_session': {
        const cmd = String(input.cmd ?? '')
        const args = Array.isArray(input.args) ? input.args.map(String) : []
        const opened = await openTerminalSession({ repairId: ctx.repairId, cmd, args, label: input.label ? String(input.label) : undefined })
        return { ok: opened.ok, tool, result: opened, error: opened.ok ? undefined : opened.error }
      }
      case 'terminal.session_send': {
        const sessionId = String(input.sessionId ?? '')
        const text = String(input.text ?? '')
        const sent = sendTerminalSessionInput(sessionId, text)
        return { ok: sent.ok, tool, result: sent, error: sent.ok ? undefined : sent.error }
      }
      case 'terminal.session_read': {
        const sessionId = String(input.sessionId ?? '')
        const after = typeof input.afterSequence === 'number' ? input.afterSequence : 0
        const read = readTerminalSession(sessionId, after)
        return { ok: read.ok, tool, result: read, error: read.ok ? undefined : read.error }
      }
      case 'terminal.session_kill': {
        const sessionId = String(input.sessionId ?? '')
        return { ok: true, tool, result: await closeTerminalSession(sessionId) }
      }
      case 'browser.inspect_local':
        return {
          ok: true,
          tool,
          result: await inspectLocalPage(
            { url: String(input.url ?? ''), waitForSelector: input.waitForSelector ? String(input.waitForSelector) : undefined, fullPage: input.fullPage === true },
            ctx,
          ),
        }
      case 'runtime.health':
        return { ok: true, tool, result: await runtimeHealth() }
      case 'runtime.verify':
        return { ok: true, tool, result: await runtimeVerify() }
      case 'runtime.launch': {
        const cmd = String(input.cmd ?? '')
        const args = Array.isArray(input.args) ? input.args.map(String) : []
        const launched = await runtimeLaunch({ cmd, args, label: input.label ? String(input.label) : undefined, repairId: ctx.repairId })
        return { ok: launched.ok, tool, result: launched, error: launched.ok ? undefined : launched.error }
      }
      case 'runtime.stop': {
        const sessionId = String(input.sessionId ?? '')
        return { ok: true, tool, result: await runtimeStop(sessionId) }
      }
      case 'installer.install': {
        const sourceArtifactPath = String(input.sourceArtifactPath ?? '')
        const installRootOverride = String(input.installRootOverride ?? '')
        const feature = String(input.feature ?? 'foundry-install')
        if (!sourceArtifactPath || !installRootOverride) {
          return { ok: false, tool, error: 'installer.install requires sourceArtifactPath and installRootOverride.' }
        }
        const installed = await installerInstall({ sourceArtifactPath, installRootOverride, feature, commanderConfirmed: input.commanderConfirmed === true })
        return { ok: installed.ok, tool, result: installed, error: installed.ok ? undefined : installed.error }
      }
      case 'installer.status':
        return { ok: true, tool, result: await installerStatus() }
      case 'installer.install_production': {
        const appimage = input.appimage as { path?: string; sha256?: string } | undefined
        const deb = input.deb as { path?: string; sha256?: string } | undefined
        const linuxUnpackedDir = input.linuxUnpackedDir ? String(input.linuxUnpackedDir) : undefined
        if (!appimage?.path || !appimage?.sha256 || !deb?.path || !deb?.sha256 || !linuxUnpackedDir) {
          return { ok: false, tool, error: 'installer.install_production requires appimage:{path,sha256}, deb:{path,sha256}, and linuxUnpackedDir — pass package.run\'s own result.' }
        }
        const feature = String(input.feature ?? 'foundry-production-install')
        const installed = await installerInstallProduction({
          appimage: { path: appimage.path, sha256: appimage.sha256 },
          deb: { path: deb.path, sha256: deb.sha256 },
          linuxUnpackedDir,
          feature,
          commanderConfirmed: input.commanderConfirmed === true,
        })
        return { ok: installed.ok, tool, result: installed, error: installed.ok ? undefined : installed.error }
      }
      case 'installer.active_status':
        return { ok: true, tool, result: await installerActiveStatus() }
      case 'installer.activate': {
        const installId = String(input.installId ?? '')
        if (!installId) return { ok: false, tool, error: 'installer.activate requires installId.' }
        const activated = await installerActivate({
          installId,
          commanderConfirmed: input.commanderConfirmed === true,
          missionId: String(input.missionId ?? ctx.repairId),
          commanderExplicitRollback: input.commanderExplicitRollback === true,
          activationMode: input.activationMode === 'MAINTENANCE_ROLLBACK' || input.activationMode === 'RELAUNCH_CURRENT' || input.activationMode === 'MISSION'
            ? input.activationMode
            : undefined,
          allowHistoricalRollback: input.allowHistoricalRollback === true,
        })
        return { ok: activated.ok, tool, result: activated, error: activated.ok ? undefined : activated.error }
      }
      case 'installer.rollback_activation': {
        const previousInstallId = input.previousInstallId === null || input.previousInstallId === undefined ? null : String(input.previousInstallId)
        const rolledBack = await installerRollbackActivation({
          previousInstallId,
          commanderConfirmed: input.commanderConfirmed === true,
          commanderExplicitRollback: input.commanderExplicitRollback === true,
        })
        return { ok: rolledBack.ok, tool, result: rolledBack, error: rolledBack.ok ? undefined : rolledBack.error }
      }
      case 'installer.rollback_target': {
        const installId = String(input.installId ?? '')
        if (!installId) return { ok: false, tool, error: 'installer.rollback_target requires installId.' }
        const target = await installerRollbackTarget(installId)
        return { ok: target.ok, tool, result: target, error: target.ok ? undefined : target.error }
      }
      case 'build.run': {
        const result = await buildRun({ repairId: ctx.repairId })
        return { ok: result.ok, tool, result, error: result.ok ? undefined : (result.stderr || `build.run failed (lockState=${result.lockState}).`) }
      }
      case 'test.run': {
        const suite = String(input.suite ?? '')
        if (!suite) return { ok: false, tool, error: 'test.run requires suite (a package.json "validate:*" script name — see test.list_suites).' }
        const result = await testRun({ repairId: ctx.repairId, suite })
        return { ok: result.ok, tool, result, error: result.ok ? undefined : (result.stderr || `test.run "${suite}" failed (exitCode=${result.exitCode}).`) }
      }
      case 'test.list_suites': {
        const suites = await listTestSuites()
        suites.sort((a, b) => Number(!a.includes('foundry')) - Number(!b.includes('foundry')) || a.localeCompare(b))
        return { ok: true, tool, result: suites }
      }
      case 'lint.run': {
        const targets = Array.isArray(input.targets) ? input.targets.map(String) : undefined
        const result = await lintRun({ repairId: ctx.repairId, targets })
        return { ok: result.ok, tool, result, error: result.ok ? undefined : (result.stderr || `lint.run failed (exitCode=${result.exitCode}).`) }
      }
      case 'typecheck.run': {
        const scopeGlob = input.scopeGlob ? String(input.scopeGlob) : undefined
        const result = await typecheckRun({ repairId: ctx.repairId, scopeGlob })
        return { ok: result.ok, tool, result, error: result.ok ? undefined : (result.scopedErrorCount ? `${result.scopedErrorCount} error(s) in scope ${scopeGlob}.` : result.baselineNote) }
      }
      case 'package.run': {
        const result = await packageRun({ repairId: ctx.repairId })
        return { ok: result.ok, tool, result, error: result.ok ? undefined : result.error }
      }
      case 'process.list': {
        const filter = input.filter ? String(input.filter) : undefined
        const limit = typeof input.limit === 'number' ? input.limit : undefined
        const result = await processList({ filter, limit })
        return { ok: result.ok, tool, result, error: result.ok ? undefined : result.error }
      }
      case 'process.inspect': {
        const pid = Number(input.pid)
        const result = await processInspect({ pid })
        return { ok: result.ok, tool, result, error: result.ok ? undefined : result.error }
      }
      case 'port.inspect': {
        const port = typeof input.port === 'number' ? input.port : undefined
        const result = await portInspect({ port })
        return { ok: result.ok, tool, result, error: result.ok ? undefined : result.error }
      }
      case 'logs.tail': {
        if (!isLogSource(input.source)) return { ok: false, tool, error: `logs.tail requires source to be one of: ${LOG_SOURCES.join(', ')}.` }
        const lines = typeof input.lines === 'number' ? input.lines : undefined
        const result = await logsTail({ source: input.source, lines, repairId: ctx.repairId })
        return { ok: result.ok, tool, result, error: result.ok ? undefined : result.error }
      }
      case 'logs.search': {
        if (!isLogSource(input.source)) return { ok: false, tool, error: `logs.search requires source to be one of: ${LOG_SOURCES.join(', ')}.` }
        const query = String(input.query ?? '')
        const result = await logsSearch({ source: input.source, query, repairId: ctx.repairId })
        return { ok: result.ok, tool, result, error: result.ok ? undefined : result.error }
      }
      case 'logs.capture': {
        if (!isLogSource(input.source)) return { ok: false, tool, error: `logs.capture requires source to be one of: ${LOG_SOURCES.join(', ')}.` }
        const lines = typeof input.lines === 'number' ? input.lines : undefined
        const result = await logsCapture({ source: input.source, lines, repairId: ctx.repairId })
        return { ok: result.ok, tool, result, error: result.ok ? undefined : result.error }
      }
      case 'runtime.launch_installed': {
        const { readProductionLease, inspectLeaseOwnerLiveness, REFUSED_PRODUCTION_LEASE_HELD } = await import('./foundryProductionLease')
        const lease = await readProductionLease()
        if (lease && lease.ownerMissionId !== ctx.repairId) {
          const inspect = await inspectLeaseOwnerLiveness(lease)
          if (!inspect.reclaimable) {
            return {
              ok: false,
              tool,
              error: `${REFUSED_PRODUCTION_LEASE_HELD}: runtime.launch_installed refused while ${lease.ownerMissionId} holds PRODUCTION_LEASE.`,
            }
          }
        }
        const result = await runtimeLaunchInstalled()
        return { ok: result.ok, tool, result, error: result.ok ? undefined : result.error }
      }
      case 'runtime.transition_to_active': {
        const result = await runtimeTransitionToActive({
          commanderConfirmed: input.commanderConfirmed === true,
          graceMs: typeof input.graceMs === 'number' ? input.graceMs : undefined,
          bootTimeoutMs: typeof input.bootTimeoutMs === 'number' ? input.bootTimeoutMs : undefined,
          missionId: String(input.missionId ?? ctx.repairId),
          installId: input.installId ? String(input.installId) : undefined,
          commanderExplicitRollback: input.commanderExplicitRollback === true,
          activationMode: input.activationMode === 'MAINTENANCE_ROLLBACK' || input.activationMode === 'RELAUNCH_CURRENT' || input.activationMode === 'MISSION'
            ? input.activationMode
            : undefined,
          allowHistoricalRollback: input.allowHistoricalRollback === true,
          forceRelaunch: input.forceRelaunch === true,
        })
        return { ok: result.ok, tool, result, error: result.ok ? undefined : result.error }
      }
      case 'runtime.stop_installed': {
        const pid = Number(input.pid)
        const result = await runtimeStopInstalled(pid)
        return { ok: result.ok, tool, result, error: result.error }
      }
      case 'mission.start': {
        const { startMission } = await import('./foundryMissionController')
        const userRequest = String(input.userRequest ?? input.request ?? '')
        if (!userRequest) return { ok: false, tool, error: 'mission.start requires userRequest.' }
        const parentId = ctx.repairId
        const helper = await startMission(userRequest, typeof input.title === 'string' ? input.title : undefined, {
          parentMissionId: parentId,
          requestId: typeof input.requestId === 'string' ? input.requestId : null,
          productionRole: input.productionOwner === true ? 'PRODUCTION_OWNER' : 'HELPER',
          productionOwner: input.productionOwner === true,
        })
        helper.helperMissionId = helper.missionId
        helper.parentMissionId = parentId
        const { saveMission } = await import('./foundryMissionStore')
        await saveMission(helper)
        return { ok: true, tool, result: helper }
      }
      case 'mission.status': {
        const { loadMission } = await import('./foundryMissionStore')
        const missionId = String(input.missionId ?? ctx.repairId)
        const mission = await loadMission(missionId)
        if (!mission) return { ok: false, tool, error: `Unknown mission ${missionId}` }
        return { ok: true, tool, result: { ...mission, journalTail: mission.journal.slice(-12) } }
      }
      case 'mission.run': {
        const { runMission, runDeterministicMission } = await import('./foundryMissionController')
        const missionId = String(input.missionId ?? ctx.repairId)
        const mission = input.brain === 'deterministic-pass004'
          ? await runDeterministicMission(missionId)
          : await runMission(missionId)
        return { ok: true, tool, result: mission, error: mission.status === 'BLOCKED' || mission.status === 'FAILED' ? mission.blocker?.blocker : undefined }
      }
      case 'mission.cancel': {
        const { cancelMission } = await import('./foundryMissionController')
        const missionId = String(input.missionId ?? ctx.repairId)
        const mission = await cancelMission(missionId)
        return { ok: true, tool, result: mission }
      }
      case 'mission.journal': {
        const { loadMission } = await import('./foundryMissionStore')
        const missionId = String(input.missionId ?? ctx.repairId)
        const mission = await loadMission(missionId)
        if (!mission) return { ok: false, tool, error: `Unknown mission ${missionId}` }
        return { ok: true, tool, result: { journal: mission.journal, context: mission.context } }
      }
      case 'mission.list': {
        const { listMissions } = await import('./foundryMissionStore')
        const { toRegistryEntry, groupOperationsQueue } = await import('./foundryMissionRegistry')
        const missions = await listMissions(typeof input.limit === 'number' ? input.limit : 40)
        return { ok: true, tool, result: { missions: missions.map(toRegistryEntry), queue: groupOperationsQueue(missions.map(toRegistryEntry)) } }
      }
      case 'mission.inspect': {
        const { inspectOperations } = await import('./foundryOperationsManager')
        const missionId = typeof input.missionId === 'string' ? input.missionId : undefined
        return { ok: true, tool, result: await inspectOperations(missionId) }
      }
      case 'mission.pause': {
        const { pauseMission } = await import('./foundryMissionController')
        const missionId = String(input.missionId ?? ctx.repairId)
        return { ok: true, tool, result: await pauseMission(missionId, String(input.reason ?? 'Commander paused')) }
      }
      case 'mission.resume': {
        const { resumeMission } = await import('./foundryMissionController')
        const missionId = String(input.missionId ?? ctx.repairId)
        return { ok: true, tool, result: await resumeMission(missionId) }
      }
      case 'mission.set_priority': {
        const { setMissionPriority } = await import('./foundryMissionController')
        const missionId = String(input.missionId ?? ctx.repairId)
        const priority = String(input.priority ?? 'NORMAL')
        if (!['CRITICAL', 'HIGH', 'NORMAL', 'LOW'].includes(priority)) {
          return { ok: false, tool, error: 'priority must be CRITICAL, HIGH, NORMAL, or LOW.' }
        }
        return { ok: true, tool, result: await setMissionPriority(missionId, priority as 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW') }
      }
      case 'mission.request_authorization': {
        const { loadMission } = await import('./foundryMissionStore')
        const { requestControlledAuthorization } = await import('./foundryOperationsManager')
        const missionId = String(input.missionId ?? ctx.repairId)
        const mission = await loadMission(missionId)
        if (!mission) return { ok: false, tool, error: `Unknown mission ${missionId}` }
        await requestControlledAuthorization(
          mission,
          String(input.action ?? 'CONTROLLED_TEST_BOUNDARY'),
          String(input.reason ?? 'Controlled authorization boundary for operations recovery.'),
          String(input.target ?? 'current mission'),
          String(input.impact ?? 'Only this pending action is paused.'),
        )
        return { ok: true, tool, result: mission }
      }
      case 'mission.complete': {
        const { completeMission } = await import('./foundryMissionController')
        const missionId = String(input.missionId ?? ctx.repairId)
        const completed = await completeMission(missionId)
        return { ok: completed.ok, tool, result: completed.mission, error: completed.error }
      }
      default:
        return { ok: false, tool, error: 'Unknown tool.' }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/escapes|allowlist|symlink/i.test(message)) {
      await recordBoundaryViolation({ action: tool, attemptedPath: String(input.path ?? input.from ?? ''), reason: message })
    }
    return { ok: false, tool, error: message }
  } finally {
    if (resourceAction) {
      const { completeResourceUsage } = await import('./foundryResourceGovernor')
      completeResourceUsage({
        actionId: resourceAction.actionId,
        missionId: resourceAction.missionId,
        ok: true,
        kind: resourceAction.kind,
        tool,
      })
    }
  }
}
