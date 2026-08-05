export type OpportunityAgentPersistenceReadiness = {
  persistence: 'session_only' | 'durable_disabled'
  durableAvailable: false
  migrationRequired: true
  requiredMigration: 'supabase/war_room_phase49c_opportunity_agents.sql'
  reason: string
}

export function getOpportunityAgentPersistenceReadiness(): OpportunityAgentPersistenceReadiness {
  return {
    persistence: 'durable_disabled',
    durableAvailable: false,
    migrationRequired: true,
    requiredMigration: 'supabase/war_room_phase49c_opportunity_agents.sql',
    reason: 'Existing opportunity tables do not preserve full Opportunity Agent work packets, source evidence, Commander ownership, status audit history, and estimated-vs-actual revenue separation. SQL proposal is review-only and not applied.',
  }
}
