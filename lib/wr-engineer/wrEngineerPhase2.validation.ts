/**
 * WR-Engineer Phase 2 foundation regression suite.
 *
 * Same check()/CaseResult/runXValidation() convention as Phase 1's wrEngineer.validation.ts and
 * lib/mission-runtime/missionRuntime.validation.ts. Run via:
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/wr-engineer/wrEngineerPhase2.validation.ts
 * (wired to `pnpm run validate:wr-engineer-phase2`).
 *
 * Every node/session/memory-touching case uses an isolated temp-file-backed store — this suite
 * never reads or writes the real .war-room/wr-engineer/{node,session}/ dev state. The Native
 * Builder bridge case uses the same disposable fixture file
 * (lib/native-builder/__fixtures__/knownIssueFixture.ts) and .war-room/native-builder/ reset
 * convention lib/mission-runtime/missionRuntime.validation.ts already established — never real
 * production issues/repairs.
 *
 * Also re-runs the full Phase 1 suite inline (see testPhase1Regression) so a single invocation
 * proves both phases together, per the mission brief's "preserve all Phase 1 tests."
 */
import { randomUUID } from 'node:crypto'
import { readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveRepoRoot } from '@/lib/repo/paths'

import { runWrEngineerValidation } from './wrEngineer.validation'

import { JsonFileNodeStore } from './node/store'
import { JsonFileSessionStore } from './session/store'
import { JsonFileEngineeringMemoryStore } from './memory/store'
import { generatePairingCode, requestPairing, authorizePairing, PairingError, sweepExpiredPairingTokens } from './node/pairing'
import { authenticateNode, recordHeartbeat, revokeNode } from './node/identity'
import { deriveNodeConnectionStatus, ENABLED_NODE_CAPABILITIES, NODE_INSPECTION_CAPABILITIES, nodePlatformFromOsPlatform } from './node/types'
import { RepositoryRegistrationError, registerRepository, requireBoundRepository, applyRepositoryStatusReport } from './node/repository'
import { FUTURE_MESSAGE_TYPES, isMessageTypeEnabled, validateProtocolMessage } from './node/protocol'
import { createSession, recordToolActivity, SessionBindingError } from './session/session'
import { proposeEdit } from './codeEditProposals'
import { bridgeProposalToNativeBuilder } from './nativeBuilderBridge'

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

// ---------------------------------------------------------------------------
// 1-2. Navigation entry + page renders (structural — no test framework/DOM in this repo).
// ---------------------------------------------------------------------------

async function testNavigationAndPage(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  const pagePath = path.join(resolveRepoRoot(), 'app', 'wr-engineer', 'page.tsx')
  const pageSource = await readFile(pagePath, 'utf8')
  results.push(check('nav_01_wr_engineer_route_exists', pageSource.length > 0, `${pageSource.length} bytes`))
  results.push(check('nav_02_page_composes_console_component', pageSource.includes('WrEngineerConsole'), 'imports/renders WrEngineerConsole'))
  results.push(check('nav_03_page_uses_war_room_error_boundary', pageSource.includes('PanelErrorBoundary'), 'wrapped in PanelErrorBoundary'))

  const consolePath = path.join(resolveRepoRoot(), 'components', 'war-room', 'wr-engineer', 'WrEngineerConsole.tsx')
  const consoleSource = await readFile(consolePath, 'utf8')
  const requiredSections = ['Machines', 'Repository', 'Engineering Chat', 'Proposed Changes', 'Validation', 'Mission / Context', 'Activity Timeline']
  results.push(check('nav_04_console_renders_required_panels', requiredSections.every(s => consoleSource.includes(s)), requiredSections.join(', ')))
  return results
}

// ---------------------------------------------------------------------------
// 3-7. Identity stack unaffected by Phase 2 (delegates to Phase 1's own checks + re-verifies here).
// ---------------------------------------------------------------------------

