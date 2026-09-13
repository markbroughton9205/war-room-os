/**
 * Structured Engineer tools. The model may name these; the Engineering Core validates
 * the payload and executes through existing native-builder machinery. No arbitrary tool strings.
 */
import { mkdir, rename } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { assertCanonicalRepoPath, readRepoFile, resolveRepoRelativePath, searchRepoText } from './repositoryInspector'
import { applyProposal } from './patchApplier'
import { buildRepoMap } from './repoMap'
import { executeTypedTerminal, ownedProcessStatus, startOwnedProcess, stopOwnedProcesses } from './terminalExecutor'
import { terminalRepoDiff, terminalRepoStatus } from './terminalExecutor'
import { buildCommitPreparation } from './commitPreparation'
import { getIssue, getRepair } from './storage'
import { classifyArgv } from './commandPolicy'
import { recordBoundaryViolation } from './boundaryLog'
import type { NativeRepairProposal, NativeValidationOperation } from './types'

export const ENGINEER_TOOL_NAMES = [
  'workspace.inspect',
  'workspace.search',
  'file.read',
  'file.write',
  'file.patch',
  'file.move',
  'file.delete',
  'terminal.execute',
  'process.start',
  'process.status',
  'process.stop',
  'git.status',
  'git.diff',
  'git.log',
  'git.branch',
  'git.commit_prepare',
  'validation.run',
  'browser.inspect_local',
  'mission.complete',
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

export async function executeEngineerTool(call: EngineerToolCall, ctx: { repairId: string }): Promise<EngineerToolResult> {
  const { tool, input } = call
  try {
    switch (tool) {
      case 'workspace.inspect':
        return { ok: true, tool, result: await buildRepoMap() }
      case 'workspace.search': {
        const query = String(input.query ?? '')
        return { ok: true, tool, result: await searchRepoText(query) }
      }
      case 'file.read': {
        const file = await containedRel(String(input.path ?? ''))
        return { ok: true, tool, result: await readRepoFile(file) }
      }
      case 'file.write': {
        const file = await containedRel(String(input.path ?? ''))
        const content = String(input.content ?? '')
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
      case 'browser.inspect_local':
        return { ok: true, tool, result: { visualVerification: 'VISUAL_VERIFICATION_NOT_AVAILABLE' } }
      case 'mission.complete':
        return { ok: true, tool, result: { requested: true } }
      default: {
        const exhaustive: never = tool
        return { ok: false, tool: exhaustive, error: 'Unknown tool.' }
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/escapes|allowlist|symlink/i.test(message)) {
      await recordBoundaryViolation({ action: tool, attemptedPath: String(input.path ?? input.from ?? ''), reason: message })
    }
    return { ok: false, tool, error: message }
  }
}
