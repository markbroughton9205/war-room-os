import path from 'node:path'

/**
 * Typed command policy for War Room Engineer. Models propose structured operations;
 * this module classifies them. Nothing here executes.
 *
 * SAFE_LOCAL may run inside an authorized workspace after mission start.
 * REQUIRES_APPROVAL needs an explicit Commander gate (commit/push/outside-workspace/…).
 * DENIED never runs.
 */
export type CommandPolicyClass = 'SAFE_LOCAL' | 'REQUIRES_APPROVAL' | 'DENIED'

export type ClassifiedCommand = {
  policyClass: CommandPolicyClass
  reason: string
  approvalKind?: 'commit' | 'push' | 'deploy' | 'file_modification' | 'shell_mutating' | 'delete_data' | 'secrets_change'
}

const DENIED_GIT_SUB = /^(push|commit|merge|reset|rebase|checkout|clean)$/i

export function classifyArgv(cmd: string, args: readonly string[]): ClassifiedCommand {
  const base = cmd.replace(/\.cmd$/i, '').split(/[/\\]/).pop()?.toLowerCase() ?? ''
  const joined = [base, ...args].join(' ').toLowerCase()

  if (base === 'powershell' || base === 'pwsh' || base === 'cmd' || base === 'bash' || base === 'sh') {
    return { policyClass: 'DENIED', reason: 'Raw shell interpreters are never permitted. Use a typed Engineer operation.' }
  }
  if (/\brm\s+(-rf|--recursive)|remove-item\s+.*-recurse|format\s+|del\s+\/s|rd\s+\/s/i.test(joined)) {
    return { policyClass: 'DENIED', reason: 'Destructive recursive deletion is denied.', approvalKind: 'delete_data' }
  }
  if (/\breg(\.exe)?\b|\bnetsh\b|\bfirewall\b|\bschtasks\b/i.test(joined)) {
    return { policyClass: 'DENIED', reason: 'System-level configuration is denied.' }
  }
  if (/\bvercel\s+deploy|\bnetlify\s+deploy|\bpnpm\s+run\s+deploy|\bnpm\s+run\s+deploy/i.test(joined)) {
    return { policyClass: 'DENIED', reason: 'Deploy is never autonomous and is not implemented as an Engineer operation.', approvalKind: 'deploy' }
  }

  if (base === 'git') {
    const sub = args.find(a => !a.startsWith('-')) ?? ''
    if (DENIED_GIT_SUB.test(sub)) {
      if (/^push$/i.test(sub)) {
        return { policyClass: 'REQUIRES_APPROVAL', reason: 'git push requires Commander approval and is never autonomous.', approvalKind: 'push' }
      }
      if (/^commit$/i.test(sub)) {
        return { policyClass: 'REQUIRES_APPROVAL', reason: 'git commit requires Commander approval and is never autonomous.', approvalKind: 'commit' }
      }
      return { policyClass: 'DENIED', reason: `git ${sub} is a history-mutating operation and is denied.`, approvalKind: 'shell_mutating' }
    }
    if (/^(status|diff|log|show|branch|rev-parse|ls-files)$/i.test(sub)) {
      return { policyClass: 'SAFE_LOCAL', reason: 'Read-only git inspection.' }
    }
    if (/^init$/i.test(sub)) {
      return { policyClass: 'SAFE_LOCAL', reason: 'git init inside an authorized new workspace is local development.' }
    }
    return { policyClass: 'DENIED', reason: `git ${sub || '(missing subcommand)'} is not an allowlisted Engineer git operation.` }
  }

  if ((base === 'pnpm' || base === 'npm' || base === 'yarn') && args.some(a => a === '-g' || a === '--global')) {
    return { policyClass: 'REQUIRES_APPROVAL', reason: 'Global package installs require Commander approval.', approvalKind: 'shell_mutating' }
  }
  if ((base === 'pnpm' || base === 'npm' || base === 'yarn') && args[0] === 'install') {
    return { policyClass: 'SAFE_LOCAL', reason: 'Workspace-local dependency install.' }
  }
  if (base === 'pnpm' || base === 'npm' || base === 'yarn' || base === 'node' || base === 'npx') {
    return { policyClass: 'SAFE_LOCAL', reason: 'Workspace-local Node toolchain command.' }
  }
  if (base === 'python' || base === 'python3' || base === 'py' || base === 'pip' || base === 'pip3' || base === 'uv' || base === 'pytest') {
    return { policyClass: 'SAFE_LOCAL', reason: 'Workspace-local Python toolchain command.' }
  }
  if (base === 'cargo' || base === 'dotnet' || base === 'tsc' || base === 'eslint') {
    return { policyClass: 'SAFE_LOCAL', reason: 'Workspace-local compiler/test command.' }
  }

  return { policyClass: 'DENIED', reason: `Command "${base}" is not in the Engineer allowlist.` }
}

export function isSafeLocalCommand(cmd: string, args: readonly string[]): boolean {
  return classifyArgv(cmd, args).policyClass === 'SAFE_LOCAL'
}

/** Commands may only use a cwd inside the authorized workspace without a new Commander approval. */
export function classifyCommandCwd(cwd: string, workspaceRoot: string): ClassifiedCommand {
  const root = path.resolve(workspaceRoot)
  const abs = path.resolve(cwd)
  const rel = path.relative(root, abs)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return {
      policyClass: 'REQUIRES_APPROVAL',
      reason: 'Command cwd is outside the authorized workspace.',
      approvalKind: 'shell_mutating',
    }
  }
  return { policyClass: 'SAFE_LOCAL', reason: 'cwd is inside the authorized workspace.' }
}
