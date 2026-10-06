import type { FoundryMissionRecord } from './foundryMissionTypes'
export type MissionControlCommand = 'pause' | 'resume' | 'cancel'
/** Primary mission publication serializes command revisions with executor checkpoints. */
export function reconcileMissionControl(existing: FoundryMissionRecord | null, incoming: FoundryMissionRecord, command?: MissionControlCommand): void {
  if (!existing) {
    incoming.controlRevision = command ? 1 : incoming.controlRevision ?? 0
    return
  }
  const terminal = ['COMPLETE', 'CANCELLED', 'FAILED'].includes(existing.status)
  if (terminal && (command || incoming.status !== existing.status)) {
    Object.assign(incoming, existing)
    return
  }
  const revision = existing.controlRevision ?? 0
  const stale = revision > (incoming.controlRevision ?? 0)
  if (command && !existing.cancelRequested && !terminal) {
    // Commands change control intent, never executor evidence. The request may
    // have loaded its snapshot before an in-flight tool published its result.
    const commandJournal = incoming.journal
    Object.assign(incoming, existing)
    incoming.journal = [...existing.journal, ...commandJournal]
    incoming.pauseRequested = command === 'pause'
    incoming.cancelRequested = command === 'cancel'
    if (command === 'resume') incoming.blocker = null
    incoming.controlRevision = revision + 1
  } else if (stale || (existing.cancelRequested && !incoming.cancelRequested)) {
    incoming.controlRevision = revision
    incoming.pauseRequested = existing.pauseRequested
    incoming.cancelRequested = existing.cancelRequested
    incoming.status = existing.status
  }
  if (incoming.modelState && existing.modelState) {
    incoming.modelState.calls = Math.max(incoming.modelState.calls, existing.modelState.calls)
    incoming.modelState.providerFailures = Math.max(incoming.modelState.providerFailures, existing.modelState.providerFailures)
  }
  // A stale executor checkpoint may add real evidence, but cannot erase a command journal.
  const entries = new Map([...existing.journal, ...incoming.journal].map(entry => [`${entry.at}\0${entry.kind}\0${entry.text}`, entry]))
  incoming.journal = [...entries.values()].sort((a, b) => a.at.localeCompare(b.at))
}
