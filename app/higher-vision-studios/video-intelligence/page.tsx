'use client'

import { useEffect, useState } from 'react'
import { HvsModuleSurface } from '@/components/war-room/higher-vision-studios/HvsModuleSurface'

export default function HvsVideoIntelligencePage() {
  const [data, setData] = useState<{ jobs?: unknown[]; note?: string } | null>(null)
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([])
  const [projectId, setProjectId] = useState('')
  const [assetId, setAssetId] = useState('')
  const [assets, setAssets] = useState<Array<{ id: string; name: string }>>([])

  useEffect(() => {
    void fetch('/api/media-command/video-intelligence').then(r => r.json()).then(setData)
    void fetch('/api/media-command/projects').then(r => r.json()).then((d: { projects?: Array<{ id: string; name: string }> }) => setProjects(d.projects ?? []))
  }, [])

  useEffect(() => {
    if (!projectId) return
    void fetch(`/api/media-command/projects/${projectId}`).then(r => r.json()).then((d: { project?: { assets: Array<{ id: string; name: string }> } }) => setAssets(d.project?.assets ?? []))
  }, [projectId])

  return (
    <HvsModuleSurface title="Video Intelligence" kicker="Watch · Understand · Search · Learn" status="boundary">
      <div className="foundry-glass space-y-3 rounded-lg border border-cyan-900/40 p-4 text-sm text-slate-300">
        <p>{data?.note}</p>
        <p className="text-[11px] uppercase tracking-widest text-cyan-400">Permanent types: VideoObservation · TechniqueRecord · VideoAnalysisJob · MediaSearchIndex</p>
        <div className="flex flex-wrap gap-2">
          <select className="rounded border border-white/15 bg-black px-2 py-1" value={projectId} onChange={e => setProjectId(e.target.value)}>
            <option value="">Project</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select className="rounded border border-white/15 bg-black px-2 py-1" value={assetId} onChange={e => setAssetId(e.target.value)}>
            <option value="">Asset</option>
            {assets.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <button
            type="button"
            className="rounded border border-cyan-400/40 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-cyan-100"
            onClick={() => void fetch('/api/media-command/video-intelligence', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId, assetId }) }).then(r => r.json()).then(() => fetch('/api/media-command/video-intelligence').then(x => x.json()).then(setData))}
          >
            Watch video
          </button>
        </div>
        <pre className="overflow-auto text-[11px] text-cyan-200">{JSON.stringify(data?.jobs ?? [], null, 2)}</pre>
        <ul className="list-disc pl-5 text-[12px] text-slate-400">
          <li>Watch Video</li>
          <li>Understand Scenes</li>
          <li>Transcript / Person / Object / Action / Camera / Transition / Effect analysis</li>
          <li>Find Best Moments · Search Video · Tutorial Understanding · Procedure Extraction</li>
          <li>Video Memory · Production Knowledge — human-verified TechniqueRecords only</li>
        </ul>
        <p className="text-[11px] text-amber-300">No automatic internet-video ingestion. Authorized/local video only.</p>
      </div>
    </HvsModuleSurface>
  )
}
