/**
 * #22 Phase 1 — Equivalent-action bypass guards.
 * GIT_PUSH COMMANDER_ONLY must not be bypassable via generic shell/HTTP.
 */
import { resolveCanonicalDangerousKind, type CanonicalDangerousKind } from '@/lib/permissions/dangerousActionRegistry'
import {
  evaluateGovernedAction,
  type PolicyDecision,
} from '@/lib/permissions/policyDecision'
import type { StandingPermissionMode } from '@/lib/permissions/standingPermissions'

/** Generic execution is fail-closed. These are inspection/build argv only, not shell command strings. */
const SAFE_GIT_READS = new Set(['status','diff','log','show','rev-parse','ls-files','ls-tree','cat-file','grep','help','describe'])
const SAFE_PACKAGE_SCRIPTS = new Set(['build','test','lint','typecheck','start','desktop:dist:linux'])
const SAFE_READERS = new Set(['pwd','whoami','uname','cat','head','tail','wc','stat'])
const normalizedBase = (cmd: string) => cmd.split(/[\\/]/).pop()?.toLowerCase().replace(/\.(?:exe|cmd|bat)$/,'') ?? ''

/** Return null only for an explicitly recognized non-mutating argv. Wrappers are never transparent. */
export function classifyShellArgv(cmd: string, args: readonly string[]): CanonicalDangerousKind | null {
  const base = normalizedBase(cmd)
  if (base === 'git') {
    let index = 0
    while (index < args.length) {
      const arg = args[index]
      if (arg === '-C' || arg === '--git-dir' || arg === '--work-tree' || arg === '--namespace') {
        if (!args[index + 1]) return 'shell_mutating'
        index += 2; continue
      }
      if (arg === '-c' || arg === '--config-env' || arg.startsWith('-c') || arg.startsWith('--config-env=')) return 'shell_mutating'
      if (arg === '--') { index++; break }
      if (arg.startsWith('-')) return 'shell_mutating'
      break
    }
    const sub = (args[index] ?? '').toLowerCase()
    const rest = args.slice(index + 1)
    if (sub === 'push') return 'push'
    if (sub === 'commit') return 'commit'
    if (SAFE_GIT_READS.has(sub)) return null
    if (sub === 'branch' && rest.length === 1 && rest[0] === '--show-current') return null
    if (sub === 'remote' && rest.length === 1 && rest[0] === '-v') return null
    if (sub === 'worktree' && rest.length === 1 && rest[0] === 'list') return null
    return 'shell_mutating'
  }
  if (SAFE_READERS.has(base) && args.every(a => !/[$`;&|><\n\r]/.test(a))) return null
  if (base === 'node' || base === 'nodejs' || base === 'electron') {
    if (args.length === 1 && ['--version','-v'].includes(args[0])) return null
    if (args[0] === '--check' && args.length === 2 && !args[1].startsWith('-')) return null
    if (args[0] === '--test' && args.slice(1).every(a => a === '--' || (!a.startsWith('-') && !/[;$`|><\n\r]/.test(a)))) return null
    if (args.length === 1 && args[0] === 'scripts/prepare-desktop-runtime.mjs') return null
    return 'shell_mutating'
  }
  if (['pnpm','npm','yarn'].includes(base)) {
    if (args[0] === 'run' && args.length === 2 && (SAFE_PACKAGE_SCRIPTS.has(args[1]) || /^validate:[a-z0-9:-]+$/.test(args[1]))) return null
    if (base === 'pnpm' && args[0] === 'exec' && args[1] === 'tsc' && args.length === 3 && args[2] === '--noEmit') return null
    if (base === 'pnpm' && args[0] === 'exec' && args[1] === 'eslint' && args.includes('--') && args.slice(args.indexOf('--') + 1).every(a => !a.startsWith('-'))) return null
    return 'shell_mutating'
  }
  // Shell interpreters, env wrappers, network CLIs and every unknown executable are not a read-only proof.
  return 'shell_mutating'
}

function isFixedResearchEndpoint(method: string, rawUrl: string): boolean {
  if (method.toUpperCase() !== 'POST') return false
  try {
    const u = new URL(rawUrl)
    return u.protocol === 'https:' && (
      (u.hostname === 'api.tavily.com' && u.pathname === '/search') ||
      (u.hostname === 'api.firecrawl.dev' && u.pathname === '/v2/search')
    )
  } catch { return false }
}

