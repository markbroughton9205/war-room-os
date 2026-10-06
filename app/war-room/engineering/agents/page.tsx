/**
 * Phase 10 — Agent Foundry and long-lived operations (Commander)
 * @route /war-room/engineering/agents
 */
import { WarRoomUiModeProvider } from '@/components/war-room/WarRoomUiModeContext'
import { FoundryAgentOpsPanel } from '@/components/war-room/foundry/FoundryAgentOpsPanel'

export const dynamic = 'force-dynamic'

export default function AgentOpsPage() {
  return (
    <WarRoomUiModeProvider>
      <main className="min-h-screen bg-[#020403] text-white">
        <div className="px-4 py-4">
          <FoundryAgentOpsPanel />
        </div>
      </main>
    </WarRoomUiModeProvider>
  )
}
