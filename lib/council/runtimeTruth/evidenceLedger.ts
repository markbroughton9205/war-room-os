/**
 * Per-round evidence ledger for runtime-truth enforcement.
 *
 * A ledger is built FRESH for a single /api/chat request and never persisted or read back across
 * requests -- that is what keeps Test 4 (prior-round contamination) honest: there is no shared
 * store a later round could accidentally read from, because a new ledger only ever contains
 * entries added during ITS OWN request's own execution, from checks that request itself performed
 * (e.g. the Ollama reachability probe every local seat call already makes). Nothing here invents
 * evidence -- callers add an entry only when a real check genuinely ran and produced a real result.
 */

export type EvidenceStatus = 'succeeded' | 'failed' | 'not_executed'

export type EvidenceActionType = 'restart' | 'health_check' | 'verify' | 'deploy' | 'other'

export type EvidenceLedgerEntry = {
  toolOrAction: string
  actionType: EvidenceActionType
  status: EvidenceStatus
  startedAt: string | null
  completedAt: string | null
  success: boolean | null
  resultSummary: string
  /** Names/aliases this evidence covers, for fuzzy claim matching. Lowercase comparison. */
  resourceAffected: string[]
  telemetrySource: string
}

export type RoundEvidenceLedger = {
  roundId: string
  entries: EvidenceLedgerEntry[]
}

export function createEvidenceLedger(roundId: string): RoundEvidenceLedger {
  return { roundId, entries: [] }
}

export function addEvidence(ledger: RoundEvidenceLedger, entry: EvidenceLedgerEntry): void {
  ledger.entries.push(entry)
}

/**
 * Real, already-running evidence: every local seat call probes Ollama reachability before
 * generating (lib/native-builder/ollamaClient.ts probeOllama()). Surfacing that as ledger evidence
 * lets a claim like "the local model backend is reachable/online" be genuinely VERIFIED without
 * inventing a new probe just for this guard -- it reuses the exact check the round already made.
 */
export function addOllamaProbeEvidence(
  ledger: RoundEvidenceLedger,
  probe: { available: boolean; baseUrl: string; detail: string },
): void {
  const now = new Date().toISOString()
  addEvidence(ledger, {
    toolOrAction: 'ollama_reachability_probe',
    actionType: 'health_check',
    status: probe.available ? 'succeeded' : 'failed',
    startedAt: now,
    completedAt: now,
    success: probe.available,
    resultSummary: probe.detail,
    resourceAffected: ['ollama', 'local model backend', 'local council backend', 'local runtime'],
    telemetrySource: 'probeOllama()',
  })
}

/**
 * A single seat/turn's own recorded backend outcome, as genuine "the local runtime answered"
 * evidence -- reused by both validateProviderResults() (app/api/chat/execute.ts, ProviderResult[])
 * and the family-deliberation turn path (DeliberationTurn.backend_type), which carry the same
 * backend-completion fact in two differently-shaped records.
 */
export function addLocalBackendCompletionEvidence(
  ledger: RoundEvidenceLedger,
  args: { backendType: 'LOCAL' | 'EXTERNAL' | null | undefined; status: 'succeeded' | null | undefined; source: string },
): void {
  if (args.backendType !== 'LOCAL' || args.status !== 'succeeded') return
  const now = new Date().toISOString()
  addEvidence(ledger, {
    toolOrAction: 'local_seat_completion',
    actionType: 'health_check',
    status: 'succeeded',
    startedAt: now,
    completedAt: now,
    success: true,
    resultSummary: args.source,
    resourceAffected: ['ollama', 'local model backend', 'local council backend', 'local runtime'],
    telemetrySource: args.source,
  })
}

/** Finds ledger evidence for a claimed resource, requiring an actual succeeded check. */
export function findMatchingEvidence(
  ledger: RoundEvidenceLedger,
  resourceGuess: string,
): EvidenceLedgerEntry | null {
  const needle = resourceGuess.trim().toLowerCase()
  if (!needle) return null
  for (const entry of ledger.entries) {
    if (entry.status !== 'succeeded') continue
    for (const alias of entry.resourceAffected) {
      const hay = alias.toLowerCase()
      if (hay.includes(needle) || needle.includes(hay)) return entry
    }
  }
  return null
}
