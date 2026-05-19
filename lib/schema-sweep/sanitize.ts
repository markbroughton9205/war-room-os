import 'server-only'

const RAW_DB_PATTERNS = [
  /PGRST\d+/i,
  /SQLSTATE/i,
  /relation .* does not exist/i,
  /permission denied/i,
  /JWT/i,
  /postgres/i,
  /postgrest/i,
  /42P01/i,
  /42501/i,
  /could not find/i,
  /schema cache/i,
]

export function containsRawDatabaseDetail(message: string): boolean {
  return RAW_DB_PATTERNS.some(pattern => pattern.test(message))
}

export function sanitizeSchemaError(error: unknown, context: 'sweep' | 'introspect' | 'migration' = 'sweep'): string {
  if (error instanceof Error && error.message && !containsRawDatabaseDetail(error.message)) {
    return error.message
  }
  if (typeof error === 'string' && !containsRawDatabaseDetail(error)) {
    return error
  }
  if (context === 'migration') {
    return 'Migration catalog comparison is unavailable from this environment. Review Supabase migration history manually.'
  }
  if (context === 'introspect') {
    return 'Live schema catalog introspection is limited. Table/column probes still run; apply optional Phase 31 introspect RPC for full index and constraint checks.'
  }
  return 'Schema sweep could not complete. Check server Supabase configuration and retry from Engineering View.'
}

export function sanitizePersistenceNote(note: string): string {
  if (!note || !containsRawDatabaseDetail(note)) return note
  return 'Supabase is reachable but schema diagnostics reported internal details. Use Engineering View → Schema Sweep for structured results.'
}
