import 'server-only'

export const SUPABASE_SERVICE_ROLE_ENV = 'SUPABASE_SERVICE_ROLE_KEY'
export const SERVER_ONLY_SUPABASE_SECRET_LABEL = 'server-only Supabase role secret'

const SERVER_ONLY_ENV_NAMES = new Set([SUPABASE_SERVICE_ROLE_ENV])

export function isServerOnlyEnvName(name: string): boolean {
  return SERVER_ONLY_ENV_NAMES.has(name)
}

export function redactServerOnlyEnvName(name: string): string {
  return isServerOnlyEnvName(name) ? SERVER_ONLY_SUPABASE_SECRET_LABEL : name
}

export function redactServerOnlyEnvNames(names: string[]): string[] {
  return names.map(redactServerOnlyEnvName)
}
