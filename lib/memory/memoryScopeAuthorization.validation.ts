import { agentMayAccessMemoryScope, agentMayWriteMemoryScope } from '@/lib/council/nebula/memory'
import { tryPersistMemoryProposalFromModelOutput } from './ingestFromModel'
import type { WarRoomSupabase } from '@/lib/war-room/persistence'

/**
 * MEMORY-14 (audit finding): agentMayWriteMemoryScope existed but was never called from the live
 * durable memory-proposal path (lib/memory/ingestFromModel.ts / lib/memory/store.ts /
 * war_room_memory_proposals). Proves both the pre-existing policy semantics (unchanged - "do not
 * invent new scope rules") and that the live path now actually enforces identity before insertion.
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

  // --- Pure policy function: unchanged semantics, exercised directly ---
  results.push(check(
    'authorized_agent_permitted_scope_succeeds',
    agentMayWriteMemoryScope('aurora', 'council') === true,
    'AURORA is one of the two agents DEFAULT_ALLOWED_SCOPES grants council-scope write to',
  ))
  results.push(check(
    'unauthorized_agent_protected_scope_rejected',
    agentMayWriteMemoryScope('orion', 'council') === false,
    'ORION is not aurora/lumen - council scope write must stay rejected for it',
  ))
  results.push(check(
    'global_commander_restrictions_preserved',
    agentMayWriteMemoryScope('astra', 'global') === false
    && agentMayWriteMemoryScope('astra', 'commander') === false
    && agentMayWriteMemoryScope('aurora', 'global') === false
    && agentMayWriteMemoryScope('aurora', 'commander') === false,
    'global/commander stay categorically unwritable regardless of agent - unchanged from the pre-existing policy function',
  ))
  results.push(check(
    'read_access_also_blocks_global_commander',
    agentMayAccessMemoryScope('astra', 'global') === false && agentMayAccessMemoryScope('astra', 'commander') === false,
    'agentMayAccessMemoryScope (read side) independently blocks global/commander too',
  ))

  // --- Live path enforcement: lib/memory/ingestFromModel.ts must actually call the policy above
  // and must reject a self-reported identity mismatch BEFORE ever reaching insertMemoryProposal ---
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
