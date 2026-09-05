/**
 * WR-Engineer chat-driven coding orchestration (Phase 3).
 *
 * Commander message -> assembled identity/mission/node/repo/memory context (unchanged Phase 1/2
 * load order) -> model adapter -> engineering response (+ optional structured proposal) ->
 * proposal validation -> lib/wr-engineer/nativeBuilderBridge.ts -> Native Builder repair state ->
 * session state -> UI (via the SSE stream / snapshot route).
 *
 * This module never writes a file itself and never calls native-builder's apply/validate/rollback
 * functions — it only ever gets a proposal as far as `bridgeProposalToNativeBuilder()` already
 * goes (a repair sitting at 'awaiting_local_execution_approval'), exactly like Phase 2. Generating
 * a proposal and bridging it are not "applying" — nothing here executes a code change.
 */
import { randomUUID } from 'node:crypto'
import { proposeEdit } from './codeEditProposals'
import { bridgeProposalToNativeBuilder, type BridgeOutcome } from './nativeBuilderBridge'
import { STRUCTURED_RESPONSE_INSTRUCTIONS, parseStructuredModelResponse, type ModelProposal } from './structuredResponse'
import { sessionRepositoryMatchesServerWorkspace, validateProposedChangeShapes } from './proposalValidation'
import { engineeringMemory } from './memory/store'
import type { EngineeringMemoryStore } from './memory/types'
import type { ModelAdapter } from './types'
import type { NodeStore } from './node/store'
import type { SessionStore } from './session/store'
import type { EngineeringChatMessage, EngineeringSession } from './session/types'
import {
  assembleSessionContext,
  setProposalBridged,
  setProposalGenerating,
  setProposalInvalid,
  setProposalReady,
  setSessionAgentState,
} from './session/session'
import { recordToolActivity } from './session/session'

export type ProposalOutcome =
  | { kind: 'none' }
  | { kind: 'parse_failed'; parseError?: string }
  | { kind: 'invalid'; reasons: string[] }
  | { kind: 'ready_not_bridged'; note: string }
  | { kind: 'bridge_rejected'; bridge: Extract<BridgeOutcome, { accepted: false }> }
  | { kind: 'bridged'; bridge: Extract<BridgeOutcome, { accepted: true }> }

export type EngineeringChatResult = {
  commanderMessage: EngineeringChatMessage
  replyMessage: EngineeringChatMessage
  session: EngineeringSession
  proposalOutcome: ProposalOutcome
}

function summarizeProposalForIssue(diagnosis: string): string {
  return diagnosis.length > 120 ? `${diagnosis.slice(0, 117)}...` : diagnosis
}

/**
 * The Phase 3 chat entry point — supersedes session.ts's sendCommanderMessage for callers that want
 * the full chat-to-proposal-to-bridge flow. sendCommanderMessage itself is untouched (Phase 2's
 * regression suite still exercises it directly) and remains a valid, simpler entry point for a
 * caller that only wants plain chat with no proposal machinery.
 */
export async function sendEngineeringChatMessage(
  sessionStore: SessionStore,
  nodeStore: NodeStore,
  modelAdapter: ModelAdapter,
  sessionId: string,
  content: string,
  memory: EngineeringMemoryStore = engineeringMemory,
  now: Date = new Date(),
): Promise<EngineeringChatResult> {
  const session = await sessionStore.getSession(sessionId)
  if (!session) throw new Error(`Unknown session: ${sessionId}`)

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
  const result = await modelAdapter.invoke({
    systemPrompt: `${context}\n\n<<< STRUCTURED_RESPONSE_CONTRACT >>>\n${STRUCTURED_RESPONSE_INSTRUCTIONS}\n<<< END STRUCTURED_RESPONSE_CONTRACT >>>`,
    userPrompt: content,
    maxTokens: 2000,
  })

  if (!result.ok) {
    const replyMessage: EngineeringChatMessage = {
      id: randomUUID(),
      sessionId,
      role: 'wr_engineer',
      content: `${result.epistemicStatus}: unable to produce a reply right now — ${result.error ?? 'no further detail available'}.`,
      createdAt: new Date().toISOString(),
    }
    await sessionStore.appendMessage(replyMessage)
    const finalSession = await setSessionAgentState(sessionStore, sessionId, 'BLOCKED')
    return { commanderMessage, replyMessage, session: finalSession, proposalOutcome: { kind: 'none' } }
  }

  const parsed = parseStructuredModelResponse(result.text)

  const replyMessage: EngineeringChatMessage = {
    id: randomUUID(),
    sessionId,
    role: 'wr_engineer',
    content: parsed.result.response,
    createdAt: new Date().toISOString(),
  }
  await sessionStore.appendMessage(replyMessage)

  if (parsed.parseFailed) {
    await recordToolActivity(sessionStore, sessionId, 'PARSE_PROPOSAL', parsed.parseError ?? 'malformed proposal block', 'FAIL')
    await memory.record({
      category: 'FAILURE',
      summary: `WR-Engineer produced a malformed structured proposal in session ${sessionId}`,
      detail: parsed.parseError ?? 'unknown parse error',
      epistemicStatus: 'OBSERVED',
      relatedRefs: [sessionId],
      tags: ['proposal-parse-failure'],
    })
  }

  if (parsed.result.kind === 'response_only') {
    const finalSession = await setSessionAgentState(sessionStore, sessionId, 'READY')
    return {
      commanderMessage,
      replyMessage,
      session: finalSession,
      proposalOutcome: parsed.parseFailed ? { kind: 'parse_failed', parseError: parsed.parseError } : { kind: 'none' },
    }
  }

  await setProposalGenerating(sessionStore, sessionId)
  const outcome = await generateAndBridgeProposal(sessionStore, nodeStore, sessionId, session, parsed.result.proposal, memory)
  const finalSession = await setSessionAgentState(sessionStore, sessionId, 'READY')
  return { commanderMessage, replyMessage, session: finalSession, proposalOutcome: outcome }
}

