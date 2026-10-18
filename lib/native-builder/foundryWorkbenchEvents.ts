/**
 * Foundry Workbench W2 events. Uses the existing Foundry event pattern
 * (typed names + bounded persistence). Not a second EventSystem.
 */
import { randomUUID } from 'node:crypto'
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { foundryDataHierarchy } from './foundryPaths'
import { FOUNDRY_AGENT_EVENT_TYPES } from './foundryAgentEvents'

export const FOUNDRY_WORKBENCH_EVENT_TYPES = [
  'EDITOR_CONTEXT_ATTACHED',
  'AI_EDIT_PROPOSED',
  'AI_EDIT_ACCEPTED',
  'AI_EDIT_REJECTED',
  'AI_EDIT_STALE',
  'AI_EDIT_APPLIED',
  'AI_EDIT_FAILED',
  'SCM_STAGE',
  'SCM_UNSTAGE',
  'SCM_COMMIT_REQUESTED',
  'SCM_COMMIT_REFUSED',
  'SCM_COMMIT_APPROVED',
  'SCM_COMMIT_COMPLETED',
  'SCM_PUSH_REQUESTED',
  'SCM_PUSH_REFUSED',
  'SCM_PUSH_APPROVED',
  'SCM_PUSH_COMPLETED',
  'DEBUG_CONTEXT_ATTACHED',
  'DEBUG_EXPLAIN_REQUESTED',
  'DEBUG_FIX_PROPOSED',
  'TEST_RUN_OBSERVED',
  'TEST_FAILURE_ATTACHED',
  'TEST_EXPLAIN_REQUESTED',
  'TEST_FIX_PROPOSED',
  'TEST_FIX_VERIFIED',
  'ADAPTER_ACTIVATED',
  'ADAPTER_DAP_SESSION_OBSERVED',
  'EXTENSION_REVIEWED',
  'EXTENSION_APPROVED',
  'EXTENSION_INSTALLED',
  'EXTENSION_UPDATED',
  'EXTENSION_DISABLED',
  'EXTENSION_ENABLED',
  'EXTENSION_REMOVED',
  'EXTENSION_QUARANTINED',
] as const

export type FoundryWorkbenchEventType = (typeof FOUNDRY_WORKBENCH_EVENT_TYPES)[number]

export type FoundryWorkbenchEvent = {
  eventId: string
  at: string
  type: FoundryWorkbenchEventType
  text: string
  proposalId?: string
  path?: string
  metadata?: Record<string, string | number | boolean | null>
}

const MAX_EVENTS = 80

function eventsPath(): string {
  const dir = path.join(foundryDataHierarchy().foundryRoot, 'workbench')
  mkdirSync(dir, { recursive: true })
  return path.join(dir, 'events.jsonl')
}

export function foundryWorkbenchEventsRegisteredOnAgentBus(): boolean {
  return FOUNDRY_WORKBENCH_EVENT_TYPES.every(type => (FOUNDRY_AGENT_EVENT_TYPES as readonly string[]).includes(type))
}

export function appendFoundryWorkbenchEvent(
  type: FoundryWorkbenchEventType,
  text: string,
  extra?: Partial<Pick<FoundryWorkbenchEvent, 'proposalId' | 'path' | 'metadata'>>,
): FoundryWorkbenchEvent {
  const event: FoundryWorkbenchEvent = {
    eventId: randomUUID(),
    at: new Date().toISOString(),
    type,
    text: String(text ?? '').slice(0, 2_000),
    proposalId: extra?.proposalId,
    path: extra?.path,
    metadata: extra?.metadata,
  }
  try {
    appendFileSync(eventsPath(), `${JSON.stringify(event)}\n`, 'utf8')
  } catch {
    /* persistence best-effort */
  }
  return event
}

export function readFoundryWorkbenchEvents(limit = 24): FoundryWorkbenchEvent[] {
  try {
    const lines = readFileSync(eventsPath(), 'utf8').split('\n').filter(Boolean)
    const parsed = lines.map(line => {
      try {
        return JSON.parse(line) as FoundryWorkbenchEvent
      } catch {
        return null
      }
    }).filter((item): item is FoundryWorkbenchEvent => Boolean(item))
    return parsed.slice(-Math.min(limit, MAX_EVENTS))
  } catch {
    return []
  }
}
