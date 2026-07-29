/**
 * Deterministic offline validator for the Live Council incremental-transport/persona cluster —
 * the part of Stage 5 the pre-existing `lib/council/incremental-transport/validation.ts` does not
 * already cover (that file owns SSE/envelope/reconciliation/route-wiring; this file owns
 * stability-mode truthfulness, persona/role-instruction content, compression fallback honesty,
 * the briefing-honesty change, and the new PanelErrorBoundary -> Native Builder coupling).
 *
 * Same house style as every other validator in this repo: plain Node script, no test framework,
 * no mocking library, `{caseId, category, result, details}` records, self-invoking tail.
 *
 * Deliberately does NOT invoke the live `/api/native-builder/issues` route: that route's storage
 * layer (`lib/native-builder/storage.ts`) has no validation-storage-root isolation mechanism
 * (unlike `lib/sovereign-model-lab/storage.ts`), so a real invocation here would read/write the
 * same directory production usage occupies. See docs/architecture/
 * LIVE_COUNCIL_INCREMENTAL_TRANSPORT_AND_PERSONA.md section 20/23 for the full explanation. This
 * validator instead exercises `issueFromPanelErrorBoundary`, a pure, side-effect-free mapping
 * function, directly.
 */
import { pathToFileURL } from 'node:url'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { buildDeliberationPrompt } from './family-deliberation/runtime'
import { PROVIDER_IDENTITY_PROFILES } from './providerIdentity'
import {
  getStabilityModeFlags,
  isCouncilStabilityMode,
  shouldPassthroughCouncilProviderText,
} from './stabilityMode'
import { applyCouncilRenderGate } from './councilRenderGate'
import { sanitizeCouncilFamilyResponse } from './providerResponseSanitizer'
import { compressCouncilOutput, NO_RELIABLE_SYNTHESIS_MESSAGE, type CouncilCompressionMessage } from './compression'
import { buildCommanderOperationFromMessage, type CouncilOperationMessageInput } from './unified-experience/adapter'
import { issueFromPanelErrorBoundary } from '@/lib/native-builder/issueIngest'

type ValidationCase = {
  caseId: string
  category: string
  result: 'PASS' | 'FAIL'
  details: string[]
}

type CaseInput = {
  caseId: string
  category: string
  run: () => boolean | Promise<boolean>
  details?: string[]
}

async function runCase(input: CaseInput): Promise<ValidationCase> {
  try {
    const passed = await input.run()
    return { caseId: input.caseId, category: input.category, result: passed ? 'PASS' : 'FAIL', details: input.details ?? [] }
  } catch (error) {
    return {
      caseId: input.caseId,
      category: input.category,
      result: 'FAIL',
      details: [...(input.details ?? []), error instanceof Error ? error.message : String(error)],
    }
  }
}

function readSource(relativePath: string): string {
  return readFileSync(join(resolveRepoRoot(), relativePath), 'utf8')
}

async function withEnv<T>(key: string, value: string | undefined, run: () => T | Promise<T>): Promise<T> {
  const original = process.env[key]
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
  try {
    return await run()
  } finally {
    if (original === undefined) delete process.env[key]
    else process.env[key] = original
  }
}

function baseDeliberationInput(role: Parameters<typeof buildDeliberationPrompt>[0]['role']) {
  return {
    role,
    commanderMessage: 'Test decree.',
    evidenceReferences: [],
    priorTurns: [],
  }
}