async function generateAndBridgeProposal(
  sessionStore: SessionStore,
  nodeStore: NodeStore,
  sessionId: string,
  session: EngineeringSession,
  modelProposal: ModelProposal,
  memory: EngineeringMemoryStore,
): Promise<ProposalOutcome> {
  const shapeCheck = validateProposedChangeShapes(modelProposal.changes)
  if (!shapeCheck.ok) {
    await setProposalInvalid(sessionStore, sessionId, shapeCheck.reasons)
    await recordToolActivity(sessionStore, sessionId, 'VALIDATE_PROPOSAL', shapeCheck.reasons.join('; '), 'FAIL')
    await memory.record({
      category: 'DECISION',
      summary: `Proposal rejected before reaching Native Builder in session ${sessionId}`,
      detail: shapeCheck.reasons.join('; '),
      epistemicStatus: 'OBSERVED',
      relatedRefs: [sessionId],
      tags: ['proposal-rejected'],
    })
    return { kind: 'invalid', reasons: shapeCheck.reasons }
  }

  const proposal = proposeEdit({
    missionId: sessionId,
    diagnosis: modelProposal.diagnosis,
    confidence: modelProposal.confidence,
    changes: modelProposal.changes.map(c => ({ file: c.file, reason: c.reason, patch: c.patch })),
    risks: modelProposal.risks,
    rollbackPlan: modelProposal.rollbackPlan,
  })

  // Native Builder's validatePatchPolicy (used by proposeEdit as an advisory preview) requires
  // expectedOriginalHash on replace_range/insert_* patches. Chat proposals must never carry a
  // model-supplied hash — structuredResponse.ts strips it, and nativeBuilderBridge.ts re-derives
  // it from live content. Missing-hash preview violations are therefore expected at this stage,
  // not a reason to reject. Path denylist / file-type / containment / delete-confirmation
  // violations still are.
  const blockingViolations = proposal.policyPreview.violations.filter(v =>
    !(v.rule === 'malformed_patch' && v.detail.includes('expectedOriginalHash')),
  )
  if (blockingViolations.length > 0) {
    const reasons = blockingViolations.map(v => `${v.rule}${v.file ? ` (${v.file})` : ''}: ${v.detail}`)
    await setProposalInvalid(sessionStore, sessionId, reasons)
    await recordToolActivity(sessionStore, sessionId, 'VALIDATE_PROPOSAL', reasons.join('; '), 'FAIL')
    await memory.record({
      category: 'DECISION',
      summary: `Proposal failed structural policy in session ${sessionId}`,
      detail: reasons.join('; '),
      epistemicStatus: 'OBSERVED',
      relatedRefs: [sessionId, proposal.id],
      tags: ['proposal-rejected'],
    })
    return { kind: 'invalid', reasons }
  }

  await setProposalReady(sessionStore, sessionId, proposal)
  await recordToolActivity(sessionStore, sessionId, 'GENERATE_PROPOSAL', `${proposal.relevantFiles.length} file(s): ${proposal.relevantFiles.join(', ')}`, 'PASS')
  await memory.record({
    category: 'MISSION',
    summary: `WR-Engineer proposed a change in session ${sessionId}`,
    detail: proposal.diagnosis,
    epistemicStatus: 'NOT_VERIFIED',
    relatedRefs: [sessionId, proposal.id],
    tags: ['proposal-generated'],
  })

  const isServerWorkspace = await sessionRepositoryMatchesServerWorkspace(session)
  if (!isServerWorkspace) {
    const note = 'This session\'s repository is not this server\'s own workspace — Native Builder can only act on its own local repository, so this proposal is ready for review but was not bridged.'
    await recordToolActivity(sessionStore, sessionId, 'BRIDGE_PROPOSAL', note, 'FAIL')
    return { kind: 'ready_not_bridged', note }
  }

  const bridgeOutcome = await bridgeProposalToNativeBuilder(proposal, {
    title: summarizeProposalForIssue(proposal.diagnosis),
    description: proposal.diagnosis,
    subsystem: proposal.relevantFiles[0] ?? 'unspecified',
  }, memory)

  if (!bridgeOutcome.accepted) {
    const reasons = bridgeOutcome.rejections.map(r => JSON.stringify(r))
    await setProposalInvalid(sessionStore, sessionId, reasons)
    await recordToolActivity(sessionStore, sessionId, 'BRIDGE_PROPOSAL', reasons.join('; '), 'FAIL')
    await memory.record({
      category: 'FAILURE',
      summary: `Native Builder rejected WR-Engineer's proposal in session ${sessionId}`,
      detail: reasons.join('; '),
      epistemicStatus: 'OBSERVED',
      relatedRefs: [sessionId, proposal.id, bridgeOutcome.issue.id],
      tags: ['native-builder-bridge-rejected'],
    })
    return { kind: 'bridge_rejected', bridge: bridgeOutcome }
  }

  await setProposalBridged(sessionStore, sessionId, bridgeOutcome.issue.id, bridgeOutcome.repair.id)
  await recordToolActivity(sessionStore, sessionId, 'BRIDGE_PROPOSAL', `repair ${bridgeOutcome.repair.id} awaiting Commander approval`, 'PASS')
  return { kind: 'bridged', bridge: bridgeOutcome }
}
