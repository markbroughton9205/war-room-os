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
      <main className="min-h-screen bg-gradient-to-b from-neutral-950 to-black px-4 py-8 text-white">
        <div className="mx-auto max-w-[1600px]">
          <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-emerald-500">War Room OS</p>
          <h1 className="mb-1 text-lg font-bold uppercase tracking-widest text-emerald-300">The Foundry</h1>
          <p className="mb-4 text-[11px] text-slate-500">
            Native software-development organization. Local coder first. Cloud APIs optional. Commit, push, and deploy stay Commander-gated.
          </p>
          <FoundryShell />
        </div>
      </main>
    </WarRoomUiModeProvider>
  )
}
