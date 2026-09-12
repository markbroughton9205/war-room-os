import { operationalAscensionAgentCount } from '@/lib/ascension/operationalRegistry'
import { isWorldLearningAgentRuntimeAvailable } from '@/lib/ascension/world-learning-agent/identity'
import { isResearchAgentRuntimeAvailable } from '@/lib/ascension/research-agent/identity'
import { isDataCorpusAgentRuntimeAvailable } from '@/lib/ascension/data-corpus-agent/identity'
import { isNavigationAgentRuntimeAvailable } from '@/lib/ascension/navigation-agent/identity'
import { isOperationsAgentRuntimeAvailable } from '@/lib/ascension/operations-agent/identity'
import { isSecurityRedTeamAgentRuntimeAvailable } from '@/lib/ascension/security-red-team-agent/identity'
import { isEngineeringAgentRuntimeAvailable } from '@/lib/ascension/engineering-agent/identity'
import { isCouncilValidatorRuntimeAvailable } from '@/lib/ascension/council-validator/identity'
import { isTerraIntelligenceAgentRuntimeAvailable } from '@/lib/ascension/terra-intelligence-agent/identity'
import { requireIntegrationCaller } from '@/lib/ascension/integration/session'
import { runIntegrationWorkflow } from '@/lib/ascension/integration/workflows'
import { runAstraBoundedMultiAgentOrchestration } from '@/lib/ascension/integration/astraBridge'
import { INTEGRATION_WORKFLOW_KINDS, type IntegrationWorkflowKind } from '@/lib/ascension/integration/types'
import { CROSS_AGENT_INTEGRATION_STATUS } from '@/lib/ascension/integration/identity'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function isWorkflowKind(value: unknown): value is IntegrationWorkflowKind {
  return typeof value === 'string' && (INTEGRATION_WORKFLOW_KINDS as readonly string[]).includes(value)
}

/**
 * #22 Phase 14 — Commander / local-Commander bounded cross-agent workflow invocation.
 */
export async function POST(req: Request) {
  const session = await requireIntegrationCaller()
  if (!session.ok) return session.response

  let body: Record<string, unknown> = {}
  try {
    const raw = await req.json()
    if (raw && typeof raw === 'object') body = raw as Record<string, unknown>
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON body.' }, { status: 400 })
  }

  const kind = isWorkflowKind(body.workflow_kind) ? body.workflow_kind : 'KNOWLEDGE_PIPELINE'
  const input = {
    ownerUserId: session.userId,
    requestedBy: session.userId,
    invokedBy: session.surface === 'LOCAL_COMMANDER' ? ('desktop_core' as const) : ('commander' as const),
    internetAvailable: body.internet_available !== false,
    liveSearchAllowed: body.live_search_allowed === true,
    useFixtures: body.use_fixture !== false,
    useLocalModel: body.use_local_model === true,
    dataDirOverride: process.env.WAR_ROOM_LOCAL_DATA_DIR ?? null,
  }

  if (kind === 'ASTRA_MULTI_AGENT_MISSION') {
    const result = await runAstraBoundedMultiAgentOrchestration(input)
    return Response.json({
      ok: result.mission?.status === 'completed',
      result,
      runtime_truth: {
        cross_agent_integration: CROSS_AGENT_INTEGRATION_STATUS,
        operational_ascension_agents: operationalAscensionAgentCount(),
        supabase_required_locally: false,
        astra_phase58a: 'NOT_APPLIED',
        production_corpus_persistence: false,
      },
    })
  }

  const result = await runIntegrationWorkflow(kind, input)
  return Response.json({
    ok: result.status !== 'DENIED' && result.status !== 'FAILED',
    result,
    agent_availability: {
      RESEARCH_AGENT: isResearchAgentRuntimeAvailable(),
      WORLD_LEARNING_AGENT: isWorldLearningAgentRuntimeAvailable(),
      DATA_CORPUS_AGENT: isDataCorpusAgentRuntimeAvailable(),
      TERRA_INTELLIGENCE_AGENT: isTerraIntelligenceAgentRuntimeAvailable(),
      NAVIGATION_AGENT: isNavigationAgentRuntimeAvailable(),
      OPERATIONS_AGENT: isOperationsAgentRuntimeAvailable(),
      SECURITY_RED_TEAM_AGENT: isSecurityRedTeamAgentRuntimeAvailable(),
      ENGINEERING_AGENT: isEngineeringAgentRuntimeAvailable(),
      COUNCIL_VALIDATOR: isCouncilValidatorRuntimeAvailable(),
    },
    runtime_truth: {
      cross_agent_integration: CROSS_AGENT_INTEGRATION_STATUS,
      operational_ascension_agents: operationalAscensionAgentCount(),
      supabase_required_locally: false,
      astra_phase58a: 'NOT_APPLIED',
      production_corpus_persistence: false,
    },
  })
}
