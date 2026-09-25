'use client'

import { useEffect, useState, type KeyboardEvent, type RefObject } from 'react'
import {
  FOUNDRY_COMPOSER_MODES,
  type ContextSourceView,
  type FoundryComposerMode,
  type ModelRegistryView,
} from '@/lib/native-builder/foundryComposerModel'

/**
 * Foundry's main command surface. Everything here is connected to something real:
 * modes route to real mission-controller behavior, the model chip shows the real registry (only
 * Foundry Auto is selectable), and the Context menu offers only sources that already exist.
 */

const DOT: Record<string, string> = {
  ready: 'bg-emerald-400',
  starting: 'bg-amber-300',
  limited: 'bg-amber-300',
  configured: 'bg-cyan-400',
  unavailable: 'bg-red-400',
  'not configured': 'bg-slate-600',
  unknown: 'bg-slate-500',
}

function Popover({ children, onClose, testId, wide }: { children: React.ReactNode; onClose: () => void; testId: string; wide?: boolean }) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} aria-hidden="true" />
      <div
        data-testid={testId}
        className={`absolute bottom-full left-0 z-50 mb-2 ${wide ? 'w-[22rem]' : 'w-72'} max-w-[calc(100vw-2rem)] rounded-lg bg-[#070d0b] p-2 text-[12px] shadow-[0_8px_30px_rgba(0,0,0,0.6)] ring-1 ring-white/10`}
      >
        {children}
      </div>
    </>
  )
}

