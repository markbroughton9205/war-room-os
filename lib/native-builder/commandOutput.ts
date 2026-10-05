/**
 * Bounded, in-process ring buffer of live command output, keyed by repairId.
 *
 * This is deliberately NOT persistence: it is a live-progress side channel for the SSE stream
 * (app/api/mission-runtime/engineering/[id]/stream/route.ts polls it between mission-state polls).
 * The authoritative record remains the redacted, truncated stdout/stderr stored on
 * NativeValidationResult by validationRunner — this buffer exists only so the Output tab can show
 * output WHILE a command runs, and it never outlives the server process.
 *
 * Bounds (both enforced, whichever hits first): the last MAX_LINES lines and the last MAX_BYTES
 * bytes; run markers (system entries) are kept until MAX_MARKERS of them accumulate. Every appended chunk is already secret-redacted by the caller (validationRunner) before
 * it reaches this module — this module trusts but does not re-verify that, and stores nothing else.
 */

export type CommandOutputEntry = {
  sequence: number
  operationId: string
  stream: 'stdout' | 'stderr' | 'system'
  text: string
  at: string
}

const MAX_LINES = 2000
const MAX_BYTES = 256 * 1024
const MAX_MARKERS = 200

type BufferState = { entries: CommandOutputEntry[]; nextSequence: number; totalBytes: number }

const buffers = new Map<string, BufferState>()

export function appendCommandOutput(
  repairId: string,
  operationId: string,
  stream: CommandOutputEntry['stream'],
  text: string,
): CommandOutputEntry {
  const state = buffers.get(repairId) ?? { entries: [], nextSequence: 1, totalBytes: 0 }
  const entry: CommandOutputEntry = {
    sequence: state.nextSequence++,
    operationId,
    stream,
    text,
    at: new Date().toISOString(),
  }
  state.entries.push(entry)
  state.totalBytes += text.length
  while (state.entries.length > MAX_LINES || state.totalBytes > MAX_BYTES) {
    // Output is evicted oldest first, but a run marker ("[run] <command>") outlives the flood it introduced: without it the tail no longer says which
    // command produced it. Markers are few and small; only when there are more than MAX_MARKERS does the oldest marker go too.
    const markers = state.entries.filter(entry => entry.stream === 'system').length
    const at = markers > MAX_MARKERS ? state.entries.findIndex(entry => entry.stream === 'system') : state.entries.findIndex(entry => entry.stream !== 'system')
    const evicted = state.entries.splice(at >= 0 ? at : 0, 1)[0]
    if (!evicted) break
    state.totalBytes -= evicted.text.length
  }
  buffers.set(repairId, state)
  return entry
}

/** Entries with sequence > afterSequence — the stream route's incremental read. */
export function getCommandOutput(repairId: string, afterSequence = 0): CommandOutputEntry[] {
  const state = buffers.get(repairId)
  if (!state) return []
  return state.entries.filter(e => e.sequence > afterSequence)
}

/** Full current contents (ring-bounded) — used when a client reconnects and wants the tail. */
export function getCommandOutputTail(repairId: string, maxEntries = 200): CommandOutputEntry[] {
  const state = buffers.get(repairId)
  if (!state) return []
  return state.entries.slice(-maxEntries)
}

export function clearCommandOutput(repairId: string): void {
  buffers.delete(repairId)
}
