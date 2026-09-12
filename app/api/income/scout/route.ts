import { NextResponse } from 'next/server'
import { orchestrateIncomeWorkerScout } from '@/lib/income-workers/scoutOrchestrator'
import { assertAutoOrApproval } from '@/lib/permissions/policy'
import { evaluateGovernedAction } from '@/lib/permissions/policyDecision'
import { buildGovernedAuditMetadata, insertGovernedAuditLog } from '@/lib/war-room/governedAudit'
import { fetchWarRoomPermissionsState } from '@/lib/war-room/permissionsState'
import { tryWarRoomSupabase } from '@/lib/war-room/persistence'

export const runtime = 'nodejs'

/**
 * #22 Phase 1 — income scout external federation is internet_research-gated.
 * Standing auto-allow applies in operator/commander modes; manual requires approval_granted.
 */
export async function POST(req: Request) {
  const started = Date.now()
  const sup = tryWarRoomSupabase()

  let body: Record<string, unknown> = {}
  try {
    const raw = await req.json()
    if (raw !== null && typeof raw === 'object') body = raw as Record<string, unknown>
  } catch {
    body = {}
  }

  const state = await fetchWarRoomPermissionsState(sup.ok ? sup.client : null)
  const gate = assertAutoOrApproval({
    mode: state.mode,
    safetyLock: state.safetyLock,
    actionKind: 'internet_research',
    body,
  })
  if (!gate.ok) {
    const decision = evaluateGovernedAction({
      mode: state.mode,
      safetyLock: state.safetyLock,
      actionKind: 'internet_research',
      body,
    })
    if (sup.ok) {
      await insertGovernedAuditLog(sup.client, {
        actor: 'user',
        category: 'action',
        message: 'Income scout blocked by standing policy.',
        metadata: buildGovernedAuditMetadata({
          decision,
          tool: 'api/income/scout',
          target: 'opportunity-scout',
        }),
      })
    }
    return NextResponse.json({
      tool: 'opportunity-scout',
      status: 'denied',
      message: gate.error,
      reasonCode: decision.reasonCode,
      policyDecision: decision.outcome,
    }, { status: gate.status })
  }

  try {
    const result = await orchestrateIncomeWorkerScout('opportunity-scout')
    const providerUsed = result.providerUsed
    const fallbackPath = result.diagnostics?.fallbackPath ?? []
    const providerStatus: Record<string, 'online' | 'standby' | 'offline' | 'error'> = {
      tavily: fallbackPath.includes('tavily_live') ? 'online' : process.env.TAVILY_API_KEY ? 'standby' : 'offline',
      firecrawl: fallbackPath.includes('firecrawl_live') ? 'online' : process.env.FIRECRAWL_API_KEY ? 'standby' : 'offline',
      brave: fallbackPath.includes('brave_live') ? 'online' : process.env.BRAVE_API_KEY ? 'standby' : 'offline',
      rss: fallbackPath.includes('rss_intelligence') ? 'online' : 'standby',
    }

    return NextResponse.json({
      tool: 'opportunity-scout',
      provider: providerUsed,
      providerUsed,
      providerStatus,
      federation: {
        fallbackPath,
        degradedMode: result.degradedMode ?? false,
        operatorGuidance: result.message,
        sourceType: result.diagnostics?.sourceType ?? 'local_manual',
      },
      agent: {
        name: 'Opportunity Scout',
        role: 'Global income opportunity researcher',
        purpose: 'Federated multi-source scout with automatic provider failover.',
        categories: ['income', 'gigs', 'freight', 'automation'],
      },
      status: result.status,
      message: result.message,
      lastScanTime: result.scannedAt,
      sourcesChecked: result.sourcesChecked,
      opportunitiesFound: result.candidates.length,
      opportunitiesRejected: result.rejected.length,
      acceptedCandidates: result.candidates.length,
      rejectedCandidates: result.rejected.length,
      scanDurationMs: Date.now() - started,
      riskFilterStatus: 'basic scam-risk filter active',
      nextScanAction: result.candidates.length > 0 ? 'Review candidates before saving' : 'Federation will use cache/historical on next scan',
      opportunities: result.candidates,
      rejected: result.rejected,
      executionState: result.executionState,
      diagnostics: result.diagnostics,
      governance: {
        actionKind: 'internet_research',
        viaAutoPolicy: gate.viaAutoPolicy,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Opportunity Scout federation scan failed.'
    return NextResponse.json({
      tool: 'opportunity-scout',
      provider: 'federation',
      providerUsed: 'federation',
      status: 'error',
      message,
      lastScanTime: new Date().toISOString(),
      sourcesChecked: 0,
      opportunitiesFound: 0,
      opportunitiesRejected: 0,
      scanDurationMs: Date.now() - started,
      opportunities: [],
      rejected: [],
    }, { status: 503 })
  }
}
