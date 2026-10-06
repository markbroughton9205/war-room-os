'use client'

import { useEffect, useState } from 'react'
import { HvsModuleSurface } from '@/components/war-room/higher-vision-studios/HvsModuleSurface'

type Asset = { id: string; name: string; kind: string; thumbPath?: string | null; codec?: string | null; width?: number | null; height?: number | null }
type Project = { id: string; name: string; assets?: Asset[] }

export default function HvsLibraryPage() {
  const [assets, setAssets] = useState<Array<Asset & { projectName: string }>>([])
  useEffect(() => {
    void fetch('/api/media-command/projects').then(r => r.json()).then(async (d: { projects?: Array<{ id: string; name: string }> }) => {
      const rows: Array<Asset & { projectName: string }> = []
      for (const p of d.projects ?? []) {
        const res = await fetch(`/api/media-command/projects/${p.id}`)
        const body = await res.json() as { project?: Project & { assets: Asset[]; name: string } }
        for (const a of body.project?.assets ?? []) rows.push({ ...a, projectName: body.project?.name ?? p.name })
      }
      setAssets(rows)
    })
  }, [])
  return (
    <HvsModuleSurface title="Media Library" kicker="Higher Vision Studios" status="live">
      <div className="foundry-glass rounded-lg border border-amber-900/40 p-4">
        <ul className="space-y-2">
          {assets.map(a => (
            <li key={a.id} className="flex items-center gap-3 rounded border border-white/10 px-3 py-2 text-sm">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {a.kind === 'video' || a.kind === 'image' || a.kind === 'logo' ? (
                <img alt="" src={`/api/media-command/assets/${a.id}/file?kind=thumb`} className="h-12 w-20 rounded object-cover" />
              ) : null}
              <span className="flex-1 text-amber-50">{a.name}</span>
              <span className="text-[10px] uppercase tracking-widest text-slate-500">{a.kind}{a.width && a.height ? ` · ${a.width}×${a.height}` : ''}{a.codec ? ` · ${a.codec}` : ''} · {a.projectName}</span>
            </li>
          ))}
          {assets.length === 0 ? <li className="text-slate-500">No assets yet. Import from the Editor.</li> : null}
        </ul>
      </div>
    </HvsModuleSurface>
  )
}