export async function runLivePersonaClusterValidation(): Promise<ValidationCase[]> {
  const cases: ValidationCase[] = []

  // P. Persona and role instructions — family-deliberation/runtime.ts
  const rolePrompts: Record<string, string> = {}
  for (const role of ['opening_position', 'direct_response', 'red_team_challenge', 'revision_or_stand_firm', 'council_synthesis'] as const) {
    rolePrompts[role] = buildDeliberationPrompt(baseDeliberationInput(role))
  }

  cases.push(await runCase({
    caseId: 'lcp_persona_001_opening_position_pinned',
    category: 'P. Persona and role instructions',
    run: () => rolePrompts.opening_position!.includes(
      'Turn role: opening position. Give your read — your position, the reasoning behind it, real risks, and what you\'d actually do next.',
    ),
  }))
  cases.push(await runCase({
    caseId: 'lcp_persona_002_direct_response_no_message_id_citation',
    category: 'P. Persona and role instructions',
    run: () => rolePrompts.direct_response!.includes('Do not cite it by message ID or label your reply with sections'),
  }))
  cases.push(await runCase({
    caseId: 'lcp_persona_003_red_team_by_name_not_message_id',
    category: 'P. Persona and role instructions',
    run: () => rolePrompts.red_team_challenge!.includes('by name, not by message ID'),
  }))
  cases.push(await runCase({
    caseId: 'lcp_persona_004_revision_no_message_id_citations',
    category: 'P. Persona and role instructions',
    run: () => rolePrompts.revision_or_stand_firm!.includes('No message-ID citations or labeled sections'),
  }))
  cases.push(await runCase({
    caseId: 'lcp_persona_005_synthesis_plain_language',
    category: 'P. Persona and role instructions',
    run: () => rolePrompts.council_synthesis!.includes('Synthesize only the completed exchange in plain language'),
  }))
  cases.push(await runCase({
    caseId: 'lcp_persona_006_no_role_instruction_uses_labeled_sections',
    category: 'P. Persona and role instructions',
    run: () => {
      // Old copy instructed listing "confidence, and recommended action" as content to produce.
      // New copy only ever mentions those words as quoted counter-examples of what NOT to write
      // (see lcp_persona_001), so this checks for the old list-style phrasing specifically, not
      // for mere presence of the words.
      return Object.values(rolePrompts).every(prompt => !prompt.toLowerCase().includes('confidence, and recommended action'))
    },
    details: ['Old copy instructed producing risks/confidence/recommended-action as listed content; new copy must not.'],
  }))
  cases.push(await runCase({
    caseId: 'lcp_persona_007_identity_profiles_under_budget',
    category: 'P. Persona and role instructions',
    run: () => Object.values(PROVIDER_IDENTITY_PROFILES).every(profile => profile.length < 250),
  }))
  cases.push(await runCase({
    caseId: 'lcp_persona_008_grok_kimi_honesty_clauses_preserved',
    category: 'P. Persona and role instructions',
    run: () =>
      PROVIDER_IDENTITY_PROFILES.grok.includes('no pretend searches')
      && PROVIDER_IDENTITY_PROFILES.grok.includes('telemetry gap')
      && PROVIDER_IDENTITY_PROFILES.kimi.includes('no pretend progress'),
  }))

  // S. Stability mode truthfulness
  cases.push(await runCase({
    caseId: 'lcp_stability_001_passthrough_is_zero_param',
    category: 'S. Stability mode truthfulness',
    run: () => shouldPassthroughCouncilProviderText.length === 0,
    details: ['Structural proof that councilFlowMode can no longer influence this function\'s decision at all.'],
  }))
  cases.push(await runCase({
    caseId: 'lcp_stability_002_passthrough_false_when_env_unset',
    category: 'S. Stability mode truthfulness',
    run: () => withEnv('COUNCIL_STABILITY_MODE', undefined, () => !isCouncilStabilityMode() && shouldPassthroughCouncilProviderText() === false),
  }))
  cases.push(await runCase({
    caseId: 'lcp_stability_003_passthrough_true_when_env_set',
    category: 'S. Stability mode truthfulness',
    run: () => withEnv('COUNCIL_STABILITY_MODE', 'true', () => isCouncilStabilityMode() && shouldPassthroughCouncilProviderText() === true),
  }))
  cases.push(await runCase({
    caseId: 'lcp_stability_004_live_research_exempt_from_stable_group_bucket',
    category: 'S. Stability mode truthfulness',
    run: () => withEnv('COUNCIL_STABILITY_MODE', undefined, () => {
      const flags = getStabilityModeFlags('stable_group')
      return flags.liveResearchRouter === true && flags.memoryInjection === false
    }),
    details: ['Stable Group chat must still get real live research even with heavy systems off.'],
  }))
  cases.push(await runCase({
    caseId: 'lcp_stability_005_live_research_off_under_explicit_debug_flag',
    category: 'S. Stability mode truthfulness',
    run: () => withEnv('COUNCIL_STABILITY_MODE', 'true', () => getStabilityModeFlags('stable_group').liveResearchRouter === false),
  }))

  // R. Render gate / sanitizer honesty (Stable Group no longer bypasses degraded detection)
  cases.push(await runCase({
    caseId: 'lcp_rendergate_001_greeting_only_blocked_for_stable_group_without_debug_flag',
    category: 'R. Render gate honesty',
    run: () => withEnv('COUNCIL_STABILITY_MODE', undefined, () => {
      const result = applyCouncilRenderGate('claude', 'Hello!', { councilMode: true, councilFlowMode: 'stable_group' })
      return result.renderable === false || result.degraded === true
    }),
    details: ['A greeting-only response must not render as a complete Stable Group answer just because it is Stable Group.'],
  }))
  cases.push(await runCase({
    caseId: 'lcp_rendergate_002_sanitizer_marks_greeting_only_incomplete_for_stable_group',
    category: 'R. Render gate honesty',
    run: () => withEnv('COUNCIL_STABILITY_MODE', undefined, () => {
      const sanitized = sanitizeCouncilFamilyResponse('claude', 'Hello!', { councilFlowMode: 'stable_group' })
      return sanitized.incomplete === true
    }),
  }))
  cases.push(await runCase({
    caseId: 'lcp_rendergate_003_explicit_debug_flag_still_passes_through',
    category: 'R. Render gate honesty',
    run: () => withEnv('COUNCIL_STABILITY_MODE', 'true', () => {
      const result = applyCouncilRenderGate('claude', 'Hello!', { councilMode: true })
      return result.renderable === true && result.degraded === false
    }),
    details: ['The explicit COUNCIL_STABILITY_MODE debug flag is the only remaining passthrough path.'],
  }))

  // C. Compression fallback honesty
  cases.push(await runCase({
    caseId: 'lcp_compress_001_no_responses_message_unchanged',
    category: 'C. Compression fallback honesty',
    run: () => {
      const summary = compressCouncilOutput([], 'standard', { stabilityMode: false })
      return summary.decisionSummary.length === 1 && summary.decisionSummary[0] === 'Council is waiting for a new decree or provider response.'
    },
  }))
  cases.push(await runCase({
    caseId: 'lcp_compress_002_all_incomplete_responses_named_honestly',
    category: 'C. Compression fallback honesty',
    run: () => {
      const messages: CouncilCompressionMessage[] = [{
        familyName: 'Ghostwriter',
        content: 'Some interim content that will not resolve to a known provider family.',
        messageType: 'response',
        integrityIncomplete: true,
      }]
      const summary = compressCouncilOutput(messages, 'standard', { stabilityMode: false })
      const text = summary.decisionSummary[0] ?? ''
      return text.startsWith(NO_RELIABLE_SYNTHESIS_MESSAGE) && text.includes('Ghostwriter')
    },
    details: ['Old copy would have said "awaiting fallback or retry" even though the round was actually over.'],
  }))
  cases.push(await runCase({
    caseId: 'lcp_compress_003_constant_text_pinned',
    category: 'C. Compression fallback honesty',
    run: () => NO_RELIABLE_SYNTHESIS_MESSAGE === 'Council could not produce a reliable synthesis from this round.',
  }))

  // B. Briefing honesty — unified-experience/adapter.ts
  cases.push(await runCase({
    caseId: 'lcp_briefing_001_no_fabricated_not_yet_available',
    category: 'B. Briefing honesty',
    run: () => {
      const input: CouncilOperationMessageInput = {
        id: 'm1',
        familyName: 'claude',
        content: 'Interim partial content, not a final synthesis.',
        timestamp: '2026-01-01T00:00:00.000Z',
        messageType: 'response',
      }
      const operation = buildCommanderOperationFromMessage(input)
      return operation.briefing.body !== 'Not yet available.'
        && operation.briefing.body.includes('No final Commander briefing was emitted')
        && operation.briefing.evidenceStatus.includes('Not evaluated here')
    },
  }))

  // I. Structural I/O sweep — the pure text/logic files in this cluster must perform no
  // filesystem, network, or database I/O of their own.
  const pureFiles = [
    'lib/council/compression.ts',
    'lib/council/councilRenderGate.ts',
    'lib/council/providerIdentity.ts',
    'lib/council/providerResponseSanitizer.ts',
    'lib/council/family-deliberation/runtime.ts',
    'lib/council/stabilityMode.ts',
    'lib/council/stableGroupChat.ts',
    'lib/council/unified-experience/adapter.ts',
  ]
  const FORBIDDEN_IO_PATTERNS = [
    /\bfetch\(/,
    /from ['"]@supabase/,
    /supabase\.(from|rpc|auth|storage)\(/i,
    /readFile\(/,
    /writeFile\(/,
    /execFile\(/,
    /\bspawn\(/,
  ]
  for (const file of pureFiles) {
    cases.push(await runCase({
      caseId: `lcp_io_${file.replace(/[^a-z0-9]+/gi, '_')}`,
      category: 'I. Structural I/O sweep',
      run: () => {
        const source = readSource(file)
        return FORBIDDEN_IO_PATTERNS.every(pattern => !pattern.test(source))
      },
      details: [`${file} must remain pure text/logic with no I/O of its own.`],
    }))
  }

  // U. UI copy and error-boundary coupling (structural source-text checks; components render via
  // React, not invokable from a plain Node validator, so behavior is proven at the source level —
  // the same technique already used by the pre-existing c4c_structural_* cases).
  cases.push(await runCase({
    caseId: 'lcp_ui_001_command_console_thinking_copy',
    category: 'U. UI copy and coupling',
    run: () => {
      const source = readSource('components/war-room/live-room/CommandConsole.tsx')
      return source.includes('Council thinking…') && !source.includes('Council responding…') && !/'Working…'/.test(source)
    },
  }))
  cases.push(await runCase({
    caseId: 'lcp_ui_002_timeline_events_collapsed_after_briefing',
    category: 'U. UI copy and coupling',
    run: () => {
      const source = readSource('components/council/CouncilOperationTimeline.tsx')
      const briefingIndex = source.indexOf('Commander Briefing')
      const detailsIndex = source.indexOf('View runtime event timeline')
      return briefingIndex >= 0 && detailsIndex > briefingIndex
    },
    details: ['Runtime event list must render after the briefing, behind a collapsed <details>, not unconditionally before it.'],
  }))
  cases.push(await runCase({
    caseId: 'lcp_ui_003_panel_error_boundary_reports_and_swallows_failure',
    category: 'U. UI copy and coupling',
    run: () => {
      const source = readSource('components/war-room/runtime/PanelErrorBoundary.tsx')
      return source.includes("fetch('/api/native-builder/issues'")
        && source.includes("kind: 'panel_error_boundary'")
        && /\.catch\(\(\)\s*=>\s*\{/.test(source)
    },
    details: ['A failed issue report must never surface as a second panel error — .catch() must be present.'],
  }))
  cases.push(await runCase({
    caseId: 'lcp_ui_004_issue_ingest_mapping_pure_and_correct',
    category: 'U. UI copy and coupling',
    run: () => {
      const mapped = issueFromPanelErrorBoundary({
        panelLabel: 'Live Council',
        errorMessage: 'Cannot read properties of undefined',
        componentStack: 'at Component (App.tsx:1:1)',
      })
      return mapped.source === 'panel_error_boundary'
        && mapped.title.includes('Live Council')
        && mapped.severity === 'high'
        && mapped.evidence.includes('Cannot read properties of undefined')
    },
    details: ['Exercises the real mapping function directly — no storage/route call, so no production issue/repair record is created.'],
  }))

  return cases
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const results = await runLivePersonaClusterValidation()
  const failed = results.filter(item => item.result === 'FAIL')
  console.log(`Live Council persona-cluster validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) {
    for (const item of failed) console.error(`${item.caseId}: ${item.details.join('; ')}`)
    process.exit(1)
  }
}
