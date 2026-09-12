import { ROADMAP_23_STATUS } from '@/lib/wr-corpus/identity'
import { requireCommanderSession } from '@/lib/security/commanderSession'
import { getNavigationCapabilityTruth, navigationRoadmapTruth } from '@/lib/terra/navigation/runtimeTruth'
import { trafficProviderTruthSummary } from '@/lib/terra/navigation/guidance'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** #22 Phase 9 — Navigation foundation capability status (Commander session). */
export async function GET() {
  const session = await requireCommanderSession('TERRA_NAVIGATION_STATUS')
  if (!session.ok) return session.response

  return Response.json({
    ok: true,
    runtime_truth: getNavigationCapabilityTruth(),
    roadmap_truth: navigationRoadmapTruth(),
    traffic_truth: trafficProviderTruthSummary(),
    future_navigation_agent: 'TARGET_UNIMPLEMENTED',
    roadmap_23: ROADMAP_23_STATUS,
  })
}
