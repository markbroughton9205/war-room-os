import type { Metadata } from 'next'
import { EarthIntelligenceMapLoader } from '@/components/earth-intelligence/EarthIntelligenceMapLoader'

export const metadata: Metadata = {
  title: 'Earth Intelligence — War Room OS',
  description: 'Isolated NASA GIBS satellite imagery map — not part of the production War Room dashboard.',
}

export default function EarthIntelligencePage() {
  return (
    <main className="h-screen w-screen overflow-hidden bg-black">
      <EarthIntelligenceMapLoader />
    </main>
  )
}
