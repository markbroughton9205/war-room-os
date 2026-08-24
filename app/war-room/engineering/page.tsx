/**
 * War Room Engineering Mission UI (Phase D).
 * @route https://<host>/war-room/engineering
 */
import { WarRoomUiModeProvider } from '@/components/war-room/WarRoomUiModeContext'
import { EngineeringMissionConsole } from '@/components/war-room/engineering/EngineeringMissionConsole'

export const dynamic = 'force-dynamic'

export default function WarRoomEngineeringPage() {
  return (
    <WarRoomUiModeProvider>
      <main className="min-h-screen bg-gradient-to-b from-neutral-950 to-black px-4 py-10 text-white">
        <div className="mx-auto max-w-6xl">
          <h1 className="mb-1 text-lg font-bold uppercase tracking-widest text-emerald-300">War Room Engineering</h1>
          <p className="mb-4 text-[11px] text-slate-500">
            Integrated Engineering Core client — consumes the identical Mission Runtime boundary as
            Standalone Builder. One Engineering Core, two thin clients; no second coding/execution
            truth lives here.
          </p>
          <EngineeringMissionConsole />
        </div>
      </main>
    </WarRoomUiModeProvider>
  )
}
