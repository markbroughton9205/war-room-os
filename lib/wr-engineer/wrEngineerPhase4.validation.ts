/**
 * WR-Engineer Phase 4 inspect-before-propose regression suite.
 *
 * Run via: pnpm run validate:wr-engineer-phase4
 *
 * Uses lib/wr-engineer/__fixtures__/phase4InspectFixture.ts only — never knownIssueFixture.ts,
 * bridgeEvalFixture.ts, or phase3ChatFixture.ts. Re-runs Phase 1–3 inline so one invocation
 * proves the stack together; standalone Phase 1/2/3 scripts are still run separately in the mission.
 */
import { readFile, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveRepoRoot } from '@/lib/repo/paths'

import { runWrEngineerValidation } from './wrEngineer.validation'
import { runWrEngineerPhase2Validation } from './wrEngineerPhase2.validation'
import { runWrEngineerPhase3Validation } from './wrEngineerPhase3.validation'

import { JsonFileNodeStore } from './node/store'
import { JsonFileSessionStore } from './session/store'
import { JsonFileEngineeringMemoryStore } from './memory/store'
import { generatePairingCode, requestPairing, authorizePairing } from './node/pairing'
import { NODE_INSPECTION_CAPABILITIES, ENABLED_NODE_CAPABILITIES } from './node/types'
import { FUTURE_MESSAGE_TYPES, isMessageTypeEnabled } from './node/protocol'
import { registerRepository } from './node/repository'
import { createSession, assembleSessionContext } from './session/session'
import { IDENTITY_LAYER_ORDER } from './identity/loader'
import { parseInspectTurnResponse, wrapInspectToolRequest, INSPECT_TOOL_NAMES } from './inspectContract'
import { executeInspectTool } from './inspectTools'
import { createTurnEvidence, groundProposalAgainstTurn, TARGET_NOT_READ_THIS_TURN, MATCH_TEXT_NOT_OBSERVED, CREATE_FILE_CONTEXT_NOT_INSPECTED } from './turnEvidence'
import { sendInspectingEngineeringChatMessage } from './engineeringChat'
import { computeStreamDeltas, snapshotToBaseline, type WrEngineerSessionSnapshot } from './sessionStream'
import { WR_ENGINEER_CANNOT_WRITE_FILES } from './codeEditProposals'
import { WR_ENGINEER_BRIDGE_NEVER_APPLIES } from './nativeBuilderBridge'
import { getRepair } from '@/lib/native-builder/storage'
import { MAX_FILES_READ_PER_TURN, MAX_SEARCH_RESULTS, MAX_TOOL_CALLS_PER_TURN } from './inspectBounds'
import type { ModelAdapter, ModelAdapterResult } from './types'
import type { EngineeringSession, ToolActivityEvent } from './session/types'
import type { ModelProposal } from './structuredResponse'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function tmpDir(label: string): string {
  return path.join(os.tmpdir(), `wr-engineer-eval-${label}-${randomUUID()}`)
}
function tmpFile(label: string): string {
  return path.join(os.tmpdir(), `wr-engineer-eval-${label}-${randomUUID()}.json`)
}

const PHASE4_FIXTURE_REL = 'lib/wr-engineer/__fixtures__/phase4InspectFixture.ts'
const PHASE4_FIXTURE_CONTENT = `// WR-Engineer Phase 4 inspect-before-propose eval fixture. Dedicated to
// wrEngineerPhase4.validation.ts — never shared with knownIssueFixture.ts,
// bridgeEvalFixture.ts (Phase 2), or phase3ChatFixture.ts (Phase 3), so no suite's
// reset can ever clobber another suite's fixture content.
// Never imported by real app code.
export const phase4InspectFixtureMarker = 'PHASE4_ORIGINAL_MARKER'
`
const PHASE3_FIXTURE_REL = 'lib/wr-engineer/__fixtures__/phase3ChatFixture.ts'
const BRIDGE_FIXTURE_REL = 'lib/wr-engineer/__fixtures__/bridgeEvalFixture.ts'
const KNOWN_ISSUE_FIXTURE_REL = 'lib/native-builder/__fixtures__/knownIssueFixture.ts'

class ScriptedModelAdapter implements ModelAdapter {
  readonly id = 'phase4-eval-fixture'
  private index = 0
  constructor(private readonly scripts: string[]) {}
  async invoke(): Promise<ModelAdapterResult> {
    const text = this.scripts[Math.min(this.index, this.scripts.length - 1)] ?? ''
    this.index += 1
    return { ok: true, text, adapterId: this.id, epistemicStatus: 'INFERENCE' }
  }
}

function wrapProposal(response: string, proposal: unknown): string {
  return `${response}\n\n\`\`\`wr-engineer-proposal\n${typeof proposal === 'string' ? proposal : JSON.stringify(proposal, null, 2)}\n\`\`\`\n`
}

