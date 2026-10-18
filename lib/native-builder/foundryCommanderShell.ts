/**
 * Client-safe Commander shell contracts.
 * Default Foundry STATUS, session visibility, and source-path policy live here so the
 * renderer never imports the server-side session store.
 */

export type CommanderEmptySessionLike = {
  id?: string
  archived?: boolean
  missionIds: string[]
  activeMissionId?: string
  chat: unknown[]
  title: string
}

export const COMMANDER_STATUS_HEADLINES = [
  'READY',
  'BUILDING',
  'TESTING',
  'VERIFYING',
  'PROJECT READY',
  'NEEDS INPUT',
] as const

export type CommanderStatusHeadline = (typeof COMMANDER_STATUS_HEADLINES)[number]

const INTERNAL_SOURCE_PATH = /^(app|components|lib|desktop|scripts|supabase)\//
const API_ROUTE_PATH = /^app\/api\//
const TS_SOURCE_PATH = /\.(ts|tsx|js|jsx|mjs|cjs)$/

export function isUntouchedEmptySession(session: CommanderEmptySessionLike): boolean {
  if (session.archived) return false
  if (session.missionIds.length > 0 || session.activeMissionId) return false
  if (session.chat.length > 0) return false
  return /^(new coding session|new session)$/i.test(session.title.trim())
}

/** Default Sessions list: real Commander work first. Empty/debug rows stay out unless selected. */
export function commanderVisibleSessions<T extends CommanderEmptySessionLike>(
  sessions: T[],
  selectedId?: string | null,
): T[] {
  return sessions.filter(session => {
    if (selectedId && session.id === selectedId) return true
    return !isUntouchedEmptySession(session)
  })
}

export function looksLikeInternalSourcePath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/').replace(/^\.?\//, '')
  if (API_ROUTE_PATH.test(normalized)) return true
  if (INTERNAL_SOURCE_PATH.test(normalized) && TS_SOURCE_PATH.test(normalized)) return true
  return false
}

export function commanderStatusHeadline(input: {
  liveWork?: boolean
  needsInput?: boolean
  testing?: boolean
  verifying?: boolean
  building?: boolean
  projectReady?: boolean
}): CommanderStatusHeadline {
  if (input.needsInput) return 'NEEDS INPUT'
  if (input.testing) return 'TESTING'
  if (input.verifying) return 'VERIFYING'
  if (input.building || input.liveWork) return 'BUILDING'
  if (input.projectReady) return 'PROJECT READY'
  return 'READY'
}

export const FOUNDRY_DEFAULT_STATUS_FORBIDDEN = [
  'foundry-file-tree',
  'app/api/',
  'app/(dashboard)',
] as const
