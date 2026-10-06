import { classifyCouncilPath } from './pathClassifier'
import { classifyToolNeed } from './toolNeed'
import { commanderTurnFromText } from './multimodalEnvelope'
import { runShortPathRuntime } from './shortPathRuntime'
import { createModelBackedShortPathCompleter, selectLiveShortPathTarget, withIsolatedShortPathCompleteFlag } from './shortPathCompleter'
import { qualityShortPathCompleter } from './qualityCompleter'
import { toCommanderFacing, publicBodyHasInternalIds, auroraAnswersFirst } from './responseLayer'
import { classifyEvidenceBoardMission } from '@/lib/council/evidence-board/classifier'
import { runEvidenceBoardCouncil } from '@/lib/council/evidence-board/orchestrator'
import { selectAgentsForMission } from './agentSelectionPolicy'
import { createTypedHandoff } from './handoff'
import { WAR_ROOM_GOLD_PROMPTS } from './goldPrompts'
import type { GiEng03Case } from './gi.eng03.validation'
import type { OutputEnvelopeV1 } from './types'

function check(caseId: string, description: string, ok: boolean, details: unknown = ''): GiEng03Case {
  return { lane: 'LIVE', caseId, description, result: ok ? 'PASS' : 'FAIL', details: typeof details === 'string' ? details : JSON.stringify(details) }
}

function skip(caseId: string, description: string, details: string): GiEng03Case {
  return { lane: 'LIVE', caseId, description, result: 'SKIP', details }
}

export type LiveLatencySample = {
  id: string
  latency_ms: number
  ttft_ms: number | null
  placement: string
  family: string
}

export type LiveAcceptanceSummary = {
  live_available: boolean
  placement: string
  family: string
  local_model?: string
  latencies: LiveLatencySample[]
  p50: number | null
  p95: number | null
  proposed_gate_ms: number | null
}

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[idx]
}

function rubric(input: {
  text: string
  question: string
  envelope: OutputEnvelopeV1
  expectPath: 'SHORT_PATH' | 'AGENT_PATH' | 'HANDOFF' | 'ESCALATED'
  prior?: string[]
}): { pass: boolean; fail: string[] } {
  const fail: string[] = []
  const facing = toCommanderFacing(input.envelope)
  if (input.expectPath === 'ESCALATED') {
    if (input.envelope.completion_state !== 'ESCALATED') fail.push('not_escalated')
  } else if (input.envelope.path_used !== input.expectPath && input.expectPath === 'SHORT_PATH') {
    fail.push(`route_${input.envelope.path_used}`)
  }
  if (input.expectPath === 'SHORT_PATH' && input.envelope.seats_used.length) fail.push('unnecessary_agent')
  if (input.expectPath === 'SHORT_PATH' && input.envelope.tool_trace_public.some(row => /broker|browser/i.test(row.label))) fail.push('unnecessary_tool')
  if (publicBodyHasInternalIds(facing.text) || publicBodyHasInternalIds(input.envelope.body.summary)) fail.push('id_leak')
  if (input.expectPath === 'SHORT_PATH' && input.envelope.body.summary.trim().length < 8) fail.push('empty')
  if (/\b(ORION|LUMEN|PULSAR)\s+says\b/i.test(facing.text)) fail.push('seat_narration')
  if (/\b(dimensional (?:instability|rift)|another realm|stabilize the rift|from another realm)\b/i.test(facing.text)) fail.push('fantasy_roleplay')
  if (input.prior?.length && /what (?:do you mean|is that|are you referring)/i.test(facing.text)) fail.push('lost_context')
  if (input.envelope.authority_decisions.some(row => row.executed && row.decision !== 'auto')) fail.push('authority')
  return { pass: fail.length === 0, fail }
}

