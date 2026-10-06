/**
 * Mission start contract (pure: no filesystem, network or clock).
 *
 *   START_REQUESTED -> START_ACKNOWLEDGED(sessionId, missionId)
 *                   -> START_FAILED(typed reason)
 *
 * A request to start work never ends as "nothing happened". Every exit of the send path is one of those three, with a plain sentence the Commander can read
 * and machine-readable attributes for anything that has to wait for the result (a test, a script) instead of guessing with a timer.
 */

export type StartFailureReason =
  | 'EMPTY_REQUEST'
  | 'NEEDS_PROJECT'
  | 'NEEDS_WORKSPACE_CONFIRMATION'
  | 'PROJECT_CREATE_FAILED'
  | 'SESSION_CREATE_FAILED'
  | 'START_REJECTED'
  | 'ALREADY_RUNNING'
  | 'NO_MISSION_RETURNED'
  | 'NETWORK'

export type StartStatus =
  | { state: 'REQUESTED'; at: string }
  | { state: 'ACKNOWLEDGED'; sessionId: string; missionId: string; at: string }
  | { state: 'FAILED'; reason: StartFailureReason; detail: string | null; at: string }

export const START_FAILURE_REASONS: readonly StartFailureReason[] = [
  'EMPTY_REQUEST', 'NEEDS_PROJECT', 'NEEDS_WORKSPACE_CONFIRMATION', 'PROJECT_CREATE_FAILED', 'SESSION_CREATE_FAILED', 'START_REJECTED', 'ALREADY_RUNNING', 'NO_MISSION_RETURNED', 'NETWORK',
]

export type StartWorkspacePlan =
  /** A workspace is known on this page or on the loaded session. */
  | { kind: 'USE'; workspaceId: string }
  /** No workspace is known yet, but the page is already inside a session: the server resolves the workspace from that session's own record. */
  | { kind: 'FROM_SESSION'; sessionId: string }
  /** Nothing is known: the Commander is asked whether to create a project. */
  | { kind: 'OFFER_PROJECT' }

/**
 * Which workspace a send goes to. A page inside a session never offers to create a new project because its local view of the workspace has not
 * loaded (or was dropped by a restart): the session itself already belongs to one.
 */
export function planStartWorkspace(input: { workspaceId: string | null; sessionWorkspaceId: string | null; sessionId: string | null }): StartWorkspacePlan {
  const known = input.workspaceId || input.sessionWorkspaceId
  if (known) return { kind: 'USE', workspaceId: known }
  if (input.sessionId) return { kind: 'FROM_SESSION', sessionId: input.sessionId }
  return { kind: 'OFFER_PROJECT' }
}

export function requested(at: string): StartStatus {
  return { state: 'REQUESTED', at }
}

export function failed(reason: StartFailureReason, at: string, detail: string | null = null): StartStatus {
  return { state: 'FAILED', reason, detail: detail ? detail.slice(0, 200) : null, at }
}

type StartResponse = { ok: boolean; status?: number; data?: { mission?: { id?: unknown } } | null; json?: Record<string, unknown> | null; error?: string | null }

/** What the server said, as one of the three outcomes. */
export function classifyStartResponse(input: { response: StartResponse; sessionId: string; at: string }): StartStatus {
  const { response, sessionId, at } = input
  if (response.status === 409 && response.json?.code === 'MISSION_ALREADY_RUNNING') return failed('ALREADY_RUNNING', at, typeof response.json.missionId === 'string' ? response.json.missionId : null)
  if (response.status === 409 && response.json?.needsConfirmation) return failed('NEEDS_WORKSPACE_CONFIRMATION', at, typeof response.json.reason === 'string' ? response.json.reason : null)
  if (response.ok) {
    const missionId = response.data?.mission?.id
    if (typeof missionId === 'string' && missionId) return { state: 'ACKNOWLEDGED', sessionId, missionId, at }
    return failed('NO_MISSION_RETURNED', at, 'The server accepted the request but did not return a mission.')
  }
  if (response.status === undefined) return failed('NETWORK', at, response.error ?? null)
  return failed('START_REJECTED', at, response.error ?? `HTTP ${response.status}`)
}

const SENTENCES: Record<StartFailureReason, string> = {
  EMPTY_REQUEST: 'Describe what you want built or fixed first.',
  NEEDS_PROJECT: "I don't have a project for this yet. Say yes to create one, or pick an existing project.",
  NEEDS_WORKSPACE_CONFIRMATION: 'This would change the War Room itself, so I need you to confirm the target before I start.',
  PROJECT_CREATE_FAILED: "I couldn't create the project, so nothing was started.",
  SESSION_CREATE_FAILED: "I couldn't open a working session, so nothing was started.",
  START_REJECTED: 'The request was refused, so nothing was started.',
  ALREADY_RUNNING: "That request is already being worked on, so I didn't start it a second time.",
  NO_MISSION_RETURNED: 'The request went through but no mission came back, so I am not treating it as started.',
  NETWORK: "I couldn't reach Foundry, so nothing was started.",
}

/** The plain sentence for the Commander. Never a code, never a raw status. */
export function startStatusSentence(status: StartStatus): string {
  if (status.state === 'REQUESTED') return 'Starting…'
  if (status.state === 'ACKNOWLEDGED') return 'Started.'
  return SENTENCES[status.reason]
}

/** Attributes for a status element: anything waiting on the start reads these instead of polling files. */
export function startStatusAttributes(status: StartStatus): Record<string, string> {
  const base: Record<string, string> = { 'data-state': status.state.toLowerCase(), 'data-at': status.at }
  if (status.state === 'ACKNOWLEDGED') return { ...base, 'data-session-id': status.sessionId, 'data-mission-id': status.missionId }
  if (status.state === 'FAILED') return { ...base, 'data-reason': status.reason.toLowerCase(), ...(status.detail ? { 'data-detail': status.detail } : {}) }
  return base
}
