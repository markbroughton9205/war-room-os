'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { mapPlayheadToSource } from '@/lib/media-command/preview-engine'
import { timelineDuration, type HvsProject } from '@/lib/media-command/types'
import { toSeconds } from '@/lib/media-command/time'
import { uniqueCaptionCues } from '@/lib/media-command/captions'
import { resolveCaptionStyle } from '@/lib/media-command/text-layout'
import type { TranscriptDocument, TranscriptSearchHit } from '@/lib/media-command/transcript'

function fmtClock(sec: number): string {
  const m = Math.floor(Math.max(0, sec) / 60)
  const s = Math.floor(Math.max(0, sec) % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function HvsProgramReview({
  project,
}: {
  project: HvsProject
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [playing, setPlaying] = useState(false)
  const [playhead, setPlayhead] = useState(0)
  const [transcripts, setTranscripts] = useState<TranscriptDocument[]>([])
  const [hits, setHits] = useState<TranscriptSearchHit[]>([])
  const [query, setQuery] = useState('')
  const duration = Math.max(0.1, toSeconds(timelineDuration(project.timeline)))
  const frame = useMemo(() => mapPlayheadToSource(project, playhead), [project, playhead])
  const src = frame.clip
    ? `/api/media-command/assets/${frame.clip.assetId}/file?kind=proxy`
    : null
  const cues = uniqueCaptionCues(project.timeline.captionTracks[0]?.cues ?? [])
  const activeCue = cues.find(cue => playhead >= toSeconds(cue.start) && playhead < toSeconds(cue.end)) ?? null
  const captionStyle = activeCue
    ? resolveCaptionStyle(activeCue, project.timeline.captionTracks[0], null)
    : null

  useEffect(() => {
    const assets = project.assets.filter(asset => asset.kind === 'video' || asset.kind === 'audio')
    void Promise.all(assets.map(async asset => {
      const res = await fetch(`/api/media-command/asr?projectId=${encodeURIComponent(project.id)}&assetId=${encodeURIComponent(asset.id)}`)
      const data = await res.json() as { transcript?: TranscriptDocument | null }
      return data.transcript
    })).then(rows => setTranscripts(rows.filter((doc): doc is TranscriptDocument => Boolean(doc?.segments?.length))))
      .catch(() => undefined)
  }, [project.id, project.assets])

  useEffect(() => {
    if (!playing) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(0.25, (now - last) / 1000)
      last = now
      setPlayhead(prev => {
        const next = prev + dt
        if (next >= duration) {
          setPlaying(false)
          return duration
        }
        return next
      })
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, duration])

  useEffect(() => {
    const el = videoRef.current
    if (!el) return
    if (playing) void el.play().catch(() => undefined)
    else el.pause()
  }, [playing, src])

  useEffect(() => {
    const el = videoRef.current
    if (!el || !frame.clip) return
    if (Math.abs(el.currentTime - frame.sourceSeconds) > 0.18) {
      try { el.currentTime = Math.max(0, frame.sourceSeconds) } catch { /* seek later */ }
    }
  }, [frame])

  function toggle() {
    if (playhead >= duration - 0.05) setPlayhead(0)
    setPlaying(value => !value)
  }

  function onSeek(value: number) {
    setPlayhead(Math.max(0, Math.min(duration, value)))
  }

  function fullscreen() {
    const node = wrapRef.current
    if (!node) return
    if (document.fullscreenElement) void document.exitFullscreen()
    else void node.requestFullscreen().catch(() => undefined)
  }

  async function searchSpeech() {
    const needle = query.trim()
    if (!needle || !transcripts[0]) {
      setHits([])
      return
    }
    const res = await fetch(`/api/media-command/asr?projectId=${encodeURIComponent(project.id)}&assetId=${encodeURIComponent(transcripts[0].assetId)}&q=${encodeURIComponent(needle)}`)
    const data = await res.json() as { hits?: TranscriptSearchHit[] }
    setHits(data.hits ?? [])
    if (data.hits?.[0]) onSeek(toSeconds(data.hits[0].timestamp))
  }

  const lines = transcripts.flatMap(doc => doc.segments.filter(seg => seg.text.trim()))

  return (
    <div ref={wrapRef} className="hvs-program-review" data-testid="hvs-program-review">
      <div className="hvs-program-review-stage">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video
          ref={videoRef}
          key={frame.clip?.assetId ?? 'empty'}
          src={src ?? undefined}
          playsInline
          muted={false}
          data-testid="hvs-ai-preview-player"
          onClick={toggle}
        />
        {activeCue && captionStyle ? (
          <div
            data-testid="hvs-program-caption"
            className="hvs-program-review-caption"
            style={{
              top: `${captionStyle.y * 100}%`,
              color: captionStyle.color,
              background: captionStyle.background ?? undefined,
              fontWeight: captionStyle.fontWeight,
              fontSize: Math.max(16, captionStyle.fontSize * 0.55),
            }}
          >
            {activeCue.text}
          </div>
        ) : null}
      </div>
      <div className="hvs-program-review-bar">
        <button type="button" data-testid="hvs-program-review-play" onClick={toggle}>
          {playing ? 'Pause' : 'Play'}
        </button>
        <input
          type="range"
          min={0}
          max={duration}
          step={0.05}
          value={playhead}
          data-testid="hvs-program-review-seek"
          onChange={event => onSeek(Number(event.target.value))}
        />
        <button type="button" data-testid="hvs-program-review-fullscreen" onClick={fullscreen}>
          Fullscreen
        </button>
      </div>
      {lines.length ? (
        <div className="hvs-program-transcript" data-testid="hvs-transcript">
          <p className="hvs-ai-sub">TRANSCRIPT</p>
          <div className="hvs-ai-row">
            <input
              className="hvs-ai-prompt"
              data-testid="hvs-speech-search"
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Find where I say…"
            />
            <button type="button" className="hvs-ai-btn" onClick={() => void searchSpeech()}>Find</button>
          </div>
          {(hits.length ? hits.map(hit => ({ start: hit.timestamp, text: hit.text })) : lines).map((row, i) => (
            <button
              key={`${toSeconds(row.start)}-${i}`}
              type="button"
              className="hvs-transcript-line"
              data-testid="hvs-transcript-line"
              onClick={() => onSeek(toSeconds(row.start))}
            >
              <span>{fmtClock(toSeconds(row.start))}</span>
              <span>{row.text}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
