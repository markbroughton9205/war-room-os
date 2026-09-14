import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireCommanderSession } from '@/lib/security/commanderSession'
import { buildCoverageMatrix } from '@/lib/planetary-intelligence/coverage'
import { createSourceFabric, seedFoundationSources } from '@/lib/planetary-intelligence/sourceFabric'
import { buildTerraCoverageState } from '@/lib/planetary-intelligence/terraCoverage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Terra information visibility: WHERE War Room can see and WHERE it is blind.
 * Returns actual counts/states. Never invents coverage percentages.
 */
export async function GET(_request: NextRequest) {
  const commander = await requireCommanderSession('Terra coverage state')
  if (!commander.ok) return commander.response

  const fabric = createSourceFabric()
  seedFoundationSources(fabric)
  const coverage = buildCoverageMatrix({ documents: [], claims: [] })
  const state = buildTerraCoverageState({
    fabric,
    coverage,
    independentOrigins: 0,
    recentStoryFlow: 0,
  })

  return NextResponse.json({
    tool: 'terra-coverage-state',
    status: 'success',
    inventedPercentages: false,
    state,
  })
}
