import { NextResponse } from 'next/server'
import {
  buildCouncilTraceTestChatBody,
  buildCouncilTraceTestRunResponse,
  COUNCIL_TRACE_TEST_PROMPT,
  handleCouncilTraceTestRun,
  handleCouncilTraceTestStatus,
} from '@/lib/council/traceTestRoute'
import type { CouncilRuntimeTraceSnapshot, CouncilTraceStage } from '@/lib/council/runtimeTrace'

export type CouncilTraceTestRouteValidationResult = {
  name: string
  ok: boolean
  expected: string
  observed: string
}

export async function runCouncilTraceTestRouteValidation(): Promise<CouncilTraceTestRouteValidationResult[]> {
  return [
    tracePromptAndBodyAreExact(),
    await environmentGateRunsBeforeCommanderSession(),
    await nonCommanderCannotInvokeChatPost(),
    await commanderStatusAvailabilityRequiresAuthorization(),
    await commanderRunInvokesExistingChatPath(),
    traceSummaryDistinguishesKimiIntentionalUnavailability(),
    traceSummaryRejectsSecretLikeArtifacts(),
  ]
}

function validation(
  name: string,
  ok: boolean,
  expected: string,
  observed: string,
): CouncilTraceTestRouteValidationResult {
  return { name, ok, expected, observed }
}

function tracePromptAndBodyAreExact(): CouncilTraceTestRouteValidationResult {
  const body = buildCouncilTraceTestChatBody()
  const ok =
    body.message === COUNCIL_TRACE_TEST_PROMPT
    && body.councilTraceDebug === true
    && body.councilFlowMode === 'full_council'
    && body.mode === 'trace_test'
  return validation(
    'trace_prompt_and_body_are_exact',
    ok,
    'exact prompt, councilTraceDebug=true, full_council mode',
    JSON.stringify(body),
  )
}

async function environmentGateRunsBeforeCommanderSession(): Promise<CouncilTraceTestRouteValidationResult> {
  let commanderCalled = false
  let chatCalled = false
  const response = await handleCouncilTraceTestRun(testRequest(), {
    assertEnvironmentAllowed: () => NextResponse.json({ error: 'blocked' }, { status: 403 }),
    requireCommander: async () => {
      commanderCalled = true
      return { ok: true, userId: 'commander' }
    },
    chatPost: async () => {
      chatCalled = true
      return NextResponse.json({})
    },
  })
  const ok = response.status === 403 && !commanderCalled && !chatCalled
  return validation(
    'environment_gate_runs_before_commander_session',
    ok,
    '403 before Commander lookup and before chat invocation',
    `status=${response.status}; commanderCalled=${commanderCalled}; chatCalled=${chatCalled}`,
  )
}

async function nonCommanderCannotInvokeChatPost(): Promise<CouncilTraceTestRouteValidationResult> {
  let chatCalled = false
  const response = await handleCouncilTraceTestRun(testRequest(), {
    assertEnvironmentAllowed: () => null,
    requireCommander: async () => ({
      ok: false,
      response: NextResponse.json({ error: 'Commander session required.' }, { status: 403 }),
    }),
    chatPost: async () => {
      chatCalled = true
      return NextResponse.json({})
    },
  })
  const ok = response.status === 403 && !chatCalled
  return validation(
    'non_commander_cannot_invoke_chat_post',
    ok,
    '403 and no /api/chat call',
    `status=${response.status}; chatCalled=${chatCalled}`,
  )
}

async function commanderStatusAvailabilityRequiresAuthorization(): Promise<CouncilTraceTestRouteValidationResult> {
  const response = await handleCouncilTraceTestStatus(testRequest(), {
    assertEnvironmentAllowed: () => null,
    requireCommander: async () => ({ ok: true, userId: 'commander' }),
  })
  const body = await response.json() as { available?: unknown; temporary?: unknown }
  const ok = response.status === 200 && body.available === true && body.temporary === true
  return validation(
    'commander_status_availability_requires_authorization',
    ok,
    'authorized status returns available temporary control',
    `status=${response.status}; body=${JSON.stringify(body)}`,
  )
}

