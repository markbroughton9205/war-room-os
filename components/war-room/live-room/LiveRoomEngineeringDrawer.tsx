'use client'

import dynamic from 'next/dynamic'
import { memo, useCallback, useEffect } from 'react'

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
  const { liveMode, setEngineeringDrawerOpen } = useLiveRoomMode()

  const handleClose = useCallback(() => {
    setEngineeringDrawerOpen(false)
  }, [setEngineeringDrawerOpen])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') handleClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, handleClose])

  if (!open) return null

  return (
    <section
      className="live-room-engineering-drawer border-t border-sky-900/50 bg-black/90 px-3 py-3"
      data-testid="live-room-engineering-drawer"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[9px] font-bold uppercase tracking-widest text-sky-300">
          Engineering diagnostics · {liveMode} mode
        </p>
        <button
          type="button"
          className="rounded border border-white/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-slate-300"
          onClick={handleClose}
          aria-label="Close engineering diagnostics"
        >
          Close
        </button>
      </div>
      <section className="grid max-h-[min(52vh,28rem)] gap-3 overflow-y-auto lg:grid-cols-2">
        <WarRoomSweepPanel />
        <SchemaSweepPanel />
        <RepairPacketPanel latest={latestRepairPacket ?? null} />
      </section>
    </section>
  )
})
