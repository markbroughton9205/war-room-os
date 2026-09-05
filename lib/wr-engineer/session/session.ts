/**
 * WR-Engineer engineering chat session — creation, immutable node/repo binding, and message flow.
 *
 * Load order for every WR-Engineer reply (mission brief, preserved exactly from Phase 1):
 *   IDENTITY.md -> SOUL.md -> USER.md -> current engineering mission -> node/repository/runtime
 *   context -> relevant engineering memory
 *
 * "Do not silently change target machine or repository mid-session" is enforced structurally, not
 * just by convention: EngineeringSession has no setter for nodeId/repositoryId anywhere in this
 * module. Changing target machine or repository always means calling createSession() again, which
 * mints a new sessionId — there is no code path that mutates an existing session's binding.
 */
import { randomUUID } from 'node:crypto'
import { loadIdentityStack, stackToOrderedText } from '../identity/loader'
import type { EngineeringMemoryStore } from '../memory/types'
import { engineeringMemory } from '../memory/store'
import type { AgentState, ModelAdapter } from '../types'
import { requireBoundRepository } from '../node/repository'
import type { NodeStore } from '../node/store'
import { getNodeConnectionStatus } from '../node/identity'
import type { SessionStore } from './store'
import type { EngineeringChatMessage, EngineeringSession, ToolActivityEvent } from './types'

export class SessionBindingError extends Error {}

export type CreateSessionInput = {
  commanderUserId: string
  nodeId: string
  repositoryId: string
  constraints?: string[]
}

/**
 * Binds a session to exactly one node + one repository, validated against node/repository.ts's
 * real registration records (never trusts a caller-supplied nodeId/repositoryId pair blindly).
 * Also records a REPOSITORY_FACT memory entry — this is the one place a session's binding is
 * decided, so it is also the one place that fact enters engineering memory.
 */
export async function createSession(
  nodeStore: NodeStore,
  sessionStore: SessionStore,
  input: CreateSessionInput,
  memory: EngineeringMemoryStore = engineeringMemory,
  now: Date = new Date(),
): Promise<EngineeringSession> {
  const node = await nodeStore.getNode(input.nodeId)
  if (!node) throw new SessionBindingError(`Cannot start a session against an unknown node: ${input.nodeId}`)
  if (node.revokedAt) throw new SessionBindingError(`Cannot start a session against a revoked node: ${input.nodeId}`)

  const repository = await requireBoundRepository(nodeStore, input.nodeId, input.repositoryId)

  const session: EngineeringSession = {
    sessionId: randomUUID(),
    commanderUserId: input.commanderUserId,
    wrEngineerIdentity: 'wr-engineer',
    nodeId: node.nodeId,
    repositoryId: repository.repositoryId,
    repositoryPath: repository.path,
    branch: repository.currentBranch,
    headSha: repository.headSha,
    mission: null,
    constraints: input.constraints ?? [],
    agentState: 'READY',
    proposalState: 'NONE',
    activeProposal: null,
    nativeBuilderIssueId: null,
    nativeBuilderRepairId: null,
    lastProposalRejection: null,
    turnPhase: 'READY',
    lastTurnEvidence: null,
    proposalGrounding: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  }
  await sessionStore.saveSession(session)

  await memory.record({
    category: 'REPOSITORY_FACT',
    summary: `Session ${session.sessionId} bound to ${node.nodeName}:${repository.name}`,
    detail: `node=${node.nodeId} (${node.platform}) repository=${repository.repositoryId} path=${repository.path}`,
    epistemicStatus: 'OBSERVED',
    relatedRefs: [session.sessionId, node.nodeId, repository.repositoryId],
    tags: ['session-binding'],
  })

  return session
}

async function requireSession(sessionStore: SessionStore, sessionId: string): Promise<EngineeringSession> {
  const session = await sessionStore.getSession(sessionId)
  if (!session) throw new SessionBindingError(`Unknown session: ${sessionId}`)
  return session
}

