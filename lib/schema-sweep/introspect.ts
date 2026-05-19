import 'server-only'

import { sanitizeSchemaError } from './sanitize'
import type { WarRoomSupabase } from '@/lib/war-room/persistence'

export type LiveSchemaCatalog = {
  mode: 'catalog_rpc' | 'information_schema' | 'postgrest_probe'
  tables: Set<string>
  columns: Map<string, Set<string>>
  indexes: Set<string>
  constraints: Set<string>
  note: string
}

type CatalogRpcPayload = {
  tables?: string[]
  columns?: Array<{ table_name: string; column_name: string }>
  indexes?: string[]
  constraints?: string[]
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

function parseRpcCatalog(data: unknown): LiveSchemaCatalog | null {
  if (!data || typeof data !== 'object') return null
  const payload = data as CatalogRpcPayload
  const tables = new Set(asStringArray(payload.tables))
  const columns = new Map<string, Set<string>>()
  for (const row of payload.columns ?? []) {
    if (!row?.table_name || !row?.column_name) continue
    const existing = columns.get(row.table_name) ?? new Set<string>()
    existing.add(row.column_name)
    columns.set(row.table_name, existing)
  }
  return {
    mode: 'catalog_rpc',
    tables,
    columns,
    indexes: new Set(asStringArray(payload.indexes)),
    constraints: new Set(asStringArray(payload.constraints)),
    note: 'Catalog loaded via war_room_introspect_catalog RPC.',
  }
}

async function tryInformationSchema(client: WarRoomSupabase): Promise<LiveSchemaCatalog | null> {
  const tablesResult = await client
    .schema('information_schema')
    .from('tables')
    .select('table_name')
    .eq('table_schema', 'public')
    .eq('table_type', 'BASE TABLE')

  if (tablesResult.error || !tablesResult.data?.length) return null

  const columnsResult = await client
    .schema('information_schema')
    .from('columns')
    .select('table_name,column_name')
    .eq('table_schema', 'public')

  if (columnsResult.error) return null

  const tables = new Set(
    tablesResult.data
      .map(row => (typeof row.table_name === 'string' ? row.table_name : null))
      .filter((name): name is string => Boolean(name)),
  )
  const columns = new Map<string, Set<string>>()
  for (const row of columnsResult.data ?? []) {
    const tableName = typeof row.table_name === 'string' ? row.table_name : null
    const columnName = typeof row.column_name === 'string' ? row.column_name : null
    if (!tableName || !columnName) continue
    const existing = columns.get(tableName) ?? new Set<string>()
    existing.add(columnName)
    columns.set(tableName, existing)
  }

  return {
    mode: 'information_schema',
    tables,
    columns,
    indexes: new Set<string>(),
    constraints: new Set<string>(),
    note: 'Tables and columns loaded from information_schema. Index and constraint checks require catalog RPC or manual validation.',
  }
}

async function tryCatalogRpc(client: WarRoomSupabase): Promise<LiveSchemaCatalog | null> {
  const result = await client.rpc('war_room_introspect_catalog')
  if (result.error || result.data == null) return null
  return parseRpcCatalog(result.data)
}

type SupabaseErrorLike = {
  message?: string
  code?: string
  details?: string
  hint?: string
}

function errorText(error: SupabaseErrorLike | null | undefined) {
  return [error?.message, error?.details, error?.hint, error?.code].filter(Boolean).join(' ')
}

function isMissingTable(error: SupabaseErrorLike | null | undefined, table: string) {
  const text = errorText(error)
  return new RegExp(`could not find .*${table}|relation .*${table}.*does not exist|undefined table|PGRST205`, 'i').test(text)
}

async function probeColumn(client: WarRoomSupabase, table: string, column: string) {
  const { error } = await client.from(table).select(column, { head: true }).limit(1)
  return !error
}

export async function probeTableColumns(
  client: WarRoomSupabase,
  table: string,
  columnNames: string[],
): Promise<{ exists: boolean; missingColumns: string[]; permissionFailed: boolean; staleSchemaCache: boolean }> {
  const tableProbe = await client.from(table).select('id', { head: true, count: 'exact' }).limit(1)
  if (tableProbe.error) {
    return {
      exists: !isMissingTable(tableProbe.error, table),
      missingColumns: isMissingTable(tableProbe.error, table) ? columnNames : [],
      permissionFailed: /permission denied|42501|row-level security/i.test(errorText(tableProbe.error)),
      staleSchemaCache: /schema cache|PGRST204|PGRST205/i.test(errorText(tableProbe.error)),
    }
  }

  const columnProbe = await client.from(table).select(columnNames.join(','), { head: true }).limit(1)
  if (!columnProbe.error) {
    return { exists: true, missingColumns: [], permissionFailed: false, staleSchemaCache: false }
  }

  const missingColumns = (
    await Promise.all(columnNames.map(async column => [column, await probeColumn(client, table, column)] as const))
  )
    .filter(([, ok]) => !ok)
    .map(([column]) => column)

  return {
    exists: true,
    missingColumns,
    permissionFailed: false,
    staleSchemaCache: /schema cache|PGRST204|PGRST205/i.test(errorText(columnProbe.error)),
  }
}

export async function introspectLiveSchema(
  client: WarRoomSupabase,
  tableNames: string[],
  columnsByTable: Map<string, string[]>,
): Promise<LiveSchemaCatalog> {
  const rpcCatalog = await tryCatalogRpc(client)
  if (rpcCatalog) return rpcCatalog

  const informationSchema = await tryInformationSchema(client)
  if (informationSchema) return informationSchema

  const tables = new Set<string>()
  const columns = new Map<string, Set<string>>()

  for (const table of tableNames) {
    const expectedColumns = columnsByTable.get(table) ?? ['id']
    const probe = await probeTableColumns(client, table, expectedColumns)
    if (probe.exists) {
      tables.add(table)
      const present = new Set(expectedColumns.filter(column => !probe.missingColumns.includes(column)))
      columns.set(table, present)
    }
  }

  return {
    mode: 'postgrest_probe',
    tables,
    columns,
    indexes: new Set<string>(),
    constraints: new Set<string>(),
    note: sanitizeSchemaError(null, 'introspect'),
  }
}