async function testIdentityUnaffected(): Promise<CaseResult[]> {
  const { loadIdentityStack, IDENTITY_LAYER_ORDER } = await import('./identity/loader')
  const stack = await loadIdentityStack()
  const results: CaseResult[] = []
  results.push(check('identity_01_stack_still_loads', stack.layers.length === 3, String(stack.layers.length)))
  results.push(check('identity_02_identity_layer_present', stack.layers.some(l => l.name === 'IDENTITY' && l.content.includes('WR-Engineer')), 'ok'))
  results.push(check('identity_03_soul_layer_present', stack.layers.some(l => l.name === 'SOUL' && l.content.length > 0), 'ok'))
  results.push(check('identity_04_user_layer_present', stack.layers.some(l => l.name === 'USER' && l.content.length > 0), 'ok'))
  results.push(check('identity_05_load_order_preserved', stack.layers.map(l => l.name).every((n, i) => n === IDENTITY_LAYER_ORDER[i]), JSON.stringify(stack.layers.map(l => l.name))))
  return results
}

// ---------------------------------------------------------------------------
// Node identity / pairing setup shared by several sections below.
// ---------------------------------------------------------------------------

async function setUpPairedNode(nodeStore: JsonFileNodeStore, ttlMs?: number) {
  const { code, token } = await generatePairingCode(nodeStore, ttlMs)
  const candidate = {
    nodeName: 'Eval Fixture Node',
    platform: 'linux' as const,
    architecture: 'x64',
    hostname: 'eval-fixture-host',
    osVersion: '0.0.0',
    agentVersion: '0.1.0',
    capabilities: [...NODE_INSPECTION_CAPABILITIES],
  }
  const requested = await requestPairing(nodeStore, code, candidate)
  const authorized = await authorizePairing(nodeStore, requested.tokenId)
  return { code, token, authorized }
}

// ---------------------------------------------------------------------------
// 8-9. Session binds node + repository.
// ---------------------------------------------------------------------------

async function testSessionBinding(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  const nodeStore = new JsonFileNodeStore(tmpDir('nodes-binding'))
  const sessionStore = new JsonFileSessionStore(tmpDir('sessions-binding'))
  const memory = new JsonFileEngineeringMemoryStore(tmpFile('memory-binding'))

  const { authorized } = await setUpPairedNode(nodeStore)
  const repository = await registerRepository(nodeStore, { nodeId: authorized.node.nodeId, name: 'fixture-repo', path: '/tmp/fixture-repo' })
  await applyRepositoryStatusReport(nodeStore, repository.repositoryId, { currentBranch: 'main', headSha: 'deadbeef' })

  const session = await createSession(nodeStore, sessionStore, {
    commanderUserId: 'commander-fixture',
    nodeId: authorized.node.nodeId,
    repositoryId: repository.repositoryId,
  }, memory)

  results.push(check('session_01_binds_node', session.nodeId === authorized.node.nodeId, session.nodeId))
  results.push(check('session_02_binds_repository', session.repositoryId === repository.repositoryId, session.repositoryId))
  results.push(check('session_03_snapshots_branch_head_at_creation', session.branch === 'main' && session.headSha === 'deadbeef', `${session.branch}/${session.headSha}`))

  return results
}

// ---------------------------------------------------------------------------
// 10, 14-15, 33. Node identity/auth: valid, unauthorized, revoked.
// ---------------------------------------------------------------------------

