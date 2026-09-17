export function isLocalDesktopCommanderRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.WAR_ROOM_PACKAGED === '1' || env.WAR_ROOM_RUNTIME_SURFACE === 'DESKTOP_LOCAL'
}

/**
 * Loopback local Commander (`wr_local_session` / bearer) is the Commander for this
 * installation. Prefer a linked remote UUID when it matches the configured Commander,
 * otherwise the configured Commander UUID (so credentialed Terra providers keep a stable
 * requestedBy), otherwise the local identity id.
 *
 * Does not require WAR_ROOM_PACKAGED — DEV :3001 and installed :3848 share this path.
 */
export function resolveLocalCommanderUserId(input: {
  loopbackOk: boolean
  localIdentityId: string | null
  linkedRemoteUserId: string | null
  configuredCommanderUserId: string | null
}): string | null {
  if (!input.loopbackOk || !input.localIdentityId) return null
  if (
    input.configuredCommanderUserId
    && input.linkedRemoteUserId
    && input.linkedRemoteUserId === input.configuredCommanderUserId
  ) {
    return input.configuredCommanderUserId
  }
  if (input.configuredCommanderUserId) return input.configuredCommanderUserId
  return input.localIdentityId
}
