'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { hvsCreateHref, hvsProjectHref } from '@/lib/media-command/navigation'
import { HVS_PRODUCTION_PAGES, hvsProductionHref } from '@/lib/media-command/production-pages'
import type { HvsProject } from '@/lib/media-command/types'

export function HvsProjectWorkspace({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<HvsProject | null>(null)

  useEffect(() => {
    void fetch(`/api/media-command/projects/${projectId}`)
      .then(r => r.json())
      .then((d: { project?: HvsProject }) => setProject(d.project ?? null))
  }, [projectId])

  if (!project) return <p className="text-sm text-slate-500">Loading project…</p>

  return (
    <div className="space-y-3" data-testid="hvs-project-workspace">
      <header className="foundry-glass rounded-lg border border-amber-900/40 p-4">
        <p className="text-[10px] uppercase tracking-[0.3em] text-cyan-300">{project.productionMode}{project.starrdom ? ' · DEMO' : ''}</p>
        <h1 className="text-xl font-semibold tracking-wide text-amber-50">{project.name}</h1>
        <p className="mt-1 text-[11px] text-slate-500">.hvsproj v{project.formatVersion} · beauty morphing {project.beautyIdentityMorphing.toUpperCase()}</p>
        <Link href={hvsCreateHref(project.id)} className="mt-3 mr-2 inline-flex rounded border border-cyan-400/50 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-cyan-100">Continue with AI</Link>
        <Link href={hvsProductionHref(project.id, 'edit')} className="mt-3 inline-flex rounded border border-emerald-400/50 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-emerald-100">Advanced Editor</Link>
      </header>
      <nav className="flex flex-wrap gap-1" aria-label="Project production pages">
        {HVS_PRODUCTION_PAGES.map(item => (
          <Link
            key={item.id}
            href={hvsProductionHref(project.id, item.id)}
            className="rounded border border-white/10 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-300"
          >
            {item.icon} {item.label}
            <span className="ml-1 text-[8px] text-slate-500">{item.status}</span>
          </Link>
        ))}
        <Link href={hvsProjectHref(project.id)} className="rounded border border-white/10 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">Overview</Link>
      </nav>
      <section className="foundry-glass rounded-lg border border-amber-900/40 p-4 text-sm text-slate-300">
        <pre className="whitespace-pre-wrap text-[12px] text-slate-400">{project.notes || 'No notes.'}</pre>
        {project.scripts.map(script => (
          <article key={script.id} className="mt-3">
            <h2 className="text-amber-100">{script.title}</h2>
            <p className="mt-1 text-slate-400">{script.body}</p>
          </article>
        ))}
        {project.storyboard.length ? (
          <ol className="mt-3 list-decimal pl-4">
            {project.storyboard.map(frame => <li key={frame.id}>{frame.title} — {frame.description}</li>)}
          </ol>
        ) : null}
      </section>
    </div>
  )
}