async function testNodeIdentity(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  const nodeStore = new JsonFileNodeStore(tmpDir('nodes-identity'))
  const { authorized } = await setUpPairedNode(nodeStore)

  const good = await authenticateNode(nodeStore, authorized.node.nodeId, authorized.credential)
  results.push(check('auth_01_valid_credential_accepted', good.ok, JSON.stringify(good)))

  const badCred = await authenticateNode(nodeStore, authorized.node.nodeId, 'wrong-credential')
  results.push(check('auth_02_unauthorized_wrong_credential_rejected', !badCred.ok && badCred.reason === 'bad_credential', JSON.stringify(badCred)))

  const unknown = await authenticateNode(nodeStore, 'no-such-node', 'anything')
  results.push(check('auth_03_unauthorized_unknown_node_rejected', !unknown.ok && unknown.reason === 'not_found', JSON.stringify(unknown)))

  await revokeNode(nodeStore, authorized.node.nodeId)
  const revokedAuth = await authenticateNode(nodeStore, authorized.node.nodeId, authorized.credential)
  results.push(check('revoke_01_revoked_node_rejected_even_with_valid_credential', !revokedAuth.ok && revokedAuth.reason === 'revoked', JSON.stringify(revokedAuth)))

  const revokedHeartbeat = await recordHeartbeat(nodeStore, { nodeId: authorized.node.nodeId, credential: authorized.credential })
  results.push(check('revoke_02_revoked_node_heartbeat_rejected', !revokedHeartbeat.ok && revokedHeartbeat.reason === 'revoked', JSON.stringify(revokedHeartbeat)))

  return results
}

// ---------------------------------------------------------------------------
// 11-13. Pairing token expiry + single-use + reuse rejection.
// ---------------------------------------------------------------------------

async function testPairingLifecycle(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  const nodeStore = new JsonFileNodeStore(tmpDir('nodes-pairing'))

  // Expiry — sweep proven against one token, and the inline (unswept) expiry check proven
  // independently against a second token, so the two code paths are each tested honestly.
  const { code: sweptAwayCode } = await generatePairingCode(nodeStore, -1000) // already expired
  const swept = await sweepExpiredPairingTokens(nodeStore)
  results.push(check('pairing_01_expired_token_swept', swept >= 1, `${swept} swept`))
  void sweptAwayCode

  const { code: expiringCode } = await generatePairingCode(nodeStore, -1000) // already expired, NOT yet swept
  let expiredAttemptThrew = false
  let expiredAttemptReason: string | undefined
  try {
    await requestPairing(nodeStore, expiringCode, {
      nodeName: 'x', platform: 'linux', architecture: 'x64', hostname: 'h', osVersion: '0', agentVersion: '0', capabilities: [],
    })
  } catch (e) {
    expiredAttemptThrew = e instanceof PairingError
    expiredAttemptReason = e instanceof PairingError ? e.reason : undefined
  }
  results.push(check('pairing_02_expired_token_rejects_attempt', expiredAttemptThrew && expiredAttemptReason === 'expired', `threw=${expiredAttemptThrew} reason=${expiredAttemptReason}`))

  // Single-use / reuse rejection
  const { code } = await generatePairingCode(nodeStore)
  const candidate = { nodeName: 'x', platform: 'linux' as const, architecture: 'x64', hostname: 'h', osVersion: '0', agentVersion: '0', capabilities: [] }
  await requestPairing(nodeStore, code, candidate)
  let reuseThrew = false
  let reuseReason: string | undefined
  try {
    await requestPairing(nodeStore, code, candidate)
  } catch (e) {
    reuseThrew = e instanceof PairingError
    reuseReason = e instanceof PairingError ? e.reason : undefined
  }
  results.push(check('pairing_03_single_use_reuse_rejected', reuseThrew && reuseReason === 'already_used', `threw=${reuseThrew} reason=${reuseReason}`))

  // Reuse rejected even after full authorize
  const { code: code2 } = await generatePairingCode(nodeStore)
  const req2 = await requestPairing(nodeStore, code2, candidate)
  await authorizePairing(nodeStore, req2.tokenId)
  let reuseAfterAuthorizeThrew = false
  try {
    await requestPairing(nodeStore, code2, candidate)
  } catch (e) {
    reuseAfterAuthorizeThrew = e instanceof PairingError && e.reason === 'already_used'
  }
  results.push(check('pairing_04_reuse_after_authorization_rejected', reuseAfterAuthorizeThrew, String(reuseAfterAuthorizeThrew)))

  return results
}

// ---------------------------------------------------------------------------
// 16-17. Heartbeat updates last_seen; stale node derives OFFLINE.
// ---------------------------------------------------------------------------

