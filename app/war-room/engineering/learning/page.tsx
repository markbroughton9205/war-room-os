/**
 * Phase 9 — Recursive Learning (Commander, read-only)
 * @route /war-room/engineering/learning
 */
import { WarRoomUiModeProvider } from '@/components/war-room/WarRoomUiModeContext'
import { FoundryLearningPanel } from '@/components/war-room/foundry/FoundryLearningPanel'

export const dynamic = 'force-dynamic'

export default function LearningPage() {
  return (
    <WarRoomUiModeProvider>
      <main className="min-h-screen bg-[#020403] text-white">
        <div className="px-4 py-4">
          <FoundryLearningPanel />
        </div>
      </main>
    </WarRoomUiModeProvider>
  )
}
