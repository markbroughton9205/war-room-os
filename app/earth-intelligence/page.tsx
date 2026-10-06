import type { Metadata } from 'next'
import { EarthIntelligenceMapLoader } from '@/components/earth-intelligence/EarthIntelligenceMapLoader'
import { WarRoomBackControl } from '@/components/war-room/WarRoomBackControl'

export const metadata: Metadata = {
  title: 'Earth Intelligence — War Room OS',
  description: 'Isolated NASA GIBS satellite imagery map — not part of the production War Room dashboard.',
}

export default function EarthIntelligencePage() {
  return (
    <main className="h-screen w-screen overflow-hidden bg-black">
      <div className="pointer-events-none absolute left-3 top-3 z-20">
        <span className="pointer-events-auto">
          <WarRoomBackControl variant="overlay" />
        </span>
      </div>
      <EarthIntelligenceMapLoader />
    </main>
  )
}
