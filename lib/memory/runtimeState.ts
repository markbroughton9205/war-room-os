export type MemoryRuntimeState =
  | 'ONLINE'
  | 'TEMPORARY'
  | 'DEGRADED'
  | 'OFFLINE'
  | 'INITIALIZING'

export type MemoryRuntimeDescriptor = {
  state: MemoryRuntimeState
  label: string
  commanderPhrase: string
  persistenceAvailable: boolean
  sessionOnly: boolean
}

const RAW_BACKEND_FAILURE =
  /\b(blocked by missing memory table|missing relation|relation .* does not exist|does not exist|schema cache|permission denied|postgres|postgrest|supabase|database error|sqlstate|pgrst\d+|42p01|42501)\b/i

const INITIALIZING_SIGNAL =
  /\b(initializ|migration|required|schema|table)\b/i

const PERMISSION_SIGNAL =
  /\b(permission denied|42501|rls|policy)\b/i

export function isRawMemoryRuntimeFailure(value: unknown): boolean {
  if (typeof value === 'string') return RAW_BACKEND_FAILURE.test(value)
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return [record.message, record.error, record.details, record.hint, record.code]
    .filter((part): part is string => typeof part === 'string')
    .some(part => RAW_BACKEND_FAILURE.test(part))
}

export function mapRawMemoryRuntimeState(value: unknown, opts?: { configured?: boolean }): MemoryRuntimeDescriptor {
  const raw = typeof value === 'string'
    ? value
    : value && typeof value === 'object'
      ? JSON.stringify(value)
      : ''
  const configured = opts?.configured ?? true

  if (!configured) {
    return {
      state: 'OFFLINE',
      label: 'Durable Memory Offline',
      commanderPhrase: 'Durable memory offline',
      persistenceAvailable: false,
      sessionOnly: true,
    }
  }

  if (!raw.trim()) {
    return {
      state: 'ONLINE',
      label: 'Durable Memory Online',
      commanderPhrase: 'Durable memory online',
      persistenceAvailable: true,
      sessionOnly: false,
    }
  }

  if (PERMISSION_SIGNAL.test(raw)) {
    return {
      state: 'DEGRADED',
      label: 'Learning Persistence Unavailable',
      commanderPhrase: 'Learning persistence unavailable',
      persistenceAvailable: false,
      sessionOnly: true,
    }
  }

  if (INITIALIZING_SIGNAL.test(raw) || isRawMemoryRuntimeFailure(raw)) {
    return {
      state: 'TEMPORARY',
      label: 'Observer Session Mode',
      commanderPhrase: 'Session-only learning active',
      persistenceAvailable: false,
      sessionOnly: true,
    }
  }

  return {
    state: 'DEGRADED',
    label: 'Temporary Learning',
    commanderPhrase: 'Observer in temporary learning mode',
    persistenceAvailable: false,
    sessionOnly: true,
  }
}

export function sanitizeMemoryRuntimeText(value: string): string {
  if (!value.trim()) return value
  if (!isRawMemoryRuntimeFailure(value)) return value
  return mapRawMemoryRuntimeState(value).commanderPhrase
}
