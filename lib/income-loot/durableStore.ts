export type IncomeLootPersistenceReadiness = {
  persistence: 'session_only'
  durableAvailable: false
  schemaReady: boolean
  migrationRequired: boolean
  adapterRequired: true
  requiredMigration: 'supabase/war_room_phase49f_income_loot_core.sql'
  reason: string
}

export function getIncomeLootPersistenceReadiness(
  env: NodeJS.ProcessEnv = process.env,
): IncomeLootPersistenceReadiness {
  const schemaReady = env.INCOME_LOOT_SCHEMA_READY === 'true'
  return {
    persistence: 'session_only',
    durableAvailable: false,
    schemaReady,
    migrationRequired: !schemaReady,
    adapterRequired: true,
    requiredMigration: 'supabase/war_room_phase49f_income_loot_core.sql',
    reason: schemaReady
      ? 'The Phase 49-F schema is applied with RLS. The application store remains session-only until a database-backed adapter is implemented and validated.'
      : 'The Phase 49-F schema has not been confirmed in this environment; opportunity and evidence metadata remain session-only.',
  }
}
