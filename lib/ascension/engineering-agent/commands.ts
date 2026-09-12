/**
 * #22 Phase 3 — Allowlisted validation command model + package-script semantic inspection.
 * Never treat "pnpm" as unconditionally safe — classify script semantics.
 */
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { assertShellArgvGoverned } from '@/lib/permissions/equivalentActionGuard'
import { denyEngineeringAgentAction } from './profile'

const execFileAsync = promisify(execFile)

export type EngineeringCommandClass =
  | 'TYPECHECK'
  | 'TEST'
  | 'VALIDATOR'
  | 'BUILD'
  | 'LINT'
  | 'DIFF'
  | 'STATUS'
  | 'DENIED'

export type ApprovedEngineeringCommand = {
  id: string
  class: Exclude<EngineeringCommandClass, 'DENIED'>
  cmd: string
  args: string[]
  timeoutMs: number
}

/** Fixed allowlist — no user-supplied shell strings. */
export const ENGINEERING_APPROVED_COMMANDS: readonly ApprovedEngineeringCommand[] = Object.freeze([
  {
    id: 'typecheck',
    class: 'TYPECHECK',
    cmd: 'pnpm',
    args: ['exec', 'tsc', '--noEmit'],
    timeoutMs: 120_000,
  },
  {
    id: 'lint',
    class: 'LINT',
    cmd: 'pnpm',
    args: ['exec', 'eslint', '--max-warnings=0'],
    timeoutMs: 120_000,
  },
  {
    id: 'build',
    class: 'BUILD',
    cmd: 'pnpm',
    args: ['run', 'build'],
    timeoutMs: 400_000,
  },
  {
    id: 'git_status',
    class: 'STATUS',
    cmd: 'git',
    args: ['status', '--porcelain'],
    timeoutMs: 30_000,
  },
  {
    id: 'git_diff',
    class: 'DIFF',
    cmd: 'git',
    args: ['diff'],
    timeoutMs: 30_000,
  },
  {
    id: 'git_diff_check',
    class: 'DIFF',
    cmd: 'git',
    args: ['diff', '--check'],
    timeoutMs: 30_000,
  },
  {
    id: 'git_rev_parse_head',
    class: 'STATUS',
    cmd: 'git',
    args: ['rev-parse', 'HEAD'],
    timeoutMs: 15_000,
  },
])

const DANGEROUS_SCRIPT_NAME =
  /deploy|publish|release|prod|production|migrate|supabase|restart|kill|crawl|scrape|income|payment|settlement|trade|wager/i

const DANGEROUS_SCRIPT_BODY =
  /deploy|vercel\s+deploy|netlify\s+deploy|npm\s+publish|pnpm\s+publish|git\s+push|git\s+commit|curl\s+-X\s+(POST|PUT|PATCH|DELETE)|Remove-Item|rm\s+-rf|taskkill|Stop-Process|supabase\s+db|psql\s+/i

export type PackageScriptClassification = {
  name: string
  body: string
  class: EngineeringCommandClass
  reason: string
}

export function loadPackageScripts(repositoryRoot: string): Record<string, string> {
  const pkgPath = path.join(repositoryRoot, 'package.json')
  if (!existsSync(pkgPath)) return {}
  const raw = JSON.parse(readFileSync(pkgPath, 'utf8')) as { scripts?: Record<string, string> }
  return raw.scripts ?? {}
}

export function classifyPackageScript(name: string, body: string): PackageScriptClassification {
  if (DANGEROUS_SCRIPT_NAME.test(name) || DANGEROUS_SCRIPT_BODY.test(body)) {
    return {
      name,
      body,
      class: 'DENIED',
      reason: `Package script "${name}" classified as dangerous (deploy/publish/mutation semantics).`,
    }
  }
  if (/^build$/i.test(name) || /\bnext\s+build\b/i.test(body)) {
    return { name, body, class: 'BUILD', reason: 'Non-production build script.' }
  }
  if (/lint|eslint/i.test(name) || /eslint/.test(body)) {
    return { name, body, class: 'LINT', reason: 'Lint script.' }
  }
  if (/test|validate/i.test(name)) {
    return { name, body, class: name.includes('validate') ? 'VALIDATOR' : 'TEST', reason: 'Test/validator script.' }
  }
  if (/^start$/i.test(name) || /next\s+start|next\s+dev/i.test(body)) {
    return {
      name,
      body,
      class: 'DENIED',
      reason: `Package script "${name}" starts a server process — denied for ENGINEERING_AGENT.`,
    }
  }
  return {
    name,
    body,
    class: 'DENIED',
    reason: `Package script "${name}" is not on the ENGINEERING_AGENT allowlist.`,
  }
}

