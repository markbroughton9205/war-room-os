/**
 * Bounded MEMORY store probe. Prints counts and client status only. No row dumps. No secrets.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

function loadEnvLocal(): void {
  const path = join(process.cwd(), '.env.local')
  if (!existsSync(path)) return
  for (const rawLine of readFileSync(path, 'utf8').split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 1) continue
    const name = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (!process.env[name]) process.env[name] = value
  }
}

function classify(haystack: string): string[] {
  const t = haystack.toLowerCase()
  const tags: string[] = []
  if (/experiment 004|exp-004|exp 004/.test(t)) tags.push('exp004')
  if (/wrim-0|wrim0|active core/.test(t)) tags.push('wrim0')
  if (/experiment 003|exp-003|exp 003/.test(t)) tags.push('exp003')
  if (/lora|r=2|rank/.test(t)) tags.push('lora')
  if (/tavily|401/.test(t)) tags.push('tavily')
  if (/memory gold|class gap|v4/.test(t)) tags.push('v4')
  if (/observer|raw until review/.test(t)) tags.push('observer')
  if (/tool learning|wrim tool/.test(t)) tags.push('tool_learning')
  return tags
}

async function countTable(
  client: ReturnType<typeof createSupabaseAdminClient>,
  table: string,
  select: string,
  haystackOf: (row: Record<string, unknown>) => string,
): Promise<{
  ok: boolean
  count: number
  classified: Record<string, number>
  error_class: string | null
  error_code: string | null
}> {
  const { data, error } = await client.from(table).select(select).limit(80)
  if (error) {
    const msg = error.message.toLowerCase()
    const code = String(error.code ?? '')
    let error_class = 'query_error'
    if (msg.includes('does not exist') || msg.includes('42p01') || code === '42P01' || code === 'PGRST205') error_class = 'missing_relation'
    if (msg.includes('permission') || msg.includes('42501') || code === '42501') error_class = 'permission'
    if (msg.includes('invalid api key')) error_class = 'invalid_api_key'
    else if (msg.includes('expired')) error_class = 'jwt_expired'
    else if (msg.includes('malformed')) error_class = 'jwt_malformed'
    else if (msg.includes('invalid jwt') || msg.includes('jwt')) error_class = 'invalid_jwt'
    if (msg.includes('schema cache')) error_class = 'schema_cache'
    return { ok: false, count: 0, classified: {}, error_class, error_code: code || null }
  }
  const rows = (data ?? []) as unknown as Record<string, unknown>[]
  const classified: Record<string, number> = {}
  for (const row of rows) {
    for (const tag of classify(haystackOf(row))) {
      classified[tag] = (classified[tag] ?? 0) + 1
    }
  }
  return { ok: true, count: rows.length, classified, error_class: null, error_code: null }
}

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('refusing probe in production')
  }
  loadEnvLocal()
  const role = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ? 'AVAILABLE' : 'MISSING'
  console.log('SUPABASE_SERVICE_ROLE_KEY=' + role)
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? ''
  let jwt_project_matches_url = 'UNKNOWN'
  let jwt_role_service = 'UNKNOWN'
  try {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? ''
    const parts = key.split('.')
    if (parts.length === 3) {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as { ref?: string; role?: string }
      jwt_role_service = payload.role === 'service_role' ? 'YES' : 'NO'
      const host = url ? new URL(url).hostname.split('.')[0] : ''
      jwt_project_matches_url = payload.ref && host && payload.ref === host ? 'YES' : 'NO'
    } else {
      jwt_project_matches_url = 'NO'
      jwt_role_service = 'NO'
    }
  } catch {
    jwt_project_matches_url = 'UNKNOWN'
  }
  console.log('jwt_project_matches_url=' + jwt_project_matches_url)
  console.log('jwt_role_service_role=' + jwt_role_service)
  if (role !== 'AVAILABLE') {
    console.log('service_status=SERVICE_FAILURE')
    return
  }

  let client
  try {
    client = createSupabaseAdminClient()
    console.log('createSupabaseAdminClient=ok')
  } catch {
    console.log('createSupabaseAdminClient=fail')
    console.log('service_status=SERVICE_FAILURE')
    return
  }

  const memories = await countTable(client, 'memories', 'id, content, family, source', (row) =>
    [row.content, row.family, row.source].map((v) => String(v ?? '')).join(' '),
  )
  const approved = await countTable(
    client,
    'war_room_approved_memories',
    'id, title, content, family_partition',
    (row) => [row.title, row.content, row.family_partition].map((v) => String(v ?? '')).join(' '),
  )
  const records = await countTable(
    client,
    'war_room_memory_records',
    'id, content, memory_type, scope, status',
    (row) => [row.content, row.memory_type, row.scope, row.status].map((v) => String(v ?? '')).join(' '),
  )

  const total = (memories.ok ? memories.count : 0) + (approved.ok ? approved.count : 0) + (records.ok ? records.count : 0)
  const anyFail = !memories.ok && !approved.ok && !records.ok
  let service_status = 'SERVICE_AVAILABLE_STORE_EMPTY'
  if (anyFail && total === 0) service_status = 'SERVICE_FAILURE'
  else if (total > 0) service_status = 'SERVICE_AVAILABLE_WITH_DATA'

  console.log(JSON.stringify({
    service_status,
    memories: { ok: memories.ok, count: memories.count, error_class: memories.error_class, error_code: memories.error_code, classified: memories.classified },
    war_room_approved_memories: { ok: approved.ok, count: approved.count, error_class: approved.error_class, error_code: approved.error_code, classified: approved.classified },
    war_room_memory_records: { ok: records.ok, count: records.count, error_class: records.error_class, error_code: records.error_code, classified: records.classified },
    total_rows_sampled: total,
  }))
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message.replace(/eyJ[A-Za-z0-9._\-]+/g, '[REDACTED]') : 'probe_failed')
  process.exit(1)
})
