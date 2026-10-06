import { BrowserCommandPanel } from '@/components/war-room/browser/BrowserCommandPanel'
import { WarRoomBackControl } from '@/components/war-room/WarRoomBackControl'

export const dynamic = 'force-dynamic'

export default function BrowserCommandPage() {
  return (
    <main className="min-h-screen bg-black p-6">
      <div className="mx-auto max-w-5xl">
        <WarRoomBackControl />
        <h1 className="mb-4 mt-3 text-lg font-bold uppercase tracking-widest text-emerald-300">War Room Browser</h1>
        <p className="mb-4 text-xs text-emerald-200/80">Trusted profiles and Commander takeover. Ephemeral research remains the Council default.</p>
        <BrowserCommandPanel />
      </div>
    </main>
  )
}
