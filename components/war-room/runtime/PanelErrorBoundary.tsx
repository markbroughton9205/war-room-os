'use client'

import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = {
  label: string
  children: ReactNode
  /** Optional extra reassurance line shown under the failure message (e.g. "no approval action was executed"). */
  note?: string
}

type State = {
  error: string | null
}

export class PanelErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error: error.message || 'Panel render failed' }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[war-room] panel isolated failure', {
      panel: this.props.label,
      error: error.message,
      componentStack: info.componentStack,
    })
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <section className="mx-auto mt-14 max-w-6xl rounded border border-amber-400/25 bg-amber-950/20 p-4 text-sm text-amber-100">
        <div className="text-[10px] font-semibold uppercase tracking-[0.35em] text-amber-200/80">
          Isolated degraded panel
        </div>
        <h2 className="mt-2 text-lg font-semibold text-white">{this.props.label}</h2>
        <p className="mt-2 text-xs leading-relaxed text-amber-100/80">
          This panel failed without destabilizing the War Room dashboard. Runtime truth label: DEGRADED.
        </p>
        <p className="mt-2 rounded border border-white/10 bg-black/30 p-2 font-mono text-[11px] text-white/65">
          {this.state.error}
        </p>
        {this.props.note ? (
          <p className="mt-2 text-xs leading-relaxed text-amber-100/80">{this.props.note}</p>
        ) : null}
      </section>
    )
  }
}
