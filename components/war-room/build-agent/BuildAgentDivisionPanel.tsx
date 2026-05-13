'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { BUILD_AGENT_DEFINITIONS } from '@/lib/build-agent/agents'
import type { BuildRequest } from '@/lib/build-agent/types'
import { AgentRoster } from './AgentRoster'
import { BuildRequestQueue } from './BuildRequestQueue'
import { DraftBuildRequestButton } from './DraftBuildRequestButton'

const PERSISTENCE_HEADER = 'x-war-room-build-requests-persistence'

export function BuildAgentDivisionPanel() {
  const [serverRequests, setServerRequests] = useState<BuildRequest[]>([])
  const [localOnlyRequests, setLocalOnlyRequests] = useState<BuildRequest[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [localDraftBanner, setLocalDraftBanner] = useState(false)

  const refreshRequests = useCallback(async () => {
    try {
      const res = await fetch('/api/build-requests', { cache: 'no-store' })
      const persistence = res.headers.get(PERSISTENCE_HEADER)
      if (persistence === 'unavailable') {
        setLocalDraftBanner(true)
      }

      const data: unknown = await res.json()

      if (!res.ok) {
        setServerRequests([])
        const msg =
          typeof data === 'object' && data !== null && 'error' in data
            ? String((data as { error?: unknown }).error ?? '')
            : ''
        setLoadError(msg || `Could not load build requests (${res.status}).`)
        return
      }

      if (!Array.isArray(data)) {
        setServerRequests([])
        setLoadError('Unexpected response when loading build requests.')
        return
      }

      setServerRequests(
        data.map((r) => {
          const row = r as BuildRequest
          return { ...row, local_only: false }
        }),
      )
      setLoadError(null)
    } catch {
      setServerRequests([])
      setLoadError('Network error while loading build requests.')
    }
  }, [])

  useEffect(() => {
    const id = window.setTimeout(() => {
      void refreshRequests()
    }, 0)
    return () => window.clearTimeout(id)
  }, [refreshRequests])

  const handlePersistFailed = useCallback((row: BuildRequest) => {
    setLocalDraftBanner(true)
    setLocalOnlyRequests((prev) => [row, ...prev])
  }, [])

  const ordered = useMemo(() => {
    const merged = [...serverRequests, ...localOnlyRequests]
    return merged.sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
  }, [serverRequests, localOnlyRequests])

  return (
    <section className="mx-auto mt-14 max-w-6xl border-t border-white/10 pt-10">
      <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.4em] text-[#d4af37]">Operations</p>
          <h2 className="mt-2 text-xl font-semibold tracking-tight text-white sm:text-2xl">Build Agent Division</h2>
          <p className="mt-2 max-w-2xl text-sm text-slate-500">
            Queue build work for specialist agents. Rows are stored in Supabase when configured; roster agents are not live
            until integrations exist — handoff through Ra&apos;el and Council remains the approval path.
          </p>
          <p className="mt-1 text-[10px] font-mono uppercase tracking-[0.2em] text-slate-600">
            Planning-only · no repo or deploy side effects from this panel
          </p>
        </div>
        <DraftBuildRequestButton
          agents={BUILD_AGENT_DEFINITIONS}
          onPersisted={refreshRequests}
          onPersistFailed={handlePersistFailed}
        />
      </header>

      {localDraftBanner && (
        <div
          role="status"
          className="mb-6 rounded-lg border border-amber-500/35 bg-amber-500/10 px-4 py-3 font-mono text-xs text-amber-100/95"
        >
          Local draft only — not persisted yet.
        </div>
      )}

      {loadError && (
        <div className="mb-6 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 font-mono text-xs text-rose-100/90">
          {loadError}
        </div>
      )}

      <div className="space-y-10">
        <AgentRoster agents={BUILD_AGENT_DEFINITIONS} />
        <BuildRequestQueue requests={ordered} />
      </div>
    </section>
  )
}
