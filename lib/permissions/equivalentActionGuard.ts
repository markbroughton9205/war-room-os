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

const FORBIDDEN_GIT_MUTATIONS = /^(commit|push|merge|reset|rebase|checkout|clean)$/i

/** Classify a proposed shell/execFile argv for equivalent dangerous actions. */
export function classifyShellArgv(cmd: string, args: readonly string[]): CanonicalDangerousKind | null {
  const base = cmd.replace(/\.cmd$/i, '').split(/[/\\]/).pop()?.toLowerCase() ?? ''
  if (base === 'git' || cmd.toLowerCase().includes('git')) {
    const sub = args.find(a => !a.startsWith('-'))
    if (sub && FORBIDDEN_GIT_MUTATIONS.test(sub)) {
      if (/^push$/i.test(sub)) return 'push'
      if (/^commit$/i.test(sub)) return 'commit'
      return 'shell_mutating'
    }
  }
  // Free-form powershell / cmd with user string — treat as shell_mutating if flags suggest mutation
  if (base === 'powershell' || base === 'pwsh' || base === 'cmd') {
    const joined = args.join(' ').toLowerCase()
    if (/\bgit\s+push\b/.test(joined)) return 'push'
    if (/\bgit\s+commit\b/.test(joined)) return 'commit'
    if (/\bRemove-Item\b|\brm\s+-rf\b|\bdel\s+/i.test(joined)) return 'delete_data'
    if (joined.includes('deploy') || joined.includes('vercel') || joined.includes('netlify')) return 'deploy'
  }
  return null
}

/** Classify HTTP method+URL for equivalent external mutation. */
export function classifyHttpMutation(method: string, url: string): CanonicalDangerousKind | null {
  const m = method.toUpperCase()
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return null
  if (m === 'POST' || m === 'PUT' || m === 'PATCH' || m === 'DELETE') {
    let host = ''
    try {
      host = new URL(url).hostname.toLowerCase()
    } catch {
      return 'external_account'
    }
    // Read-only search/provider hosts used by War Room research — not external_account mutation
    const readOnlyHosts = [
      'api.tavily.com',
      'api.search.brave.com',
      'api.firecrawl.dev',
      'api.x.ai',
      'generativelanguage.googleapis.com',
      'api.openai.com',
      'api.anthropic.com',
      'api.github.com',
      'earthquake.usgs.gov',
      'api.met.no',
    ]
    if (readOnlyHosts.some(h => host === h || host.endsWith(`.${h}`))) {
      // Provider search/completion POSTs are read/discovery, not account mutation —
      // return null so caller treats as research/fetch, not EXTERNAL_MUTATION bypass.
      return null
    }
    // Payment / bank / trade hosts would be financial
    if (/stripe|paypal|plaid|coinbase|binance|broker|brokerage/.test(host)) return 'financial'
    if (m === 'DELETE') return 'external_account'
    return 'external_account'
  }
  return null
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
  if (input.researchDiscovery) {
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