async function testHeartbeatAndStaleness(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  const nodeStore = new JsonFileNodeStore(tmpDir('nodes-heartbeat'))
  const { authorized } = await setUpPairedNode(nodeStore)

  results.push(check('heartbeat_01_last_seen_initially_null', authorized.node.lastSeenAt === null, String(authorized.node.lastSeenAt)))
  const beat = await recordHeartbeat(nodeStore, { nodeId: authorized.node.nodeId, credential: authorized.credential })
  results.push(check('heartbeat_02_updates_last_seen', beat.ok && beat.node.lastSeenAt !== null, JSON.stringify(beat.ok ? beat.node.lastSeenAt : beat)))

  const now = new Date()
  const freshStatus = deriveNodeConnectionStatus(now.toISOString(), now, 90_000)
  results.push(check('offline_01_fresh_heartbeat_is_online', freshStatus === 'ONLINE', freshStatus))

  const staleTimestamp = new Date(now.getTime() - 10 * 60_000).toISOString()
  const staleStatus = deriveNodeConnectionStatus(staleTimestamp, now, 90_000)
  results.push(check('offline_02_stale_node_becomes_offline', staleStatus === 'OFFLINE', staleStatus))

  const neverSeenStatus = deriveNodeConnectionStatus(null, now)
  results.push(check('offline_03_never_seen_node_is_offline', neverSeenStatus === 'OFFLINE', neverSeenStatus))

  return results
}

// ---------------------------------------------------------------------------
// 18-19. Repository must be registered; unregistered path/id rejected.
// ---------------------------------------------------------------------------

async function testRepositoryRegistration(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  const nodeStore = new JsonFileNodeStore(tmpDir('nodes-repo'))
  const { authorized } = await setUpPairedNode(nodeStore)

  let unregisteredThrew = false
  try {
    await requireBoundRepository(nodeStore, authorized.node.nodeId, 'no-such-repository-id')
  } catch (e) {
    unregisteredThrew = e instanceof RepositoryRegistrationError
  }
  results.push(check('repo_01_unregistered_repository_rejected', unregisteredThrew, String(unregisteredThrew)))

  const repository = await registerRepository(nodeStore, { nodeId: authorized.node.nodeId, name: 'r', path: '/tmp/r' })
  const bound = await requireBoundRepository(nodeStore, authorized.node.nodeId, repository.repositoryId)
  results.push(check('repo_02_registered_repository_accepted', bound.repositoryId === repository.repositoryId, bound.repositoryId))

  let duplicateThrew = false
  try {
    await registerRepository(nodeStore, { nodeId: authorized.node.nodeId, name: 'r-again', path: '/tmp/r' })
  } catch (e) {
    duplicateThrew = e instanceof RepositoryRegistrationError && e.reason === 'already_registered'
  }
  results.push(check('repo_03_duplicate_path_rejected', duplicateThrew, String(duplicateThrew)))

  return results
}

// ---------------------------------------------------------------------------
// 20-21. No silent mid-session machine/repository/branch switch.
// ---------------------------------------------------------------------------

