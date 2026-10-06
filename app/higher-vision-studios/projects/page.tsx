'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { hvsCreateHref, hvsProjectHref, hvsStudioHref } from '@/lib/media-command/navigation'
import { formatTimecode } from '@/lib/media-command/time'
import { formatLabelForAspect, simpleStatusLabel } from '@/lib/media-command/production-language'
import { timelineDuration, type HvsProject } from '@/lib/media-command/types'

type CatalogEntry = { id: string; name: string; updatedAt: string; productionMode: string; starrdom: boolean }

type Card = {
  id: string
  name: string
  type: string
  duration: string
  updatedAt: string
  status: string
  aspect: string
  version: string
  lastRender: string
  posterId: string | null
  starrdom: boolean
}

function toCard(entry: CatalogEntry, project: HvsProject | null): Card {
  const duration = project ? formatTimecode(timelineDuration(project.timeline)) : '—'
  const poster = project?.assets.find(a => a.kind === 'video' || a.kind === 'image' || a.kind === 'logo') ?? null
  const last = project?.renderJobs.at(-1)
  const status = last?.status ?? (project?.assets.length ? 'editing' : 'draft')
  return {
    id: entry.id,
    name: entry.name,
    type: entry.productionMode.replace('_', ' / '),
    duration,
    updatedAt: entry.updatedAt,
    status,
    aspect: project?.timeline.aspect ?? '16:9',
    version: project?.versions.find(v => v.id === project.currentVersionId)?.label ?? project?.versions.at(-1)?.label ?? 'Version 1',
    lastRender: last ? `${last.target.aspect} · ${last.status}` : 'none',
    posterId: poster?.id ?? null,
    starrdom: entry.starrdom,
  }
}

export default function HvsProjectsPage() {
  const [cards, setCards] = useState<Card[]>([])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const catalogRes = await fetch('/api/media-command/projects')
      const catalog = await catalogRes.json() as { projects?: CatalogEntry[] }
      const entries = catalog.projects ?? []
      const initial = entries.map(entry => toCard(entry, null))
      if (!cancelled) setCards(initial)
      const enriched: Card[] = []
      const chunk = 8
      for (let i = 0; i < entries.length; i += chunk) {
        const batch = entries.slice(i, i + chunk)
        const loaded = await Promise.all(batch.map(async entry => {
          try {
            const res = await fetch(`/api/media-command/projects/${entry.id}`)
            const body = await res.json() as { project?: HvsProject }
            return toCard(entry, body.project ?? null)
          } catch {
            return toCard(entry, null)
          }
        }))
        enriched.push(...loaded)
        if (!cancelled) setCards([...enriched, ...initial.slice(enriched.length)])
      }
    })()
    return () => { cancelled = true }
  }, [])

  return (
    <div className="space-y-3" data-testid="hvs-projects-page">
      <header className="foundry-glass rounded-lg border border-amber-900/40 px-4 py-3">
        <p className="text-[10px] font-bold uppercase tracking-[0.34em] text-amber-300">Higher Vision Studios</p>
        <h1 className="mt-1 text-xl font-semibold tracking-[0.12em] text-amber-50">My Projects</h1>
        <p className="mt-1 text-[11px] text-slate-500">Continue with AI, or open Advanced Editor. Timeline, media, and versions still restore from .hvsproj.</p>
      </header>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map(card => (
          <li key={card.id}>
            <Link
              href={hvsStudioHref(card.id)}
              data-testid="hvs-project-card"
              className="foundry-glass block overflow-hidden rounded-lg border border-amber-900/40 hover:border-emerald-400/50"
            >
              <div className="relative aspect-video bg-black">
                {card.posterId ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img alt="" src={`/api/media-command/assets/${card.posterId}/file?kind=thumb`} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-[10px] uppercase tracking-[0.28em] text-slate-600">No poster</div>
                )}
                <span className="absolute right-2 top-2 rounded border border-cyan-400/40 bg-black/70 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-cyan-200">{card.aspect}</span>
              </div>
              <div className="space-y-1 px-3 py-2.5">
                <p className="truncate text-sm font-semibold tracking-wide text-amber-50">{card.name}</p>
                <p className="text-[10px] uppercase tracking-widest text-cyan-300">Status: {simpleStatusLabel(card.status)}</p>
                <p className="text-[10px] uppercase tracking-widest text-slate-500">
                  {card.duration} · {formatLabelForAspect(card.aspect === '9:16' || card.aspect === '1:1' ? card.aspect : '16:9')}
                  {card.starrdom ? ' · DEMO' : ''}
                </p>
                <p className="hidden">{card.type} {card.version} {card.lastRender} {card.aspect}</p>
                <p className="text-[10px] text-slate-500">Modified {new Date(card.updatedAt).toLocaleString()}</p>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Link href={hvsCreateHref(card.id)} className="rounded-full border border-emerald-400/40 px-2.5 py-1 text-[9px] font-bold uppercase tracking-widest text-emerald-100">Continue</Link>
                  <Link href={hvsStudioHref(card.id)} className="rounded-full border border-white/15 px-2.5 py-1 text-[9px] font-bold uppercase tracking-widest text-slate-300">Preview</Link>
                  <Link href={hvsStudioHref(card.id)} className="rounded-full border border-amber-400/30 px-2.5 py-1 text-[9px] font-bold uppercase tracking-widest text-amber-100">Advanced Editor</Link>
                </div>
              </div>
            </Link>
            <Link href={hvsProjectHref(card.id)} className="mt-1 inline-block px-1 text-[9px] uppercase tracking-widest text-slate-600">Overview</Link>
          </li>
        ))}
      </ul>
      {cards.length === 0 ? <p className="text-sm text-slate-500">No projects yet. Create one from Home.</p> : null}
    </div>
  )
}
