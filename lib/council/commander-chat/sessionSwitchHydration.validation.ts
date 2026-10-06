/**
 * Session switch hydration: rail selection is the only pane authority.
 */
import { pathToFileURL } from 'node:url'
import { readFileSync } from 'node:fs'
import { shouldReplacePersistedTranscript } from '@/lib/conversation-runtime/transcriptReconciliation'
import { parseConversationId } from '@/lib/war-room/conversationOwnership'
import {
  createSimulatedSessionState,
  decideHydrationApply,
  historyHydrationRequest,
  ledgerIdIsNotRemoteAuthority,
  sessionBindingSourceFromHttp,
  shouldCommitFetchedTranscript,
  shouldHydrateAlreadySelectedSession,
  shouldPersistLocalTranscript,
  sidebarPaneIdentitiesAgree,
  simulateFetchResolve,
  simulateSelectSession,
  visibleTranscriptForSelection,
} from './sessionSwitchHydration'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function pair(kind: string, text: string): { messageType: string; content: string }[] {
  return [
    { messageType: 'decree', content: text },
    { messageType: 'response', content: `${kind} reply` },
  ]
}

const moe = pair('moe', 'Research current mixture-of-experts inference methods using primary sources.')
const status = pair('status', 'what is the status')
const empty: { messageType: string; content: string }[] = []