export async function setSessionAgentState(
  sessionStore: SessionStore,
  sessionId: string,
  agentState: AgentState,
  now: Date = new Date(),
): Promise<EngineeringSession> {
  const session = await requireSession(sessionStore, sessionId)
  const updated: EngineeringSession = { ...session, agentState, updatedAt: now.toISOString() }
  await sessionStore.saveSession(updated)
  return updated
}

/** Assembles the full, ordered context a model adapter call should see for this session — never
 * reorders or collapses the identity layers, and always makes the bound node/repository/mission
 * explicit rather than implied. */
export async function assembleSessionContext(
  sessionStore: SessionStore,
  nodeStore: NodeStore,
  sessionId: string,
  memory: EngineeringMemoryStore = engineeringMemory,
): Promise<string> {
  const session = await requireSession(sessionStore, sessionId)
  const identity = await loadIdentityStack()
  const sections = [stackToOrderedText(identity)]

  if (session.mission) {
    sections.push(`<<< MISSION >>>\n${JSON.stringify(session.mission, null, 2)}\n<<< END MISSION >>>`)
  }

  const node = await nodeStore.getNode(session.nodeId)
  const repository = await nodeStore.getRepository(session.repositoryId)
  sections.push(
    `<<< NODE_REPOSITORY_CONTEXT >>>\n${JSON.stringify(
      {
        node: node ? { nodeId: node.nodeId, nodeName: node.nodeName, platform: node.platform, status: getNodeConnectionStatus(node) } : null,
        repository: repository ? { repositoryId: repository.repositoryId, path: repository.path, currentBranch: repository.currentBranch, headSha: repository.headSha } : null,
        constraints: session.constraints,
      },
      null,
      2,
    )}\n<<< END NODE_REPOSITORY_CONTEXT >>>`,
  )

  const memoryRecords = await memory.query({ tag: undefined })
  const relevant = memoryRecords.filter(r => r.relatedRefs.includes(sessionId) || r.relatedRefs.includes(session.nodeId) || r.relatedRefs.includes(session.repositoryId))
  sections.push(`<<< ENGINEERING_MEMORY >>>\n${JSON.stringify(relevant, null, 2)}\n<<< END ENGINEERING_MEMORY >>>`)

  return sections.join('\n\n')
}

/**
 * Appends the Commander's message, invokes the model adapter with the full assembled context, and
 * appends WR-Engineer's reply. Transitions READY -> WORKING for the duration of the model call,
 * back to READY (or BLOCKED on adapter failure) afterward — never leaves a session stuck WORKING.
 */
export async function sendCommanderMessage(
  sessionStore: SessionStore,
  nodeStore: NodeStore,
  modelAdapter: ModelAdapter,
  sessionId: string,
  content: string,
  memory: EngineeringMemoryStore = engineeringMemory,
  now: Date = new Date(),
): Promise<{ commanderMessage: EngineeringChatMessage; replyMessage: EngineeringChatMessage; session: EngineeringSession }> {
  await requireSession(sessionStore, sessionId)

  const commanderMessage: EngineeringChatMessage = {
    id: randomUUID(),
    sessionId,
    role: 'commander',
    content,
    createdAt: now.toISOString(),
  }
  await sessionStore.appendMessage(commanderMessage)
  await setSessionAgentState(sessionStore, sessionId, 'WORKING', now)

  const context = await assembleSessionContext(sessionStore, nodeStore, sessionId, memory)
  const result = await modelAdapter.invoke({ systemPrompt: context, userPrompt: content })

  const replyMessage: EngineeringChatMessage = {
    id: randomUUID(),
    sessionId,
    role: 'wr_engineer',
    content: result.ok
      ? result.text
      : `${result.epistemicStatus}: unable to produce a reply right now — ${result.error ?? 'no further detail available'}.`,
    createdAt: new Date().toISOString(),
  }
  await sessionStore.appendMessage(replyMessage)
  const session = await setSessionAgentState(sessionStore, sessionId, result.ok ? 'READY' : 'BLOCKED')

  return { commanderMessage, replyMessage, session }
}

