import { createHash, randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { FoundryMissionRecord } from './foundryMissionTypes'
import {
  type FoundryDurableToolCall,
  type FoundryResourceId,
  type FoundryToolIdempotency,
} from './foundryOperationsTypes'
import { foundryDataHierarchy } from './foundryPaths'

const READ_ONLY = new Set([
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
  'engineering.plan',
  'engineering.boundary',
  'engineering.consistency',
  'engineering.test_review',
  'engineering.contracts',
  'engineering.dead_code',
  'engineering.write_set_expand',
  'file.read',
  'git.status',
  'git.diff',
  'git.log',
  'git.branch',
  'test.list_suites',
  'process.status',
  'process.list',
  'process.inspect',
  'port.inspect',
  'logs.tail',
  'logs.search',
  'logs.capture',
  'browser.get_text',
  'browser.inspect',
  'browser.get_dom',
  'browser.screenshot',
  'browser.console',
  'browser.network',
  'computer.windows',
  'computer.observe',
  'computer.screenshot',
  'computer.find_text',
  'computer.find_control',
  'computer.wait_for_control',
  'external_app.discover',
  'external_app.status',
  'external_app.observe',
  'cursor.observe_generation',
  'cursor.read_response',
  'installer.status',
  'installer.active_status',
  'runtime.verify',
  'deploy.inspect',
  'mission.status',
  'mission.journal',
  'mission.inspect',
  'mission.list',
  'research.search',
  'research.fetch',
  'research.record',
  'project.inspect',
  'project.preview',
  'capability.scoreboard',
  'capability.query',
  'capability.resolve',
  'capability.pack',
  'capability.inspect',
  'capability.gap',
  'capability.self_knowledge',
  'hvs.project.open',
  'hvs.ffmpeg.probe',
])

const IDEMPOTENT_WRITE = new Set([
  'file.write',
  'file.patch',
  'file.replace_unique',
  'lint.run',
  'typecheck.run',
  'test.run',
  'terminal.execute',
  'validation.run',
  'build.run',
])

const EXTERNAL_ACTION = new Set([
  'git.push',
  'git.commit',
  'git.commit_prepare',
  'deploy.publish',
  'deploy.live',
])

export function classifyToolIdempotency(tool: string): FoundryToolIdempotency {
  if (tool === 'hvs.project.open' || tool === 'hvs.ffmpeg.probe') return 'READ_ONLY'
  if (tool.startsWith('hvs.') && /publish|upload|deploy|push|spend/i.test(tool)) return 'EXTERNAL_ACTION'
  if (READ_ONLY.has(tool) || tool.endsWith('.inspect') || tool.endsWith('.status') || tool.endsWith('.list')) {
    return 'READ_ONLY'
  }
  if (EXTERNAL_ACTION.has(tool) || /push|live.?deploy|commit/i.test(tool)) return 'EXTERNAL_ACTION'
  if (IDEMPOTENT_WRITE.has(tool)) return 'IDEMPOTENT_WRITE'
  if (
    tool.startsWith('installer.')
    || tool.startsWith('runtime.')
    || tool === 'package.run'
    || tool === 'process.start'
    || tool === 'process.stop'
    || tool === 'browser.start'
    || tool === 'browser.navigate'
    || tool === 'browser.stop'
  ) {
    return 'NON_IDEMPOTENT_WRITE'
  }
  return 'NON_IDEMPOTENT_WRITE'
}

export function resourcesForTool(tool: string, input: Record<string, unknown> = {}): FoundryResourceId[] {
  const resources: FoundryResourceId[] = []
  if (tool === 'file.write' || tool === 'file.patch' || tool === 'file.replace_unique' || tool === 'file.move' || tool === 'file.delete') {
    resources.push('REPO_WRITE')
  }
  if (tool === 'build.run' || tool === 'package.run' || tool.startsWith('installer.install') || tool === 'installer.activate' || tool === 'installer.rollback_activation' || tool === 'runtime.transition_to_active') {
    resources.push('PRODUCTION_LEASE')
  }
  if (tool === 'build.run') resources.push('BUILD_PIPELINE')
  if (tool === 'package.run') resources.push('PACKAGE_PIPELINE')
  if (tool.startsWith('installer.install')) resources.push('INSTALL_PIPELINE')
  if (tool === 'installer.activate' || tool === 'installer.rollback_activation' || tool === 'runtime.transition_to_active') resources.push('ACTIVE_RUNTIME')
  if (tool.startsWith('browser.') && !READ_ONLY.has(tool)) resources.push('PERSISTENT_BROWSER')
  if ((tool.startsWith('computer.') || tool.startsWith('external_app.') || tool.startsWith('cursor.')) && !READ_ONLY.has(tool)) {
    resources.push('COMPUTER_USE_DESKTOP')
  }
  if (tool.includes('deploy') && tool !== 'deploy.inspect') resources.push('DEPLOY_TARGET')
  const port = Number(input.port)
  if (port === 3847) resources.push('PORT_3847')
  if (port === 3848) resources.push('PORT_3848')
  return resources
}

export function hashToolArgs(input: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(input), 'utf8').digest('hex')
}

export function createDurableToolCall(
  mission: FoundryMissionRecord,
  tool: string,
  input: Record<string, unknown>,
): FoundryDurableToolCall {
  return {
    toolCallId: randomUUID(),
    missionId: mission.missionId,
    tool,
    argsHash: hashToolArgs(input),
    startTime: new Date().toISOString(),
    status: 'QUEUED',
    resourceClaims: resourcesForTool(tool, input),
    idempotency: classifyToolIdempotency(tool),
  }
}

export async function persistDurableToolCall(call: FoundryDurableToolCall): Promise<void> {
  const root = path.join(foundryDataHierarchy().toolCalls, call.missionId)
  await mkdir(root, { recursive: true })
  await writeFile(path.join(root, `${call.toolCallId}.json`), JSON.stringify(call, null, 2), 'utf8')
}

export function attachDurableToolCall(mission: FoundryMissionRecord, call: FoundryDurableToolCall): void {
  mission.durableToolCalls = [...(mission.durableToolCalls ?? []), call].slice(-400)
  mission.activeToolCallId = call.status === 'STARTED' || call.status === 'QUEUED' ? call.toolCallId : null
}

export function markInFlightToolsInterrupted(mission: FoundryMissionRecord): FoundryDurableToolCall[] {
  const interrupted: FoundryDurableToolCall[] = []
  for (const call of mission.durableToolCalls ?? []) {
    if (call.status !== 'QUEUED' && call.status !== 'STARTED') continue
    call.status = call.idempotency === 'READ_ONLY' ? 'INTERRUPTED' : 'UNKNOWN'
    call.endTime = new Date().toISOString()
    call.resultSummary = `Controller restart reconciled in-flight ${call.tool} as ${call.status}. Do not replay blindly.`
    interrupted.push(call)
  }
  mission.activeToolCallId = null
  return interrupted
}

export function shouldReplayTool(call: FoundryDurableToolCall): boolean {
  if (call.status === 'SUCCEEDED') return false
  if (call.idempotency === 'READ_ONLY') return true
  if (call.idempotency === 'EXTERNAL_ACTION') return false
  if (call.idempotency === 'NON_IDEMPOTENT_WRITE') return false
  return call.status === 'INTERRUPTED' || call.status === 'UNKNOWN'
}
