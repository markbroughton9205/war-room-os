/**
 * Blueprint-to-build adapter (Commander)
 * @route /war-room/engineering/blueprints
 */
import { WarRoomUiModeProvider } from '@/components/war-room/WarRoomUiModeContext'
import { FoundryBlueprintsPanel } from '@/components/war-room/foundry/FoundryBlueprintsPanel'

export const dynamic = 'force-dynamic'

export default function BlueprintsPage() {
  return (
    <WarRoomUiModeProvider>
      <main className="min-h-screen bg-[#020403] text-white">
        <div className="px-4 py-4">
          <FoundryBlueprintsPanel />
        </div>
      </main>
    </WarRoomUiModeProvider>
  )
}
