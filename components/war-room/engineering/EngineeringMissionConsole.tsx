'use client'

/**
 * Phase D — War Room Engineering Mission UI.
 *
 * This does NOT reimplement a second Engineering Core client. It reuses BuilderWorkspace, the
 * exact same thin client Standalone Builder (Phase A) already proved end to end against the
 * Engineering Core boundary, with basePath="/war-room/engineering" so this surface's own URL
 * round-trips independently of Builder's. The only genuinely new piece here is the "active
 * missions" list/switcher (Phase D's own requirement) — everything else (files, search, coder
 * request, proposal/diff, approvals, validation, activity, rollback) is the identical component,
 * not a parallel implementation.
 *
 * This is also the concrete proof of Phase C (Shared Session Continuity): selecting a mission
 * created in Standalone Builder here, or vice versa, reconstructs identical live state because
 * both surfaces read the same repairId against the same authoritative native-builder persistence
 * — there is no separate War-Room-side mission cache.
 *
 * Council Assist is Phase E, not yet implemented — the tab below is an honest, clearly-labeled
 * placeholder (no fabricated dashboard, no simulated data) rather than a working feature.
 */
import { useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { BuilderWorkspace } from '@/components/war-room/builder/BuilderWorkspace'

const BASE_PATH = '/war-room/engineering'

type MissionListItem = {
  id: string
  title: string
  status: string
  updatedAt: string
  nativeBuilder: { issueId: string; repairId: string }
}

async function getJson<T>(url: string): Promise<{ ok: boolean; data?: T; error?: string }> {
  try {
    const res = await fetch(url, { cache: 'no-store' })
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (!res.ok) return { ok: false, error: typeof json.error === 'string' ? json.error : `HTTP ${res.status}` }
    return { ok: true, data: json as T }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

const STATUS_COLOR: Record<string, string> = {
  completed: 'text-emerald-400',
  rolled_back: 'text-amber-400',
  blocked: 'text-red-400',
  cancelled: 'text-slate-500',
}

export function EngineeringMissionConsole() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const activeMissionId = searchParams.get('mission')
  const [missions, setMissions] = useState<MissionListItem[]>([])
  const [loadingList, setLoadingList] = useState(false)
  const [showCouncilPlaceholder, setShowCouncilPlaceholder] = useState(false)

  const refreshList = useCallback(async () => {
    setLoadingList(true)
    const result = await getJson<{ missions: MissionListItem[] }>('/api/mission-runtime/engineering')
    if (result.ok && result.data) setMissions(result.data.missions)
    setLoadingList(false)
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void refreshList(), 0)
    return () => window.clearTimeout(timer)
  }, [refreshList])

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_1fr]">
      <aside className="rounded border border-emerald-900/40 bg-neutral-950/60 p-3">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-[11px] font-bold uppercase tracking-widest text-emerald-300">Active Missions</h2>
          <button
            type="button"
            onClick={() => void refreshList()}
            className="text-[10px] uppercase tracking-wider text-slate-500 hover:text-emerald-300"
          >
            {loadingList ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={() => router.replace(BASE_PATH)}
            className={`rounded border px-2 py-1 text-left text-[11px] ${
              !activeMissionId ? 'border-emerald-500 text-emerald-300' : 'border-transparent text-slate-400 hover:border-slate-700'
            }`}
          >
            + New mission
          </button>
          {missions.length === 0 && !loadingList && (
            <p className="px-2 py-1 text-[10px] text-slate-600">No missions yet. Real system, empty on purpose — nothing has run.</p>
          )}
          {missions.map(m => (
            <button
              key={m.id}
              type="button"
              onClick={() => router.replace(`${BASE_PATH}?mission=${m.id}`)}
              className={`rounded border px-2 py-1 text-left text-[11px] ${
                activeMissionId === m.id ? 'border-emerald-500 text-emerald-200' : 'border-transparent text-slate-400 hover:border-slate-700'
              }`}
            >
              <div className="truncate">{m.title}</div>
              <div className={`text-[9px] uppercase tracking-wider ${STATUS_COLOR[m.status] ?? 'text-slate-500'}`}>{m.status}</div>
            </button>
          ))}
        </div>

        <div className="mt-4 border-t border-emerald-900/40 pt-3">
          <button
            type="button"
            onClick={() => setShowCouncilPlaceholder(s => !s)}
            className="w-full rounded border border-slate-800 px-2 py-1 text-left text-[10px] uppercase tracking-wider text-slate-500"
          >
            Council Assist
          </button>
          {showCouncilPlaceholder && (
            <p className="mt-2 px-1 text-[10px] leading-relaxed text-slate-600">
              Not yet implemented. Council Assist is Phase E — a shared, advisory-only capability
              from both War Room Engineering and Standalone Builder. Coder remains the sole
              executor; Council will never directly become an executable patch.
            </p>
          )}
        </div>
      </aside>

      <div>
        <BuilderWorkspace basePath={BASE_PATH} />
      </div>
    </div>
  )
}
