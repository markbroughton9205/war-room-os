import { NativeBuilderPanel } from '@/components/war-room/native-builder/NativeBuilderPanel'

export const dynamic = 'force-dynamic'

export default function NativeBuilderPage() {
  return (
    <main className="min-h-screen bg-black p-6">
      <div className="mx-auto max-w-5xl">
        <h1 className="mb-4 text-lg font-bold uppercase tracking-widest text-emerald-300">War Room Native Builder</h1>
        <NativeBuilderPanel />
      </div>
    </main>
  )
}
