/** Display only records belonging to the current page selection. Never changes durable state. */
export function missionForSelectedPage<T extends { id: string }>(mission: T | null, missionId: string | null): T | null {
  return missionId && mission?.id === missionId ? mission : null
}
export function currentWorkForSelectedPage<T extends { missionId: string; workspaceId?: string | null }>(work: T | null, page: { missionId: string | null; workspaceId: string | null; sessionId: string | null }): T | null {
  if (!work) return null
  if (page.missionId) return work.missionId === page.missionId ? work : null
  // A fresh conversation has no mission; the global Operations pointer is not its work.
  if (page.sessionId) return null
  if (page.workspaceId) return work.workspaceId === page.workspaceId ? work : null
  return work
}
