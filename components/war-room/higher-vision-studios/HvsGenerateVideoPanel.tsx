'use client'

/**
 * HVS-GENERATIVE-VIDEO-01 — compact GENERATE VIDEO panel inside the AI-first Create surface.
 * Local Wan 2.2 only. Never shows READY unless the server reports installed weights + runtime + GPU admission.
 * Completed generations are real AssetRecords and open in the existing Source monitor (editor ?sourceAsset=).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { hvsStudioHref } from '@/lib/media-command/navigation'
import type { AssetRecord } from '@/lib/media-command/types'
import type { HvsGenerateVideoOp, HvsGenerateVideoResult, HvsModelStatusLine } from '@/lib/media-command/generative/types'
import { WAN22_LIMITS } from '@/lib/media-command/generative/types'
import { generationStateLine } from '@/lib/media-command/generative/status-lines'

export { generationStateLine }

type StatusResponse = {
  modelStatusLine?: HvsModelStatusLine
  modelInstallLine?: string
  gpuAdmissionLine?: string
  discovery?: { detail?: string; status?: string; modelPath?: string }
  gpu?: { state?: string; name?: string | null; freeMiB?: number | null; totalMiB?: number | null; reason?: string }
  generations?: HvsGenerateVideoResult[]
  error?: string
}

const ACTIVE = new Set(['QUEUED', 'LOADING_MODEL', 'GENERATING', 'ENCODING', 'INGESTING'])

export function HvsGenerateVideoPanel({
  projectId,
  assets,
  ensureProject,
  onAssetCreated,
}: {
  projectId: string | null
  assets: AssetRecord[]
  ensureProject?: () => Promise<string>
  onAssetCreated?: (assetId: string) => void
}) {
  const [status, setStatus] = useState<StatusResponse | null>(null)
  const [prompt, setPrompt] = useState('')
  const [duration, setDuration] = useState<number>(WAN22_LIMITS.maxDurationSeconds)
  const [vertical, setVertical] = useState(false)
  const [sourceImageAssetId, setSourceImageAssetId] = useState('')
  const [generation, setGeneration] = useState<HvsGenerateVideoResult | null>(null)
  const [notes, setNotes] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  const images = useMemo(() => assets.filter(a => a.kind === 'image' || a.kind === 'graphic'), [assets])

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/media-command/generate-video${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''}`)
      const data = await res.json() as StatusResponse
      setStatus(res.ok ? data : { error: data.error ?? 'Status unavailable.' })
      if (generation && data.generations) {
        const live = data.generations.find(g => g.generationId === generation.generationId)
        if (live) setGeneration(live)
      }
    } catch {
      setStatus({ error: 'Status unavailable.' })
    }
  }, [projectId, generation])

  useEffect(() => { void refresh() }, [projectId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!generation || !ACTIVE.has(generation.status)) return
    const timer = setInterval(() => { void refresh() }, 2000)
    return () => clearInterval(timer)
  }, [generation, refresh])

  useEffect(() => {
    if (generation?.status === 'COMPLETE' && generation.outputAssetId) onAssetCreated?.(generation.outputAssetId)
  }, [generation?.status, generation?.outputAssetId]) // eslint-disable-line react-hooks/exhaustive-deps

  const modelLine: string = status?.error ? 'ERROR' : status?.modelStatusLine ?? 'CHECKING…'
  const ready = status?.modelStatusLine === 'WAN 2.2 READY'

  async function fillFromSentence() {
    const res = await fetch('/api/media-command/generate-video', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'propose', utterance: prompt, projectId, selectedImageAssetId: sourceImageAssetId || null }),
    })
    const data = await res.json() as { proposal?: HvsGenerateVideoOp | null; notes?: string[] }
    if (data.proposal) {
      setPrompt(data.proposal.request.prompt)
      setDuration(data.proposal.request.durationSeconds)
      setVertical(data.proposal.request.height === 1280)
    }
    setNotes(data.notes?.length ? data.notes : ['That does not read as a video-generation request.'])
  }

  async function generate() {
    setBusy(true)
    try {
      const id = projectId ?? (ensureProject ? await ensureProject() : null)
      if (!id) {
        setNotes(['Open or start a project first.'])
        return
      }
      const res = await fetch('/api/media-command/generate-video', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'generate',
          request: {
            projectId: id,
            prompt,
            durationSeconds: duration,
            ...(vertical ? { width: 704, height: 1280 } : {}),
            ...(sourceImageAssetId ? { sourceImageAssetId } : {}),
          },
        }),
      })
      const data = await res.json() as { result?: HvsGenerateVideoResult; error?: { message?: string } }
      if (data.result) setGeneration(data.result)
      else setNotes([data.error?.message ?? 'Request rejected.'])
    } finally {
      setBusy(false)
      void refresh()
    }
  }

  async function cancel() {
    if (!generation) return
    await fetch('/api/media-command/generate-video', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'cancel', generationId: generation.generationId }),
    })
    void refresh()
  }

  return (
    <article className="hvs-ai-panel" data-testid="hvs-generate-video-panel">
      <h2 className="hvs-ai-kicker">GENERATE VIDEO</h2>
      <p className="hvs-ai-sub" data-testid="hvs-generate-model-status" title={status?.gpu?.reason ?? status?.discovery?.detail ?? ''}>
        <b>{modelLine}</b>
        {status?.gpu?.name ? ` · ${status.gpu.name} · ${status.gpu.freeMiB ?? '?'} / ${status.gpu.totalMiB ?? '?'} MiB free` : ''}
      </p>
      {status && !status.error ? (
        <p className="hvs-ai-sub" data-testid="hvs-generate-install-admission">
          <span data-testid="hvs-generate-install-status">{status.modelInstallLine ?? 'UNKNOWN'}</span>
          {' · '}
          <span data-testid="hvs-generate-gpu-admission">{status.gpuAdmissionLine ?? 'UNKNOWN'}</span>
        </p>
      ) : null}
      {!ready && status?.discovery?.detail ? <p className="hvs-ai-sub" data-testid="hvs-generate-model-detail">{modelLine === 'INSUFFICIENT VRAM' ? status.gpu?.reason : status.discovery.detail}</p> : null}
      <textarea
        className="hvs-ai-prompt"
        data-testid="hvs-generate-prompt"
        rows={2}
        maxLength={WAN22_LIMITS.promptMaxChars}
        placeholder="Generate a 5-second cinematic nighttime city shot."
        value={prompt}
        onChange={e => setPrompt(e.target.value)}
      />
      <div className="hvs-ai-row">
        <label className="hvs-ai-chip">
          Duration{' '}
          <select data-testid="hvs-generate-duration" value={duration} onChange={e => setDuration(Number(e.target.value))}>
            {[1, 2, 3, 4, 5].map(s => <option key={s} value={s}>{s}s</option>)}
          </select>
        </label>
        <label className="hvs-ai-chip">
          <input type="checkbox" checked={vertical} onChange={e => setVertical(e.target.checked)} /> Vertical 704×1280
        </label>
        <label className="hvs-ai-chip">
          Source image{' '}
          <select data-testid="hvs-generate-source-image" value={sourceImageAssetId} onChange={e => setSourceImageAssetId(e.target.value)}>
            <option value="">None (text to video)</option>
            {images.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
      </div>
      <div className="hvs-ai-row">
        <button type="button" className="hvs-ai-btn hvs-ai-btn-ghost" data-testid="hvs-generate-propose" disabled={!prompt.trim()} onClick={() => void fillFromSentence()}>
          Understand sentence
        </button>
        <button type="button" className="hvs-ai-btn" data-testid="hvs-generate-submit" disabled={!ready || busy || prompt.trim().length < WAN22_LIMITS.promptMinChars || Boolean(generation && ACTIVE.has(generation.status))} onClick={() => void generate()}>
          Generate locally
        </button>
        {generation && ACTIVE.has(generation.status) ? (
          <button type="button" className="hvs-ai-btn hvs-ai-btn-ghost" data-testid="hvs-generate-cancel" onClick={() => void cancel()}>Cancel</button>
        ) : null}
      </div>
      <p className="hvs-ai-sub" data-testid="hvs-generate-state">{generationStateLine(generation)}</p>
      {generation?.status === 'COMPLETE' && generation.outputAssetId && projectId ? (
        <Link
          className="hvs-ai-btn hvs-ai-btn-ghost"
          data-testid="hvs-generate-open-source"
          href={`${hvsStudioHref(projectId)}?sourceAsset=${encodeURIComponent(generation.outputAssetId)}`}
        >
          Open in Source monitor
        </Link>
      ) : null}
      {notes.length ? <p className="hvs-ai-sub" data-testid="hvs-generate-notes">{notes.join(' ')}</p> : null}
      <p className="hvs-ai-sub">Runs Wan 2.2 TI2V-5B on this machine. No cloud, no API keys. Results land in your assets; nothing is added to the timeline automatically.</p>
    </article>
  )
}
