'use client'

import { useEffect, useState } from 'react'

import type { EnvReadinessResponse } from '@/lib/deploy/types'

/** Env names surfaced for operator checklist (names only; presence from server). */
const WATCHLIST = [
  'TAVILY_API_KEY',
  'FIRECRAWL_API_KEY',
  'XAI_API_KEY',
  'GEMINI_API_KEY',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'server-only Supabase role secret',
] as const

export function ProviderSetupChecklistPanel() {
  const [missing, setMissing] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      setErr(null)
      try {
        const res = await fetch('/api/deploy/env', { cache: 'no-store' })
        const j = await res.json() as EnvReadinessResponse & { error?: string }
        if (!res.ok) throw new Error(j.error || 'Env checklist failed')
        const present = new Set<string>()
        for (const g of j.groups ?? []) {
          for (const row of [...g.required, ...g.optional]) {
            if (row.present) present.add(row.name)
          }
        }
        const miss = WATCHLIST.filter(name => !present.has(name))
        if (!cancelled) setMissing(miss)
      } catch (e) {
        if (!cancelled) {
          setErr(e instanceof Error ? e.message : 'Failed to load checklist')
          setMissing([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <section
      className="border-b border-yellow-900 px-6 py-3 text-xs flex-shrink-0"
      style={{ background: 'rgba(15,118,110,0.06)' }}
    >
      <h2 className="text-xs font-bold tracking-widest" style={{ color: '#5EEAD4' }}>
        PROVIDER SETUP CHECKLIST
      </h2>
      <p className="mt-1 text-[10px] tracking-widest" style={{ color: '#666' }}>
        Missing environment variable names only (no values).
      </p>
      {loading && <p className="mt-2" style={{ color: '#777' }}>Loading…</p>}
      {err && <p className="mt-2" style={{ color: '#fca5a5' }}>{err}</p>}
      {!loading && !err && missing.length === 0 && (
        <p className="mt-2 font-bold tracking-widest" style={{ color: '#34D399' }}>
          All watched keys present.
        </p>
      )}
      {!loading && !err && missing.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2 font-mono text-[10px]" style={{ color: '#fdba74' }}>
          {missing.map(name => (
            <li key={name} className="rounded border border-amber-900/50 px-2 py-1" style={{ background: 'rgba(0,0,0,0.25)' }}>
              {name}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
