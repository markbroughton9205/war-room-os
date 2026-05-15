/**
 * War Room runtime integrity dashboard.
 * @route https://<host>/war-room/integrity
 */
import { WarRoomUiModeProvider } from '@/components/war-room/WarRoomUiModeContext'
import { RuntimeIntegrityDashboard } from '@/components/war-room/runtime/RuntimeIntegrityDashboard'

export const dynamic = 'force-dynamic'

export default function WarRoomIntegrityPage() {
  return (
    <WarRoomUiModeProvider>
      <main className="min-h-screen bg-gradient-to-b from-neutral-950 to-black px-4 py-10 text-white">
        <div className="mx-auto max-w-6xl">
          <RuntimeIntegrityDashboard />
        </div>
      </main>
    </WarRoomUiModeProvider>
  )
}