async function liveShort(text: string, prior: string[] = [], completer: ReturnType<typeof createModelBackedShortPathCompleter>) {
  const envelope = commanderTurnFromText({ text, room_id: 'gi-eng-03-room', session_id: 'gi-eng-03-session' })
  envelope.context.prior_turns = prior
  envelope.context.conversation_id = 'gi-eng-03-session'
  const output = await runShortPathRuntime({
    envelope,
    path: 'SHORT_PATH',
    allow_tools: true,
    tool_allowlist: ['council.calc.simple'],
    model_route: { lane: 'classify_or_short', placement: 'NONE' },
  }, completer)
  return output
}

export async function runGiEng03Live(): Promise<{ cases: GiEng03Case[]; summary: LiveAcceptanceSummary }> {
  const live = await selectLiveShortPathTarget()
  const summary: LiveAcceptanceSummary = {
    live_available: Boolean(live.target || live.local_model),
    placement: live.placement,
    family: live.target?.providerFamily ?? (live.local_model ? 'local_ollama' : 'none'),
    local_model: live.local_model,
    latencies: [],
    p50: null,
    p95: null,
    proposed_gate_ms: null,
  }
  if (!summary.live_available) {
    return {
      cases: [skip('LIVE-UNAVAILABLE', 'No hosted key and no live local model. Cannot score LIVE.', live.reason)],
      summary,
    }
  }

  return withIsolatedShortPathCompleteFlag(async () => {
    const cases: GiEng03Case[] = []
    const completer = createModelBackedShortPathCompleter(qualityShortPathCompleter)
    cases.push(check('LIVE-TARGET', 'live target is hosted dispatch or actual local model', summary.placement === 'CLOUD' || summary.placement === 'LOCAL', live))

    const session = [
      "What's up Council?",
      "I've been thinking about making you smarter before I redesign the UI.",
      'Why is that the better order?',
      'What is the difference between RAM and VRAM?',
      'Explain it using War Room as the example.',
      'Rewrite this professionally:\nwe need to fix the browser before we add more stuff because it keeps breaking',
      'Tell me about sparse experts.',
      'Now research the latest sparse expert inference work using primary sources.',
      'Anyway, make that rewrite more concise.',
      "Thanks. That's enough for now.",
    ]
    const history: string[] = []
    let sessionOk = true
    for (const [index, turn] of session.entries()) {
      const classified = classifyCouncilPath({ text: turn, prior_turns: history })
      if (classified.path !== 'SHORT_PATH') {
        const expectEscalation = /research the latest|primary sources/i.test(turn)
        const output = await liveShort(turn, history, completer)
        const ok = expectEscalation
          ? output.completion_state === 'ESCALATED' && output.escalation?.to === 'AGENT_PATH'
          : false
        cases.push(check(`SESS-${index + 1}`, `turn ${index + 1} ${expectEscalation ? 'escalates' : 'should have stayed SHORT'}`, ok && output.telemetry?.turn_id != null, {
          path: classified.path,
          state: output.completion_state,
          to: output.escalation?.to,
        }))
        if (!ok) sessionOk = false
        history.push(turn)
        continue
      }
      const output = await liveShort(turn, history, completer)
      const invoked = output.telemetry?.model_family ? output.placement !== 'NONE' : output.placement === 'LOCAL' || output.placement === 'CLOUD' || output.placement === 'HYBRID'
      const score = rubric({ text: output.body.summary, question: turn, envelope: output, expectPath: 'SHORT_PATH', prior: history })
      const liveOk = (output.placement === 'LOCAL' || output.placement === 'CLOUD' || output.placement === 'HYBRID') && Boolean(output.body.summary.trim()) && score.pass
      if (!liveOk) sessionOk = false
      summary.latencies.push({
        id: `SESS-${index + 1}`,
        latency_ms: output.telemetry?.latency_ms ?? 0,
        ttft_ms: output.telemetry?.ttft_ms ?? null,
        placement: output.placement,
        family: output.telemetry?.model_family ?? summary.family,
      })
      cases.push(check(`SESS-${index + 1}`, `session turn ${index + 1}: ${turn.slice(0, 48)}`, liveOk && invoked, {
        placement: output.placement,
        family: output.telemetry?.model_family,
        fallback: output.telemetry?.fallback,
        latency_ms: output.telemetry?.latency_ms,
        ttft_ms: output.telemetry?.ttft_ms,
        fail: score.fail,
        preview: output.body.summary.slice(0, 240),
      }))
      history.push(turn)
    }
    cases.push(check('SESS-CONT', '10-turn mix preserves one session and returns to casual after research', sessionOk && history.length === 10, { turns: history.length }))

    const extras: Array<{ id: string; prompt: string; prior?: string[] }> = [
      { id: 'LIVE-HTTP', prompt: 'What is HTTP?' },
      { id: 'LIVE-MATH', prompt: '2+2' },
      { id: 'LIVE-VRAM', prompt: 'If a model needs 12 GB VRAM and another process reserves 5 GB on a 16 GB GPU, can both safely fit at once? Explain the practical problem.' },
      { id: 'LIVE-TOOLS', prompt: 'Why might a smaller model with better tools outperform a larger model without tools on War Room tasks?' },
      { id: 'LIVE-CESIUM', prompt: 'Give me three architectural reasons not to put full Cesium on the Home page.' },
      { id: 'LIVE-EXPLAIN', prompt: 'Explain what the PathClassifier does.' },
    ]
    for (const extra of extras) {
      const output = await liveShort(extra.prompt, extra.prior ?? [], completer)
      const score = rubric({ text: output.body.summary, question: extra.prompt, envelope: output, expectPath: 'SHORT_PATH' })
      const liveOk = output.placement !== 'NONE' && output.body.summary.trim().length > 0 && score.pass
      if (extra.id === 'LIVE-MATH') {
        const mathOk = output.body.summary.trim() === '4' || /\b4\b/.test(output.body.summary)
        cases.push(check(extra.id, extra.prompt, mathOk && output.seats_used.length === 0, { summary: output.body.summary, placement: output.placement }))
      } else {
        cases.push(check(extra.id, extra.prompt, liveOk, {
          placement: output.placement,
          family: output.telemetry?.model_family,
          latency_ms: output.telemetry?.latency_ms,
          fail: score.fail,
          preview: output.body.summary.slice(0, 280),
        }))
      }
      summary.latencies.push({
        id: extra.id,
        latency_ms: output.telemetry?.latency_ms ?? 0,
        ttft_ms: output.telemetry?.ttft_ms ?? null,
        placement: output.placement,
        family: output.telemetry?.model_family ?? summary.family,
      })
    }

    for (const gold of WAR_ROOM_GOLD_PROMPTS.filter(row => row.expected_path === 'SHORT_PATH').slice(0, 4)) {
      const output = await liveShort(gold.prompt, gold.prior ?? [], completer)
      const score = rubric({ text: output.body.summary, question: gold.prompt, envelope: output, expectPath: 'SHORT_PATH' })
      cases.push(check(`LIVE-${gold.id}`, gold.prompt.slice(0, 72), output.placement !== 'NONE' && score.pass, {
        placement: output.placement,
        fail: score.fail,
        preview: output.body.summary.slice(0, 220),
      }))
      summary.latencies.push({
        id: gold.id,
        latency_ms: output.telemetry?.latency_ms ?? 0,
        ttft_ms: output.telemetry?.ttft_ms ?? null,
        placement: output.placement,
        family: output.telemetry?.model_family ?? summary.family,
      })
    }

    const escalate = classifyCouncilPath({
      text: 'Now research the latest sparse expert inference work using primary sources.',
      prior_turns: ['Tell me about sparse experts.'],
    })
    cases.push(check('LIVE-ESC', 'research follow-up is AGENT DEEP_RESEARCH', escalate.path === 'AGENT_PATH' && escalate.mission_class === 'DEEP_RESEARCH' && escalate.tool_need === 'BROWSER_SEARCH', escalate))

    const foundry = classifyCouncilPath('Change the PathClassifier in the repo so it handles X.')
    const stub = createTypedHandoff({ text: 'Change the PathClassifier in the repo so it handles X.', room_id: 'gi-eng-03-room', session_id: 'gi-eng-03-session', target: 'FOUNDRY' })
    cases.push(check('LIVE-FOUNDRY', 'live Foundry distinction holds', foundry.path === 'HANDOFF' && stub.executed === false, { path: foundry.path, executed: stub.executed }))

    try {
      const ebc = await runEvidenceBoardCouncil({ commanderMessage: 'Status on War Room' })
      const brief = ebc.commander_brief
      const agents = ebc.classification.selected_agents
      cases.push(check('LIVE-EBC', 'Status on War Room uses existing EBC, not six seats', ebc.classification.mission_class === 'SYSTEM_STATUS' && agents.length <= 5 && agents.includes('ORION') && agents.includes('AURORA') && !/claim_/i.test(brief), {
        agents,
        completion: ebc.snapshot.completion_state,
        brief: brief.slice(0, 280),
      }))
      cases.push(check('LIVE-AURORA', 'EBC brief answers first without claim IDs or seat-says', auroraAnswersFirst(brief, 'Status on War Room') && !publicBodyHasInternalIds(brief) && !/\bORION says\b/i.test(brief), brief.slice(0, 280)))
      const why = classifyCouncilPath({ text: 'Why did you say that?', prior_turns: ['Status on War Room', brief] })
      cases.push(check('LIVE-EBC-FOLLOW', 'why-did-you-say-that does not blindly rerun status as a new six-seat mission', why.path === 'SHORT_PATH' && why.mission_class !== 'SYSTEM_STATUS', why))
    } catch (error) {
      cases.push(check('LIVE-EBC', 'Status on War Room live EBC', false, error instanceof Error ? error.message : String(error)))
    }

    try {
      const researchClass = classifyEvidenceBoardMission({
        commanderMessage: 'Research the current Playwright guidance for persistent browser profiles and use primary sources.',
      })
      const seats = selectAgentsForMission({ mission_class: researchClass.mission_class, text: 'Research the current Playwright guidance for persistent browser profiles and use primary sources.' })
      cases.push(check('LIVE-RESEARCH-ROUTE', 'Playwright primary-source research is DEEP_RESEARCH with PULSAR', researchClass.mission_class === 'DEEP_RESEARCH' && seats.selected_agents.includes('PULSAR') && seats.selected_agents.length < 6, { class: researchClass.mission_class, agents: seats.selected_agents, tools: researchClass.required_tools }))
      const research = await runEvidenceBoardCouncil({
        commanderMessage: 'Research the current Playwright guidance for persistent browser profiles and use primary sources.',
      })
      const brief = research.commander_brief
      cases.push(check('LIVE-RESEARCH', 'research mission uses Broker path and clean AURORA brief', research.classification.selected_agents.includes('PULSAR') && !publicBodyHasInternalIds(brief) && !/claim_/i.test(brief), {
        agents: research.classification.selected_agents,
        completion: research.snapshot.completion_state,
        sources: research.board.evidence.filter(row => row.url).slice(0, 4).map(row => row.url),
        brief: brief.slice(0, 280),
      }))
    } catch (error) {
      cases.push(check('LIVE-RESEARCH', 'Playwright research live EBC', false, error instanceof Error ? error.message : String(error)))
    }

    const samples = summary.latencies.filter(row => row.latency_ms > 0).map(row => row.latency_ms)
    summary.p50 = percentile(samples, 50)
    summary.p95 = percentile(samples, 95)
    summary.proposed_gate_ms = summary.p95 != null ? Math.max(8_000, Math.round(summary.p95 * 1.4)) : null
    cases.push(check('LIVE-LAT', 'latency measured for live SHORT_PATH', samples.length >= 5 && summary.p50 != null, {
      n: samples.length,
      p50: summary.p50,
      p95: summary.p95,
      proposed_gate_ms: summary.proposed_gate_ms,
    }))
    cases.push(check('LIVE-PLACE', 'placement is LOCAL or CLOUD from a real generator', summary.placement === 'LOCAL' || summary.placement === 'CLOUD', summary))

    return { cases, summary }
  })
}
