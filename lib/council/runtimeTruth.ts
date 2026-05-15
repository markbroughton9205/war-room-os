import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import { COUNCIL_ROSTER } from '@/lib/council/familyRoster'
import type { WarRoomMode } from '@/lib/council/modeGovernor'
import type { ProviderFamilyOutcomeStatus } from '@/lib/council/providerIsolation'
import type { RoomStatus } from '@/lib/council/roomStatus'

export type VerifiedRuntimeContext = {
  family?: string
  providerStatus?: 'active' | 'pending' | 'timeout' | 'failed' | 'offline' | string
  httpStatus?: number
  errorCode?: string
  /** From PostgREST/provider only — short, no secrets */
  errorMessage?: string
  /** e.g. 'TIMED_OUT', 'IN_FLIGHT', 'DEGRADED' */
  orchestratorFlags?: string[]
}

/** Literal phrases + patterns aligned with modeGovernorFilters recovery blocks. */
const SPECULATIVE_PHRASE_PATTERNS: RegExp[] = [
  /\bnetwork\s+interplay\b/i,
  /\bbackend\s+(?:sync(?:hronization)?|synchronization)\s+problem\b/i,
  /\bbackend\s+synchronization\b/i,
  /\bsystem\s+hiccups?\b/i,
  /\bload\s+balanc(?:e|ing)\b/i,
  /\bperformance\s+anomalies?\b/i,
  /\bconnection\s+instabilit(?:y|ies)\b/i,
  /\bpersistent\s+communication\s+dodges?\b/i,
  /\bprovider\s+throttl(?:e|ing)\b/i,
  /\btargeted\s+disruption\b/i,
  /\badversar(?:y|ies)\s+may\s+exploit\b/i,
  /\bcompetitors?\s+may\s+exploit\b/i,
  /\badversary\s+(?:attack|campaign|operation)\b/i,
  /\b(?:aws|azure|gcp|cloudflare)\s+(?:outage|incident|degraded)\b/i,
  /\bprovider\s+mesh\s+(?:down|offline|compromised)\b/i,
  /\bqueue\s+(?:drained|cleared|succeeded)\b/i,
  /\b(?:all\s+)?nodes?\s+(?:online|restored|aligned)\b/i,
  /\bopenai\s+load\s+balanc(?:e|ing)\b/i,
  /\bcommunication\s+mesh\b/i,
  /\bspectral\s+(?:degradation|interference)\b/i,
]

const SECRET_LIKE = /\b(api[_-]?key|bearer\s+|password|secret|token|authorization)\b/i

function rosterLabel(family: string): string {
  return COUNCIL_ROSTER.find(r => r.id === family)?.label ?? family
}

function safeErrorSnippet(msg: string | undefined): string | undefined {
  if (!msg) return undefined
  const t = msg.replace(/\s+/g, ' ').trim().slice(0, 160)
  if (!t || SECRET_LIKE.test(t)) return undefined
  return t
}

function verifiedBlob(ctx?: VerifiedRuntimeContext): string {
  if (!ctx) return ''
  return [
    ctx.errorMessage ?? '',
    ctx.errorCode ?? '',
    ctx.providerStatus ?? '',
    ...(ctx.orchestratorFlags ?? []),
    ctx.httpStatus != null ? String(ctx.httpStatus) : '',
  ]
    .join(' ')
    .toLowerCase()
}

function hasVerifiedTimeoutSignal(ctx?: VerifiedRuntimeContext): boolean {
  if (!ctx) return false
  const blob = verifiedBlob(ctx)
  if (ctx.providerStatus === 'timeout') return true
  if (ctx.orchestratorFlags?.some(f => /timed?_?out/i.test(f))) return true
  return /\b(timeout|timed\s*out|abort|deadline|response\s+window)\b/i.test(blob)
}

function hasVerifiedPendingSignal(ctx?: VerifiedRuntimeContext): boolean {
  if (!ctx) return false
  if (ctx.providerStatus === 'pending') return true
  return Boolean(ctx.orchestratorFlags?.some(f => /in[_-]?flight|pending/i.test(f)))
}

/** Infrastructure blocklist phrases are never substantiated by status alone. */
function phraseSubstantiatedByVerified(_pattern: RegExp, ctx?: VerifiedRuntimeContext): boolean {
  if (!ctx) return false
  const msg = (ctx.errorMessage ?? '').toLowerCase()
  const code = (ctx.errorCode ?? '').toLowerCase()
  if (!msg && !code) return false
  // Only allow echoing provider-sourced timeout/abort wording — not invented infra.
  return /\b(timeout|timed\s*out|abort|deadline|response\s+window|empty\s+body)\b/i.test(`${msg} ${code}`)
}

export function isSpeculativeInfrastructureLanguage(
  text: string,
  verified?: VerifiedRuntimeContext,
): boolean {
  const t = (text ?? '').trim()
  if (!t) return false
  for (const re of SPECULATIVE_PHRASE_PATTERNS) {
    if (re.test(t) && !phraseSubstantiatedByVerified(re, verified)) return true
  }
  return false
}

export function stripUnverifiedDiagnostics(
  text: string,
  verified?: VerifiedRuntimeContext,
): { text: string; stripped: boolean; warnings: string[] } {
  const warnings: string[] = []
  const lines = (text ?? '').split('\n')
  const kept: string[] = []
  let stripped = false

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      kept.push(line)
      continue
    }
    if (isSpeculativeInfrastructureLanguage(trimmed, verified)) {
      stripped = true
      warnings.push('runtime_truth_stripped_speculative_line')
      continue
    }
    kept.push(line)
  }

  let out = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim()

  if (!stripped && isSpeculativeInfrastructureLanguage(out, verified)) {
    out = ''
    stripped = true
    warnings.push('runtime_truth_stripped_speculative_block')
  }

  return { text: out, stripped, warnings }
}

