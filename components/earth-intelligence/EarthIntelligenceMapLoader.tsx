'use client'

import dynamic from 'next/dynamic'

const EarthIntelligenceMap = dynamic(
  () => import('@/components/earth-intelligence/EarthIntelligenceMap').then(mod => mod.EarthIntelligenceMap),
  { ssr: false },
)

export function EarthIntelligenceMapLoader() {
  return <EarthIntelligenceMap />
}
