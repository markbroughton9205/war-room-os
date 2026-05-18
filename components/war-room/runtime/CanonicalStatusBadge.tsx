'use client'

import { useEffect, useState } from 'react'

type CanonicalSubsystemStatus = {
  id: string
  label: string
  truthBoundary: string
  health: string
  confidence: number
  missingEvidence: string[]
}

type CanonicalStatusResponse = {
  subsystems: CanonicalSubsystemStatus[]
}

function colorFor(value: string) {
  if (/healthy|verified|source_backed/i.test(value)) return '#34D399'
  if (/degraded|advisory|unknown|estimated|experimental/i.test(value)) return '#FBBF24'
  if (/unavailable/i.test(value)) return '#F87171'
  return '#94A3B8'
}

export function CanonicalStatusBadge({ subsystemId, label }: { subsystemId: string; label: string }) {
  const [system, setSystem] = useState<CanonicalSubsystemStatus | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/runtime/canonical-status', { cache: 'no-store' })
        const body = await res.json() as CanonicalStatusResponse
        if (!cancelled && res.ok) {
          setSystem(body.subsystems.find(item => item.id === subsystemId) ?? null)
        }
      } catch {
        if (!cancelled) setSystem(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [subsystemId])

  const value = system ? `${system.health} · ${system.confidence}%` : 'checking'
  const color = colorFor(system?.health ?? 'unknown')
  return (
    <span
      className="rounded px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest"
      title={system?.missingEvidence.join(' · ') || 'Canonical runtime status'}
      style={{ border: `1px solid ${color}66`, color, background: 'rgba(0,0,0,0.25)' }}
    >
      {label}: {value}
    </span>
  )
}
