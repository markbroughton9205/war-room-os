import { agentMayAccessMemoryScope, agentMayWriteMemoryScope } from '@/lib/council/nebula/memory'
import { tryPersistMemoryProposalFromModelOutput } from './ingestFromModel'
import type { WarRoomSupabase } from '@/lib/war-room/persistence'

/**
 * MEMORY-14 (audit finding, then reconciled 2026-09-06 against an explicit "do not assume the
 * prior fix is complete" instruction). Full architecture trace, with evidence:
 *
 *   - lib/council/nebula/memory.ts's NebulaMemoryScope taxonomy (working/private/council/mission/
 *     commander/global/constellation) has NO real persistence layer anywhere in this codebase.
 *     createWorkingMemory() (the only function that builds a NebulaMemoryRecord) has zero callers
 *     outside its own file. There is no table, no insert call, no read call for Nebula-scoped
 *     memory anywhere - it is a fully-designed type/policy system with nothing wired to it yet.
 *   - war_room_memory_proposals (supabase/war_room_production_init.sql) is a SEPARATE, legacy
 *     family-attribution system: its check constraint enumerates exactly the 8 MemoryFamilyPartition
 *     values ('ChatGPT Family', ... 'Baby AI Observer') - no scope column, zero overlap with
 *     NebulaMemoryScope's 7 values.
 *   - Conclusion: war_room_memory_proposals is NOT the Nebula-scoped-memory persistence layer, and
 *     no real write path for Nebula-scoped memory exists to enforce agentMayWriteMemoryScope
 *     against. An earlier pass of this fix called agentMayWriteMemoryScope(nebulaAgentId,
 *     'mission') inside ingestFromModel.ts - a hard-coded, always-'mission', always-permitted
 *     (every agent has 'mission' access) decorative check with no relationship to anything real in
 *     this table. It has been REMOVED (see ingestFromModel.ts) rather than kept for appearances -
 *     building a real Nebula-memory write boundary is new functionality, not a repair, and is out
 *     of scope here.
 *
 * What genuinely IS real and is tested below:
 *   1. agentMayWriteMemoryScope/agentMayAccessMemoryScope's own semantics (unchanged, exercised
 *      directly as pure functions) - these prove the POLICY is internally correct, not that it is
 *      wired to any live write boundary, since none exists to wire it to.
 *   2. The real vulnerability found and fixed in the live path this table DOES have: a model
 *      self-reporting a family_partition different from its real, caller-known emitting seat is
 *      rejected before insertion.
 *   3. A second, independent fail-closed check: if a caller ever supplies an emittingSeat whose
 *      own partition mapping disagrees with the fallbackPartition it also supplied, the write is
 *      rejected rather than trusting fallbackPartition blindly - this is the "fail closed when
 *      emitting identity is unavailable/inconsistent at an authorization boundary" the mission
 *      asked for, applied to the one authorization boundary that actually exists in this table.
 */

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

/** Minimal fake Supabase client: records whether/what insert() was called with, never touches a
 * real database. Mirrors the .from().insert().select().single() chain lib/memory/store.ts uses. */
function makeMockClient(): { client: WarRoomSupabase; insertCalls: Record<string, unknown>[] } {
  const insertCalls: Record<string, unknown>[] = []
  const chain = {
    insert(payload: Record<string, unknown>) {
      insertCalls.push(payload)
      return chain
    },
    select() {
      return chain
    },
    single() {
      return Promise.resolve({ data: { id: 'mock-proposal-id' }, error: null })
    },
  }
  const client = { from: () => chain } as unknown as WarRoomSupabase
  return { client, insertCalls }
}