async function testNoSilentSwitching(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  const nodeStore = new JsonFileNodeStore(tmpDir('nodes-switch'))
  const sessionStore = new JsonFileSessionStore(tmpDir('sessions-switch'))
  const memory = new JsonFileEngineeringMemoryStore(tmpFile('memory-switch'))

  const { authorized } = await setUpPairedNode(nodeStore)
  const repoA = await registerRepository(nodeStore, { nodeId: authorized.node.nodeId, name: 'repo-a', path: '/tmp/a' })
  await applyRepositoryStatusReport(nodeStore, repoA.repositoryId, { currentBranch: 'main', headSha: 'aaa' })
  const repoB = await registerRepository(nodeStore, { nodeId: authorized.node.nodeId, name: 'repo-b', path: '/tmp/b' })

  const session = await createSession(nodeStore, sessionStore, { commanderUserId: 'c', nodeId: authorized.node.nodeId, repositoryId: repoA.repositoryId }, memory)

  results.push(check('switch_01_session_module_has_no_repository_setter', !('setRepository' in (await import('./session/session'))), 'no setRepository export'))
  results.push(check('switch_02_session_module_has_no_node_setter', !('setNode' in (await import('./session/session'))), 'no setNode export'))

  // A "different repo" request creates a NEW session — never mutates the existing one.
  const secondSession = await createSession(nodeStore, sessionStore, { commanderUserId: 'c', nodeId: authorized.node.nodeId, repositoryId: repoB.repositoryId }, memory)
  results.push(check('switch_03_different_repository_yields_new_session_id', secondSession.sessionId !== session.sessionId, `${session.sessionId} vs ${secondSession.sessionId}`))

  const reloaded = await sessionStore.getSession(session.sessionId)
  results.push(check('switch_04_original_session_repository_unchanged', reloaded?.repositoryId === repoA.repositoryId, String(reloaded?.repositoryId)))

  // A fresh REPOSITORY_STATUS report (e.g. a branch checkout on the node) never retroactively
  // rewrites a session's already-snapshotted branch — proving no silent mid-session branch switch.
  await applyRepositoryStatusReport(nodeStore, repoA.repositoryId, { currentBranch: 'feature/other', headSha: 'bbb' })
  const reloadedAfterReport = await sessionStore.getSession(session.sessionId)
  results.push(check('switch_05_mid_session_branch_report_does_not_rewrite_snapshot', reloadedAfterReport?.branch === 'main', String(reloadedAfterReport?.branch)))

  return results
}

// ---------------------------------------------------------------------------
// 22-23, 26-29. Protocol validation.
// ---------------------------------------------------------------------------

function testProtocol(): CaseResult[] {
  const results: CaseResult[] = []

  const hello = validateProtocolMessage({
    type: 'NODE_HELLO', nodeName: 'x', platform: 'linux', architecture: 'x64', hostname: 'h', osVersion: '0', agentVersion: '0', capabilities: ['read_file'],
  })
  results.push(check('protocol_01_known_message_type_validated', hello.ok, JSON.stringify(hello)))

  const unknown = validateProtocolMessage({ type: 'DO_ANYTHING', foo: 'bar' })
  results.push(check('protocol_02_unknown_message_type_rejected', !unknown.ok, JSON.stringify(unknown)))

  const malformed = validateProtocolMessage({ type: 'NODE_HELLO', nodeName: 'x' })
  results.push(check('protocol_03_malformed_known_type_rejected', !malformed.ok, JSON.stringify(malformed)))

  const notObject = validateProtocolMessage('not-an-object')
  results.push(check('protocol_04_non_object_rejected', !notObject.ok, JSON.stringify(notObject)))

  const gitStatus = validateProtocolMessage({ type: 'GIT_STATUS', repositoryId: 'r1' })
  results.push(check('protocol_05_git_status_representable', gitStatus.ok, JSON.stringify(gitStatus)))

  const gitDiff = validateProtocolMessage({ type: 'GIT_DIFF', repositoryId: 'r1', staged: false })
  results.push(check('protocol_06_git_diff_representable', gitDiff.ok, JSON.stringify(gitDiff)))

  const gitLog = validateProtocolMessage({ type: 'GIT_LOG', repositoryId: 'r1', limit: 10 })
  results.push(check('protocol_07_git_log_representable', gitLog.ok, JSON.stringify(gitLog)))

  const readFileMsg = validateProtocolMessage({ type: 'READ_FILE', repositoryId: 'r1', relPath: 'package.json' })
  results.push(check('protocol_08_read_file_representable', readFileMsg.ok, JSON.stringify(readFileMsg)))

  const searchFilesMsg = validateProtocolMessage({ type: 'SEARCH_FILES', repositoryId: 'r1', query: 'TerraGlobe' })
  results.push(check('protocol_09_search_files_representable', searchFilesMsg.ok, JSON.stringify(searchFilesMsg)))

  const runValidationMsg = validateProtocolMessage({ type: 'RUN_VALIDATION', repositoryId: 'r1', operationId: 'typecheck' })
  results.push(check('protocol_10_run_validation_representable', runValidationMsg.ok, JSON.stringify(runValidationMsg)))

  return results
}

