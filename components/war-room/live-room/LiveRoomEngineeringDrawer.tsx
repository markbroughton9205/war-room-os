'use client'

import dynamic from 'next/dynamic'
import { memo } from 'react'

import { useLiveRoomMode } from './LiveRoomModeContext'

function DrawerSkeleton({ label }: { label: string }) {
  return (
    <section className="rounded border border-sky-500/20 bg-black/20 p-3 text-[10px] tracking-widest text-sky-200">
      {label}
    </section>
  )
}

const SchemaSweepPanel = dynamic(
  () => import('@/components/war-room/schema/SchemaSweepPanel').then(mod => mod.SchemaSweepPanel),
  { ssr: false, loading: () => <DrawerSkeleton label="Schema sweep loading…" /> },
)

const RepairPacketPanel = dynamic(
  () => import('@/components/war-room/engineering/RepairPacketPanel').then(mod => mod.RepairPacketPanel),
  { ssr: false, loading: () => <DrawerSkeleton label="Repair packets loading…" /> },
)

const WarRoomSweepPanel = dynamic(
  () => import('@/components/war-room/evolution/WarRoomSweepPanel').then(mod => mod.WarRoomSweepPanel),
  { ssr: false, loading: () => <DrawerSkeleton label="OS sweep loading…" /> },
)

export type LiveRoomEngineeringDrawerProps = {
  open: boolean
  latestRepairPacket?: React.ComponentProps<typeof RepairPacketPanel>['latest']
}

export const LiveRoomEngineeringDrawer = memo(function LiveRoomEngineeringDrawer({
  open,
  latestRepairPacket,
}: LiveRoomEngineeringDrawerProps) {
  const { liveMode } = useLiveRoomMode()

  if (!open) return null

  return (
    <section
      className="live-room-engineering-drawer border-t border-sky-900/50 bg-black/90 px-3 py-3"
      data-testid="live-room-engineering-drawer"
    >
      <p className="mb-2 text-[9px] font-bold uppercase tracking-widest text-sky-300">
        Engineering diagnostics · {liveMode} mode
      </p>
      <section className="grid max-h-[min(52vh,28rem)] gap-3 overflow-y-auto lg:grid-cols-2">
        <WarRoomSweepPanel />
        <SchemaSweepPanel />
        <RepairPacketPanel latest={latestRepairPacket ?? null} />
      </section>
    </section>
  )
})
