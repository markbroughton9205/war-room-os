/**
 * Mission-level scarce resource claims (pure). Complements the file-backed pipeline locks in
 * foundryResourceLocks.ts: those guard singleton pipelines, these arbitrate task/job concurrency.
 * This is scheduling, not a usage cap: a conflicting claim queues work, it never forbids it.
 */
export type ResourceClaim = string

export type ClaimHolder = { holderId: string; claims: readonly ResourceClaim[] }
export type ClaimConflict = { claim: ResourceClaim; heldBy: string; heldClaim: ResourceClaim; reason: string }
export type PressureHint = { ramFreeMb?: number; swapUsedMb?: number; vramUsedRatio?: number }

const EXCLUSIVE = /^(GPU|RUNTIME_CONTROL|BROWSER_SESSION|PORT:\d+|SUBSYSTEM_WRITE:.+|MODEL:.+|PROJECT_WRITE:.+)$/
const KNOWN = /^(CPU_HEAVY|MEMORY_HEAVY|GPU|RUNTIME_CONTROL|BROWSER_SESSION|PORT:\d+|PROJECT_WRITE:.+|SUBSYSTEM_WRITE:.+|MODEL:.+)$/

export function isValidClaim(claim: string): boolean {
  return KNOWN.test(claim)
}

/** Local models (ollama / local) run on the one GPU, so they implicitly claim it. */
export function normalizeClaims(claims: readonly ResourceClaim[]): ResourceClaim[] {
  const out = new Set(claims.map(claim => claim.trim()).filter(Boolean))
  for (const claim of [...out]) if (/^MODEL:(ollama|local)\//i.test(claim)) out.add('GPU')
  return [...out].sort()
}

function trimSlash(value: string): string {
  return value.length > 1 ? value.replace(/\/+$/, '') : value
}

function overlap(a: ResourceClaim, b: ResourceClaim): boolean {
  if (a === b) return EXCLUSIVE.test(a)
  if (a.startsWith('PROJECT_WRITE:') && b.startsWith('PROJECT_WRITE:')) {
    // One writer per tree: nested roots overlap.
    const x = trimSlash(a.slice('PROJECT_WRITE:'.length))
    const y = trimSlash(b.slice('PROJECT_WRITE:'.length))
    return x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`)
  }
  return false
}

export function findClaimConflicts(
  requested: readonly ResourceClaim[],
  held: readonly ClaimHolder[],
  pressure: PressureHint = {},
  limits: { cpuHeavy?: number } = {},
): ClaimConflict[] {
  const want = normalizeClaims(requested)
  const conflicts: ClaimConflict[] = []
  const cpuLimit = Math.max(1, pressure.ramFreeMb !== undefined && pressure.ramFreeMb < 2048 ? 1 : (limits.cpuHeavy ?? 2))
  for (const claim of want) {
    for (const holder of held) {
      for (const heldClaim of normalizeClaims(holder.claims)) {
        if (overlap(claim, heldClaim)) {
          conflicts.push({ claim, heldBy: holder.holderId, heldClaim, reason: `${claim} is held by ${holder.holderId}` })
        }
      }
    }
    if (claim === 'CPU_HEAVY') {
      const heavy = held.filter(holder => normalizeClaims(holder.claims).includes('CPU_HEAVY'))
      if (heavy.length >= cpuLimit) {
        conflicts.push({ claim, heldBy: heavy[0].holderId, heldClaim: 'CPU_HEAVY', reason: `${heavy.length} heavy CPU jobs already running (limit ${cpuLimit})` })
      }
    }
    if (claim === 'MEMORY_HEAVY') {
      const heavy = held.find(holder => normalizeClaims(holder.claims).includes('MEMORY_HEAVY'))
      const pressured = (pressure.ramFreeMb !== undefined && pressure.ramFreeMb < 3072) || (pressure.swapUsedMb ?? 0) > 2048
      if (heavy && pressured) {
        conflicts.push({ claim, heldBy: heavy.holderId, heldClaim: 'MEMORY_HEAVY', reason: 'memory pressure with another memory-heavy job running' })
      }
    }
  }
  return conflicts
}
