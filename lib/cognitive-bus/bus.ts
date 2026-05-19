import type {
  CognitiveBusEvent,
  CognitiveBusEventType,
  CouncilThreadState,
} from '@/lib/cognitive-bus/types'

const MAX_EVENTS_PER_THREAD = 400

type ThreadBucket = {
  events: CognitiveBusEvent[]
  state: CouncilThreadState
}

const threads = new Map<string, ThreadBucket>()

function initialThreadState(threadId: string): CouncilThreadState {
  return {
    threadId,
    phase: 'intake',
    correlationId: null,
    operatorPacket: null,
    lastEventAt: null,
    inheritedContext: {},
  }
}

function getBucket(threadId: string): ThreadBucket {
  const key = threadId.trim() || 'default'
  let bucket = threads.get(key)
  if (!bucket) {
    bucket = { events: [], state: initialThreadState(key) }
    threads.set(key, bucket)
  }
  return bucket
}

export function getCouncilThreadState(threadId: string): CouncilThreadState {
  return { ...getBucket(threadId).state }
}

export function listCognitiveBusEvents(threadId: string, limit = 80): CognitiveBusEvent[] {
  const cap = Math.min(Math.max(1, limit), MAX_EVENTS_PER_THREAD)
  const events = getBucket(threadId).events
  return events.slice(-cap)
}

export function publishCognitiveBusEvent(input: {
  threadId: string
  type: CognitiveBusEventType
  payload?: Record<string, unknown>
  correlationId?: string
}): CognitiveBusEvent {
  const bucket = getBucket(input.threadId)
  const event: CognitiveBusEvent = {
    id: crypto.randomUUID(),
    threadId: bucket.state.threadId,
    type: input.type,
    at: new Date().toISOString(),
    correlationId: input.correlationId ?? bucket.state.correlationId ?? undefined,
    payload: input.payload && typeof input.payload === 'object' ? input.payload : {},
  }
  bucket.events.push(event)
  if (bucket.events.length > MAX_EVENTS_PER_THREAD) {
    bucket.events.splice(0, bucket.events.length - MAX_EVENTS_PER_THREAD)
  }
  bucket.state.lastEventAt = event.at
  if (input.correlationId) bucket.state.correlationId = input.correlationId
  return event
}

export function patchCouncilThreadState(
  threadId: string,
  patch: Partial<CouncilThreadState>,
): CouncilThreadState {
  const bucket = getBucket(threadId)
  bucket.state = {
    ...bucket.state,
    ...patch,
    threadId: bucket.state.threadId,
    inheritedContext: {
      ...bucket.state.inheritedContext,
      ...(patch.inheritedContext ?? {}),
    },
  }
  return { ...bucket.state }
}

export function resetCognitiveBusThread(threadId: string): void {
  threads.delete(threadId.trim() || 'default')
}

/** Merge persisted events into memory bus (idempotent by event id). */
export function hydrateCognitiveBusThread(
  threadId: string,
  events: CognitiveBusEvent[],
  state?: Partial<CouncilThreadState>,
): void {
  const bucket = getBucket(threadId)
  const seen = new Set(bucket.events.map(e => e.id))
  for (const event of events) {
    if (seen.has(event.id)) continue
    bucket.events.push(event)
    seen.add(event.id)
  }
  bucket.events.sort((a, b) => a.at.localeCompare(b.at))
  if (bucket.events.length > MAX_EVENTS_PER_THREAD) {
    bucket.events = bucket.events.slice(-MAX_EVENTS_PER_THREAD)
  }
  if (state) {
    bucket.state = {
      ...bucket.state,
      ...state,
      threadId: bucket.state.threadId,
      inheritedContext: { ...bucket.state.inheritedContext, ...(state.inheritedContext ?? {}) },
    }
  }
}