/** Unknown HTTP mutations and GitHub API writes require a dedicated governed route. */
export function classifyHttpMutation(method: string, url: string): CanonicalDangerousKind | null {
  const m = method.toUpperCase()
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return null
  if (!['POST','PUT','PATCH','DELETE'].includes(m)) return 'external_account'
  let host: string
  try { host = new URL(url).hostname.toLowerCase() } catch { return 'external_account' }
  if (/stripe|paypal|plaid|coinbase|binance|broker|brokerage/.test(host)) return 'financial'
  return 'external_account'
}

export function assertShellArgvGoverned(input: {
  cmd: string
  args: readonly string[]
  mode: StandingPermissionMode
  safetyLock: boolean
  body?: Record<string, unknown>
  commanderSessionOk?: boolean
}): PolicyDecision {
  const equivalent = classifyShellArgv(input.cmd, input.args)
  if (!equivalent) {
    return {
      outcome: 'ALLOW',
      reasonCode: 'ALLOWED_BOUNDED_READ',
      reason: 'Shell argv does not match a forbidden equivalent dangerous action.',
      actionKind: 'shell_readonly_or_fixed',
      canonicalKind: null,
      riskTier: null,
      technicalReach: 'EXECUTE_SANDBOXED',
      policyAuthority: 'BOUNDED_ALLOWED',
      requiresApproval: false,
      approvalSatisfied: true,
      httpStatus: 200,
    }
  }

  const decision = evaluateGovernedAction({
    mode: input.mode,
    safetyLock: input.safetyLock,
    actionKind: equivalent,
    body: input.body ?? {},
    commanderSessionOk: input.commanderSessionOk,
    technicalReach: 'EXECUTE_SANDBOXED',
  })

  if (decision.outcome === 'ALLOW') {
    // Even if somehow allowed, equivalent bypass of structural no-reach must still deny
    return {
      ...decision,
      outcome: 'DENY',
      reasonCode: 'EQUIVALENT_ACTION_BYPASS_DENIED',
      reason: `Generic shell cannot bypass ${equivalent} policy (equivalent-action guard).`,
      httpStatus: 403,
      approvalSatisfied: false,
    }
  }

  return {
    ...decision,
    reasonCode: 'EQUIVALENT_ACTION_BYPASS_DENIED',
    reason: `Generic shell blocked as equivalent of ${equivalent}: ${decision.reason}`,
  }
}

export function assertHttpMutationGoverned(input: {
  method: string
  url: string
  mode: StandingPermissionMode
  safetyLock: boolean
  body?: Record<string, unknown>
  commanderSessionOk?: boolean
  /** When true, treat as Council/research read-only discovery POST (Tavily etc.). */
  researchDiscovery?: boolean
}): PolicyDecision {
  if (input.researchDiscovery && isFixedResearchEndpoint(input.method, input.url)) {
    return {
      outcome: 'ALLOW',
      reasonCode: 'ALLOWED_BOUNDED_READ',
      reason: 'Classified as bounded research discovery POST (not external mutation).',
      actionKind: 'internet_research',
      canonicalKind: null,
      riskTier: 'TIER_0_READ_OBSERVE',
      technicalReach: 'READ_ONLY',
      policyAuthority: 'BOUNDED_ALLOWED',
      requiresApproval: false,
      approvalSatisfied: true,
      httpStatus: 200,
    }
  }

  const equivalent = classifyHttpMutation(input.method, input.url)
  if (!equivalent) {
    return {
      outcome: 'ALLOW',
      reasonCode: 'ALLOWED_BOUNDED_READ',
      reason: 'HTTP method/URL is not classified as external mutation.',
      actionKind: 'http_read_or_discovery',
      canonicalKind: null,
      riskTier: 'TIER_0_READ_OBSERVE',
      technicalReach: 'READ_ONLY',
      policyAuthority: 'BOUNDED_ALLOWED',
      requiresApproval: false,
      approvalSatisfied: true,
      httpStatus: 200,
    }
  }

  const decision = evaluateGovernedAction({
    mode: input.mode,
    safetyLock: input.safetyLock,
    actionKind: equivalent,
    body: input.body ?? {},
    commanderSessionOk: input.commanderSessionOk,
  })

  return {
    ...decision,
    reasonCode: decision.outcome === 'ALLOW' ? 'EQUIVALENT_ACTION_BYPASS_DENIED' : decision.reasonCode,
    outcome: decision.outcome === 'ALLOW' ? 'DENY' : decision.outcome,
    reason:
      decision.outcome === 'ALLOW'
        ? `Generic HTTP cannot bypass ${equivalent} policy without dedicated governed route.`
        : `Generic HTTP blocked as equivalent of ${equivalent}: ${decision.reason}`,
    httpStatus: 403,
    approvalSatisfied: false,
  }
}

export function equivalentKindResolves(kind: string): boolean {
  return resolveCanonicalDangerousKind(kind) !== null
}
