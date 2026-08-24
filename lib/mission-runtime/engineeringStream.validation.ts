/**
 * Phase F (Engineering Streaming) regression suite. Calls the real route handler function
 * directly (a plain async (Request) => Response — no framework magic needed to invoke it in
 * isolation) and reads its real ReadableStream body through the same SSE-frame parsing shape
 * lib/council/incremental-transport/sse.ts already established, proving:
 *   1. A stream for a real mission opens, sends an initial full-state progress envelope, and
 *      (when the mission is not already terminal) stays open.
 *   2. A stream for a nonexistent mission emits error + closed and terminates immediately.
 *   3. When the underlying authoritative mission actually transitions (a real approveAndApply()
 *      call made concurrently, not simulated), the stream emits a fresh envelope carrying the new
 *      state, and closes with 'mission_terminal' once status is terminal — proving envelopes come
 *      from real polls of the authoritative record, not a fabricated progress bar.
 *   4. Reconnecting a second stream after the first mid-mission gets the CURRENT full state on its
 *      very first progress envelope, not a replay of everything the first stream saw — the
 *      "refresh must reconstruct authoritative text without replay corruption" requirement.
 */
import { randomUUID } from 'node:crypto'
import { rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { getMissionExecutionStrategy } from '@/lib/mission-runtime'
import { GET as streamGet } from '@/app/api/mission-runtime/engineering/[id]/stream/route'
import type { EngineeringStreamEnvelope } from './engineeringStream'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

const FIXTURE_REL = 'lib/native-builder/__fixtures__/knownIssueFixture.ts'
const BROKEN_FIXTURE_CONTENT = `/**\n * Deliberately broken, isolated fixture for the Phase 14 native-builder end-to-end proof. Never\n * imported by real app code — safe to detect, patch, validate, and roll back repeatedly.\n *\n * Seeded bug: the loop bound \`values.length - 1\` excludes the final array element, so\n * sumFixtureValues([1,2,3,4]) returns 6 (1+2+3) instead of 10.\n */\nexport function sumFixtureValues(values: number[]): number {\n  let total = 0\n  for (let i = 0; i < values.length - 1; i += 1) {\n    total += values[i]\n  }\n  return total\n}\n`

async function resetNativeBuilderState(): Promise<void> {
  const root = path.join(resolveRepoRoot(), '.war-room', 'native-builder')
  await rm(root, { recursive: true, force: true })
}
async function resetFixtureToBroken(): Promise<void> {
  await writeFile(path.join(resolveRepoRoot(), FIXTURE_REL), BROKEN_FIXTURE_CONTENT, 'utf8')
}

/** Reads events off a Response's SSE body for up to `maxEvents` envelopes or until `timeoutMs`,
 * whichever comes first, then aborts the underlying request so the route's own interval timer is
 * torn down (mirrors a browser tab closing an EventSource). */
async function collectEnvelopes(
  response: Response,
  controller: AbortController,
  opts: { maxEvents: number; timeoutMs: number },
): Promise<EngineeringStreamEnvelope[]> {
  const envelopes: EngineeringStreamEnvelope[] = []
  const reader = response.body?.getReader()
  if (!reader) return envelopes
  const decoder = new TextDecoder()
  let buffer = ''
  const deadline = Date.now() + opts.timeoutMs
  try {
    while (envelopes.length < opts.maxEvents && Date.now() < deadline) {
      const timeoutPromise = new Promise<{ done: true; value: undefined }>(resolve =>
        setTimeout(() => resolve({ done: true, value: undefined }), Math.max(0, deadline - Date.now())),
      )
      const result = await Promise.race([reader.read(), timeoutPromise])
      if (result.done) break
      buffer += decoder.decode(result.value, { stream: true })
      let boundary = buffer.search(/\r?\n\r?\n/)
      while (boundary >= 0) {
        const frame = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + (buffer.slice(boundary).startsWith('\r\n\r\n') ? 4 : 2))
        boundary = buffer.search(/\r?\n\r?\n/)
        const dataLine = frame.split(/\r?\n/).find(l => l.startsWith('data:'))
        if (!dataLine) continue
        try {
          envelopes.push(JSON.parse(dataLine.slice(5).trim()) as EngineeringStreamEnvelope)
        } catch {
          /* ignore malformed frame in test harness */
        }
        if (envelopes.length >= opts.maxEvents) break
      }
    }
  } finally {
    controller.abort()
    try {
      await reader.cancel()
    } catch {
      /* already cancelled */
    }
  }
  return envelopes
}

function openStream(missionId: string, intervalMs = 250): { response: Promise<Response>; controller: AbortController } {
  const controller = new AbortController()
  const req = new Request(`https://internal.test/api/mission-runtime/engineering/${missionId}/stream?intervalMs=${intervalMs}`, {
    signal: controller.signal,
  })
  return { response: streamGet(req, { params: Promise.resolve({ id: missionId }) }), controller }
}

async function testOpenAndInitialProgress(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  await resetNativeBuilderState()
  await resetFixtureToBroken()
  const strategy = getMissionExecutionStrategy('engineering')
  const created = await strategy.create({
    title: `Stream fixture ${randomUUID()}`,
    description: 'Proves the stream opens and sends real initial state.',
    subsystem: FIXTURE_REL,
    severity: 'medium',
  })

  const { response, controller } = openStream(created.id)
  const res = await response
  results.push(check('stream_01_content_type_sse', res.headers.get('Content-Type')?.includes('text/event-stream') ?? false, String(res.headers.get('Content-Type'))))

  const envelopes = await collectEnvelopes(res, controller, { maxEvents: 2, timeoutMs: 3000 })
  results.push(check('stream_02_first_envelope_opened', envelopes[0]?.envelopeType === 'opened', JSON.stringify(envelopes[0])))
  results.push(check('stream_03_second_envelope_progress_with_real_mission', envelopes[1]?.envelopeType === 'progress' && envelopes[1].mission.id === created.id, JSON.stringify(envelopes[1]?.envelopeType)))
  if (envelopes[1]?.envelopeType === 'progress') {
    results.push(check('stream_04_progress_carries_full_authoritative_status', envelopes[1].mission.status === created.status, `${envelopes[1].mission.status} vs ${created.status}`))
  }

  await resetNativeBuilderState()
  await resetFixtureToBroken()
  return results
}