// ---------------------------------------------------------------------------
// Proposal lifecycle (Phase 3) — only NONE/GENERATING/INVALID/READY/BRIDGED are ever stored here;
// see session/types.ts's StoredProposalState header for why the post-bridge states are always
// derived from native-builder's own repair record instead.
// ---------------------------------------------------------------------------

export async function setProposalGenerating(sessionStore: SessionStore, sessionId: string, now: Date = new Date()): Promise<EngineeringSession> {
  const session = await requireSession(sessionStore, sessionId)
  const updated: EngineeringSession = {
    ...session,
    proposalState: 'GENERATING',
    activeProposal: null,
    nativeBuilderIssueId: null,
    nativeBuilderRepairId: null,
    lastProposalRejection: null,
    updatedAt: now.toISOString(),
  }
  await sessionStore.saveSession(updated)
  return updated
}

export async function setProposalReady(
  sessionStore: SessionStore,
  sessionId: string,
  proposal: EngineeringSession['activeProposal'],
  now: Date = new Date(),
): Promise<EngineeringSession> {
  const session = await requireSession(sessionStore, sessionId)
  const updated: EngineeringSession = { ...session, proposalState: 'READY', activeProposal: proposal, lastProposalRejection: null, updatedAt: now.toISOString() }
  await sessionStore.saveSession(updated)
  return updated
}

export async function setProposalInvalid(sessionStore: SessionStore, sessionId: string, reasons: string[], now: Date = new Date()): Promise<EngineeringSession> {
  const session = await requireSession(sessionStore, sessionId)
  const updated: EngineeringSession = {
    ...session,
    proposalState: 'INVALID',
    activeProposal: null,
    nativeBuilderIssueId: null,
    nativeBuilderRepairId: null,
    lastProposalRejection: { reasons },
    updatedAt: now.toISOString(),
  }
  await sessionStore.saveSession(updated)
  return updated
}

export async function setProposalBridged(
  sessionStore: SessionStore,
  sessionId: string,
  issueId: string,
  repairId: string,
  now: Date = new Date(),
): Promise<EngineeringSession> {
  const session = await requireSession(sessionStore, sessionId)
  const updated: EngineeringSession = {
    ...session,
    proposalState: 'BRIDGED',
    nativeBuilderIssueId: issueId,
    nativeBuilderRepairId: repairId,
    lastProposalRejection: null,
    updatedAt: now.toISOString(),
  }
  await sessionStore.saveSession(updated)
  return updated
}

export async function setSessionTurnPhase(
  sessionStore: SessionStore,
  sessionId: string,
  turnPhase: EngineeringSession['turnPhase'],
  now: Date = new Date(),
): Promise<EngineeringSession> {
  const session = await requireSession(sessionStore, sessionId)
  const updated: EngineeringSession = { ...session, turnPhase, updatedAt: now.toISOString() }
  await sessionStore.saveSession(updated)
  return updated
}

export async function saveTurnEvidence(
  sessionStore: SessionStore,
  sessionId: string,
  lastTurnEvidence: EngineeringSession['lastTurnEvidence'],
  proposalGrounding: EngineeringSession['proposalGrounding'] = null,
  now: Date = new Date(),
): Promise<EngineeringSession> {
  const session = await requireSession(sessionStore, sessionId)
  const updated: EngineeringSession = { ...session, lastTurnEvidence, proposalGrounding, updatedAt: now.toISOString() }
  await sessionStore.saveSession(updated)
  return updated
}

export async function recordToolActivity(
  sessionStore: SessionStore,
  sessionId: string,
  tool: string,
  detail: string,
  outcome: ToolActivityEvent['outcome'],
  now: Date = new Date(),
  extra?: { turnId?: string; target?: string },
): Promise<ToolActivityEvent> {
  await requireSession(sessionStore, sessionId)
  const event: ToolActivityEvent = {
    id: randomUUID(),
    sessionId,
    tool,
    detail,
    outcome,
    occurredAt: now.toISOString(),
    turnId: extra?.turnId,
    target: extra?.target,
  }
  await sessionStore.appendToolEvent(event)
  return event
}
