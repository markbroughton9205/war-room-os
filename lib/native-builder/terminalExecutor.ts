/**
 * Typed Engineer terminal operations. Argv only; commandPolicy classifies; validationRunner
 * spawn path executes. Long-running processes are registered in processRegistry and are not
 * awaited.
 */
import { spawn } from 'node:child_process'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { classifyArgv, classifyCommandCwd } from './commandPolicy'
import {
  runValidationOperation,
  runValidationOperationStreaming,
  terminalDevServerStatus,
  terminalRepoDiff,
  terminalRepoStatus,
  assertResolvedArgvNotDangerousEquivalent,
} from './validationRunner'
import {
  killProcessesForRepair,
  listProcessesForRepair,
  registerActiveProcess,
} from './processRegistry'
import type { NativeValidationOperation, NativeValidationResult } from './types'

export type TerminalExecuteRequest = {
  operation: NativeValidationOperation
  repairId?: string
}

export async function executeTypedTerminal(request: TerminalExecuteRequest): Promise<NativeValidationResult> {
  if (request.repairId) {
    return runValidationOperationStreaming(request.operation, { repairId: request.repairId })
  }
  return runValidationOperation(request.operation)
}

export async function startOwnedProcess(input: {
  repairId: string
  cmd: string
  args: string[]
  label: string
}): Promise<{ ok: boolean; pid?: number; error?: string }> {
  const policy = classifyArgv(input.cmd, input.args)
  if (policy.policyClass !== 'SAFE_LOCAL') {
    return { ok: false, error: policy.reason }
  }
  const cwd = resolveRepoRoot()
  const cwdPolicy = classifyCommandCwd(cwd, cwd)
  if (cwdPolicy.policyClass !== 'SAFE_LOCAL') {
    return { ok: false, error: cwdPolicy.reason }
  }
  const bypass = assertResolvedArgvNotDangerousEquivalent(input.cmd, input.args)
  if (bypass) return { ok: false, error: bypass }
  const child = spawn(input.cmd, input.args, {
    cwd,
    windowsHide: true,
    shell: process.platform === 'win32',
    detached: process.platform !== 'win32',
    stdio: 'pipe',
  })
  registerActiveProcess(input.repairId, child, input.label)
  if (typeof child.pid !== 'number') return { ok: false, error: 'Process did not start.' }
  return { ok: true, pid: child.pid }
}

export async function stopOwnedProcesses(repairId: string) {
  return killProcessesForRepair(repairId)
}

export function ownedProcessStatus(repairId: string) {
  return listProcessesForRepair(repairId)
}

export { terminalRepoStatus, terminalRepoDiff, terminalDevServerStatus }
