/**
 * WR-Engineer Phase 3 foundation regression suite.
 *
 * Same check()/CaseResult/runXValidation() convention as Phase 1's wrEngineer.validation.ts and
 * Phase 2's wrEngineerPhase2.validation.ts. Run via:
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/wr-engineer/wrEngineerPhase3.validation.ts
 * (wired to `pnpm run validate:wr-engineer-phase3`).
 *
 * Chat/proposal/bridge cases use isolated temp-file-backed node/session/memory stores — this suite
 * never reads or writes the real .war-room/wr-engineer/{node,session,memory}/ dev state. The Native
 * Builder bridge cases use this suite's own disposable fixture
 * (lib/wr-engineer/__fixtures__/phase3ChatFixture.ts) and the same .war-room/native-builder/ reset
 * convention Phase 2 already established — never lib/native-builder/__fixtures__/knownIssueFixture.ts
 * and never lib/wr-engineer/__fixtures__/bridgeEvalFixture.ts.
 *
 * Also re-runs Phase 1 and Phase 2 inline (see testPhase1Regression / testPhase2Regression) so a
 * single invocation proves all three phases together.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveRepoRoot } from '@/lib/repo/paths'

import { runWrEngineerValidation } from './wrEngineer.validation'
import { runWrEngineerPhase2Validation } from './wrEngineerPhase2.validation'

import { JsonFileNodeStore } from './node/store'
import { JsonFileSessionStore } from './session/store'
import { JsonFileEngineeringMemoryStore } from './memory/store'
import { generatePairingCode, requestPairing, authorizePairing } from './node/pairing'
import { NODE_INSPECTION_CAPABILITIES, ENABLED_NODE_CAPABILITIES } from './node/types'
import { FUTURE_MESSAGE_TYPES, isMessageTypeEnabled } from './node/protocol'
import { registerRepository } from './node/repository'
import { createSession, assembleSessionContext } from './session/session'
import { IDENTITY_LAYER_ORDER } from './identity/loader'
import { parseStructuredModelResponse } from './structuredResponse'
import { sessionRepositoryMatchesServerWorkspace, validateProposedChangeShapes } from './proposalValidation'
import { sendEngineeringChatMessage } from './engineeringChat'
import { deriveProposalState, proposalStateFromRepairState } from './session/proposalState'
import {
  WR_ENGINEER_STREAM_VERSION,
  encodeWrEngineerStreamEnvelope,
  snapshotToBaseline,
  computeStreamDeltas,
  type WrEngineerSessionSnapshot,
  type StreamBaseline,
} from './sessionStream'
import { WR_ENGINEER_CANNOT_WRITE_FILES } from './codeEditProposals'
import { WR_ENGINEER_BRIDGE_NEVER_APPLIES } from './nativeBuilderBridge'
import { getRepair } from '@/lib/native-builder/storage'
import type { ModelAdapter, ModelAdapterResult } from './types'
import type { EngineeringChatMessage, EngineeringSession, ToolActivityEvent } from './session/types'
import type { ModelProposedChange } from './structuredResponse'
import type { NodeConnectionStatus } from './node/types'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function tmpFile(label: string): string {
  return path.join(os.tmpdir(), `wr-engineer-eval-${label}-${randomUUID()}.json`)
}
function tmpDir(label: string): string {
  return path.join(os.tmpdir(), `wr-engineer-eval-${label}-${randomUUID()}`)
}

// Dedicated to this suite — never Phase 2's bridgeEvalFixture.ts and never native-builder's
// knownIssueFixture.ts, so a reset here can never clobber a different suite's fixture.
const PHASE3_FIXTURE_REL = 'lib/wr-engineer/__fixtures__/phase3ChatFixture.ts'
const PHASE3_FIXTURE_CONTENT = `// WR-Engineer Phase 3 chat-to-proposal-to-bridge eval fixture. Dedicated to
// wrEngineerPhase3.validation.ts's chat_bridge_* cases — never shared with
// lib/native-builder's own fixtures or lib/wr-engineer/__fixtures__/bridgeEvalFixture.ts (Phase 2's
// bridge suite), specifically so no suite's reset can ever clobber another suite's fixture content.
// Never imported by real app code.
export const phase3ChatFixtureMarker = 'PHASE3_ORIGINAL_MARKER'
`
const BRIDGE_FIXTURE_REL = 'lib/wr-engineer/__fixtures__/bridgeEvalFixture.ts'
const KNOWN_ISSUE_FIXTURE_REL = 'lib/native-builder/__fixtures__/knownIssueFixture.ts'

class FixtureModelAdapter implements ModelAdapter {
  readonly id = 'phase3-eval-fixture'
  constructor(private readonly text: string, private readonly succeed = true) {}
  async invoke(): Promise<ModelAdapterResult> {
    if (!this.succeed) {
      return { ok: false, text: '', adapterId: this.id, epistemicStatus: 'UNKNOWN', error: 'fixture adapter unavailable' }
    }
    return { ok: true, text: this.text, adapterId: this.id, epistemicStatus: 'INFERENCE' }
  }
}

function wrapProposal(response: string, proposal: unknown): string {
  return `${response}\n\n\`\`\`wr-engineer-proposal\n${typeof proposal === 'string' ? proposal : JSON.stringify(proposal, null, 2)}\n\`\`\`\n`
}

function validPhase3Proposal(overrides: Record<string, unknown> = {}) {
  return {
    diagnosis: 'Phase 3 eval — valid live-verified change against the dedicated chat fixture.',
    confidence: 'medium',
    changes: [{
      file: PHASE3_FIXTURE_REL,
      reason: 'eval fixture only',
      patch: {
        operation: 'replace_range',
        file: PHASE3_FIXTURE_REL,
        matchText: 'PHASE3_ORIGINAL_MARKER',
        replacementText: 'PHASE3_UPDATED_MARKER',
      },
    }],
    risks: ['none — eval fixture only'],
    rollbackPlan: 'reset fixture content',
    ...overrides,
  }
}

async function setUpPairedNode(nodeStore: JsonFileNodeStore) {
  const { code } = await generatePairingCode(nodeStore)
  const requested = await requestPairing(nodeStore, code, {
    nodeName: 'Phase 3 Eval Node',
    platform: 'linux' as const,
    architecture: 'x64',
    hostname: 'phase3-eval-host',
    osVersion: '0.0.0',
    agentVersion: '0.1.0',
    capabilities: [...NODE_INSPECTION_CAPABILITIES],
  })
  return authorizePairing(nodeStore, requested.tokenId)
}

async function setUpSession(opts: { repositoryPath: string }) {
  const nodeStore = new JsonFileNodeStore(tmpDir('nodes-p3'))
  const sessionStore = new JsonFileSessionStore(tmpDir('sessions-p3'))
  const memory = new JsonFileEngineeringMemoryStore(tmpFile('memory-p3'))
  const authorized = await setUpPairedNode(nodeStore)
  const repository = await registerRepository(nodeStore, {
    nodeId: authorized.node.nodeId,
    name: 'phase3-eval-repo',
    path: opts.repositoryPath,
  })
  const session = await createSession(nodeStore, sessionStore, {
    commanderUserId: 'commander-phase3',
    nodeId: authorized.node.nodeId,
    repositoryId: repository.repositoryId,
  }, memory)
  return { nodeStore, sessionStore, memory, session }
}

async function resetNativeBuilderState(): Promise<void> {
  await rm(path.join(resolveRepoRoot(), '.war-room', 'native-builder'), { recursive: true, force: true })
}

function makeSession(overrides: Partial<EngineeringSession> = {}): EngineeringSession {
  return {
    sessionId: 'sess-p3',
    commanderUserId: 'commander-fixture',
    wrEngineerIdentity: 'wr-engineer',
    nodeId: 'node-1',
    repositoryId: 'repo-1',
    repositoryPath: '/tmp/r',
    branch: 'main',
    headSha: 'abc',
    mission: null,
    constraints: [],
    agentState: 'READY',
    proposalState: 'NONE',
    activeProposal: null,
    nativeBuilderIssueId: null,
    nativeBuilderRepairId: null,
    lastProposalRejection: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeMessage(overrides: Partial<EngineeringChatMessage> = {}): EngineeringChatMessage {
  return {
    id: overrides.id ?? 'msg-1',
    sessionId: 'sess-p3',
    role: overrides.role ?? 'commander',
    content: overrides.content ?? 'hello',
    createdAt: overrides.createdAt ?? '2026-01-01T00:00:01.000Z',
  }
}

function makeToolEvent(overrides: Partial<ToolActivityEvent> = {}): ToolActivityEvent {
  return {
    id: overrides.id ?? 'tool-1',
    sessionId: 'sess-p3',
    tool: overrides.tool ?? 'GIT_STATUS',
    detail: overrides.detail ?? 'clean',
    outcome: overrides.outcome ?? 'PASS',
    occurredAt: overrides.occurredAt ?? '2026-01-01T00:00:02.000Z',
  }
}

function makeSnapshot(overrides: Partial<WrEngineerSessionSnapshot> = {}): WrEngineerSessionSnapshot {
  const session = overrides.session ?? makeSession()
  return {
    session,
    proposalState: overrides.proposalState ?? session.proposalState,
    repairState: overrides.repairState ?? null,
    messages: overrides.messages ?? [],
    toolEvents: overrides.toolEvents ?? [],
    nodeStatus: overrides.nodeStatus ?? 'OFFLINE',
  }
}

function deltaTypes(baseline: StreamBaseline, current: WrEngineerSessionSnapshot): string[] {
  return computeStreamDeltas(baseline, current).envelopes.map(e => e.envelopeType)
}

// ---------------------------------------------------------------------------
// Structured response contract (parse-only — no session, no filesystem).
// ---------------------------------------------------------------------------

function testStructuredResponseContract(): CaseResult[] {
  const results: CaseResult[] = []

  const responseOnly = parseStructuredModelResponse('Just an engineering explanation. No proposal.')
  results.push(check(
    'chat_01_response_only_parses',
    responseOnly.result.kind === 'response_only' && responseOnly.result.response.includes('Just an engineering explanation') && !responseOnly.parseAttempted && !responseOnly.parseFailed,
    JSON.stringify({ kind: responseOnly.result.kind, attempted: responseOnly.parseAttempted, failed: responseOnly.parseFailed }),
  ))

  const valid = parseStructuredModelResponse(wrapProposal('Here is the fix.', validPhase3Proposal()))
  results.push(check(
    'chat_02_valid_structured_proposal_parses',
    valid.result.kind === 'response_with_proposal' && valid.result.proposal.changes[0].patch.operation === 'replace_range' && !valid.parseFailed,
    valid.result.kind === 'response_with_proposal' ? valid.result.proposal.changes[0].file : (valid.parseError ?? valid.result.kind),
  ))
  results.push(check(
    'chat_16_model_response_text_visible_with_proposal',
    valid.result.kind === 'response_with_proposal' && valid.result.response.includes('Here is the fix.'),
    valid.result.kind === 'response_with_proposal' ? valid.result.response : valid.result.kind,
  ))

  let threw = false
  let malformed: ReturnType<typeof parseStructuredModelResponse> | undefined
  try {
    malformed = parseStructuredModelResponse(wrapProposal('Visible answer remains.', '{not json'))
  } catch {
    threw = true
  }
  results.push(check('chat_03_malformed_proposal_does_not_crash', !threw && malformed?.parseFailed === true && malformed.result.kind === 'response_only', `threw=${threw}`))
  results.push(check(
    'chat_17_parse_failure_preserves_response_text',
    malformed?.result.kind === 'response_only' && malformed.result.response.includes('Visible answer remains.'),
    malformed?.result.kind === 'response_only' ? malformed.result.response : String(malformed?.result.kind),
  ))

  const incomplete = parseStructuredModelResponse(wrapProposal('Incomplete proposal.', { diagnosis: '', changes: [] }))
  results.push(check(
    'chat_04_malformed_proposal_rejected',
    incomplete.parseFailed === true && incomplete.result.kind === 'response_only',
    incomplete.parseError ?? incomplete.result.kind,
  ))

  const unsupported = parseStructuredModelResponse(wrapProposal('Unsupported op.', {
    diagnosis: 'try to run a command',
    confidence: 'low',
    changes: [{ file: 'x.ts', reason: 'no', patch: { operation: 'run_command', file: 'x.ts' } }],
    risks: [],
    rollbackPlan: 'n/a',
  }))
  results.push(check(
    'chat_08_unsupported_operation_rejected_at_parse',
    unsupported.parseFailed === true && (unsupported.parseError ?? '').toLowerCase().includes('unsupported'),
    unsupported.parseError ?? unsupported.result.kind,
  ))

  return results
}

function testProposalShapeGuards(): CaseResult[] {
  const results: CaseResult[] = []

  const absolute = validateProposedChangeShapes([{
    file: path.resolve('/tmp', 'other.ts'),
    reason: 'no',
    patch: {
      operation: 'replace_range',
      file: path.resolve('/tmp', 'other.ts'),
      matchText: 'x',
      replacementText: 'y',
      commanderConfirmed: false,
    },
  }])
  results.push(check(
    'chat_06_absolute_path_rejected',
    !absolute.ok && absolute.reasons.some(r => r.toLowerCase().includes('absolute')),
    JSON.stringify(absolute),
  ))

  const traversal = validateProposedChangeShapes([{
    file: 'lib/wr-engineer/../../secret.ts',
    reason: 'no',
    patch: {
      operation: 'replace_range',
      file: 'lib/wr-engineer/../../secret.ts',
      matchText: 'x',
      replacementText: 'y',
      commanderConfirmed: false,
    },
  }])
  results.push(check(
    'chat_07_repo_escape_via_dotdot_rejected',
    !traversal.ok && traversal.reasons.some(r => r.includes('..')),
    JSON.stringify(traversal),
  ))

  const unsupported: ModelProposedChange[] = [{
    file: 'x.ts',
    reason: 'no',
    patch: {
      operation: 'run_command' as ModelProposedChange['patch']['operation'],
      file: 'x.ts',
      commanderConfirmed: false,
    },
  }]
  const unsupportedResult = validateProposedChangeShapes(unsupported)
  results.push(check(
    'chat_08b_unsupported_operation_rejected_at_validation',
    !unsupportedResult.ok && unsupportedResult.reasons.some(r => r.toLowerCase().includes('unsupported')),
    JSON.stringify(unsupportedResult),
  ))

  const ok = validateProposedChangeShapes([{
    file: PHASE3_FIXTURE_REL,
    reason: 'eval',
    patch: {
      operation: 'replace_range',
      file: PHASE3_FIXTURE_REL,
      matchText: 'PHASE3_ORIGINAL_MARKER',
      replacementText: 'PHASE3_UPDATED_MARKER',
      commanderConfirmed: false,
    },
  }])
  results.push(check('chat_shape_valid_change_accepted', ok.ok, JSON.stringify(ok)))

  return results
}

// ---------------------------------------------------------------------------
// Chat orchestration + session-bound validation + Native Builder bridge.
// ---------------------------------------------------------------------------

async function testResponseOnlyChat(): Promise<CaseResult[]> {
  const { nodeStore, sessionStore, memory, session } = await setUpSession({ repositoryPath: resolveRepoRoot() })
  const result = await sendEngineeringChatMessage(
    sessionStore, nodeStore, new FixtureModelAdapter('Response-only engineering answer.'), session.sessionId, 'explain the runtime', memory,
  )
  return [
    check('chat_01b_response_only_chat_works', result.proposalOutcome.kind === 'none' && result.replyMessage.content.includes('Response-only engineering answer.'), result.proposalOutcome.kind),
    check('chat_01c_response_only_leaves_proposal_none', result.session.proposalState === 'NONE', result.session.proposalState),
    check('chat_01d_response_only_returns_agent_ready', result.session.agentState === 'READY', result.session.agentState),
    check('chat_01e_commander_and_reply_messages_appended', result.commanderMessage.role === 'commander' && result.replyMessage.role === 'wr_engineer', `${result.commanderMessage.role}/${result.replyMessage.role}`),
  ]
}

async function testMalformedChatDoesNotCrash(): Promise<CaseResult[]> {
  const { nodeStore, sessionStore, memory, session } = await setUpSession({ repositoryPath: resolveRepoRoot() })
  let threw = false
  let result: Awaited<ReturnType<typeof sendEngineeringChatMessage>> | undefined
  try {
    result = await sendEngineeringChatMessage(
      sessionStore, nodeStore,
      new FixtureModelAdapter(wrapProposal('Visible answer remains.', '{not json')),
      session.sessionId, 'propose a change', memory,
    )
  } catch (error) {
    threw = true
    return [check('chat_03b_malformed_chat_does_not_crash', false, error instanceof Error ? error.message : String(error))]
  }
  const records = await memory.query({ tag: 'proposal-parse-failure' })
  return [
    check('chat_03b_malformed_chat_does_not_crash', !threw && result.proposalOutcome.kind === 'parse_failed', result.proposalOutcome.kind),
    check('chat_17b_parse_failure_preserves_chat_text', result.replyMessage.content.includes('Visible answer remains.'), result.replyMessage.content.slice(0, 80)),
    check('chat_03c_parse_failure_session_stays_ready', result.session.agentState === 'READY' && result.session.proposalState === 'NONE', `${result.session.agentState}/${result.session.proposalState}`),
    check('memory_30b_parse_failure_recorded', records.some(r => r.relatedRefs.includes(session.sessionId)), `${records.length} FAILURE records`),
  ]
}

async function testCrossRepoBlocked(): Promise<CaseResult[]> {
  const otherRepo = tmpDir('other-repo')
  await mkdir(otherRepo, { recursive: true })
  const { nodeStore, sessionStore, memory, session } = await setUpSession({ repositoryPath: otherRepo })

  const matches = await sessionRepositoryMatchesServerWorkspace(session)
  const result = await sendEngineeringChatMessage(
    sessionStore, nodeStore,
    new FixtureModelAdapter(wrapProposal('Here is the fix.', validPhase3Proposal())),
    session.sessionId, 'fix the fixture marker', memory,
  )
  return [
    check('chat_05_session_bound_to_other_repo_does_not_match_server', matches === false, String(matches)),
    check('chat_05b_proposal_cannot_target_another_repository', result.proposalOutcome.kind === 'ready_not_bridged', result.proposalOutcome.kind),
    check('chat_12b_foreign_repo_proposal_state_is_ready_not_bridged', result.session.proposalState === 'READY' && result.session.nativeBuilderRepairId === null, `${result.session.proposalState}/${result.session.nativeBuilderRepairId}`),
  ]
}

async function testValidProposalBridges(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  const fixtureAbs = path.join(resolveRepoRoot(), PHASE3_FIXTURE_REL)
  await resetNativeBuilderState()
  await writeFile(fixtureAbs, PHASE3_FIXTURE_CONTENT, 'utf8')

  const { nodeStore, sessionStore, memory, session } = await setUpSession({ repositoryPath: resolveRepoRoot() })
  const matches = await sessionRepositoryMatchesServerWorkspace(session)
  results.push(check('chat_09_local_workspace_session_matches_server', matches === true, String(matches)))

  const result = await sendEngineeringChatMessage(
    sessionStore, nodeStore,
    new FixtureModelAdapter(wrapProposal('Here is the fix for the fixture marker.', validPhase3Proposal())),
    session.sessionId, 'fix the fixture marker', memory,
  )

  results.push(check('chat_09b_valid_proposal_reaches_bridge', result.proposalOutcome.kind === 'bridged', result.proposalOutcome.kind))
  results.push(check(
    'chat_16b_reply_text_visible_alongside_bridged_proposal',
    result.replyMessage.content.includes('Here is the fix for the fixture marker.'),
    result.replyMessage.content.slice(0, 80),
  ))

  if (result.proposalOutcome.kind === 'bridged') {
    const repair = result.proposalOutcome.bridge.repair
    results.push(check('chat_10_bridge_creates_native_builder_repair', Boolean(repair.id) && repair.state === 'awaiting_local_execution_approval', `${repair.id}/${repair.state}`))
    results.push(check('chat_10b_session_links_issue_and_repair', result.session.nativeBuilderIssueId === result.proposalOutcome.bridge.issue.id && result.session.nativeBuilderRepairId === repair.id, `${result.session.nativeBuilderIssueId}/${result.session.nativeBuilderRepairId}`))
    results.push(check('chat_12_stored_proposal_state_is_bridged', result.session.proposalState === 'BRIDGED', result.session.proposalState))
    results.push(check(
      'chat_12c_derived_proposal_state_is_awaiting_approval',
      deriveProposalState(result.session, repair.state) === 'AWAITING_APPROVAL',
      deriveProposalState(result.session, repair.state),
    ))
    results.push(check('chat_15_repair_state_can_be_surfaced', repair.state === 'awaiting_local_execution_approval' && proposalStateFromRepairState(repair.state) === 'AWAITING_APPROVAL', repair.state))

    const fetched = await getRepair(repair.id)
    results.push(check('chat_15b_repair_reloadable_from_native_builder_storage', fetched?.id === repair.id && fetched?.state === 'awaiting_local_execution_approval', fetched?.state ?? 'missing'))
    results.push(check('chat_13_native_builder_is_apply_authority', fetched?.selectedProposal?.proposerId === 'wr-engineer' && WR_ENGINEER_BRIDGE_NEVER_APPLIES === true, String(fetched?.selectedProposal?.proposerId)))

    let serialized = ''
    let serializeThrew = false
    try {
      serialized = JSON.stringify(result.session.activeProposal)
    } catch {
      serializeThrew = true
    }
    results.push(check(
      'chat_14_proposal_panel_data_serializable',
      !serializeThrew && Boolean(serialized) && serialized.includes(PHASE3_FIXTURE_REL) && serialized.includes('PHASE3_ORIGINAL_MARKER'),
      serializeThrew ? 'threw' : `${serialized.length} bytes`,
    ))
  }

  const stillOriginal = await readFile(fixtureAbs, 'utf8')
  results.push(check(
    'chat_11_wr_engineer_does_not_write_the_file',
    stillOriginal.includes('PHASE3_ORIGINAL_MARKER') && !stillOriginal.includes('PHASE3_UPDATED_MARKER'),
    'fixture unchanged — apply remains Native Builder',
  ))

  const proposalRecords = await memory.query({ tag: 'proposal-generated' })
  const bridgeRecords = await memory.query({ tag: 'native-builder-bridge' })
  results.push(check('memory_30_proposal_result_recorded', proposalRecords.some(r => r.relatedRefs.includes(session.sessionId)), `${proposalRecords.length} proposal-generated`))
  results.push(check('memory_30c_bridge_result_recorded', bridgeRecords.some(r => r.summary.includes('bridged')), `${bridgeRecords.length} native-builder-bridge`))

  await resetNativeBuilderState()
  await writeFile(fixtureAbs, PHASE3_FIXTURE_CONTENT, 'utf8')
  return results
}

async function testInvalidProposalRejectedInChat(): Promise<CaseResult[]> {
  const { nodeStore, sessionStore, memory, session } = await setUpSession({ repositoryPath: resolveRepoRoot() })
  const result = await sendEngineeringChatMessage(
    sessionStore, nodeStore,
    new FixtureModelAdapter(wrapProposal('Trying an absolute path.', {
      diagnosis: 'escape the repo',
      confidence: 'low',
      changes: [{
        file: path.resolve('/tmp', 'escape.ts'),
        reason: 'no',
        patch: { operation: 'replace_range', file: path.resolve('/tmp', 'escape.ts'), matchText: 'a', replacementText: 'b' },
      }],
      risks: [],
      rollbackPlan: 'n/a',
    })),
    session.sessionId, 'write outside the repo', memory,
  )
  const rejected = await memory.query({ tag: 'proposal-rejected' })
  return [
    check('chat_04b_malformed_path_proposal_rejected_in_chat', result.proposalOutcome.kind === 'invalid', result.proposalOutcome.kind),
    check('chat_12d_invalid_proposal_state', result.session.proposalState === 'INVALID', result.session.proposalState),
    check('memory_30d_rejection_recorded', rejected.some(r => r.relatedRefs.includes(session.sessionId)), `${rejected.length} proposal-rejected`),
  ]
}

// ---------------------------------------------------------------------------
// SSE envelope / snapshot / deltas.
// ---------------------------------------------------------------------------

function testSseContract(): CaseResult[] {
  const results: CaseResult[] = []
  const opened = encodeWrEngineerStreamEnvelope({
    version: WR_ENGINEER_STREAM_VERSION,
    sessionId: 'sess-p3',
    sequence: 0,
    emittedAt: '2026-01-01T00:00:00.000Z',
    envelopeType: 'opened',
  })
  results.push(check(
    'sse_18_envelope_encoder_works',
    opened.startsWith('event: opened\ndata: ') && opened.endsWith('\n\n') && opened.includes('"envelopeType":"opened"'),
    opened.slice(0, 80),
  ))

  const snapshot = makeSnapshot({
    messages: [makeMessage()],
    toolEvents: [makeToolEvent()],
    nodeStatus: 'ONLINE',
  })
  const baseline = snapshotToBaseline(snapshot)
  results.push(check(
    'sse_19_snapshot_baseline_works',
    baseline.agentState === 'READY' && baseline.messageCount === 1 && baseline.toolEventCount === 1 && baseline.proposalState === 'NONE' && baseline.nodeStatus === 'ONLINE',
    JSON.stringify(baseline),
  ))

  const empty = makeSnapshot()
  const emptyBaseline = snapshotToBaseline(empty)

  const withMessage = makeSnapshot({ messages: [makeMessage({ id: 'm-created' })] })
  results.push(check(
    'sse_20_delta_emits_message_created',
    deltaTypes(emptyBaseline, withMessage).includes('message.created'),
    deltaTypes(emptyBaseline, withMessage).join(','),
  ))

  const withAgent = makeSnapshot({ session: makeSession({ agentState: 'WORKING' }) })
  results.push(check(
    'sse_21_delta_emits_agent_state',
    deltaTypes(emptyBaseline, withAgent).includes('agent.state'),
    deltaTypes(emptyBaseline, withAgent).join(','),
  ))

  const withPass = makeSnapshot({ toolEvents: [makeToolEvent({ id: 't-pass', outcome: 'PASS' })] })
  const withFail = makeSnapshot({ toolEvents: [makeToolEvent({ id: 't-fail', outcome: 'FAIL', tool: 'PARSE_PROPOSAL' })] })
  results.push(check(
    'sse_22_delta_emits_tool_completed',
    deltaTypes(emptyBaseline, withPass).includes('tool.completed'),
    deltaTypes(emptyBaseline, withPass).join(','),
  ))
  results.push(check(
    'sse_22b_delta_emits_tool_failed',
    deltaTypes(emptyBaseline, withFail).includes('tool.failed'),
    deltaTypes(emptyBaseline, withFail).join(','),
  ))

  const generating = makeSnapshot({ session: makeSession({ proposalState: 'GENERATING' }), proposalState: 'GENERATING' })
  const ready = makeSnapshot({
    session: makeSession({
      proposalState: 'READY',
      activeProposal: {
        id: 'prop-1',
        missionId: 'sess-p3',
        diagnosis: 'd',
        confidence: 'low',
        relevantFiles: [PHASE3_FIXTURE_REL],
        plannedChanges: [],
        risks: [],
        rollbackPlan: 'n/a',
        generatedAt: '2026-01-01T00:00:00.000Z',
        epistemicStatus: 'NOT_VERIFIED',
        policyPreview: { ok: true, violations: [], changedFileCount: 0, changedLineCount: 0 },
      },
    }),
    proposalState: 'READY',
  })
  const invalid = makeSnapshot({
    session: makeSession({ proposalState: 'INVALID', lastProposalRejection: { reasons: ['Absolute path not allowed'] } }),
    proposalState: 'INVALID',
  })
  const bridged = makeSnapshot({
    session: makeSession({ proposalState: 'BRIDGED', nativeBuilderIssueId: 'issue-1', nativeBuilderRepairId: 'repair-1' }),
    proposalState: 'BRIDGED',
  })
  results.push(check('sse_23_delta_emits_proposal_generating', deltaTypes(emptyBaseline, generating).includes('proposal.generating'), deltaTypes(emptyBaseline, generating).join(',')))
  results.push(check('sse_23b_delta_emits_proposal_ready', deltaTypes(emptyBaseline, ready).includes('proposal.ready'), deltaTypes(emptyBaseline, ready).join(',')))
  results.push(check('sse_23c_delta_emits_proposal_invalid', deltaTypes(emptyBaseline, invalid).includes('proposal.invalid'), deltaTypes(emptyBaseline, invalid).join(',')))
  results.push(check('sse_23d_delta_emits_proposal_bridged', deltaTypes(emptyBaseline, bridged).includes('proposal.bridged'), deltaTypes(emptyBaseline, bridged).join(',')))

  const withRepair = makeSnapshot({
    session: makeSession({ nativeBuilderRepairId: 'repair-1', proposalState: 'BRIDGED' }),
    proposalState: 'AWAITING_APPROVAL',
    repairState: 'awaiting_local_execution_approval',
  })
  results.push(check(
    'sse_24_delta_emits_repair_state',
    deltaTypes(emptyBaseline, withRepair).includes('repair.state'),
    deltaTypes(emptyBaseline, withRepair).join(','),
  ))

  const withNode = makeSnapshot({ session: makeSession(), nodeStatus: 'ONLINE' })
  results.push(check(
    'sse_25_delta_emits_node_status',
    deltaTypes(emptyBaseline, withNode).includes('node.status'),
    deltaTypes(emptyBaseline, withNode).join(','),
  ))

  const first = computeStreamDeltas(emptyBaseline, withMessage)
  const repeat = computeStreamDeltas(first.newBaseline, withMessage)
  results.push(check(
    'sse_26_repeated_identical_snapshot_emits_zero_duplicate_deltas',
    first.changed === true && repeat.changed === false && repeat.envelopes.length === 0,
    `first=${first.envelopes.length} repeat=${repeat.envelopes.length}`,
  ))

  const fallback = {
    session: makeSession({ nativeBuilderRepairId: 'repair-1' }),
    messages: [makeMessage()],
    toolEvents: [makeToolEvent()],
    proposalState: 'AWAITING_APPROVAL' as const,
    repairState: 'awaiting_local_execution_approval',
    nodeStatus: 'ONLINE' as NodeConnectionStatus,
  }
  const fallbackKeys = ['session', 'messages', 'toolEvents', 'proposalState', 'repairState', 'nodeStatus']
  let fallbackJson = ''
  let fallbackThrew = false
  try {
    fallbackJson = JSON.stringify(fallback)
  } catch {
    fallbackThrew = true
  }
  results.push(check(
    'sse_27_fallback_snapshot_shape_valid',
    !fallbackThrew && fallbackKeys.every(k => k in fallback) && fallbackJson.includes('repair-1'),
    fallbackThrew ? 'threw' : fallbackKeys.join(','),
  ))

  const validationTool = makeSnapshot({ toolEvents: [makeToolEvent({ id: 't-val', tool: 'RUN_VALIDATION', outcome: 'PASS' })] })
  results.push(check(
    'sse_validation_surfaces_as_tool_completed',
    deltaTypes(emptyBaseline, validationTool).includes('tool.completed'),
    deltaTypes(emptyBaseline, validationTool).join(','),
  ))

  return results
}

// ---------------------------------------------------------------------------
// Binding immutability, identity load order, UI surfaces, security boundaries.
// ---------------------------------------------------------------------------

async function testBindingAndIdentity(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  const { nodeStore, sessionStore, memory, session } = await setUpSession({ repositoryPath: resolveRepoRoot() })

  const sessionModule = await import('./session/session')
  results.push(check('bind_28_session_module_has_no_repository_setter', !('setRepository' in sessionModule), 'no setRepository export'))
  results.push(check('bind_28b_session_module_has_no_node_setter', !('setNode' in sessionModule), 'no setNode export'))

  const reloaded = await sessionStore.getSession(session.sessionId)
  results.push(check(
    'bind_28c_node_repo_binding_immutable_on_record',
    reloaded?.nodeId === session.nodeId && reloaded?.repositoryId === session.repositoryId && reloaded?.wrEngineerIdentity === 'wr-engineer',
    JSON.stringify({ nodeId: reloaded?.nodeId, repositoryId: reloaded?.repositoryId }),
  ))

  const context = await assembleSessionContext(sessionStore, nodeStore, session.sessionId, memory)
  const markers = ['IDENTITY', 'SOUL', 'USER', 'NODE_REPOSITORY_CONTEXT', 'ENGINEERING_MEMORY']
  const indexes = markers.map(m => context.indexOf(`<<< ${m}`))
  const orderOk = indexes.every((idx, i) => idx !== -1 && (i === 0 || idx > indexes[i - 1]!))
  results.push(check('identity_29_chat_context_preserves_load_order', orderOk, JSON.stringify(markers.map((m, i) => [m, indexes[i]]))))

  const stack = await import('./identity/loader').then(m => m.loadIdentityStack())
  results.push(check(
    'identity_29b_layer_order_unchanged',
    stack.layers.map(l => l.name).every((n, i) => n === IDENTITY_LAYER_ORDER[i]),
    JSON.stringify(stack.layers.map(l => l.name)),
  ))

  return results
}

async function testUiSurfaces(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  const consolePath = path.join(resolveRepoRoot(), 'components', 'war-room', 'wr-engineer', 'WrEngineerConsole.tsx')
  const consoleSource = await readFile(consolePath, 'utf8')

  results.push(check('ui_proposal_panel_present', consoleSource.includes('Proposed Changes') && consoleSource.includes('activeProposal'), 'Proposed Changes + activeProposal'))
  results.push(check('ui_diff_view_present', consoleSource.includes('View Diff') && consoleSource.includes('diffExpanded') && consoleSource.includes('matchText'), 'View Diff toggle'))
  results.push(check('ui_repair_state_surfaced', consoleSource.includes('repairState') && consoleSource.includes('Native Builder repair'), 'repair state'))
  results.push(check('ui_validation_panel_present', consoleSource.includes('Validation') && consoleSource.includes('/validate'), 'Validation panel'))
  results.push(check('ui_stream_state_present', consoleSource.includes('EventSource') && consoleSource.includes('streamStatus') && consoleSource.includes('CONNECTED'), 'SSE stream status'))
  results.push(check('ui_id_based_merge', consoleSource.includes('function mergeById') && consoleSource.includes('byId.set'), 'mergeById'))
  results.push(check('ui_snapshot_fallback_poll_preserved', consoleSource.includes('4000') && consoleSource.includes('refreshSession'), '4s fallback poll'))
  results.push(check('ui_apply_path_is_native_builder', consoleSource.includes('/native-builder') && consoleSource.includes('Prepare Apply'), 'Native Builder apply CTA'))

  const snapshotRoute = await readFile(path.join(resolveRepoRoot(), 'app', 'api', 'wr-engineer', 'sessions', '[sessionId]', 'route.ts'), 'utf8')
  results.push(check(
    'sse_27b_snapshot_route_keeps_fallback_shape',
    snapshotRoute.includes('proposalState') && snapshotRoute.includes('repairState') && snapshotRoute.includes('nodeStatus') && snapshotRoute.includes('messages') && snapshotRoute.includes('toolEvents'),
    'GET snapshot fields',
  ))

  const streamRoute = await readFile(path.join(resolveRepoRoot(), 'app', 'api', 'wr-engineer', 'sessions', '[sessionId]', 'stream', 'route.ts'), 'utf8')
  results.push(check('sse_endpoint_exists', streamRoute.includes('text/event-stream') && streamRoute.includes('computeStreamDeltas'), 'SSE route'))
  results.push(check('sse_endpoint_is_read_only', /\bPOST\b/.test(streamRoute) === false && streamRoute.includes('export async function GET'), 'GET-only stream'))

  const repairRoute = await readFile(path.join(resolveRepoRoot(), 'app', 'api', 'wr-engineer', 'sessions', '[sessionId]', 'repair', 'route.ts'), 'utf8')
  results.push(check('repair_route_is_read_only', repairRoute.includes('export async function GET') && !repairRoute.includes('export async function POST') && !repairRoute.includes('approveAndApply'), 'GET-only repair detail'))

  const messagesRoute = await readFile(path.join(resolveRepoRoot(), 'app', 'api', 'wr-engineer', 'sessions', '[sessionId]', 'messages', 'route.ts'), 'utf8')
  results.push(check('messages_route_uses_engineering_chat', messagesRoute.includes('sendEngineeringChatMessage'), 'Phase 3 chat entry point'))

  return results
}

async function testSecurityBoundaries(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  results.push(check('guard_33_run_command_disabled', !isMessageTypeEnabled('RUN_COMMAND'), String(isMessageTypeEnabled('RUN_COMMAND'))))
  results.push(check('guard_33b_future_message_types_disabled', FUTURE_MESSAGE_TYPES.every(t => !isMessageTypeEnabled(t)), JSON.stringify(FUTURE_MESSAGE_TYPES)))
  results.push(check('guard_33c_run_command_capability_not_enabled', !ENABLED_NODE_CAPABILITIES.includes('run_command'), JSON.stringify(ENABLED_NODE_CAPABILITIES)))
  results.push(check('guard_13_cannot_write_files_flag', WR_ENGINEER_CANNOT_WRITE_FILES === true, String(WR_ENGINEER_CANNOT_WRITE_FILES)))
  results.push(check('guard_13b_bridge_never_applies_flag', WR_ENGINEER_BRIDGE_NEVER_APPLIES === true, String(WR_ENGINEER_BRIDGE_NEVER_APPLIES)))

  const apiDir = path.join(resolveRepoRoot(), 'app', 'api', 'wr-engineer')
  const { readdir } = await import('node:fs/promises')
  async function walk(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true })
    const files: string[] = []
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) files.push(...(await walk(full)))
      else if (entry.name === 'route.ts') files.push(full)
    }
    return files
  }
  const routeFiles = await walk(apiDir)
  let sawShellExec = false
  let sawCommandRoute = false
  for (const file of routeFiles) {
    const content = await readFile(file, 'utf8')
    if (/child_process|execFile|spawn\(|\bexec\(/.test(content)) sawShellExec = true
    const rel = path.relative(apiDir, file).split(path.sep).join('/')
    if (rel.includes('/command/') || rel === 'command/route.ts') sawCommandRoute = true
  }
  results.push(check('guard_33d_no_route_shells_out_directly', !sawShellExec, `${routeFiles.length} routes scanned`))
  results.push(check('guard_33e_no_unrestricted_command_endpoint', !sawCommandRoute, 'no /command route'))

  const phase3LibFiles = [
    'lib/wr-engineer/engineeringChat.ts',
    'lib/wr-engineer/proposalValidation.ts',
    'lib/wr-engineer/structuredResponse.ts',
    'lib/wr-engineer/sessionStream.ts',
    'lib/wr-engineer/session/proposalState.ts',
    'app/api/wr-engineer/sessions/[sessionId]/stream/route.ts',
    'app/api/wr-engineer/sessions/[sessionId]/repair/route.ts',
    'app/api/wr-engineer/sessions/[sessionId]/messages/route.ts',
  ]
  let sawDirectWrite = false
  const writeHits: string[] = []
  for (const rel of phase3LibFiles) {
    const content = await readFile(path.join(resolveRepoRoot(), rel), 'utf8')
    if (/from ['"]node:fs\/promises['"]/.test(content) && /writeFile/.test(content)) {
      sawDirectWrite = true
      writeHits.push(`${rel}:writeFile`)
    }
    const importedApply = content.split(/\r?\n/).some(line =>
      /^\s*import\b/.test(line) && /patchApplier|approveAndApply|rollbackNow/.test(line),
    )
    if (importedApply) {
      sawDirectWrite = true
      writeHits.push(`${rel}:apply-import`)
    }
  }
  results.push(check('guard_34_no_direct_filesystem_write_outside_native_builder', !sawDirectWrite, writeHits.length ? writeHits.join(',') : `${phase3LibFiles.length} phase-3 files scanned`))

  return results
}

async function testSharedFixtureProtection(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  const knownIssue = await readFile(path.join(resolveRepoRoot(), KNOWN_ISSUE_FIXTURE_REL), 'utf8')
  const bridgeEval = await readFile(path.join(resolveRepoRoot(), BRIDGE_FIXTURE_REL), 'utf8')
  const phase3 = await readFile(path.join(resolveRepoRoot(), PHASE3_FIXTURE_REL), 'utf8')
  results.push(check('protect_known_issue_fixture_untouched', knownIssue.includes('values.length - 1') && knownIssue.includes('sumFixtureValues'), 'knownIssueFixture.ts intact'))
  results.push(check('protect_phase2_bridge_fixture_untouched', bridgeEval.includes("bridgeFixtureMarker = 'ORIGINAL_MARKER'"), 'bridgeEvalFixture.ts intact'))
  results.push(check('protect_phase3_uses_own_fixture', phase3.includes("phase3ChatFixtureMarker = 'PHASE3_ORIGINAL_MARKER'"), 'phase3ChatFixture.ts intact'))
  return results
}

async function testPhase1Regression(): Promise<CaseResult[]> {
  const results = await runWrEngineerValidation()
  return results.map(r => ({ ...r, name: `phase1_regression_${r.name}` }))
}

async function testPhase2Regression(): Promise<CaseResult[]> {
  const results = await runWrEngineerPhase2Validation()
  return results.map(r => ({ ...r, name: `phase2_regression_${r.name}` }))
}

export async function runWrEngineerPhase3Validation(): Promise<CaseResult[]> {
  return [
    ...testStructuredResponseContract(),
    ...testProposalShapeGuards(),
    ...(await testResponseOnlyChat()),
    ...(await testMalformedChatDoesNotCrash()),
    ...(await testCrossRepoBlocked()),
    ...(await testInvalidProposalRejectedInChat()),
    ...(await testValidProposalBridges()),
    ...testSseContract(),
    ...(await testBindingAndIdentity()),
    ...(await testUiSurfaces()),
    ...(await testSecurityBoundaries()),
    ...(await testSharedFixtureProtection()),
    ...(await testPhase1Regression()),
    ...(await testPhase2Regression()),
  ]
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await runWrEngineerPhase3Validation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(r => !r.pass)
  console.log(`WR-Engineer Phase 3 validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