// ---------------------------------------------------------------------------
// 24-25. Tool event recorded and appears in session state.
// ---------------------------------------------------------------------------

async function testToolActivity(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  const nodeStore = new JsonFileNodeStore(tmpDir('nodes-activity'))
  const sessionStore = new JsonFileSessionStore(tmpDir('sessions-activity'))
  const memory = new JsonFileEngineeringMemoryStore(tmpFile('memory-activity'))

  const { authorized } = await setUpPairedNode(nodeStore)
  const repository = await registerRepository(nodeStore, { nodeId: authorized.node.nodeId, name: 'r', path: '/tmp/act' })
  const session = await createSession(nodeStore, sessionStore, { commanderUserId: 'c', nodeId: authorized.node.nodeId, repositoryId: repository.repositoryId }, memory)

  const event = await recordToolActivity(sessionStore, session.sessionId, 'GIT_STATUS', 'clean', 'PASS')
  results.push(check('activity_01_tool_event_recorded', Boolean(event.id), event.id))

  const events = await sessionStore.listToolEvents(session.sessionId)
  results.push(check('activity_02_event_appears_in_session_state', events.some(e => e.id === event.id), `${events.length} events`))

  let unknownSessionThrew = false
  try {
    await recordToolActivity(sessionStore, 'no-such-session', 'X', 'x', 'PASS')
  } catch (e) {
    unknownSessionThrew = e instanceof SessionBindingError
  }
  results.push(check('activity_03_unknown_session_rejected', unknownSessionThrew, String(unknownSessionThrew)))

  return results
}

// ---------------------------------------------------------------------------
// 30. Phase 1 edit proposal remains functional.
// ---------------------------------------------------------------------------

function testPhase1ProposalStillWorks(): CaseResult[] {
  const proposal = proposeEdit({
    missionId: randomUUID(),
    diagnosis: 'Phase 2 regression fixture — proposal interface unaffected.',
    confidence: 'low',
    changes: [],
    risks: [],
    rollbackPlan: 'n/a',
  })
  return [check('phase1_proposal_01_still_functional', proposal.epistemicStatus === 'NOT_VERIFIED' && Boolean(proposal.id), proposal.id)]
}

// ---------------------------------------------------------------------------
// 31. Native Builder bridge — typed/validated, real re-verification against a live fixture file.
// ---------------------------------------------------------------------------

// Dedicated to this suite — never lib/native-builder's own __fixtures__/knownIssueFixture.ts, so a
// reset here can never clobber a different suite's fixture (see lib/wr-engineer/__fixtures__/
// bridgeEvalFixture.ts's header for why this is a hard requirement, not a style preference).
const BRIDGE_FIXTURE_REL = 'lib/wr-engineer/__fixtures__/bridgeEvalFixture.ts'
const BRIDGE_FIXTURE_CONTENT = `// WR-Engineer Phase 2 native-builder bridge eval fixture. Dedicated to
// wrEngineerPhase2.validation.ts's bridge_* cases — never shared with
// lib/native-builder's own fixtures (lib/native-builder/__fixtures__/knownIssueFixture.ts),
// specifically so this suite's writes/resets can never clobber another suite's fixture content.
// Never imported by real app code.
export const bridgeFixtureMarker = 'ORIGINAL_MARKER'
`

async function resetNativeBuilderState(): Promise<void> {
  await rm(path.join(resolveRepoRoot(), '.war-room', 'native-builder'), { recursive: true, force: true })
}

