import type { Metadata } from 'next'
import { LegacyRouteDisclosure } from '@/components/war-room/LegacyRouteDisclosure'
import { AnalystOperationsPanel } from '@/components/war-room/analysts/AnalystOperationsPanel'
import { Phase3WarRoomPanels } from '@/components/war-room/phase3/Phase3WarRoomPanels'
import { KpiGrid } from '@/components/war-room/KpiGrid'
import { WarRoomShell } from '@/components/war-room/WarRoomShell'
import { WarRoomLazyPanels } from '@/components/war-room/WarRoomLazyPanels'
import { WarRoomPerformanceDiagnostics } from '@/components/war-room/performance/WarRoomPerformanceDiagnostics'

export const metadata: Metadata = {
  title: 'War Room OS — Legacy Demo Dashboard',
  description:
    'Legacy War Room OS demo dashboard — council seating, sentinel metrics, and baby observer sections are simulated placeholder data, not live provider output.',
}

export default function WarRoomDashboardPage() {
  return (
    <WarRoomShell>
      <LegacyRouteDisclosure />
      <Phase3WarRoomPanels />
      <KpiGrid />
      <WarRoomPerformanceDiagnostics />
      <AnalystOperationsPanel compact />
      <WarRoomLazyPanels />
    </WarRoomShell>
  )
}
