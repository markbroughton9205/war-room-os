'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { IconIntegrate, IconLearn, IconNavigate } from '@/components/war-room/council/CommandIcons'
import { MediaLauncher } from '@/components/war-room/media/MediaLauncher'
import { useTerraActiveLocation } from './TerraActiveLocationContext'

export type CommanderAgentId = 'navigate' | 'learn' | 'integrate'

type AgentRunState = {
  busy: boolean
  status: string
  summary: string
}

const INITIAL_RUN: AgentRunState = { busy: false, status: 'READY', summary: '' }

function parseLatLng(value: string): { latitude: number; longitude: number } | null {
  const match = value.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/)
  if (!match) return null
  const latitude = Number(match[1])
  const longitude = Number(match[2])
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null
  return { latitude, longitude }
}

const AGENTS: Array<{
  id: CommanderAgentId
  label: string
  title: string
  glow: string
  Icon: typeof IconNavigate
}> = [
  { id: 'navigate', label: 'Navigate', title: 'Plan a route', glow: 'rgba(34, 211, 238, 0.55)', Icon: IconNavigate },
  { id: 'learn', label: 'Learn', title: 'Learn a world topic', glow: 'rgba(52, 211, 153, 0.55)', Icon: IconLearn },
  { id: 'integrate', label: 'Integrate', title: 'Run a bounded agent handoff', glow: 'rgba(167, 139, 250, 0.55)', Icon: IconIntegrate },
]

function resultStatus(json: { result?: { status?: string }; error?: string }, ok: boolean) {
  return json.result?.status ?? json.error ?? (ok ? 'OK' : 'ERROR')
}