export function replaceWithRuntimeTruthLine(family: string, ctx: VerifiedRuntimeContext): string {
  const label = rosterLabel(ctx.family ?? family)

  if (hasVerifiedTimeoutSignal(ctx)) {
    const snippet = safeErrorSnippet(ctx.errorMessage)
    if (snippet && /\b(timeout|abort|deadline)\b/i.test(snippet)) {
      return `${label}: ${snippet}`
    }
    return `${label}: Provider returned timeout.`
  }

  if (ctx.providerStatus === 'failed' || ctx.orchestratorFlags?.some(f => /failed/i.test(f))) {
    const snippet = safeErrorSnippet(ctx.errorMessage)
    if (snippet) return `${label}: ${snippet}`
    return `${label}: Provider call failed.`
  }

  if (hasVerifiedPendingSignal(ctx) || ctx.providerStatus === 'offline') {
    return `${label} has not responded yet.`
  }

  if (ctx.providerStatus === 'pending') {
    return `${label} pending.`
  }

  if (ctx.orchestratorFlags?.some(f => /recovery|degraded/i.test(f))) {
    return 'Recovery ping requested.'
  }

  return `${label} pending.`
}

export type ApplyRuntimeTruthFilterOpts = {
  family: string
  mode: WarRoomMode | string
  verifiedContext?: VerifiedRuntimeContext
  roomStatuses?: RoomStatus[]
}

export function applyRuntimeTruthFilter(
  text: string,
  opts: ApplyRuntimeTruthFilterOpts,
): { text: string; warnings: string[] } {
  const warnings: string[] = []
  let t = (text ?? '').trim()
  if (!t) return { text: t, warnings }

  const verified: VerifiedRuntimeContext = {
    family: opts.family,
    ...opts.verifiedContext,
  }

  const roomStatus = opts.roomStatuses?.find(
    r => r.family === opts.family || r.family === verified.family,
  )
  if (roomStatus && !verified.providerStatus) {
    verified.providerStatus = roomStatus.status
  }

  if (opts.mode === 'recovery') {
    if (isSpeculativeInfrastructureLanguage(t, verified) || !t) {
      t = replaceWithRuntimeTruthLine(opts.family, verified)
      warnings.push('runtime_truth_recovery_replaced')
      return { text: t, warnings }
    }
  }

  const stripped = stripUnverifiedDiagnostics(t, verified)
  t = stripped.text
  warnings.push(...stripped.warnings)

  if (stripped.stripped && !t.trim() && opts.mode === 'recovery') {
    t = replaceWithRuntimeTruthLine(opts.family, verified)
    warnings.push('runtime_truth_recovery_fallback_line')
  } else if (stripped.stripped && !t.trim()) {
    warnings.push('runtime_truth_empty_after_strip')
  }

  if (t && isSpeculativeInfrastructureLanguage(t, verified)) {
    if (opts.mode === 'recovery' || opts.mode === 'attendance') {
      t = replaceWithRuntimeTruthLine(opts.family, verified)
      warnings.push('runtime_truth_replaced_residual_speculation')
    } else {
      const residual = stripUnverifiedDiagnostics(t, verified)
      t = residual.text
      warnings.push(...residual.warnings)
    }
  }

  return { text: t.trim(), warnings }
}

export function providerOutcomeToVerifiedContext(args: {
  family: CouncilOrchestrationFamily
  runtime: ProviderFamilyOutcomeStatus
  runtimeDetail?: string
  httpStatus?: number
}): VerifiedRuntimeContext {
  const { family, runtime, runtimeDetail, httpStatus } = args
  let providerStatus: VerifiedRuntimeContext['providerStatus']
  const orchestratorFlags: string[] = [runtime]

  switch (runtime) {
    case 'RESPONDED':
    case 'READY':
      providerStatus = 'active'
      break
    case 'DEGRADED':
      providerStatus = 'active'
      orchestratorFlags.push('DEGRADED')
      break
    case 'IN_FLIGHT':
      providerStatus = 'pending'
      orchestratorFlags.push('IN_FLIGHT')
      break
    case 'TIMED_OUT':
      providerStatus = 'timeout'
      orchestratorFlags.push('TIMED_OUT')
      break
    case 'FAILED':
      providerStatus = 'failed'
      break
    case 'SKIPPED':
    default:
      providerStatus = 'offline'
      break
  }

  return {
    family,
    providerStatus,
    httpStatus,
    errorMessage: safeErrorSnippet(runtimeDetail),
    errorCode: runtimeDetail && runtimeDetail.length < 64 ? runtimeDetail : undefined,
    orchestratorFlags,
  }
}

export function verifiedContextsFromProviderStates(
  states: Partial<Record<CouncilOrchestrationFamily, ProviderFamilyOutcomeStatus>> | undefined,
  details?: Partial<Record<CouncilOrchestrationFamily, string>>,
): Partial<Record<CouncilOrchestrationFamily, VerifiedRuntimeContext>> {
  if (!states) return {}
  const out: Partial<Record<CouncilOrchestrationFamily, VerifiedRuntimeContext>> = {}
  for (const [family, runtime] of Object.entries(states) as [CouncilOrchestrationFamily, ProviderFamilyOutcomeStatus][]) {
    out[family] = providerOutcomeToVerifiedContext({
      family,
      runtime,
      runtimeDetail: details?.[family],
    })
  }
  return out
}