export function assertPackageScriptAllowed(
  repositoryRoot: string,
  scriptName: string,
): { ok: true; classification: PackageScriptClassification } | { ok: false; classification: PackageScriptClassification } {
  const scripts = loadPackageScripts(repositoryRoot)
  const body = scripts[scriptName]
  if (body == null) {
    const classification: PackageScriptClassification = {
      name: scriptName,
      body: '',
      class: 'DENIED',
      reason: `Unknown package script "${scriptName}".`,
    }
    return { ok: false, classification }
  }
  const classification = classifyPackageScript(scriptName, body)
  if (classification.class === 'DENIED') return { ok: false, classification }
  return { ok: true, classification }
}

/** Reject free-form / dangerous argv before any exec. */
export function governEngineeringArgv(
  cmd: string,
  args: readonly string[],
): { ok: true } | { ok: false; reason: string; reasonCode: string } {
  const joined = [cmd, ...args].join(' ').toLowerCase()
  if (/\bgit\s+(commit|push|rebase|reset|clean|merge|tag|checkout)\b/.test(joined)) {
    const d = denyEngineeringAgentAction(
      /\bpush\b/.test(joined) ? 'GIT_PUSH' : /\bcommit\b/.test(joined) ? 'GIT_COMMIT' : 'ARBITRARY_SHELL',
    )
    return { ok: false, reason: d.reason, reasonCode: d.reasonCode }
  }
  if (/\b(powershell|pwsh|cmd)\b/.test(joined) && args.length > 0) {
    const d = denyEngineeringAgentAction('ARBITRARY_POWERSHELL')
    return { ok: false, reason: d.reason, reasonCode: d.reasonCode }
  }
  if (/deploy|publish|taskkill|stop-process|kill\s+-9|rm\s+-rf|remove-item/.test(joined)) {
    const d = denyEngineeringAgentAction(/deploy|publish/.test(joined) ? 'PRODUCTION_DEPLOY' : 'ARBITRARY_SHELL')
    return { ok: false, reason: d.reason, reasonCode: d.reasonCode }
  }

  // pnpm run <script> — inspect package.json semantics
  if ((cmd === 'pnpm' || cmd.endsWith('pnpm')) && args[0] === 'run' && typeof args[1] === 'string') {
    // Caller must pass repositoryRoot via resolveApprovedCommand; here deny unknown run names
    // that look dangerous by name alone.
    if (DANGEROUS_SCRIPT_NAME.test(args[1])) {
      const d = denyEngineeringAgentAction('PRODUCTION_DEPLOY')
      return { ok: false, reason: `pnpm run ${args[1]} denied by script-name semantics.`, reasonCode: d.reasonCode }
    }
  }

  const gate = assertShellArgvGoverned({
    cmd,
    args,
    mode: 'commander',
    safetyLock: true,
    body: {},
    commanderSessionOk: false,
  })
  if (gate.outcome !== 'ALLOW') {
    return { ok: false, reason: gate.reason, reasonCode: gate.reasonCode }
  }
  return { ok: true }
}

