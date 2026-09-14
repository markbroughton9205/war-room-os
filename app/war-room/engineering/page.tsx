/**
 * THE FOUNDRY
 * @route /war-room/engineering
 */
import { WarRoomUiModeProvider } from '@/components/war-room/WarRoomUiModeContext'
import { FoundryShell } from '@/components/war-room/foundry/FoundryShell'

export const dynamic = 'force-dynamic'

export default function WarRoomFoundryPage() {
  return (
    <WarRoomUiModeProvider>
      <main className="min-h-screen bg-[#020403] text-white">
        <div className="px-2 py-2 lg:px-3">
          <FoundryShell />
        </div>
      </main>
    </WarRoomUiModeProvider>
  )
}
