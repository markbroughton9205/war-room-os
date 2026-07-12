import 'server-only'

export const COMMANDER_USER_ID_ENV = 'WAR_ROOM_COMMANDER_USER_ID'

export type CommanderIdentityConfigResult =
  | {
      ok: true
      commanderUserId: string
    }
  | {
      ok: false
      reason: 'missing' | 'malformed'
      message: string
    }

export type CommanderIdentityEnv = {
  WAR_ROOM_COMMANDER_USER_ID?: string | undefined
  [key: string]: string | undefined
}

export function readCommanderIdentityConfig(env: CommanderIdentityEnv = process.env): CommanderIdentityConfigResult {
  const raw = env.WAR_ROOM_COMMANDER_USER_ID
  const commanderUserId = raw?.trim()

  if (!commanderUserId) {
    return {
      ok: false,
      reason: 'missing',
      message: `${COMMANDER_USER_ID_ENV} is not configured.`,
    }
  }

  if (!isUuid(commanderUserId)) {
    return {
      ok: false,
      reason: 'malformed',
      message: `${COMMANDER_USER_ID_ENV} must be a UUID.`,
    }
  }

  return { ok: true, commanderUserId }
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}