export function resolveApprovedCommand(
  commandId: string,
  repositoryRoot: string,
): { ok: true; command: ApprovedEngineeringCommand } | { ok: false; reason: string; reasonCode: string } {
  const found = ENGINEERING_APPROVED_COMMANDS.find(c => c.id === commandId)
  if (!found) {
    // Attempt package script alias — only if classified safe
    if (commandId.startsWith('pnpm_run:')) {
      const script = commandId.slice('pnpm_run:'.length)
      const check = assertPackageScriptAllowed(repositoryRoot, script)
      if (!check.ok) {
        return {
          ok: false,
          reason: check.classification.reason,
          reasonCode: 'PACKAGE_SCRIPT_DENIED',
        }
      }
      return {
        ok: true,
        command: {
          id: commandId,
          class: check.classification.class as Exclude<EngineeringCommandClass, 'DENIED'>,
          cmd: 'pnpm',
          args: ['run', script],
          timeoutMs: 180_000,
        },
      }
    }
    return { ok: false, reason: `Command "${commandId}" is not allowlisted.`, reasonCode: 'COMMAND_NOT_ALLOWLISTED' }
  }

  if (found.id === 'build') {
    const check = assertPackageScriptAllowed(repositoryRoot, 'build')
    if (!check.ok) {
      return { ok: false, reason: check.classification.reason, reasonCode: 'PACKAGE_SCRIPT_DENIED' }
    }
  }

  const governed = governEngineeringArgv(found.cmd, found.args)
  if (!governed.ok) return governed
  return { ok: true, command: found }
}

export type EngineeringCommandResult = {
  command_id: string
  class: EngineeringCommandClass
  ok: boolean
  exit_code: number | null
  stdout: string
  stderr: string
  duration_ms: number
  denied?: boolean
  deny_reason?: string
}

export async function runApprovedEngineeringCommand(input: {
  commandId: string
  cwd: string
  repositoryRoot: string
}): Promise<EngineeringCommandResult> {
  const started = Date.now()
  const resolved = resolveApprovedCommand(input.commandId, input.repositoryRoot)
  if (!resolved.ok) {
    return {
      command_id: input.commandId,
      class: 'DENIED',
      ok: false,
      exit_code: 1,
      stdout: '',
      stderr: resolved.reason,
      duration_ms: Date.now() - started,
      denied: true,
      deny_reason: resolved.reason,
    }
  }

  const governed = governEngineeringArgv(resolved.command.cmd, resolved.command.args)
  if (!governed.ok) {
    return {
      command_id: input.commandId,
      class: 'DENIED',
      ok: false,
      exit_code: 1,
      stdout: '',
      stderr: governed.reason,
      duration_ms: Date.now() - started,
      denied: true,
      deny_reason: governed.reason,
    }
  }

  try {
    const { stdout, stderr } = await execFileAsync(resolved.command.cmd, resolved.command.args, {
      cwd: input.cwd,
      windowsHide: true,
      timeout: resolved.command.timeoutMs,
      maxBuffer: 2 * 1024 * 1024,
      shell: process.platform === 'win32',
      encoding: 'utf8',
    })
    return {
      command_id: input.commandId,
      class: resolved.command.class,
      ok: true,
      exit_code: 0,
      stdout: String(stdout).slice(0, 20_000),
      stderr: String(stderr).slice(0, 20_000),
      duration_ms: Date.now() - started,
    }
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number }
    return {
      command_id: input.commandId,
      class: resolved.command.class,
      ok: false,
      exit_code: typeof err.code === 'number' ? err.code : 1,
      stdout: String(err.stdout ?? '').slice(0, 20_000),
      stderr: String(err.stderr ?? (err instanceof Error ? err.message : String(err))).slice(0, 20_000),
      duration_ms: Date.now() - started,
    }
  }
}

/** Red-team helper: attempt arbitrary argv through governance (never executes). */
export function attemptArbitraryCommand(
  cmd: string,
  args: readonly string[],
): { allowed: false; reason: string; reasonCode: string } {
  const g = governEngineeringArgv(cmd, args)
  if (g.ok) {
    // Even if argv looks "safe", arbitrary commands outside allowlist are denied
    return {
      allowed: false,
      reason: 'Arbitrary command execution denied — only allowlisted command ids may run.',
      reasonCode: 'ARBITRARY_SHELL_DENIED',
    }
  }
  return { allowed: false, reason: g.reason, reasonCode: g.reasonCode }
}
