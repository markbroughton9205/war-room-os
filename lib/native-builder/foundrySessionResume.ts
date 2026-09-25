/**
 * Session-list mission pointer.
 * Uses only the selected session's own ids. Never invents a mission.
 */

export function resolveSessionListMissionId(session: {
  activeMissionId?: string | null
  missionIds?: readonly string[] | null
}): string | null {
  const active = typeof session.activeMissionId === 'string' ? session.activeMissionId.trim() : ''
  if (active) return active
  const ids = session.missionIds ?? []
  for (let index = ids.length - 1; index >= 0; index -= 1) {
    const id = typeof ids[index] === 'string' ? ids[index].trim() : ''
    if (id) return id
  }
  return null
}