export function runSessionSwitchHydrationValidation(): CaseResult[] {
  const results: CaseResult[] = []

  {
    const state = createSimulatedSessionState()
    simulateSelectSession(state, 'sess-a', moe)
    simulateSelectSession(state, 'sess-b', status)
    const visible = visibleTranscriptForSelection({
      activeSessionId: state.activeSessionId,
      transcriptOwnerId: state.transcriptOwnerId,
      messages: state.messages,
    })
    results.push(check(
      'SESSION-SWITCH-1',
      state.activeSessionId === 'sess-b'
      && visible.visible
      && visible.messages.some(row => 'content' in row && String(row.content).includes('what is the status'))
      && !visible.messages.some(row => 'content' in row && String(row.content).includes('mixture-of-experts')),
      `active=${state.activeSessionId} owner=${state.transcriptOwnerId}`,
    ))
  }

  {
    const state = createSimulatedSessionState()
    simulateSelectSession(state, 'sess-a', moe)
    simulateSelectSession(state, 'sess-b', status)
    simulateSelectSession(state, 'sess-a', moe)
    results.push(check(
      'SESSION-SWITCH-2',
      state.activeSessionId === 'sess-a'
      && state.transcriptOwnerId === 'sess-a'
      && state.messages.some(row => String(row.content).includes('mixture-of-experts'))
      && !state.messages.some(row => String(row.content).includes('what is the status')),
      `active=${state.activeSessionId} last=${state.messages.at(-1)?.content}`,
    ))
  }

  {
    const state = createSimulatedSessionState()
    simulateSelectSession(state, 'sess-a', moe)
    simulateSelectSession(state, 'sess-empty', empty)
    const visible = visibleTranscriptForSelection({
      activeSessionId: state.activeSessionId,
      transcriptOwnerId: state.transcriptOwnerId,
      messages: state.messages,
    })
    results.push(check(
      'SESSION-SWITCH-3',
      visible.visible && visible.messages.length === 0 && state.activeSessionId === 'sess-empty',
      `count=${visible.messages.length}`,
    ))
  }

  {
    const state = createSimulatedSessionState()
    const a1 = simulateSelectSession(state, 'sess-a', moe)
    const b1 = simulateSelectSession(state, 'sess-b', status)
    const a2 = simulateSelectSession(state, 'sess-a', moe)
    const lateB = simulateFetchResolve(state, {
      resultSessionId: 'sess-b',
      resultGeneration: b1.generation,
      fetchedMessages: status,
    })
    results.push(check(
      'SESSION-SWITCH-4',
      lateB.apply === false
      && lateB.reason === 'stale_generation'
      && state.transcriptOwnerId === 'sess-a'
      && state.generation === a2.generation
      && a1.generation < b1.generation
      && state.messages.some(row => String(row.content).includes('mixture-of-experts')),
      `late=${lateB.reason} owner=${state.transcriptOwnerId}`,
    ))
  }

  {
    const hydratedForeign = createSimulatedSessionState()
    hydratedForeign.activeSessionId = 'sess-moe'
    hydratedForeign.transcriptOwnerId = 'sess-status'
    hydratedForeign.messages = status
    hydratedForeign.generation = 1
    const mustReplace = shouldCommitFetchedTranscript({
      fetchedSessionId: 'sess-moe',
      activeSessionId: 'sess-moe',
      visibleOwnerId: 'sess-status',
      localMessages: status,
      fetchedMessages: moe,
    })
    const sameCountWouldBlockOldGuard = shouldReplacePersistedTranscript(status, moe) === false
    simulateSelectSession(hydratedForeign, 'sess-moe', moe)
    simulateSelectSession(hydratedForeign, 'sess-status', status)
    simulateSelectSession(hydratedForeign, 'sess-moe', moe)
    results.push(check(
      'SESSION-SWITCH-5',
      mustReplace
      && sameCountWouldBlockOldGuard
      && hydratedForeign.transcriptOwnerId === 'sess-moe'
      && hydratedForeign.messages.some(row => String(row.content).includes('mixture-of-experts')),
      `mustReplace=${mustReplace} oldGuardBlocksEqualCount=${sameCountWouldBlockOldGuard}`,
    ))
  }

  {
    const state = createSimulatedSessionState()
    simulateSelectSession(state, 'sess-moe', moe)
    const restored = visibleTranscriptForSelection({
      activeSessionId: state.activeSessionId,
      transcriptOwnerId: state.transcriptOwnerId,
      messages: state.messages,
    })
    results.push(check(
      'SESSION-SWITCH-6',
      restored.visible && restored.messages.some(row => String(row.content).includes('mixture-of-experts')),
      `count=${restored.messages.length}`,
    ))
  }

  {
    const state = createSimulatedSessionState()
    simulateSelectSession(state, 'sess-status', status)
    results.push(check(
      'SESSION-SWITCH-7',
      state.messages.some(row => String(row.content).includes('what is the status'))
      && state.messages.some(row => String(row.content).includes('status reply')),
      `last=${state.messages.at(-1)?.content}`,
    ))
  }

  {
    const req = historyHydrationRequest('sess-moe')
    results.push(check(
      'SESSION-SWITCH-8',
      req.method === 'GET' && req.startsMission === false && req.path.includes('/api/conversations/sess-moe'),
      JSON.stringify(req),
    ))
  }

  {
    const state = createSimulatedSessionState()
    simulateSelectSession(state, 'sess-moe', moe)
    simulateSelectSession(state, 'sess-status', status)
    const advancedFollows = state.transcriptOwnerId === 'sess-status' && state.activeSessionId === 'sess-status'
    results.push(check('SESSION-SWITCH-9', advancedFollows, `owner=${state.transcriptOwnerId}`))
  }

  {
    const state = createSimulatedSessionState()
    simulateSelectSession(state, 'sess-status', status)
    simulateSelectSession(state, 'sess-moe', moe)
    const runtimeFollows = state.transcriptOwnerId === 'sess-moe'
      && !state.messages.some(row => String(row.content).includes('what is the status'))
    results.push(check('SESSION-SWITCH-10', runtimeFollows, `owner=${state.transcriptOwnerId}`))
  }

  {
    const agree = sidebarPaneIdentitiesAgree({ sidebarSessionId: 'sess-a', paneOwnerId: 'sess-a' })
    const split = sidebarPaneIdentitiesAgree({ sidebarSessionId: 'sess-a', paneOwnerId: 'sess-b' })
    const hiddenStale = visibleTranscriptForSelection({
      activeSessionId: 'sess-a',
      transcriptOwnerId: 'sess-b',
      messages: status,
    })
    results.push(check(
      'SESSION-SWITCH-11',
      agree && !split && hiddenStale.visible === false && hiddenStale.messages.length === 0,
      `agree=${agree} split=${split} hidden=${hiddenStale.messages.length}`,
    ))
  }

  {
    const localUuid = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
    const parsed = parseConversationId(localUuid)
    const persistOk = shouldPersistLocalTranscript({
      cacheSessionId: localUuid,
      activeSessionId: localUuid,
      transcriptOwnerId: localUuid,
    })
    const persistCross = shouldPersistLocalTranscript({
      cacheSessionId: localUuid,
      activeSessionId: 'other',
      transcriptOwnerId: localUuid,
    })
    results.push(check(
      'SESSION-SWITCH-12',
      ledgerIdIsNotRemoteAuthority(localUuid)
      && parsed === localUuid
      && sessionBindingSourceFromHttp(401) === 'local_ledger'
      && sessionBindingSourceFromHttp(404) === 'local_ledger'
      && sessionBindingSourceFromHttp(200) === 'remote_conversation'
      && persistOk
      && persistCross === false,
      `parsed=${parsed} source401=${sessionBindingSourceFromHttp(401)}`,
    ))
  }

  {
    const staleClick = shouldHydrateAlreadySelectedSession({
      selectedSessionId: 'sess-moe',
      activeSessionId: 'sess-moe',
      transcriptOwnerId: 'sess-status',
    })
    const skipHealthy = shouldHydrateAlreadySelectedSession({
      selectedSessionId: 'sess-moe',
      activeSessionId: 'sess-moe',
      transcriptOwnerId: 'sess-moe',
    })
    const aborted = decideHydrationApply({
      selectedSessionId: 'sess-b',
      activeSessionId: 'sess-a',
      resultSessionId: 'sess-b',
      selectionGeneration: 3,
      resultGeneration: 2,
      aborted: true,
    })
    results.push(check(
      'SESSION-SWITCH-OWNER-REPAIR',
      staleClick && !skipHealthy && aborted.reason === 'aborted',
      `staleClick=${staleClick} skipHealthy=${skipHealthy} aborted=${aborted.reason}`,
    ))
  }

  {
    const readout = readFileSync(new URL('../../../components/council/EvidenceBoardReadout.tsx', import.meta.url), 'utf8')
    results.push(check(
      'SESSION-SWITCH-13-PARTIAL-EBC',
      readout.includes('aurora?.unknowns')
      && readout.includes('aurora?.verified_facts')
      && readout.includes('snapshot.selected_agents ??')
      && !/snapshot\.aurora\.unknowns/.test(readout),
      'persisted research snapshots without aurora must not crash Advanced',
    ))
  }

  return results
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runSessionSwitchHydrationValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`SESSION_SWITCH_HYDRATION ${results.length - failed.length}/${results.length} ${failed.length ? 'FAIL' : 'PASS'}`)
  if (failed.length) process.exit(1)
}