async function testNonexistentMissionClosesImmediately(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  const { response, controller } = openStream(`nonexistent-${randomUUID()}`)
  const res = await response
  const envelopes = await collectEnvelopes(res, controller, { maxEvents: 2, timeoutMs: 2000 })
  results.push(check('stream_05_nonexistent_emits_error', envelopes[0]?.envelopeType === 'error', JSON.stringify(envelopes[0])))
  results.push(check('stream_06_nonexistent_then_closed', envelopes[1]?.envelopeType === 'closed' && envelopes[1].terminalState === 'not_found', JSON.stringify(envelopes[1])))
  return results
}

async function testRealTransitionAndTerminalClose(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  await resetNativeBuilderState()
  await resetFixtureToBroken()
  const strategy = getMissionExecutionStrategy('engineering')
  const created = await strategy.create({
    title: 'Fixture sum drops last element',
    description: 'sumFixtureValues([1,2,3,4]) returns 6 instead of 10 — off-by-one loop bound.',
    subsystem: FIXTURE_REL,
    severity: 'medium',
    targetFiles: [FIXTURE_REL],
  })
  results.push(check('stream_07_precondition_awaiting_approval', created.status === 'awaiting_approval', created.status))

  const { response, controller } = openStream(created.id, 200)
  const res = await response
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  const envelopes: EngineeringStreamEnvelope[] = []
  let buffer = ''

  const pump = (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let boundary = buffer.search(/\r?\n\r?\n/)
        while (boundary >= 0) {
          const frame = buffer.slice(0, boundary)
          buffer = buffer.slice(boundary + (buffer.slice(boundary).startsWith('\r\n\r\n') ? 4 : 2))
          boundary = buffer.search(/\r?\n\r?\n/)
          const dataLine = frame.split(/\r?\n/).find(l => l.startsWith('data:'))
          if (dataLine) {
            try {
              envelopes.push(JSON.parse(dataLine.slice(5).trim()) as EngineeringStreamEnvelope)
            } catch {
              /* ignore */
            }
          }
        }
      }
    } catch {
      /* reader cancelled */
    }
  })()

  // Give the stream a moment to send its initial opened+progress pair before we mutate state.
  await new Promise(r => setTimeout(r, 300))

  // Real transition: approve+apply for real, concurrently with the open stream.
  const applied = await strategy.approve(created.id, true)
  results.push(check('stream_08_real_apply_happened', applied.status === 'awaiting_commander_decision' || applied.status === 'blocked', applied.status))

  let resolved = applied
  if (applied.status === 'awaiting_commander_decision') {
    resolved = await strategy.decide(created.id, true)
  }

  // Wait for the stream to observe and report the terminal transition.
  const deadline = Date.now() + 5000
  while (!envelopes.some(e => e.envelopeType === 'closed') && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 100))
  }
  controller.abort()
  try {
    await reader.cancel()
  } catch {
    /* already cancelled */
  }
  await pump

  const finalEnvelope = envelopes.find(e => e.envelopeType === 'final')
  results.push(check('stream_09_final_envelope_seen', Boolean(finalEnvelope), `${envelopes.length} envelopes: ${envelopes.map(e => e.envelopeType).join(',')}`))
  if (finalEnvelope?.envelopeType === 'final') {
    results.push(check('stream_10_final_status_matches_authoritative_resolution', finalEnvelope.mission.status === resolved.status, `${finalEnvelope.mission.status} vs ${resolved.status}`))
  }
  results.push(check('stream_11_closed_with_mission_terminal', envelopes.find(e => e.envelopeType === 'closed')?.envelopeType === 'closed' && (envelopes.find(e => e.envelopeType === 'closed') as Extract<EngineeringStreamEnvelope, { envelopeType: 'closed' }>)?.terminalState === 'mission_terminal', 'terminalState check'))

  // Reconnect proof: a fresh stream now must get the CURRENT (terminal) state on its very first
  // progress-carrying envelope, not a replay of the earlier awaiting_approval/applying frames.
  const reconnect = openStream(created.id)
  const reconnectRes = await reconnect.response
  const reconnectEnvelopes = await collectEnvelopes(reconnectRes, reconnect.controller, { maxEvents: 3, timeoutMs: 3000 })
  const reconnectProgress = reconnectEnvelopes.find(e => e.envelopeType === 'progress' || e.envelopeType === 'final')
  results.push(check(
    'stream_12_reconnect_gets_current_state_not_replay',
    Boolean(reconnectProgress) && reconnectProgress!.mission.status === resolved.status,
    JSON.stringify({ seen: reconnectProgress?.envelopeType, status: reconnectProgress?.mission.status ?? null }),
  ))

  await resetNativeBuilderState()
  await resetFixtureToBroken()
  return results
}

export async function runEngineeringStreamValidation(): Promise<CaseResult[]> {
  return [
    ...(await testOpenAndInitialProgress()),
    ...(await testNonexistentMissionClosesImmediately()),
    ...(await testRealTransitionAndTerminalClose()),
  ]
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await runEngineeringStreamValidation()
  for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.name} ${r.detail}`)
  const failed = results.filter(r => !r.pass)
  console.log(`Engineering Stream validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