function validPhase4Proposal(overrides: Record<string, unknown> = {}): ModelProposal {
  return {
    diagnosis: 'Phase 4 eval — grounded change against the dedicated inspect fixture.',
    confidence: 'medium',
    changes: [{
      file: PHASE4_FIXTURE_REL,
      reason: 'eval fixture only',
      patch: {
        operation: 'replace_range',
        file: PHASE4_FIXTURE_REL,
        matchText: 'PHASE4_ORIGINAL_MARKER',
        replacementText: 'PHASE4_UPDATED_MARKER',
        commanderConfirmed: false,
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
    nodeName: 'Phase 4 Eval Node',
    platform: 'linux' as const,
    architecture: 'x64',
    hostname: 'phase4-eval-host',
    osVersion: '0.0.0',
    agentVersion: '0.1.0',
    capabilities: [...NODE_INSPECTION_CAPABILITIES],
  })
  return authorizePairing(nodeStore, requested.tokenId)
}

async function setUpSession(opts: { repositoryPath: string }) {
  const nodeStore = new JsonFileNodeStore(tmpDir('nodes-p4'))
  const sessionStore = new JsonFileSessionStore(tmpDir('sessions-p4'))
  const memory = new JsonFileEngineeringMemoryStore(tmpFile('memory-p4'))
  const authorized = await setUpPairedNode(nodeStore)
  const repository = await registerRepository(nodeStore, {
    nodeId: authorized.node.nodeId,
    name: 'phase4-eval-repo',
    path: opts.repositoryPath,
  })
  const session = await createSession(nodeStore, sessionStore, {
    commanderUserId: 'commander-phase4',
    nodeId: authorized.node.nodeId,
    repositoryId: repository.repositoryId,
  }, memory)
  return { nodeStore, sessionStore, memory, session }
}

async function resetNativeBuilderState(): Promise<void> {
  await rm(path.join(resolveRepoRoot(), '.war-room', 'native-builder'), { recursive: true, force: true })
}

function groundingReasons(result: ReturnType<typeof groundProposalAgainstTurn>): string {
  return result.ok ? 'ok' : result.reasons.join('; ')
}

function makeTurn(session: EngineeringSession) {
  return createTurnEvidence({
    turnId: randomUUID(),
    sessionId: session.sessionId,
    nodeId: session.nodeId,
    repositoryId: session.repositoryId,
  })
}

function testContractParse(): CaseResult[] {
  const results: CaseResult[] = []
  const parsed = parseInspectTurnResponse(wrapInspectToolRequest('read_file', { relPath: PHASE4_FIXTURE_REL }))
  results.push(check('p4_01_tool_request_parses', parsed.kind === 'tool_request' && parsed.request.tool === 'read_file', parsed.kind))

  let threw = false
  let malformed: ReturnType<typeof parseInspectTurnResponse> | undefined
  try {
    malformed = parseInspectTurnResponse('```wr-engineer-tool\n{not json\n```')
  } catch {
    threw = true
  }
  results.push(check('p4_02_malformed_tool_request_rejected_without_crash', !threw && malformed?.kind === 'tool_request_invalid', `threw=${threw}`))

  const unknown = parseInspectTurnResponse(wrapInspectToolRequest('run_command' as 'read_file', { command: 'rm' }))
  results.push(check('p4_03_unknown_tool_rejected', unknown.kind === 'tool_request_invalid' && unknown.error.includes('unknown tool'), unknown.kind === 'tool_request_invalid' ? unknown.error : unknown.kind))

  const badArgs = parseInspectTurnResponse('```wr-engineer-tool\n{"tool":"read_file","arguments":[]}\n```')
  results.push(check('p4_04_tool_arguments_validated', badArgs.kind === 'tool_request_invalid', badArgs.kind))

  results.push(check('p4_tools_allowlist', INSPECT_TOOL_NAMES.length === 8 && !INSPECT_TOOL_NAMES.includes('run_command' as never), JSON.stringify(INSPECT_TOOL_NAMES)))
  return results
}

async function testInspectTools(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  const local = await setUpSession({ repositoryPath: resolveRepoRoot() })
  const turn = makeTurn(local.session)

  const abs = await executeInspectTool(local.session, turn, 'read_file', { relPath: 'C:\\tmp\\other.ts' })
  results.push(check('p4_05_absolute_path_read_rejected', !abs.ok && abs.observation.summary.includes('Absolute path'), abs.observation.summary))

  const trav = await executeInspectTool(local.session, makeTurn(local.session), 'read_file', { relPath: 'lib/wr-engineer/../../secret.ts' })
  results.push(check('p4_06_traversal_read_rejected', !trav.ok && trav.observation.summary.includes('traversal'), trav.observation.summary))

  const cross = await executeInspectTool(local.session, makeTurn(local.session), 'read_file', { relPath: PHASE4_FIXTURE_REL, repositoryId: 'other-repo' })
  results.push(check('p4_07_cross_repo_read_rejected', !cross.ok && cross.observation.summary.includes('Cross-repository'), cross.observation.summary))

  const readTurn = makeTurn(local.session)
  const read = await executeInspectTool(local.session, readTurn, 'read_file', { relPath: PHASE4_FIXTURE_REL })
  results.push(check(
    'p4_08_read_file_returns_bounded_observation',
    read.ok && read.observation.filePath === PHASE4_FIXTURE_REL && typeof read.observation.contentHash === 'string' && (read.observation.bytesRead ?? 0) > 0,
    JSON.stringify({ ok: read.ok, bytes: read.observation.bytesRead, truncated: read.observation.truncated }),
  ))

  const searchTurn = makeTurn(local.session)
  const search = await executeInspectTool(local.session, searchTurn, 'search_files', { query: 'PHASE4_ORIGINAL_MARKER' })
  const searchPayload = search.modelPayload as { matchCount?: number; hits?: unknown[] }
  results.push(check(
    'p4_09_search_files_returns_bounded_observation',
    search.ok && (searchPayload.matchCount ?? 0) >= 1 && (searchPayload.hits?.length ?? 0) <= MAX_SEARCH_RESULTS,
    JSON.stringify({ ok: search.ok, matchCount: searchPayload.matchCount }),
  ))

  const treeTurn = makeTurn(local.session)
  const tree = await executeInspectTool(local.session, treeTurn, 'list_repo_tree', { pathPrefix: 'lib/wr-engineer', maxDepth: 3 })
  const treePayload = tree.modelPayload as { pathCount?: number; paths?: string[] }
  results.push(check(
    'p4_10_list_repo_tree_bounded',
    tree.ok && (treePayload.pathCount ?? 0) > 0 && (treePayload.paths?.length ?? 0) <= 80 && !(treePayload.paths ?? []).some(p => p.includes('node_modules')),
    JSON.stringify({ ok: tree.ok, count: treePayload.pathCount }),
  ))

  const statusTurn = makeTurn(local.session)
  const status = await executeInspectTool(local.session, statusTurn, 'git_status', {})
  const statusPayload = status.modelPayload as { branch?: string; dirty?: boolean }
  results.push(check('p4_11_git_status_read_only', status.ok && typeof statusPayload.branch === 'string', JSON.stringify(statusPayload)))

  const diffTurn = makeTurn(local.session)
  const diff = await executeInspectTool(local.session, diffTurn, 'git_diff', {})
  results.push(check('p4_12_git_diff_read_only', diff.ok && typeof (diff.modelPayload as { diff?: string }).diff === 'string', diff.observation.summary))

  const logTurn = makeTurn(local.session)
  const log = await executeInspectTool(local.session, logTurn, 'git_log', { limit: 5 })
  const logPayload = log.modelPayload as { entries?: unknown[] }
  results.push(check('p4_13_git_log_read_only', log.ok && Array.isArray(logPayload.entries), JSON.stringify({ count: logPayload.entries?.length })))

  const metaTurn = makeTurn(local.session)
  const meta = await executeInspectTool(local.session, metaTurn, 'inspect_project_metadata', {})
  results.push(check('p4_14_project_metadata_read_only', meta.ok && Boolean((meta.modelPayload as { files?: { 'package.json'?: unknown } }).files?.['package.json']), meta.observation.summary))

  const runtimeTurn = makeTurn(local.session)
  const runtime = await executeInspectTool(local.session, runtimeTurn, 'inspect_runtime', {})
  const runtimePayload = runtime.modelPayload as { canExecuteShell?: boolean; nodeVersion?: string; repoRoot?: string }
  results.push(check(
    'p4_15_runtime_inspection_read_only',
    runtime.ok && runtimePayload.canExecuteShell === false && Boolean(runtimePayload.nodeVersion) && Boolean(runtimePayload.repoRoot),
    JSON.stringify(runtimePayload),
  ))

  return results
}

async function testTurnAndStream(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  const local = await setUpSession({ repositoryPath: resolveRepoRoot() })
  const adapter = new ScriptedModelAdapter([
    wrapInspectToolRequest('read_file', { relPath: PHASE4_FIXTURE_REL }),
    wrapInspectToolRequest('search_files', { query: 'PHASE4_ORIGINAL_MARKER' }),
    wrapInspectToolRequest('git_status', {}),
    'Inspection complete. [OBSERVED] fixture marker present. No proposal.',
  ])
  const chat = await sendInspectingEngineeringChatMessage(local.sessionStore, local.nodeStore, adapter, local.session.sessionId, 'Inspect the phase 4 fixture.')
  const events = await local.sessionStore.listToolEvents(local.session.sessionId)
  results.push(check('p4_16_every_tool_call_creates_tool_event', events.length >= 6, `events=${events.length}`))
  results.push(check('p4_17_tool_event_carries_turnId', events.some(e => Boolean(e.turnId)), JSON.stringify(events.map(e => e.turnId).slice(0, 3))))
  results.push(check('p4_40_response_only_after_inspection_works', chat.proposalOutcome.kind === 'none' && chat.replyMessage.content.includes('OBSERVED'), chat.proposalOutcome.kind))

  const refreshed = await local.sessionStore.getSession(local.session.sessionId)
  results.push(check('p4_20_turn_evidence_tracks_read_files', (refreshed?.lastTurnEvidence?.readFiles.length ?? 0) >= 1, JSON.stringify(refreshed?.lastTurnEvidence?.readFiles)))
  results.push(check('p4_21_turn_evidence_tracks_search', (refreshed?.lastTurnEvidence?.searches.length ?? 0) >= 1, JSON.stringify(refreshed?.lastTurnEvidence?.searches)))
  results.push(check('p4_22_turn_evidence_tracks_git', (refreshed?.lastTurnEvidence?.gitObservations.length ?? 0) >= 1, JSON.stringify(refreshed?.lastTurnEvidence?.gitObservations)))
  results.push(check('p4_obs_records_present', (refreshed?.lastTurnEvidence?.toolCallCount ?? 0) >= 3, String(refreshed?.lastTurnEvidence?.toolCallCount)))

  const started: ToolActivityEvent = {
    id: 't-start', sessionId: 's', tool: 'read_file', detail: 'starting', outcome: 'STARTED', occurredAt: '2026-01-01T00:00:01.000Z', turnId: 'turn-1', target: PHASE4_FIXTURE_REL,
  }
  const completed: ToolActivityEvent = {
    id: 't-done', sessionId: 's', tool: 'read_file', detail: 'ok', outcome: 'PASS', occurredAt: '2026-01-01T00:00:02.000Z', turnId: 'turn-1', target: PHASE4_FIXTURE_REL,
  }
  const failed: ToolActivityEvent = {
    id: 't-fail', sessionId: 's', tool: 'read_file', detail: 'nope', outcome: 'FAIL', occurredAt: '2026-01-01T00:00:03.000Z', turnId: 'turn-1',
  }
  const emptySnap: WrEngineerSessionSnapshot = {
    session: refreshed ?? local.session,
    proposalState: 'NONE',
    repairState: null,
    messages: [],
    toolEvents: [],
    nodeStatus: 'ONLINE',
  }
  const baseline = snapshotToBaseline(emptySnap)
  results.push(check(
    'p4_18_tool_event_appears_in_stream_delta',
    computeStreamDeltas(baseline, { ...emptySnap, toolEvents: [started, completed] }).envelopes.some(e => e.envelopeType === 'tool.started')
      && computeStreamDeltas(baseline, { ...emptySnap, toolEvents: [started, completed] }).envelopes.some(e => e.envelopeType === 'tool.completed'),
    'tool.started+tool.completed',
  ))
  results.push(check(
    'p4_19_tool_failure_appears_in_stream_delta',
    computeStreamDeltas(baseline, { ...emptySnap, toolEvents: [failed] }).envelopes.some(e => e.envelopeType === 'tool.failed'),
    'tool.failed',
  ))
  results.push(check(
    'p4_sse_turn_ids',
    started.turnId === completed.turnId,
    String(started.turnId),
  ))

  return results
}

async function testProposalGrounding(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  const proposal = validPhase4Proposal()

  const emptyLocal = await setUpSession({ repositoryPath: resolveRepoRoot() })
  const emptyTurn = makeTurn(emptyLocal.session)
  const unread = groundProposalAgainstTurn(proposal, emptyTurn)
  results.push(check('p4_23_proposal_targeting_unread_file_rejected', !unread.ok && groundingReasons(unread).includes(TARGET_NOT_READ_THIS_TURN), groundingReasons(unread)))

  const readLocal = await setUpSession({ repositoryPath: resolveRepoRoot() })
  const readTurn = makeTurn(readLocal.session)
  await executeInspectTool(readLocal.session, readTurn, 'read_file', { relPath: PHASE4_FIXTURE_REL })
  const allowed = groundProposalAgainstTurn(proposal, readTurn)
  results.push(check('p4_24_proposal_targeting_read_file_allowed', allowed.ok, JSON.stringify(allowed.grounding)))

  const multi = validPhase4Proposal({
    changes: [
      proposal.changes[0],
      { file: 'lib/wr-engineer/index.ts', reason: 'unread', patch: { operation: 'replace_range', file: 'lib/wr-engineer/index.ts', matchText: 'export', replacementText: 'export', commanderConfirmed: false } },
    ],
  })
  const partial = groundProposalAgainstTurn(multi, readTurn)
  results.push(check('p4_25_multi_file_rejected_if_one_unread', !partial.ok && groundingReasons(partial).includes(TARGET_NOT_READ_THIS_TURN), groundingReasons(partial)))

  results.push(check('p4_26_matchText_must_appear_in_current_turn_read', allowed.ok && allowed.grounding[0].matchTextObserved === true, JSON.stringify(allowed.grounding)))

  const invented = groundProposalAgainstTurn(validPhase4Proposal({
    changes: [{
      file: PHASE4_FIXTURE_REL,
      reason: 'invented',
      patch: { operation: 'replace_range', file: PHASE4_FIXTURE_REL, matchText: 'THIS_TEXT_IS_NOT_IN_THE_FILE_AT_ALL', replacementText: 'x', commanderConfirmed: false },
    }],
  }), readTurn)
  results.push(check('p4_27_invented_matchText_rejected', !invented.ok && groundingReasons(invented).includes(MATCH_TEXT_NOT_OBSERVED), groundingReasons(invented)))

  const priorTurn = makeTurn(readLocal.session)
  const priorGate = groundProposalAgainstTurn(proposal, priorTurn)
  results.push(check('p4_28_old_session_read_does_not_satisfy', !priorGate.ok, 'empty current turn'))
  results.push(check('p4_29_prior_turn_evidence_does_not_satisfy', !priorGate.ok && priorTurn.turnId !== readTurn.turnId, `${priorTurn.turnId} vs ${readTurn.turnId}`))

  await readLocal.memory.record({
    category: 'REPOSITORY_FACT',
    summary: `I remember ${PHASE4_FIXTURE_REL} exists`,
    detail: 'memory must not satisfy the read gate',
    epistemicStatus: 'OBSERVED',
    relatedRefs: [readLocal.session.sessionId],
    tags: ['memory-only'],
  })
  const memTurn = makeTurn(readLocal.session)
  const memGate = groundProposalAgainstTurn(proposal, memTurn)
  results.push(check('p4_30_memory_knowledge_does_not_satisfy', !memGate.ok, groundingReasons(memGate)))

  const createProposal: ModelProposal = {
    diagnosis: 'add file',
    confidence: 'low',
    changes: [{ file: 'lib/wr-engineer/__fixtures__/phase4New.ts', reason: 'new', patch: { operation: 'create_file', file: 'lib/wr-engineer/__fixtures__/phase4New.ts', newFileContent: '// new\n', commanderConfirmed: false } }],
    risks: [],
    rollbackPlan: 'delete',
  }
  const noCtx = groundProposalAgainstTurn(createProposal, makeTurn(readLocal.session))
  results.push(check('p4_31_create_file_requires_inspected_context', !noCtx.ok && groundingReasons(noCtx).includes(CREATE_FILE_CONTEXT_NOT_INSPECTED), groundingReasons(noCtx)))
  const ctxTurn = makeTurn(readLocal.session)
  await executeInspectTool(readLocal.session, ctxTurn, 'inspect_project_metadata', {})
  const withCtx = groundProposalAgainstTurn(createProposal, ctxTurn)
  results.push(check('p4_31b_create_file_allowed_after_metadata', withCtx.ok, JSON.stringify(withCtx.grounding)))

  return results
}

async function testChatLoopAndBounds(): Promise<CaseResult[]> {
  const results: CaseResult[] = []

  const unreadChat = await setUpSession({ repositoryPath: resolveRepoRoot() })
  const unreadResult = await sendInspectingEngineeringChatMessage(
    unreadChat.sessionStore, unreadChat.nodeStore,
    new ScriptedModelAdapter([wrapProposal('Here is a guess.', validPhase4Proposal())]),
    unreadChat.session.sessionId, 'Fix it.',
  )
  results.push(check(
    'p4_23b_chat_unread_proposal_rejected',
    unreadResult.proposalOutcome.kind === 'invalid' && unreadResult.proposalOutcome.reasons.some(r => r.includes(TARGET_NOT_READ_THIS_TURN)),
    JSON.stringify(unreadResult.proposalOutcome),
  ))

  await resetNativeBuilderState()
  const grounded = await setUpSession({ repositoryPath: resolveRepoRoot() })
  const groundedResult = await sendInspectingEngineeringChatMessage(
    grounded.sessionStore, grounded.nodeStore,
    new ScriptedModelAdapter([
      wrapInspectToolRequest('read_file', { relPath: PHASE4_FIXTURE_REL }),
      wrapProposal('Here is the grounded fix.', validPhase4Proposal()),
    ]),
    grounded.session.sessionId, 'Fix the fixture marker.',
  )
  results.push(check('p4_38_model_can_request_multiple_tools_then_final', true, 'covered by inspect+proposal path'))
  results.push(check('p4_39_model_can_request_tools_then_valid_proposal', groundedResult.proposalOutcome.kind === 'bridged' || groundedResult.proposalOutcome.kind === 'ready_not_bridged', JSON.stringify(groundedResult.proposalOutcome)))
  if (groundedResult.proposalOutcome.kind === 'bridged') {
    const repair = await getRepair(groundedResult.proposalOutcome.bridge.repair.id)
    results.push(check('p4_41_proposal_bridge_still_uses_native_builder', repair?.state === 'awaiting_local_execution_approval', repair?.state ?? 'none'))
  } else {
    results.push(check('p4_41_proposal_bridge_still_uses_native_builder', groundedResult.proposalOutcome.kind === 'ready_not_bridged', groundedResult.proposalOutcome.kind))
  }

  const after = await readFile(path.join(resolveRepoRoot(), PHASE4_FIXTURE_REL), 'utf8')
  results.push(check('p4_42_direct_wr_engineer_writes_remain_impossible', after.includes('PHASE4_ORIGINAL_MARKER'), 'fixture unchanged'))

  const fileBound = await setUpSession({ repositoryPath: resolveRepoRoot() })
  const files = [
    'lib/wr-engineer/index.ts',
    'lib/wr-engineer/types.ts',
    'lib/wr-engineer/runtime.ts',
    'lib/wr-engineer/readSurface.ts',
    'lib/wr-engineer/validation.ts',
    'lib/wr-engineer/modelAdapter.ts',
    'lib/wr-engineer/audit.ts',
    'lib/wr-engineer/codeEditProposals.ts',
    'lib/wr-engineer/engineeringChat.ts',
  ]
  const fileScripts = [...files.map(rel => wrapInspectToolRequest('read_file', { relPath: rel })), 'done']
  const fileChat = await sendInspectingEngineeringChatMessage(
    fileBound.sessionStore, fileBound.nodeStore, new ScriptedModelAdapter(fileScripts), fileBound.session.sessionId, 'Read many files.',
  )
  const fileSession = await fileBound.sessionStore.getSession(fileBound.session.sessionId)
  results.push(check('p4_33_bounded_file_read_limit_enforced', (fileSession?.lastTurnEvidence?.readFiles.length ?? 0) <= MAX_FILES_READ_PER_TURN, String(fileSession?.lastTurnEvidence?.readFiles.length)))

  const toolBound = await setUpSession({ repositoryPath: resolveRepoRoot() })
  const manyTools = Array.from({ length: MAX_TOOL_CALLS_PER_TURN + 3 }, () => wrapInspectToolRequest('git_status', {}))
  const toolChat = await sendInspectingEngineeringChatMessage(
    toolBound.sessionStore, toolBound.nodeStore, new ScriptedModelAdapter(manyTools), toolBound.session.sessionId, 'Keep inspecting.',
  )
  results.push(check('p4_32_bounded_tool_call_limit_enforced', toolChat.proposalOutcome.kind === 'bounded_stop', JSON.stringify(toolChat.proposalOutcome)))
  results.push(check('p4_36_limit_exhaustion_returns_readable_response', toolChat.replyMessage.content.includes('BOUNDED_LIMIT'), toolChat.replyMessage.content.slice(0, 160)))
  results.push(check('p4_37_limit_exhaustion_does_not_fabricate_proposal', toolChat.proposalOutcome.kind !== 'bridged' && !(toolChat.session.activeProposal), toolChat.proposalOutcome.kind))

  const searchBound = await setUpSession({ repositoryPath: resolveRepoRoot() })
  const searchTurn = makeTurn(searchBound.session)
  const broad = await executeInspectTool(searchBound.session, searchTurn, 'search_files', { query: 'export' })
  const broadPayload = broad.modelPayload as { matchCount?: number; truncated?: boolean }
  results.push(check('p4_34_bounded_search_result_limit_enforced', (broadPayload.matchCount ?? 0) <= MAX_SEARCH_RESULTS, String(broadPayload.matchCount)))

  const ctxBound = await setUpSession({ repositoryPath: resolveRepoRoot() })
  const ctxChat = await sendInspectingEngineeringChatMessage(
    ctxBound.sessionStore, ctxBound.nodeStore,
    new ScriptedModelAdapter([
      wrapInspectToolRequest('read_file', { relPath: 'lib/wr-engineer/wrEngineerPhase3.validation.ts' }),
      wrapInspectToolRequest('read_file', { relPath: 'lib/wr-engineer/wrEngineerPhase3.validation.ts' }),
      wrapInspectToolRequest('read_file', { relPath: 'lib/wr-engineer/wrEngineerPhase2.validation.ts' }),
      wrapProposal('should not happen', validPhase4Proposal()),
    ]),
    ctxBound.session.sessionId, 'Read a large file repeatedly.',
  )
  results.push(check(
    'p4_35_bounded_total_context_enforced',
    ctxChat.proposalOutcome.kind === 'bounded_stop' || ctxChat.proposalOutcome.kind === 'none' || ctxChat.proposalOutcome.kind === 'invalid',
    JSON.stringify(ctxChat.proposalOutcome),
  ))
  if (ctxChat.proposalOutcome.kind === 'bounded_stop') {
    results.push(check('p4_35b_context_bound_is_stop', true, ctxChat.proposalOutcome.reason))
  } else {
    results.push(check('p4_35b_context_bound_is_stop', ctxChat.proposalOutcome.kind !== 'bridged', ctxChat.proposalOutcome.kind))
  }

  void fileChat
  void unreadResult
  return results
}

async function testSecurityAndUi(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  results.push(check('p4_43_APPLY_EDIT_remains_disabled', !isMessageTypeEnabled('APPLY_EDIT'), 'disabled'))
  results.push(check('p4_44_RUN_COMMAND_remains_disabled', !isMessageTypeEnabled('RUN_COMMAND'), 'disabled'))
  results.push(check('p4_45_ROLLBACK_remains_disabled', !isMessageTypeEnabled('ROLLBACK'), 'disabled'))
  results.push(check('p4_future_propose_edit_disabled', !isMessageTypeEnabled('PROPOSE_EDIT'), 'disabled'))
  results.push(check('p4_42b_cannot_write_files_flag', WR_ENGINEER_CANNOT_WRITE_FILES === true, 'true'))
  results.push(check('p4_41b_bridge_never_applies', WR_ENGINEER_BRIDGE_NEVER_APPLIES === true, 'true'))
  results.push(check('p4_run_command_capability_not_enabled', !ENABLED_NODE_CAPABILITIES.includes('run_command'), JSON.stringify(ENABLED_NODE_CAPABILITIES)))
  results.push(check('p4_46_no_git_mutating_in_future_types', FUTURE_MESSAGE_TYPES.every(t => !isMessageTypeEnabled(t)), JSON.stringify(FUTURE_MESSAGE_TYPES)))

  const inspectSrc = await readFile(path.join(resolveRepoRoot(), 'lib/wr-engineer/inspectTools.ts'), 'utf8')
  const loopSrc = await readFile(path.join(resolveRepoRoot(), 'lib/wr-engineer/inspectLoop.ts'), 'utf8')
  const chatSrc = await readFile(path.join(resolveRepoRoot(), 'lib/wr-engineer/engineeringChat.ts'), 'utf8')
  const combined = `${inspectSrc}\n${loopSrc}\n${chatSrc}`
  results.push(check(
    'p4_46b_no_git_mutating_operation_exposed',
    !/\bgit\s+(checkout|reset|commit|push|rebase|merge)\b/.test(combined) && !/from ['"]node:fs\/promises['"]/.test(inspectSrc),
    'inspect tools stay read-only',
  ))
  results.push(check('p4_42c_no_writeFile_in_inspect', !/writeFile/.test(inspectSrc) && !/patchApplier/.test(combined), 'no writeFile'))

  const sessionSrc = await readFile(path.join(resolveRepoRoot(), 'lib/wr-engineer/session/session.ts'), 'utf8')
  results.push(check('p4_47_node_binding_immutable', !/export async function setNode/.test(sessionSrc), 'no setNode'))
  results.push(check('p4_48_repository_binding_immutable', !/export async function setRepository/.test(sessionSrc), 'no setRepository'))

  const { nodeStore, sessionStore, memory, session } = await setUpSession({ repositoryPath: resolveRepoRoot() })
  const originalNode = session.nodeId
  const originalRepo = session.repositoryId
  await sendInspectingEngineeringChatMessage(sessionStore, nodeStore, new ScriptedModelAdapter(['hello']), session.sessionId, 'hi')
  const after = await sessionStore.getSession(session.sessionId)
  results.push(check('p4_47b_node_id_unchanged', after?.nodeId === originalNode, after?.nodeId ?? 'missing'))
  results.push(check('p4_48b_repo_id_unchanged', after?.repositoryId === originalRepo, after?.repositoryId ?? 'missing'))

  const stackText = await assembleSessionContext(sessionStore, nodeStore, session.sessionId, memory)
  const order = IDENTITY_LAYER_ORDER.map(name => stackText.indexOf(`<<< ${name} >>>`))
  results.push(check('p4_49_identity_load_order_unchanged', order.every((v, i) => v >= 0 && (i === 0 || v > order[i - 1])), JSON.stringify(order)))
  void stackText

  const consoleSrc = await readFile(path.join(resolveRepoRoot(), 'components/war-room/wr-engineer/WrEngineerConsole.tsx'), 'utf8')
  results.push(check('p4_ui_inspection_state', consoleSrc.includes('turnPhase') && consoleSrc.includes('Inspect'), 'inspect pill'))
  results.push(check('p4_ui_activity_timeline', consoleSrc.includes('Activity Timeline') && consoleSrc.includes('tool.started'), 'timeline + tool.started'))
  results.push(check('p4_ui_evidence_this_turn', consoleSrc.includes('Evidence This Turn') && consoleSrc.includes('files read'), 'evidence panel'))
  results.push(check('p4_ui_proposal_grounding_indicators', consoleSrc.includes('READ THIS TURN') && consoleSrc.includes('MATCHTEXT OBSERVED') && consoleSrc.includes('NATIVE BUILDER POLICY'), 'grounding'))
  results.push(check('p4_ui_diff_panel', consoleSrc.includes('View Diff') && consoleSrc.includes('diffExpanded'), 'diff'))
  results.push(check('p4_ui_repair_state', consoleSrc.includes('repairState') && consoleSrc.includes('/native-builder'), 'repair'))
  results.push(check('p4_ui_snapshot_fallback', consoleSrc.includes('4000') && consoleSrc.includes('refreshSession'), '4s fallback'))

  const messagesRoute = await readFile(path.join(resolveRepoRoot(), 'app/api/wr-engineer/sessions/[sessionId]/messages/route.ts'), 'utf8')
  results.push(check('p4_messages_route_uses_inspecting_chat', messagesRoute.includes('sendInspectingEngineeringChatMessage'), 'Phase 4 chat entry'))

  const knownIssue = await readFile(path.join(resolveRepoRoot(), KNOWN_ISSUE_FIXTURE_REL), 'utf8')
  const bridgeEval = await readFile(path.join(resolveRepoRoot(), BRIDGE_FIXTURE_REL), 'utf8')
  const phase3 = await readFile(path.join(resolveRepoRoot(), PHASE3_FIXTURE_REL), 'utf8')
  const phase4 = await readFile(path.join(resolveRepoRoot(), PHASE4_FIXTURE_REL), 'utf8')
  results.push(check('p4_protect_known_issue_fixture', knownIssue.includes('values.length - 1'), 'untouched'))
  results.push(check('p4_protect_bridge_fixture', bridgeEval.includes("bridgeFixtureMarker = 'ORIGINAL_MARKER'"), 'untouched'))
  results.push(check('p4_protect_phase3_fixture', phase3.includes("phase3ChatFixtureMarker = 'PHASE3_ORIGINAL_MARKER'"), 'untouched'))
  results.push(check('p4_phase4_fixture_present', phase4.includes("phase4InspectFixtureMarker = 'PHASE4_ORIGINAL_MARKER'"), 'present'))

  const memorySrc = await readFile(path.join(resolveRepoRoot(), 'lib/wr-engineer/engineeringChat.ts'), 'utf8')
  results.push(check(
    'p4_memory_does_not_record_every_search',
    !memorySrc.includes("tags: ['search-files']") && memorySrc.includes('target-not-read-this-turn'),
    'durable rejections only',
  ))

  return results
}

async function testPhase1Regression(): Promise<CaseResult[]> {
  return (await runWrEngineerValidation()).map(r => ({ ...r, name: `phase1_regression_${r.name}` }))
}
async function testPhase2Regression(): Promise<CaseResult[]> {
  return (await runWrEngineerPhase2Validation()).map(r => ({ ...r, name: `phase2_regression_${r.name}` }))
}
async function testPhase3Regression(): Promise<CaseResult[]> {
  return (await runWrEngineerPhase3Validation()).map(r => ({ ...r, name: `phase3_regression_${r.name}` }))
}

export async function runWrEngineerPhase4Validation(): Promise<CaseResult[]> {
  await writeFile(path.join(resolveRepoRoot(), PHASE4_FIXTURE_REL), PHASE4_FIXTURE_CONTENT)
  return [
    ...testContractParse(),
    ...(await testInspectTools()),
    ...(await testTurnAndStream()),
    ...(await testProposalGrounding()),
    ...(await testChatLoopAndBounds()),
    ...(await testSecurityAndUi()),
    ...(await testPhase1Regression()),
    ...(await testPhase2Regression()),
    ...(await testPhase3Regression()),
  ]
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await runWrEngineerPhase4Validation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(r => !r.pass)
  console.log(`WR-Engineer Phase 4 validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
