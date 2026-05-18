import type { Metadata } from 'next'
import { AnalystOperationsPanel } from '@/components/war-room/analysts/AnalystOperationsPanel'
import { Phase3WarRoomPanels } from '@/components/war-room/phase3/Phase3WarRoomPanels'
import { KpiGrid } from '@/components/war-room/KpiGrid'
import { WarRoomShell } from '@/components/war-room/WarRoomShell'
import { WarRoomLazyPanels } from '@/components/war-room/WarRoomLazyPanels'
import { WarRoomPerformanceDiagnostics } from '@/components/war-room/performance/WarRoomPerformanceDiagnostics'

export const metadata: Metadata = {
  title: 'War Room OS — Command',
  description: 'War Room OS command dashboard — council layout and panels are UI shells until wired to live data.',
}

export default function WarRoomDashboardPage() {
  return (
    <WarRoomShell>
      <Phase3WarRoomPanels />
      <KpiGrid />
      <WarRoomPerformanceDiagnostics />
      <AnalystOperationsPanel compact />
      <WarRoomLazyPanels />
    </WarRoomShell>
  )
}