export function FoundryComposer({
  request,
  onRequestChange,
  promptRef,
  onSend,
  onStop,
  busy,
  hasMission,
  missionRunning,
  mode,
  onModeChange,
  registry,
  context,
  onInsertContext,
  localReady,
  webReady,
  terminalOpen,
  onToggleTerminal,
  modelMenuSignal,
}: {
  request: string
  onRequestChange: (value: string) => void
  promptRef: RefObject<HTMLTextAreaElement | null>
  onSend: () => void
  onStop: () => void
  busy: string | null
  hasMission: boolean
  missionRunning: boolean
  mode: FoundryComposerMode
  onModeChange: (mode: FoundryComposerMode) => void
  registry: ModelRegistryView
  context: ContextSourceView
  onInsertContext: (reference: string) => void
  localReady: boolean
  webReady: boolean
  terminalOpen: boolean
  onToggleTerminal: () => void
  /** Increment to open the model popover from elsewhere (e.g. the provider-unavailable intervention). */
  modelMenuSignal?: number
}) {
  const [menu, setMenu] = useState<'model' | 'context' | null>(null)

  useEffect(() => {
    const el = promptRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`
  }, [request, promptRef])

  useEffect(() => {
    if (modelMenuSignal) queueMicrotask(() => setMenu('model'))
  }, [modelMenuSignal])

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      onSend()
    }
  }

  const chip = 'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11.5px] text-slate-300 hover:bg-white/[0.06]'
  const currentDot = DOT[registry.current.state] ?? DOT.unknown
  const modeMeta = FOUNDRY_COMPOSER_MODES.find(item => item.id === mode)

  return (
    <div className="relative" data-testid="foundry-composer" data-composer-mode={mode}>
      <div className="rounded-xl bg-white/[0.035] ring-1 ring-white/10 focus-within:ring-emerald-400/30">
        <textarea
          ref={promptRef}
          data-testid="foundry-chat-input"
          rows={2}
          className="block max-h-[220px] w-full resize-none bg-transparent px-3.5 pb-1 pt-3 text-[14px] leading-[1.5] text-slate-100 outline-none placeholder:text-slate-500"
          placeholder={mode === 'ask' ? 'Ask Foundry about this project…' : 'Tell Foundry the result you want…'}
          value={request}
          onChange={event => onRequestChange(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="flex flex-wrap items-center gap-1 px-2 pb-2">
          <div className="inline-flex rounded-md bg-black/30 p-0.5" role="radiogroup" aria-label="Foundry mode" data-testid="foundry-mode-selector">
            {FOUNDRY_COMPOSER_MODES.map(item => (
              <button
                key={item.id}
                type="button"
                role="radio"
                aria-checked={mode === item.id}
                title={item.hint}
                data-testid={`foundry-mode-${item.id}`}
                className={`rounded px-2 py-0.5 text-[11.5px] ${mode === item.id ? 'bg-white/[0.1] text-slate-100' : 'text-slate-500 hover:text-slate-300'}`}
                onClick={() => onModeChange(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="relative">
            <button type="button" className={chip} data-testid="foundry-model-selector" aria-haspopup="listbox" aria-expanded={menu === 'model'} onClick={() => setMenu(menu === 'model' ? null : 'model')}>
              <span className={`h-1.5 w-1.5 rounded-full ${currentDot}`} aria-hidden="true" />
              {registry.current.label}
              <span className="text-slate-500">{registry.current.locality === 'unknown' ? '' : registry.current.locality === 'local' ? 'Local' : 'Cloud'}</span>
              <span aria-hidden="true" className="text-[9px] text-slate-500">▾</span>
            </button>
            {menu === 'model' ? (
              <Popover onClose={() => setMenu(null)} testId="foundry-model-menu" wide>
                <p className="px-1.5 pb-1 text-[10.5px] uppercase tracking-widest text-slate-500">Models</p>
                <ul className="space-y-0.5" role="listbox">
                  {registry.entries.map(entry => (
                    <li key={entry.id} role="option" aria-selected={entry.selected} aria-disabled={!entry.selectable} data-testid="foundry-model-entry" data-model-id={entry.id} className={`flex items-start gap-2 rounded px-1.5 py-1 ${entry.selected ? 'bg-white/[0.06]' : ''} ${entry.selectable ? '' : 'opacity-80'}`}>
                      <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${DOT[entry.state] ?? DOT.unknown}`} aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-slate-100">{entry.label} <span className="text-slate-500">{entry.locality === 'auto' ? '' : entry.locality === 'local' ? 'Local' : 'Cloud'}</span></span>
                        <span className="block truncate text-[11px] text-slate-500">{entry.state} · {entry.detail}</span>
                      </span>
                      {entry.selected ? <span className="text-[11px] text-emerald-300">✓</span> : null}
                    </li>
                  ))}
                </ul>
                <p className="px-1.5 pt-1.5 text-[10.5px] leading-snug text-slate-500">Foundry Auto chooses the worker for each task. Direct model selection is not connected yet, so other models are shown for status only.</p>
              </Popover>
            ) : null}
          </div>

          <div className="relative">
            <button type="button" className={chip} data-testid="foundry-context-button" aria-haspopup="menu" aria-expanded={menu === 'context'} onClick={() => setMenu(menu === 'context' ? null : 'context')}>
              <span aria-hidden="true" className="text-[13px] leading-none">+</span> Context
            </button>
            {menu === 'context' ? (
              <Popover onClose={() => setMenu(null)} testId="foundry-context-menu">
                {context.filesState === 'loading' && !context.connected.some(source => source.id === 'files') ? <p className="px-1.5 py-1 text-slate-500" data-testid="foundry-context-loading">Loading project files…</p> : null}
                {context.filesState === 'unavailable' && !context.connected.some(source => source.id === 'files') ? <p className="px-1.5 py-1 text-slate-500" data-testid="foundry-context-unavailable">Project files are unavailable right now.</p> : null}
                {context.filesState === 'ready' && context.connected.length === 0 ? <p className="px-1.5 py-1 text-slate-500" data-testid="foundry-context-empty">No project files yet.</p> : null}
                {context.connected.map(source => (
                  <div key={source.id} className="mb-1">
                    <p className="px-1.5 pb-0.5 text-[10.5px] uppercase tracking-widest text-slate-500">{source.label} <span className="text-slate-600">{source.count}</span></p>
                    <ul className="max-h-40 overflow-auto">
                      {source.paths.slice(0, 40).map(file => (
                        <li key={`${source.id}-${file}`}>
                          <button type="button" data-testid="foundry-context-item" className="w-full truncate rounded px-1.5 py-0.5 text-left font-mono text-[11.5px] text-slate-300 hover:bg-white/[0.06]" onClick={() => { onInsertContext(file); setMenu(null) }}>{file}</button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
                <p className="px-1.5 pt-1 text-[10.5px] leading-snug text-slate-600" data-testid="foundry-context-not-connected">Not connected yet: {context.notConnected.join(', ')}.</p>
              </Popover>
            ) : null}
          </div>

          <div className="ml-auto flex items-center gap-1" title={modeMeta?.hint}>
          <span className="mr-1 hidden items-center gap-2.5 whitespace-nowrap text-[10.5px] text-slate-500 md:inline-flex" data-testid="foundry-composer-indicators">
            <span className="inline-flex items-center gap-1" title={localReady ? 'Local model ready' : 'Local model not ready'}><span className={`h-1 w-1 rounded-full ${localReady ? 'bg-emerald-400' : 'bg-slate-600'}`} />Local</span>
            <span className="inline-flex items-center gap-1" title={webReady ? 'Web research ready' : 'Web research not confirmed'}><span className={`h-1 w-1 rounded-full ${webReady ? 'bg-emerald-400' : 'bg-slate-600'}`} />Web</span>
            <button type="button" className={`inline-flex items-center gap-1 hover:text-slate-300 ${terminalOpen ? 'text-slate-200' : ''}`} onClick={onToggleTerminal} title="Show or hide the terminal"><span className={`h-1 w-1 rounded-full ${terminalOpen ? 'bg-emerald-400' : 'bg-slate-600'}`} />Terminal</button>
          </span>

          {hasMission ? (
            <button
              type="button"
              data-testid="foundry-stop"
              disabled={busy !== null}
              className={`whitespace-nowrap rounded-md px-2 py-1 text-[11.5px] ${missionRunning ? 'text-amber-200 hover:bg-white/[0.06]' : 'text-slate-600'}`}
              onClick={onStop}
              title="Stop the current mission"
            >
              ■ Stop
            </button>
          ) : null}
          <button
            type="button"
            data-testid="foundry-send"
            aria-label="Send"
            disabled={busy !== null}
            className="grid h-7 w-7 place-items-center rounded-lg bg-emerald-400/90 text-[14px] font-bold text-black hover:bg-emerald-300 disabled:opacity-40"
            onClick={onSend}
          >
            ↑
          </button>
          </div>
        </div>
      </div>
    </div>
  )
}
