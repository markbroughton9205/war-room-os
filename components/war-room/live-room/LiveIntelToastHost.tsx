'use client'

import { memo, useEffect, useSyncExternalStore } from 'react'

import { SOURCE_LABEL } from '@/lib/live-intel/composeLiveIntel'
import { dismissLiveIntelToast, getLiveIntelStoreSnapshot, subscribeLiveIntelStore } from '@/lib/live-intel/liveIntelStore'
import type { LiveIntelItem, LiveIntelSeverity } from '@/lib/live-intel/types'

const TONE_DOT: Record<LiveIntelSeverity, string> = {
  info: 'bg-cyan-400',
  operational: 'bg-emerald-400',
  warning: 'bg-amber-400',
  critical: 'bg-red-500',
}

function clockLabel(iso: string): string {
  const then = Date.parse(iso)
  if (!Number.isFinite(then) || then <= 0) return ''
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

function ToastCard({ item }: { item: LiveIntelItem }) {
  useEffect(() => {
    const timer = window.setTimeout(() => dismissLiveIntelToast(item.id), 4200)
    return () => window.clearTimeout(timer)
  }, [item.id])

  return (
    <div
      className="live-intel-motion w-[min(22rem,calc(100vw-1.5rem))] rounded-lg border border-cyan-400/25 bg-[rgba(2,8,14,0.94)] px-3 py-2 shadow-[0_12px_32px_rgba(0,0,0,0.45)]"
      data-testid="live-intel-toast"
      role="status"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-[8px] font-bold uppercase tracking-[0.22em] text-slate-400">{SOURCE_LABEL[item.source]}</p>
        <span className={`h-1.5 w-1.5 rounded-full ${TONE_DOT[item.severity]}`} aria-hidden="true" />
      </div>
      <p className="mt-1 text-[12px] font-semibold text-slate-100">{item.title}</p>
      <p className="mt-0.5 text-[10px] uppercase tracking-widest text-slate-500">
        {item.metadata && typeof item.metadata.id === 'string' ? `${item.metadata.id} · ` : ''}
        {clockLabel(item.timestamp)}
      </p>
    </div>
  )
}

export const LiveIntelToastHost = memo(function LiveIntelToastHost() {
  const store = useSyncExternalStore(subscribeLiveIntelStore, getLiveIntelStoreSnapshot, getLiveIntelStoreSnapshot)
  const toast = store.toasts[store.toasts.length - 1]
  if (!toast) return null
  return (
    <div className="pointer-events-none fixed right-4 top-24 z-[60] flex flex-col items-end gap-2" data-testid="live-intel-toast-host">
      <div className="pointer-events-auto">
        <ToastCard item={toast} />
      </div>
    </div>
  )
})
