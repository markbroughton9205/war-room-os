import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveWarRoomStatusSigil } from '@/lib/runtime/statusSigil'
import type { CanonicalRuntimeStatus } from '@/lib/runtime/canonicalStatus'

export type UiTruthValidationResult = { id: string; pass: boolean; detail: string }

function test(id: string, fn: () => boolean | string): UiTruthValidationResult {
  try {
    const result = fn()
    return { id, pass: result === true, detail: result === true ? 'PASS' : String(result) }
  } catch (error) {
    return { id, pass: false, detail: error instanceof Error ? error.message : String(error) }
  }
}

function statusFixture(overrides: Partial<CanonicalRuntimeStatus> = {}): CanonicalRuntimeStatus {
  const now = new Date().toISOString()
  const subsystems = ['provider_runtime', 'signal_radar', 'persistence', 'approval_gate'].map(id => ({ id, label: id, truthBoundary: 'VERIFIED' as const, health: 'healthy' as const, confidence: 95, evidence: ['test'], missingEvidence: [], downstreamImpact: [], recommendedRecovery: [], lastChecked: now }))
  return {
    generatedAt: now,
    subsystems,
    providers: [],
    engineControl: {} as CanonicalRuntimeStatus['engineControl'],
    summary: { health: 'healthy', confidence: 95, degradedSubsystems: [], unavailableSubsystems: [], uncertaintyDampening: 'test' },
    guardrails: { fakeConnectedStates: false, fakeSourceBackedClaims: false, apiKeysExposed: false, hiddenExecution: false, autonomousFinancialAction: false, browserShellExecution: false, deploymentMutation: false },
    ...overrides,
  }
}

export function runUiTruthValidation(): UiTruthValidationResult[] {
  const page = readFileSync(join(process.cwd(), 'app/page.tsx'), 'utf8')
  const css = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8')
  const matrix = readFileSync(join(process.cwd(), 'components/MatrixCodeRain.tsx'), 'utf8')
  const durableStore = readFileSync(join(process.cwd(), 'lib/opportunity-agents/durableStore.ts'), 'utf8')
  const refreshPipeline = readFileSync(join(process.cwd(), 'lib/opportunity-agents/sources/refreshPipeline.ts'), 'utf8')
  const refreshRoute = readFileSync(join(process.cwd(), 'app/api/opportunity-agents/sources/refresh/route.ts'), 'utf8')
  const adapters = readFileSync(join(process.cwd(), 'lib/opportunity-agents/sources/adapters.ts'), 'utf8')
  return [
    test('ui_01_production_debug_banners_absent', () => !page.includes('Approval gate active. No pending write actions.') && !page.includes('Repo mutation controls unavailable in production dashboard.') || 'debug banner text remains'),
    test('ui_02_status_green_only_after_required_probes', () => resolveWarRoomStatusSigil(statusFixture()).state === 'green' || 'healthy fixture not green'),
    test('ui_03_status_unknown_yellow', () => resolveWarRoomStatusSigil(null).state === 'yellow' || 'missing telemetry not yellow'),
    test('ui_04_status_failure_red', () => {
      const fixture = statusFixture({ subsystems: [{ ...statusFixture().subsystems[0]!, health: 'unavailable' }] })
      return resolveWarRoomStatusSigil(fixture).state === 'red' || 'critical failure not red'
    }),
    test('ui_05_status_accessible_no_primary_sentences', () => page.includes('aria-label={sigil.ariaLabel}') && page.includes('<svg viewBox="0 0 64 64"') || 'status sigil accessibility missing'),
    test('ui_06_green_scrollbar_token', () => css.includes('--war-room-scrollbar-thumb') && css.includes('::-webkit-scrollbar-thumb') && css.includes('scrollbar-color') || 'green scrollbar CSS missing'),
    test('ui_07_matrix_reduced_motion_token', () => css.includes('--war-room-matrix-opacity') && matrix.includes('var(--war-room-matrix-opacity)') && css.includes('prefers-reduced-motion') || 'matrix token/reduced motion missing'),
    test('ui_08_raw_json_not_primary_chat', () => page.includes('isPrimaryTranscriptNoise') && page.includes('"opportunities"') && page.includes('raw opportunity packet') || 'raw opportunity packet filter missing'),
    test('ui_09_provider_diagnostics_collapsed', () => page.includes('<details') && page.includes('Runtime Details') && page.includes('Incremental Council Transport') || 'runtime details not collapsed'),
    test('ui_10_session_only_not_durable', () => {
      const sessionDisclosureVisible = page.includes('workforce.persistence.replace') || page.includes('session_only') || page.includes('Session-only')
      const durableDisabledTruth = durableStore.includes("durableAvailable: false") && durableStore.includes("migrationRequired: true")
      const noDurableClaim = !durableStore.includes('durableAvailable: true') && !durableStore.includes("persistence: 'supabase'")
      return sessionDisclosureVisible && durableDisabledTruth && noDurableClaim || 'session-only/durable-disabled truth is not visible and enforced'
    }),
    test('ui_11_news_not_auto_actionable', () => {
      const routeUsesActionableGuard = refreshRoute.includes('isActionableSourceOpportunity') && refreshRoute.includes('.filter(isActionableSourceOpportunity)')
      const guardRequiresConcreteEvidence = refreshPipeline.includes("record.evidenceStatus === 'LIVE_VERIFIED'")
        && refreshPipeline.includes('Boolean(record.deadline)')
        && refreshPipeline.includes('Boolean(record.url || record.sourceReference)')
      const historicalNewsNotActionable = adapters.includes("summary: 'Historical spending intelligence only; not an open opportunity.'")
        && adapters.includes("evidenceStatus: 'HISTORICAL'")
        && adapters.includes('isActive: false')
      return routeUsesActionableGuard && guardRequiresConcreteEvidence && historicalNewsNotActionable || 'generic/news intelligence can become actionable without concrete opportunity evidence'
    }),
    test('ui_12_phase49a_protected_imports_unchanged', () => !page.includes('contextRelevance') && !page.includes('retrievalOrchestrator') || 'protected module imported into app page'),
  ]
}

if (process.argv[1]?.endsWith('uiTruthValidation.ts')) {
  const results = runUiTruthValidation()
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.id} ${result.detail}`)
  const failed = results.filter(result => !result.pass)
  console.log(`UI truth validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