export function CommanderAgentDock({
  placement = 'overlay',
}: {
  placement?: 'overlay' | 'rail'
}) {
  const { activeLocation } = useTerraActiveLocation()
  const rootRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState<CommanderAgentId | null>(null)
  const [destination, setDestination] = useState('')
  const [topic, setTopic] = useState('')
  const [navigate, setNavigate] = useState<AgentRunState>(INITIAL_RUN)
  const [learn, setLearn] = useState<AgentRunState>(INITIAL_RUN)
  const [integrate, setIntegrate] = useState<AgentRunState>(INITIAL_RUN)

  const runState = open === 'navigate' ? navigate : open === 'learn' ? learn : integrate

  const close = useCallback(() => setOpen(null), [])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onPointer)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onPointer)
    }
  }, [close, open])

  async function runNavigate() {
    const dest = parseLatLng(destination)
    if (!dest && !activeLocation) {
      setNavigate({
        busy: false,
        status: 'NEED_INPUT',
        summary: 'Enter a destination as latitude, longitude, or pin a Terra location first.',
      })
      return
    }
    const origin = activeLocation
      ? { latitude: activeLocation.latitude, longitude: activeLocation.longitude }
      : dest
    const destinationPoint = dest ?? origin
    setNavigate({ busy: true, status: 'RUNNING', summary: 'Planning route…' })
    try {
      const res = await fetch('/api/ascension/navigation-agent/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          task_type: 'PLAN_ROUTE',
          origin,
          destination: destinationPoint,
          location_source: activeLocation ? 'terra' : 'explicit_input',
          use_fixture: true,
        }),
      })
      const json = (await res.json()) as { result?: { status?: string; summary?: string }; error?: string }
      setNavigate({
        busy: false,
        status: resultStatus(json, res.ok),
        summary: json.result?.summary ?? json.error ?? 'No route returned.',
      })
    } catch (err) {
      setNavigate({ busy: false, status: 'ERROR', summary: err instanceof Error ? err.message : 'Request failed' })
    }
  }

  async function runLearn() {
    const nextTopic = topic.trim()
    if (!nextTopic) {
      setLearn({ busy: false, status: 'NEED_INPUT', summary: 'Enter a topic to learn.' })
      return
    }
    setLearn({ busy: true, status: 'RUNNING', summary: 'Learning topic…' })
    try {
      const res = await fetch('/api/ascension/world-learning-agent/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          task_type: 'LEARN_TOPIC',
          topic: nextTopic,
          use_fixture: true,
          internet_available: true,
          live_search_allowed: false,
        }),
      })
      const json = (await res.json()) as { result?: { status?: string; summary?: string }; error?: string }
      setLearn({
        busy: false,
        status: resultStatus(json, res.ok),
        summary: json.result?.summary ?? json.error ?? 'No learning result returned.',
      })
    } catch (err) {
      setLearn({ busy: false, status: 'ERROR', summary: err instanceof Error ? err.message : 'Request failed' })
    }
  }

  async function runIntegrate() {
    setIntegrate({ busy: true, status: 'RUNNING', summary: 'Running bounded handoff…' })
    try {
      const res = await fetch('/api/ascension/integration/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workflow_kind: 'KNOWLEDGE_PIPELINE',
          use_fixture: true,
          internet_available: true,
          live_search_allowed: false,
        }),
      })
      const json = (await res.json()) as {
        result?: { status?: string; summary?: string; workflow?: { status?: string; summary?: string } }
        error?: string
      }
      setIntegrate({
        busy: false,
        status: json.result?.workflow?.status ?? json.result?.status ?? json.error ?? (res.ok ? 'OK' : 'ERROR'),
        summary: json.result?.workflow?.summary ?? json.result?.summary ?? json.error ?? 'No integration result returned.',
      })
    } catch (err) {
      setIntegrate({ busy: false, status: 'ERROR', summary: err instanceof Error ? err.message : 'Request failed' })
    }
  }

  const overlay = placement === 'overlay'
  const busyId = navigate.busy ? 'navigate' : learn.busy ? 'learn' : integrate.busy ? 'integrate' : null

  return (
    <div
      ref={rootRef}
      className={
        overlay
          ? 'pointer-events-none absolute inset-y-2 right-2 z-30 flex max-h-full items-start justify-end gap-2'
          : 'pointer-events-auto flex w-full min-w-0 flex-col items-stretch gap-2'
      }
      data-testid="commander-agent-dock"
    >
      <div className={`pointer-events-auto flex ${overlay ? 'flex-row-reverse items-start gap-2' : 'flex-col gap-2'}`}>
        <div
          className={`flex shrink-0 ${overlay ? 'flex-col' : 'flex-row'} gap-1.5`}
          role="toolbar"
          aria-label="Terra command tools"
        >
          {AGENTS.map(agent => {
            const selected = open === agent.id
            const state = busyId === agent.id ? 'active' : selected ? 'selected' : 'idle'
            return (
              <button
                key={agent.id}
                type="button"
                className="flex flex-col items-center gap-0.5"
                data-testid={`commander-agent-${agent.id}`}
                aria-label={agent.title}
                aria-pressed={selected}
                title={agent.title}
                onClick={() => setOpen(current => (current === agent.id ? null : agent.id))}
              >
                <span
                  className="commander-agent-icon grid h-9 w-9 place-items-center rounded-full border bg-slate-950/80 backdrop-blur-xl"
                  style={{
                    ['--commander-agent-glow' as string]: agent.glow,
                    borderColor: selected ? 'rgba(255,255,255,0.45)' : 'rgba(148,163,184,0.28)',
                    color: selected ? '#e2e8f0' : '#94a3b8',
                  }}
                  data-state={state}
                >
                  <agent.Icon size={15} />
                </span>
                <span className={`text-[7px] font-bold uppercase tracking-[0.16em] ${selected ? 'text-cyan-100' : 'text-slate-400'}`}>
                  {agent.label}
                </span>
              </button>
            )
          })}
          {overlay ? <MediaLauncher variant="dock" layout="stack" /> : null}
        </div>
        {!overlay ? <MediaLauncher variant="dock" layout="rail" /> : null}

        {open ? (
          <section
            className="flex min-h-0 max-h-full w-[min(19rem,calc(100vw-4.5rem))] flex-col overflow-hidden rounded-xl border border-white/15 bg-[rgba(2,8,14,0.92)] shadow-[0_12px_40px_rgba(0,0,0,0.45)] backdrop-blur-xl"
            data-testid="commander-agent-panel"
            data-agent={open}
          >
            <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-cyan-200">
                {AGENTS.find(agent => agent.id === open)?.label}
              </p>
              <button
                type="button"
                onClick={close}
                className="rounded px-1.5 py-0.5 text-[10px] uppercase tracking-widest text-slate-400 hover:text-slate-200"
                aria-label="Close agent panel"
              >
                Close
              </button>
            </div>
            <div className="min-h-0 max-h-[min(16rem,calc(100%-2.5rem))] space-y-2 overflow-y-auto overscroll-contain px-3 py-2">
              {open === 'navigate' ? (
                <>
                  <p className="text-[11px] leading-snug text-slate-400">
                    {activeLocation
                      ? `Origin: ${activeLocation.label}`
                      : 'Pin a Terra location or enter destination coordinates.'}
                  </p>
                  <label className="block text-[10px] text-slate-300">
                    Destination (lat, lng)
                    <input
                      value={destination}
                      onChange={event => setDestination(event.target.value)}
                      placeholder="60.1745, 24.9455"
                      className="mt-1 w-full rounded border border-white/15 bg-black/50 px-2 py-1.5 text-[12px] text-cyan-100 outline-none"
                    />
                  </label>
                  <button
                    type="button"
                    disabled={navigate.busy}
                    onClick={() => void runNavigate()}
                    className="w-full rounded border border-cyan-400/40 bg-cyan-950/40 px-2 py-1.5 text-[10px] font-bold uppercase tracking-widest text-cyan-100 disabled:opacity-50"
                  >
                    {navigate.busy ? 'Planning…' : 'Plan route'}
                  </button>
                </>
              ) : null}
              {open === 'learn' ? (
                <>
                  <p className="text-[11px] leading-snug text-slate-400">Learn a world topic. Candidates only — no training.</p>
                  <label className="block text-[10px] text-slate-300">
                    Topic
                    <input
                      value={topic}
                      onChange={event => setTopic(event.target.value)}
                      placeholder="Helsinki harbor traffic"
                      className="mt-1 w-full rounded border border-white/15 bg-black/50 px-2 py-1.5 text-[12px] text-emerald-100 outline-none"
                    />
                  </label>
                  <button
                    type="button"
                    disabled={learn.busy}
                    onClick={() => void runLearn()}
                    className="w-full rounded border border-emerald-400/40 bg-emerald-950/40 px-2 py-1.5 text-[10px] font-bold uppercase tracking-widest text-emerald-100 disabled:opacity-50"
                  >
                    {learn.busy ? 'Learning…' : 'Learn topic'}
                  </button>
                </>
              ) : null}
              {open === 'integrate' ? (
                <>
                  <p className="text-[11px] leading-snug text-slate-400">
                    Bounded knowledge handoff. No commit, push, deploy, or SQL.
                  </p>
                  <button
                    type="button"
                    disabled={integrate.busy}
                    onClick={() => void runIntegrate()}
                    className="w-full rounded border border-violet-400/40 bg-violet-950/40 px-2 py-1.5 text-[10px] font-bold uppercase tracking-widest text-violet-100 disabled:opacity-50"
                  >
                    {integrate.busy ? 'Running…' : 'Run handoff'}
                  </button>
                </>
              ) : null}
              {runState.status !== 'READY' || runState.summary ? (
                <div className="rounded border border-white/10 bg-black/40 px-2 py-1.5">
                  <p className="font-mono text-[10px] uppercase tracking-widest text-amber-200">{runState.status}</p>
                  {runState.summary ? <p className="mt-1 text-[11px] leading-snug text-slate-300">{runState.summary}</p> : null}
                </div>
              ) : null}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  )
}
