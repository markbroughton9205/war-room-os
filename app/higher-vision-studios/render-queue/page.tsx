'use client'

import { useEffect, useState } from 'react'
import { HvsModuleSurface } from '@/components/war-room/higher-vision-studios/HvsModuleSurface'
import { describeHistoricalEnvironmentFailure, isHistoricalEnvironmentFailure } from '@/lib/media-command/render-job-status'

export default function HvsRenderQueuePage() {
  const [jobs, setJobs] = useState<Array<{
    id: string
    status: string
    target?: { aspect: string }
    projectName?: string
    blockedReason?: string | null
    outputPath?: string | null
    encoder?: string | null
    probe?: { width: number | null; height: number | null; durationSec: number | null; hasVideo: boolean; hasAudio: boolean } | null
  }>>([])
  const [bundledAvailable, setBundledAvailable] = useState(false)
  useEffect(() => {
    void fetch('/api/media-command/render-queue').then(r => r.json()).then((d: { jobs?: typeof jobs }) => setJobs(d.jobs ?? []))
    void fetch('/api/media-command/status').then(r => r.json()).then((d: { ffmpeg?: { ffmpeg?: string | null } }) => {
      setBundledAvailable(Boolean(d.ffmpeg?.ffmpeg))
    })
  }, [])
  return (
    <HvsModuleSurface title="Render Queue" kicker="Durable jobs · 16:9 / 9:16 / 1:1 · 1080p min" status="live">
      <div className="foundry-glass rounded-lg border border-amber-900/40 p-4">
        <ul className="space-y-2 text-sm">
          {jobs.map(j => {
            const stale = isHistoricalEnvironmentFailure(j.blockedReason)
            return (
              <li key={j.id} className="rounded border border-white/10 px-3 py-2">
                <span className="text-amber-50">{j.projectName ?? 'Project'} · {j.target?.aspect}</span>
                <span className="ml-2 text-[10px] uppercase tracking-widest text-cyan-300">{j.status}</span>
                {stale ? <span className="ml-2 text-[10px] uppercase tracking-widest text-slate-500">historical / stale</span> : null}
                {j.encoder ? <span className="ml-2 text-[10px] uppercase tracking-widest text-amber-300">{j.encoder}</span> : null}
                {j.probe ? <p className="mt-1 text-[11px] text-slate-400">{j.probe.width}×{j.probe.height} · {j.probe.durationSec?.toFixed(2)}s · {j.probe.hasAudio ? 'audio' : 'no audio'}</p> : null}
                {j.outputPath ? <p className="mt-1 truncate text-[11px] text-emerald-200">{j.outputPath}</p> : null}
                {stale ? (
                  <p className="mt-1 text-[11px] text-slate-400">{describeHistoricalEnvironmentFailure(bundledAvailable)}</p>
                ) : j.blockedReason ? (
                  <p className="mt-1 text-[11px] text-amber-300">{j.blockedReason}</p>
                ) : null}
              </li>
            )
          })}
          {jobs.length === 0 ? <li className="text-slate-500">Queue empty. Render from the Editor.</li> : null}
        </ul>
      </div>
    </HvsModuleSurface>
  )
}