async function commanderRunInvokesExistingChatPath(): Promise<CouncilTraceTestRouteValidationResult> {
  let sentBody: Record<string, unknown> = {}
  const response = await handleCouncilTraceTestRun(testRequest(), {
    assertEnvironmentAllowed: () => null,
    requireCommander: async () => ({ ok: true, userId: 'commander' }),
    chatPost: async request => {
      sentBody = await request.json() as Record<string, unknown>
      return NextResponse.json({
        results: [{ family: 'ChatGPT', status: 'OK', content: 'ChatGPT Family: orchestration and synthesis.' }],
        councilTrace: sampleTrace(),
      })
    },
    env: { OPENAI_API_KEY: 'configured' },
  })
  const body = await response.json() as { ok?: unknown; summary?: { traceCaptured?: unknown } }
  const ok =
    response.status === 200
    && body.ok === true
    && body.summary?.traceCaptured === true
    && sentBody?.message === COUNCIL_TRACE_TEST_PROMPT
    && sentBody?.councilTraceDebug === true
    && sentBody?.councilFlowMode === 'full_council'
  return validation(
    'commander_run_invokes_existing_chat_path',
    ok,
    'authorized run calls injected /api/chat path with exact trace body',
    `status=${response.status}; sent=${JSON.stringify(sentBody)}; traceCaptured=${body.summary?.traceCaptured}`,
  )
}

function traceSummaryDistinguishesKimiIntentionalUnavailability(): CouncilTraceTestRouteValidationResult {
  const response = buildCouncilTraceTestRunResponse({
    results: [{ family: 'ChatGPT', status: 'OK', content: 'ready' }],
    councilTrace: sampleTrace(),
  }, {
    OPENAI_API_KEY: 'configured',
    ANTHROPIC_API_KEY: 'configured',
    XAI_API_KEY: 'configured',
    GEMINI_API_KEY: 'configured',
  })
  const kimi = response.summary.unavailableProviders.find(provider => provider.family === 'Kimi')
  const ok = kimi?.reason === 'intentionally_unavailable_funding_paused'
  return validation(
    'trace_summary_distinguishes_kimi_intentional_unavailability',
    ok,
    'Kimi unavailable reason is intentional funding pause, not provider error',
    JSON.stringify(kimi),
  )
}

function traceSummaryRejectsSecretLikeArtifacts(): CouncilTraceTestRouteValidationResult {
  const trace = sampleTrace()
  trace.stages[0] = {
    ...trace.stages[0],
    outputSummary: { leaked: 'Bearer abc.def.ghi' },
  }
  const response = buildCouncilTraceTestRunResponse({ results: [], councilTrace: trace })
  const ok = response.summary.secretRedactionVerdict === 'failed'
  return validation(
    'trace_summary_rejects_secret_like_artifacts',
    ok,
    'secret-like trace artifact yields failed redaction verdict',
    response.summary.secretRedactionVerdict,
  )
}

function testRequest(): Request {
  return new Request('https://war-room-os.test/api/council/trace-test', { method: 'POST' })
}

function sampleTrace(): CouncilRuntimeTraceSnapshot {
  return {
    councilTraceId: 'ctrace_test',
    missionId: 'mission_test',
    missionVersion: 1,
    finalReportId: 'creport_test',
    sessionId: null,
    providerResponseIds: { ChatGPT: ['resp_chatgpt_test'] },
    stages: [
      stage('request_received', 'Initialized trace.'),
      stage('command_parsed', 'Commander discipline command normalized.'),
      stage('current_intent_resolved', 'Intent resolved.'),
      stage('providers_selected', 'Providers selected.'),
      stage('provider_calls_started', 'Provider calls started.'),
      stage('provider_responses_received', 'Provider responses collected.'),
      stage('integrity_checked', 'Provider results checked.'),
      stage('red_team_checked', 'Red Team integrity observed.'),
      { ...stage('scope_guardian_checked', 'Scope Guardian advisory check recorded.'), observation: 'inferred' },
      stage('final_moderated', 'Finalized.'),
      stage('council_report_built', 'Report built.'),
      stage('memory_recommendation_recorded', 'No memory proposal ingestion ran.'),
    ],
    redaction: { applied: true, policy: 'test redaction policy' },
    createdAt: '2026-07-15T00:00:00.000Z',
    completedAt: '2026-07-15T00:00:01.000Z',
  }
}

function stage(stageName: CouncilRuntimeTraceSnapshot['stages'][number]['stage'], stateChange: string): CouncilTraceStage {
  return {
    stage: stageName,
    module: 'test',
    inputSummary: null,
    outputSummary: null,
    stateChange,
    timestamp: '2026-07-15T00:00:00.000Z',
    missionVersion: 1,
    observation: 'runtime_observed',
  }
}
