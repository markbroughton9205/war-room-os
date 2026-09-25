import { NextResponse } from 'next/server'
import { listMissions } from '@/lib/native-builder/foundryMissionStore'
import { groupOperationsQueue, toRegistryEntry } from '@/lib/native-builder/foundryMissionRegistry'
import { ensureRecovered, inspectOperations } from '@/lib/native-builder/foundryOperationsManager'
import { readFoundryRuntimeConfig } from '@/lib/native-builder/foundryRuntimeConfig'
import { toFoundryMissionCommanderView } from '@/lib/native-builder/foundryMissionView'
import { filterMissionsForView, parseFoundryMissionHistoryView } from '@/lib/native-builder/foundryMissionVisibility'
import { selectCurrentCommanderWork } from '@/lib/native-builder/foundryCommanderExperience'
import { readProductionLease } from '@/lib/native-builder/foundryProductionLease'
import { readProductionOwner } from '@/lib/native-builder/foundryProductionOwnership'
import { readLastWatchdogScan } from '@/lib/native-builder/foundryProductionLeaseWatchdog'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  await ensureRecovered()
  const view = parseFoundryMissionHistoryView(new URL(req.url).searchParams.get('view'))
  const missions = filterMissionsForView(await listMissions(200), view)
  const registry = missions.map(toRegistryEntry)
  const inspection = await inspectOperations()
  const current = selectCurrentCommanderWork(missions)
  return NextResponse.json({
    view,
    queue: groupOperationsQueue(registry),
    currentWork: current ? toFoundryMissionCommanderView(current) : null,
    registry,
    claims: view === 'commander' ? inspection.claims.filter(claim => registry.some(entry => entry.missionId === claim.missionId)) : inspection.claims,
    runtimeConfig: readFoundryRuntimeConfig(),
    productionLease: await readProductionLease(),
    productionOwner: await readProductionOwner(),
    lastWatchdogScan: await readLastWatchdogScan(),
    missions: missions.map(toFoundryMissionCommanderView),
  })
}