async function testNativeBuilderBridge(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  const memory = new JsonFileEngineeringMemoryStore(tmpFile('memory-bridge'))
  const fixtureAbs = path.join(resolveRepoRoot(), BRIDGE_FIXTURE_REL)

  await resetNativeBuilderState()
  await writeFile(fixtureAbs, BRIDGE_FIXTURE_CONTENT, 'utf8')

  // Rejection path: matchText that does not exist in the live file.
  const badProposal = proposeEdit({
    missionId: randomUUID(),
    diagnosis: 'Bridge eval — deliberately stale matchText.',
    confidence: 'low',
    changes: [{
      file: BRIDGE_FIXTURE_REL,
      reason: 'eval',
      patch: { operation: 'replace_range', file: BRIDGE_FIXTURE_REL, matchText: 'THIS_TEXT_DOES_NOT_EXIST', replacementText: 'x' },
    }],
    risks: [],
    rollbackPlan: 'n/a',
  })
  const rejected = await bridgeProposalToNativeBuilder(badProposal, {
    title: 'Bridge eval rejection case', description: 'matchText not found', subsystem: BRIDGE_FIXTURE_REL,
  }, memory)
  results.push(check('bridge_01_rejects_stale_match_text', rejected.accepted === false, JSON.stringify(rejected)))

  // Acceptance path: real matchText, freshly re-verified against live content (never trusting a
  // caller-supplied hash — the proposal below supplies none).
  const goodProposal = proposeEdit({
    missionId: randomUUID(),
    diagnosis: 'Bridge eval — valid, live-verified change.',
    confidence: 'medium',
    changes: [{
      file: BRIDGE_FIXTURE_REL,
      reason: 'eval',
      patch: { operation: 'replace_range', file: BRIDGE_FIXTURE_REL, matchText: 'ORIGINAL_MARKER', replacementText: 'UPDATED_MARKER' },
    }],
    risks: ['none — eval fixture only'],
    rollbackPlan: 'reset fixture content',
  })
  const accepted = await bridgeProposalToNativeBuilder(goodProposal, {
    title: 'Bridge eval acceptance case', description: 'valid matchText re-verified live', subsystem: BRIDGE_FIXTURE_REL,
  }, memory)
  results.push(check('bridge_02_accepts_and_creates_real_repair', accepted.accepted === true, JSON.stringify(accepted.accepted ? { repairId: accepted.repair.id, state: accepted.repair.state } : accepted)))

  if (accepted.accepted) {
    results.push(check('bridge_03_repair_state_is_awaiting_approval_never_further', accepted.repair.state === 'awaiting_local_execution_approval', accepted.repair.state))
    results.push(check('bridge_04_selected_proposal_has_freshly_derived_hash', typeof accepted.repair.selectedProposal?.plannedChanges[0]?.patch.expectedOriginalHash === 'string', String(accepted.repair.selectedProposal?.plannedChanges[0]?.patch.expectedOriginalHash)))
    results.push(check('bridge_05_policy_result_recorded_and_ok', accepted.repair.policyResult?.ok === true, JSON.stringify(accepted.repair.policyResult)))
    results.push(check('bridge_06_proposer_attribution_is_wr_engineer', accepted.repair.selectedProposal?.proposerId === 'wr-engineer', String(accepted.repair.selectedProposal?.proposerId)))

    // The bridge never applies — the fixture file on disk must be untouched by the bridge itself.
    const stillOriginal = await readFile(fixtureAbs, 'utf8')
    results.push(check('bridge_07_bridge_never_writes_the_file_itself', stillOriginal.includes('ORIGINAL_MARKER'), 'file unchanged, apply remains native-builder\'s own gated path'))
  }

  await resetNativeBuilderState()
  await writeFile(fixtureAbs, BRIDGE_FIXTURE_CONTENT, 'utf8')

  return results
}

// ---------------------------------------------------------------------------
// 32. Engineering memory records node/repository facts.
// ---------------------------------------------------------------------------

async function testMemoryRecordsNodeRepoFacts(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  const nodeStore = new JsonFileNodeStore(tmpDir('nodes-memory'))
  const sessionStore = new JsonFileSessionStore(tmpDir('sessions-memory'))
  const memory = new JsonFileEngineeringMemoryStore(tmpFile('memory-facts'))

  const { authorized } = await setUpPairedNode(nodeStore)
  const repository = await registerRepository(nodeStore, { nodeId: authorized.node.nodeId, name: 'r', path: '/tmp/mem' })
  const session = await createSession(nodeStore, sessionStore, { commanderUserId: 'c', nodeId: authorized.node.nodeId, repositoryId: repository.repositoryId }, memory)

  const records = await memory.query({ category: 'REPOSITORY_FACT' })
  results.push(check('memory_01_repository_fact_recorded_on_session_creation', records.some(r => r.relatedRefs.includes(session.sessionId)), `${records.length} REPOSITORY_FACT records`))

  return results
}

