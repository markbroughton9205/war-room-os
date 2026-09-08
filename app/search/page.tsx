import type { Metadata } from 'next'
import { WarRoomSearchPanel } from '@/components/war-room/search/WarRoomSearchPanel'

export const metadata: Metadata = {
  title: 'War Room Search',
  description: 'Federated live web search through existing War Room research evidence systems.',
}

export const dynamic = 'force-dynamic'

export default function WarRoomSearchPage() {
  return (
    <main className="min-h-screen bg-black">
      <WarRoomSearchPanel />
    </main>
  )
}
