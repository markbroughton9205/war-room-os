'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  HVS_CANONICAL_PATH,
  hvsCharactersHref,
  hvsCreateHref,
  hvsStudioHref,
  persistHvsResume,
  readHvsResume,
} from '@/lib/media-command/navigation'
import { formatLabelForAspect, lengthLabel, simpleStatusLabel } from '@/lib/media-command/production-language'
import { HvsAiCreateStudio } from './HvsAiCreateStudio'
import './hvs-ai-first.css'

type CatalogEntry = { id: string; name: string; updatedAt: string; productionMode: string; starrdom: boolean }
type ProjectFacts = {
  id: string
  durationSec?: number
  aspect?: '16:9' | '9:16' | '1:1'
  renderStatus?: string
  clipCount?: number
}

export function HvsHomeScreen() {
  const [projects, setProjects] = useState<CatalogEntry[]>([])
  const [facts, setFacts] = useState<Record<string, ProjectFacts>>({})
  const [charactersHref, setCharactersHref] = useState(`${HVS_CANONICAL_PATH}/characters`)

  useEffect(() => {
    queueMicrotask(() => setCharactersHref(hvsCharactersHref(readHvsResume()?.projectId)))
    void fetch('/api/media-command/projects')
      .then(r => r.json())
      .then(async (data: { projects?: CatalogEntry[] }) => {
        const list = data.projects ?? []
        setProjects(list)
        const recent = list.slice(0, 6)
        const next: Record<string, ProjectFacts> = {}
        await Promise.all(recent.map(async entry => {
          try {
            const res = await fetch(`/api/media-command/projects/${entry.id}`)
            const body = await res.json() as {
              project?: {
                id: string
                timeline?: { aspect?: '16:9' | '9:16' | '1:1'; tracks?: Array<{ clips?: unknown[] }> }
                renderJobs?: Array<{ status?: string }>
              }
            }
            const project = body.project
            const ticks = 0
            void ticks
            next[entry.id] = {
              id: entry.id,
              aspect: project?.timeline?.aspect,
              renderStatus: project?.renderJobs?.at(-1)?.status,
              clipCount: project?.timeline?.tracks?.reduce((n, track) => n + (track.clips?.length ?? 0), 0),
            }
          } catch {
            next[entry.id] = { id: entry.id }
          }
        }))
        setFacts(next)
      })
      .catch(() => setProjects([]))
  }, [])

  const recent = projects.slice(0, 6)
  const starrdom = projects.filter(p => p.starrdom)

  return (
    <div className="space-y-4" data-testid="hvs-home-screen">
      <HvsAiCreateStudio />

      <section className="hvs-ai-panel" data-testid="hvs-home-characters">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.28em] text-amber-300">Characters</h2>
        <p className="mt-1 text-[12px] text-slate-500">High-fidelity Ra&apos;el stays inside Higher Vision Studios. Unreal remains the execution engine.</p>
        <Link
          href={charactersHref}
          data-testid="hvs-home-open-characters"
          data-hvs-internal-route="1"
          className="mt-3 inline-flex rounded-full border border-amber-400/50 px-3 py-2 text-[11px] font-bold uppercase tracking-widest text-amber-100"
          onClick={() => persistHvsResume({
            basePath: `${HVS_CANONICAL_PATH}/characters`,
            projectId: readHvsResume()?.projectId ?? null,
            section: 'characters',
          })}
        >
          Open Characters
        </Link>
      </section>

      <section className="hvs-ai-panel" data-testid="hvs-home-recent">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.28em] text-cyan-300">My projects</h2>
        <p className="mt-1 text-[12px] text-slate-500">Recent productions. Technical details stay in Advanced Editor.</p>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {recent.length === 0 ? <li className="text-sm text-slate-500">No productions yet.</li> : null}
          {recent.map(project => {
            const card = facts[project.id]
            const status = simpleStatusLabel(card?.renderStatus ?? (card?.clipCount ? 'editing' : 'draft'))
            return (
              <li key={project.id} className="rounded-xl border border-white/10 px-3 py-3">
                <p className="text-sm text-amber-50">{project.name}</p>
                <p className="mt-1 text-[11px] uppercase tracking-widest text-cyan-300">Status: {status}</p>
                <p className="text-[11px] text-slate-500">
                  {lengthLabel(card?.durationSec ?? null)} · {formatLabelForAspect(card?.aspect ?? '16:9')}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Link
                    href={hvsCreateHref(project.id)}
                    className="rounded-full border border-emerald-400/40 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-emerald-100"
                    onClick={() => persistHvsResume({ basePath: hvsCreateHref(project.id), projectId: project.id, section: 'home' })}
                  >
                    Continue
                  </Link>
                  <Link
                    href={hvsStudioHref(project.id)}
                    className="rounded-full border border-white/15 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-300"
                  >
                    Preview
                  </Link>
                </div>
              </li>
            )
          })}
        </ul>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href={`${HVS_CANONICAL_PATH}/projects`} className="hvs-ai-btn hvs-ai-btn-ghost">All projects</Link>
          <Link href={`${HVS_CANONICAL_PATH}/studio`} className="hvs-ai-btn hvs-ai-btn-ghost" data-testid="hvs-home-advanced-editor">Advanced Editor</Link>
        </div>
      </section>

      <section className="hvs-ai-panel">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.28em] text-amber-300">Luxury Beauty Demo</h2>
        <p className="mt-2 text-sm text-slate-400">
          Optional demo project for the Advanced Editor. Real talent is authoritative. Identity morphing is off.
        </p>
        <Link
          href={starrdom[0] ? hvsStudioHref(starrdom[0].id) : `${HVS_CANONICAL_PATH}/projects?starrdom=1`}
          className="mt-3 inline-flex rounded-full border border-amber-400/50 px-3 py-2 text-[11px] font-bold uppercase tracking-widest text-amber-100"
        >
          Open demo project
        </Link>
      </section>
    </div>
  )
}