// ---------------------------------------------------------------------------
// 34-36. Windows / macOS / Linux platform mapping.
// ---------------------------------------------------------------------------

function testPlatformSupport(): CaseResult[] {
  return [
    check('platform_01_windows_supported', nodePlatformFromOsPlatform('win32') === 'windows', String(nodePlatformFromOsPlatform('win32'))),
    check('platform_02_macos_supported', nodePlatformFromOsPlatform('darwin') === 'macos', String(nodePlatformFromOsPlatform('darwin'))),
    check('platform_03_linux_supported', nodePlatformFromOsPlatform('linux') === 'linux', String(nodePlatformFromOsPlatform('linux'))),
    check('platform_04_unsupported_platform_returns_null', nodePlatformFromOsPlatform('sunos') === null, String(nodePlatformFromOsPlatform('sunos'))),
  ]
}

// ---------------------------------------------------------------------------
// 37-38. No unrestricted execution — controlled actions typed but never enabled.
// ---------------------------------------------------------------------------

async function testNoUnrestrictedExecution(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  results.push(check('guard_01_future_message_types_all_disabled', FUTURE_MESSAGE_TYPES.every(t => !isMessageTypeEnabled(t)), JSON.stringify(FUTURE_MESSAGE_TYPES)))
  results.push(check('guard_02_run_command_specifically_disabled', !isMessageTypeEnabled('RUN_COMMAND'), String(isMessageTypeEnabled('RUN_COMMAND'))))
  results.push(check('guard_03_run_command_capability_not_enabled', !ENABLED_NODE_CAPABILITIES.includes('run_command'), JSON.stringify(ENABLED_NODE_CAPABILITIES)))
  results.push(check('guard_04_apply_edit_and_rollback_disabled', !isMessageTypeEnabled('APPLY_EDIT') && !isMessageTypeEnabled('ROLLBACK'), 'both disabled'))

  // No route file under app/api/wr-engineer implements a raw shell/exec endpoint.
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
  for (const file of routeFiles) {
    const content = await readFile(file, 'utf8')
    if (/child_process|execFile|spawn\(|exec\(/.test(content)) sawShellExec = true
  }
  results.push(check('guard_05_no_route_shells_out_directly', !sawShellExec, `${routeFiles.length} routes scanned`))

  return results
}

// ---------------------------------------------------------------------------
// 39. Phase 1 regression re-run inline.
// ---------------------------------------------------------------------------

async function testPhase1Regression(): Promise<CaseResult[]> {
  const results = await runWrEngineerValidation()
  return results.map(r => ({ ...r, name: `phase1_regression_${r.name}` }))
}

export async function runWrEngineerPhase2Validation(): Promise<CaseResult[]> {
  return [
    ...(await testNavigationAndPage()),
    ...(await testIdentityUnaffected()),
    ...(await testSessionBinding()),
    ...(await testNodeIdentity()),
    ...(await testPairingLifecycle()),
    ...(await testHeartbeatAndStaleness()),
    ...(await testRepositoryRegistration()),
    ...(await testNoSilentSwitching()),
    ...testProtocol(),
    ...(await testToolActivity()),
    ...testPhase1ProposalStillWorks(),
    ...(await testNativeBuilderBridge()),
    ...(await testMemoryRecordsNodeRepoFacts()),
    ...testPlatformSupport(),
    ...(await testNoUnrestrictedExecution()),
    ...(await testPhase1Regression()),
  ]
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await runWrEngineerPhase2Validation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(r => !r.pass)
  console.log(`WR-Engineer Phase 2 validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
