import { NativeBuilderPanel } from '@/components/war-room/native-builder/NativeBuilderPanel'
import { WarRoomBackControl } from '@/components/war-room/WarRoomBackControl'

export const dynamic = 'force-dynamic'

export default function NativeBuilderPage() {
  return (
    <main className="min-h-screen bg-black p-6">
      <div className="mx-auto max-w-5xl">
        <WarRoomBackControl />
        <h1 className="mb-4 mt-3 text-lg font-bold uppercase tracking-widest text-emerald-300">War Room Native Builder</h1>
        <NativeBuilderPanel />
      </div>
    </main>
  )
}