export async function runMemoryScopeAuthorizationValidation(): Promise<CaseResult[]> {
  const results: CaseResult[] = []

  // --- Policy function semantics: real, unchanged, but NOT wired to any live write boundary
  // (none exists - see file header). Exercising it directly proves the policy itself is correct,
  // not that MEMORY-14's original framing (enforce it in the live durable path) is achievable
  // without building new persistence that doesn't exist yet. ---
  results.push(check(
    'policy_authorized_agent_permitted_scope_succeeds',
    agentMayWriteMemoryScope('aurora', 'council') === true,
    'AURORA is one of the two agents DEFAULT_ALLOWED_SCOPES grants council-scope write to (pure policy function, not wired to any live path)',
  ))
  results.push(check(
    'policy_unauthorized_agent_protected_scope_rejected',
    agentMayWriteMemoryScope('orion', 'council') === false,
    'ORION is not aurora/lumen - council scope write must stay rejected for it (pure policy function, not wired to any live path)',
  ))
  results.push(check(
    'policy_global_commander_constellation_restrictions_preserved',
    agentMayWriteMemoryScope('astra', 'global') === false
    && agentMayWriteMemoryScope('astra', 'commander') === false
    && agentMayWriteMemoryScope('aurora', 'global') === false
    && agentMayWriteMemoryScope('aurora', 'commander') === false
    && agentMayWriteMemoryScope('orion', 'constellation') === false
    && agentMayWriteMemoryScope('astra', 'constellation') === true,
    'global/commander stay categorically unwritable regardless of agent; constellation stays astra-only - unchanged from the pre-existing policy function',
  ))
  results.push(check(
    'policy_read_access_also_blocks_global_commander',
    agentMayAccessMemoryScope('astra', 'global') === false && agentMayAccessMemoryScope('astra', 'commander') === false,
    'agentMayAccessMemoryScope (read side) independently blocks global/commander too',
  ))

  // --- Live path: the real, existing authorization boundary in war_room_memory_proposals is
  // family_partition identity, not Nebula scope (which this table has no concept of at all). ---
  const { client: authorizedClient, insertCalls: authorizedInserts } = makeMockClient()
  const authorizedResult = await tryPersistMemoryProposalFromModelOutput({
    client: authorizedClient,
    responseText: 'MEMORY_PROPOSAL:{"family_partition":"Claude Family","title":"t","content":"c"}',
    fallbackPartition: 'Claude Family',
    emittingSeat: 'claude',
    conversationId: null,
  })
  results.push(check(
    'authorized_write_matching_real_identity_succeeds',
    authorizedResult.inserted === true && authorizedInserts.length === 1
    && authorizedInserts[0]?.family_partition === 'Claude Family',
    `inserted=${authorizedResult.inserted} insertCalls=${authorizedInserts.length} skipReason=${authorizedResult.skipReason ?? 'none'}`,
  ))

  // ORION (claude seat) is the real emitting identity, but the model's own response text
  // self-reports a DIFFERENT, valid enum partition ("Red Team") - this must be rejected, not
  // silently corrected to the real identity and not silently trusted as claimed.
  const { client: spoofedClient, insertCalls: spoofedInserts } = makeMockClient()
  const spoofedResult = await tryPersistMemoryProposalFromModelOutput({
    client: spoofedClient,
    responseText: 'MEMORY_PROPOSAL:{"family_partition":"Red Team","title":"t","content":"c"}',
    fallbackPartition: 'Claude Family',
    emittingSeat: 'claude',
    conversationId: null,
  })
  results.push(check(
    'model_self_reporting_different_partition_does_not_bypass_authorization',
    spoofedResult.inserted === false
    && spoofedResult.skipReason === 'unauthorized_scope_self_report'
    && spoofedInserts.length === 0,
    `inserted=${spoofedResult.inserted} skipReason=${spoofedResult.skipReason} insertCalls=${spoofedInserts.length} (must be 0 - rejected BEFORE insertion)`,
  ))

  // Fail-closed check: caller supplies an emittingSeat ('grok') whose own partition mapping
  // ('Grok Family') disagrees with the fallbackPartition it also supplied ('Claude Family') - a
  // bug upstream, or inconsistent identity at this boundary. Must reject, not trust either value
  // arbitrarily.
  const { client: mismatchClient, insertCalls: mismatchInserts } = makeMockClient()
  const mismatchResult = await tryPersistMemoryProposalFromModelOutput({
    client: mismatchClient,
    responseText: 'MEMORY_PROPOSAL:{"family_partition":"Claude Family","title":"t","content":"c"}',
    fallbackPartition: 'Claude Family',
    emittingSeat: 'grok',
    conversationId: null,
  })
  results.push(check(
    'inconsistent_emittingSeat_and_fallbackPartition_fails_closed',
    mismatchResult.inserted === false
    && mismatchResult.skipReason === 'emitting_seat_fallback_partition_mismatch'
    && mismatchInserts.length === 0,
    `inserted=${mismatchResult.inserted} skipReason=${mismatchResult.skipReason} insertCalls=${mismatchInserts.length} (must be 0 - failed closed before insertion)`,
  ))

  // Legacy callers that don't pass emittingSeat at all must keep working exactly as before - this
  // repair adds enforcement, it does not require every caller to be updated to remain functional
  // (though the one real caller in execute.ts was updated to pass it).
  const { client: legacyClient, insertCalls: legacyInserts } = makeMockClient()
  const legacyResult = await tryPersistMemoryProposalFromModelOutput({
    client: legacyClient,
    responseText: 'MEMORY_PROPOSAL:{"family_partition":"Claude Family","title":"t","content":"c"}',
    fallbackPartition: 'Claude Family',
    conversationId: null,
  })
  results.push(check(
    'caller_without_emittingSeat_still_functions_unchanged',
    legacyResult.inserted === true && legacyInserts.length === 1,
    `inserted=${legacyResult.inserted} insertCalls=${legacyInserts.length}`,
  ))

  return results
}
