'use client'

import { useState } from 'react'
import Link from 'next/link'
import { hvsStudioHref } from '@/lib/media-command/navigation'
import { durationReportLine, formatLabelForAspect, lengthLabel, styleLabel } from '@/lib/media-command/production-language'
import type { HvsWarRoomPacket } from '@/lib/media-command/war-room-hvs-intent'
import type { HvsProductionSession } from '@/lib/media-command/production-ai-types'
import type { HvsProject } from '@/lib/media-command/types'
import { HvsProgramReview } from '@/components/war-room/higher-vision-studios/HvsProgramReview'

type PacketState = {
  packet: HvsWarRoomPacket
  session?: HvsProductionSession | null
  project?: HvsProject | null
}

export function HvsWarRoomProductionCard({
  initial,
}: {
  initial: PacketState
}) {
  const [state, setState] = useState(PacketStateSafe(initial))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [revision, setRevision] = useState('')
  const packet = state.packet
  const session = state.session
  const project = state.project
  const ready = session?.progress.stage === 'ready'
  const failed = session?.progress.stage === 'failed'

  async function post(action: string, extra?: Record<string, unknown>) {
    if (!packet.projectId && action !== 'route') return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/media-command/war-room', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action,
          projectId: packet.projectId,
          conversationId: packet.conversationId,
          prompt: extra?.prompt ?? packet.intent?.prompt,
          utterance: extra?.utterance,
          ...extra,
        }),
      })
      const data = await res.json() as PacketState & { error?: string; session?: HvsProductionSession; project?: HvsProject }
      if (!res.ok) throw new Error(data.error ?? "I couldn't finish the video.")
      setState({
        packet: data.packet ?? packet,
        session: data.session ?? session,
        project: data.project ?? project,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : "I couldn't finish the video.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="message-fade-in mb-4 ml-11 rounded-lg p-3 text-sm"
      data-testid="hvs-war-room-card"
      style={{ background: 'rgba(232,200,114,0.07)', border: '1px solid rgba(232,200,114,0.28)' }}
    >
      <div className="text-xs font-bold tracking-widest" style={{ color: '#E8C872' }}>HIGHER VISION STUDIOS</div>
      {packet.cinemaPlan ? (
        <>
          <p className="mt-2 font-semibold" style={{ color: '#FFF8E8' }}>YOUR SHOTS</p>
          <ol className="mt-1 list-decimal pl-5" style={{ color: '#D1D5DB' }} data-testid="hvs-war-room-shot-list">
            {packet.cinemaPlan.commanderShotList.map(item => (
              <li key={item.shotId}>{item.name} — {item.durationLabel}</li>
            ))}
          </ol>
        </>
      ) : packet.scenePlan ? (
        <>
          <p className="mt-2 font-semibold" style={{ color: '#FFF8E8' }}>I can build that scene.</p>
          <p style={{ color: '#E5E7EB' }}>{packet.scenePlan.durationLabel} · {packet.scenePlan.shotCount} shots · {packet.scenePlan.environmentLabel}</p>
          <p className="mt-2 font-semibold" style={{ color: '#FFF8E8' }}>HVS will:</p>
          <ul className="mt-1 list-disc pl-5" style={{ color: '#D1D5DB' }}>
            {packet.summaryLines.slice(0, 8).map(line => <li key={line}>✓ {line}</li>)}
          </ul>
        </>
      ) : packet.plan ? (
        <>
          <p className="mt-2 font-semibold" style={{ color: '#FFF8E8' }}>HVS understands:</p>
          <p style={{ color: '#E5E7EB' }}>
            {packet.plan.lengthLabel} · {packet.plan.formatLabel} · {packet.plan.styleLabel}
          </p>
          <p className="mt-2 font-semibold" style={{ color: '#FFF8E8' }}>HVS will:</p>
          <ul className="mt-1 list-disc pl-5" style={{ color: '#D1D5DB' }}>
            {packet.summaryLines.slice(0, 6).map(line => <li key={line}>{line.startsWith('Find') || line.startsWith('Build') || line.startsWith('Use') || line.startsWith('Improve') || line.startsWith('Clean') || line.startsWith('Create') ? `✓ ${line}` : line}</li>)}
          </ul>
        </>
      ) : packet.patch ? (
        <p className="mt-2" style={{ color: '#E5E7EB' }}>{packet.patch.summary}</p>
      ) : null}

      {session?.selector?.durationReport ? (
        <p className="mt-2" data-testid="hvs-war-room-duration" style={{ color: '#CBD5E1' }}>
          {durationReportLine(session.selector.durationReport.requestedSec, session.selector.durationReport.createdSec)}
        </p>
      ) : null}

      {project && (ready || (project.timeline.tracks.some(track => track.clips.length > 0))) ? (
        <div className="mt-3">
          <p className="font-semibold" style={{ color: '#FFF8E8' }}>{ready ? 'YOUR VIDEO IS READY' : 'Preview'}</p>
          <HvsProgramReview project={project} />
          {session?.result ? (
            <p className="mt-1 text-xs" style={{ color: '#94A3B8' }}>
              {lengthLabel(session.result.durationSec)} · {formatLabelForAspect(session.result.aspect)} · {styleLabel(session.intent.style)}
            </p>
          ) : null}
        </div>
      ) : null}

      {session?.variants.some(item => item.status === 'ready') ? (
        <div className="mt-3" data-testid="hvs-war-room-variants">
          <p className="font-semibold">YOUR VIDEOS ARE READY</p>
          {session.variants.map(item => (
            <div key={item.id} className="mt-1 flex items-center justify-between gap-2">
              <span>{item.name}</span>
              {item.outputAssetId ? (
                <span className="flex gap-2">
                  <a href={`/api/media-command/assets/${item.outputAssetId}/file`} className="underline">Preview</a>
                  <a href={`/api/media-command/assets/${item.outputAssetId}/file`} className="underline">Save</a>
                </span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {session?.progress.stage && session.progress.stage !== 'idle' && session.progress.stage !== 'ready' ? (
        <p className="mt-2" data-testid="hvs-war-room-progress">{session.progress.headline}</p>
      ) : null}

      {failed || error ? (
        <div className="mt-3" data-testid="hvs-war-room-failure">
          <p>I couldn't finish the video.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => void post('retry')}>Try again</button>
            <button type="button" disabled={busy} onClick={() => void post('plan', { prompt: packet.intent?.prompt })}>Change request</button>
            <button type="button" onClick={() => setError(session?.progress.advancedError ?? error)}>Open details</button>
          </div>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        {packet.approvalAction === 'PREVIEW' ? (
          <>
            <button type="button" data-testid="hvs-war-room-preview-shots" disabled={busy} onClick={() => void post('approve')}>
              {busy ? 'Building preview…' : 'Preview'}
            </button>
            <button type="button" data-testid="hvs-war-room-use-shots" disabled={busy} onClick={() => void post('approve')}>
              Use shots
            </button>
            {packet.projectId ? (
              <Link href={`/higher-vision-studios/camera?project=${encodeURIComponent(packet.projectId)}`} data-testid="hvs-war-room-open-camera">
                Open Camera
              </Link>
            ) : null}
          </>
        ) : null}
        {packet.approvalAction === 'BUILD_SCENE' ? (
          <>
            <button type="button" data-testid="hvs-war-room-build-scene" disabled={busy} onClick={() => void post('approve')}>
              {busy ? 'Building scene…' : 'Build scene'}
            </button>
            {packet.projectId ? (
              <Link href={`/higher-vision-studios/3d-director?project=${encodeURIComponent(packet.projectId)}`} data-testid="hvs-war-room-open-3d">
                Open 3D Director
              </Link>
            ) : null}
          </>
        ) : null}
        {packet.approvalAction === 'MAKE_VIDEO' && !ready ? (
          <button type="button" data-testid="hvs-war-room-make-video" disabled={busy} onClick={() => void post('approve')}>
            {busy ? 'Making video…' : 'Make video'}
          </button>
        ) : null}
        {packet.approvalAction === 'APPLY_CHANGES' ? (
          <button type="button" data-testid="hvs-war-room-apply" disabled={busy} onClick={() => void post('apply-revision')}>
            Apply changes
          </button>
        ) : null}
        {packet.approvalAction === 'CREATE_VERSIONS' || ready ? (
          <button type="button" data-testid="hvs-war-room-create-versions" disabled={busy} onClick={() => void post('create-versions', { utterance: 'Make widescreen, vertical, and square versions.' })}>
            Create versions
          </button>
        ) : null}
        {ready ? (
          <>
            <button type="button" disabled={busy} onClick={() => void post('render')}>Save</button>
            <button type="button" onClick={() => setRevision('Make the opening shorter.')}>Change something</button>
          </>
        ) : null}
        {packet.projectId ? (
          <Link href={`/higher-vision-studios/projects/${packet.projectId}/create`} data-testid="hvs-war-room-open-hvs">Open in HVS</Link>
        ) : null}
        {packet.projectId ? (
          <Link href={hvsStudioHref(packet.projectId)} className="opacity-70">Advanced Editor</Link>
        ) : null}
      </div>

      {ready ? (
        <div className="mt-3">
          <textarea
            value={revision}
            onChange={event => setRevision(event.target.value)}
            placeholder="Make the opening shorter."
            data-testid="hvs-war-room-revision"
            className="w-full rounded bg-black/40 p-2"
          />
          <button type="button" disabled={busy || !revision.trim()} onClick={() => void post('revise', { utterance: revision })}>
            Show the change
          </button>
        </div>
      ) : null}
    </div>
  )
}

function PacketStateSafe(initial: PacketState): PacketState {
  return {
    packet: initial.packet,
    session: initial.session ?? null,
    project: initial.project ?? null,
  }
}
