'use client'

import { useEffect, useState } from 'react'

type UnrealStatus = {
  engine: 'DETECTED' | 'NOT_INSTALLED' | 'READY' | 'ERROR'
  characterBinding: 'NOT_BOUND' | 'BOUND'
  scenePackage: 'READY' | 'STALE'
  runtime: 'NOT_INSTALLED' | 'DETECTED' | 'ERROR' | 'READY'
  executionProject?: 'MISSING' | 'READY'
  motion?: 'PROTOTYPE' | 'TAKE 3 IMPORTED'
  sequencer?: 'MISSING' | 'READY'
}

const ENGINE_LABEL = {
  DETECTED: 'DETECTED',
  NOT_INSTALLED: 'NOT INSTALLED',
  READY: 'READY',
  ERROR: 'ERROR',
} as const

export function HvsUnrealExecutionStatus({ projectId }: { projectId: string | null }) {
  const [status, setStatus] = useState<UnrealStatus | null>(null)

  useEffect(() => {
    const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''
    let cancelled = false
    void fetch(`/api/media-command/unreal${query}`)
      .then(async response => {
        const body = await response.json() as UnrealStatus
        if (!cancelled) setStatus(response.ok ? body : { ...body, engine: 'ERROR', runtime: 'ERROR' })
      })
      .catch(() => {
        if (!cancelled) setStatus({ engine: 'ERROR', characterBinding: 'NOT_BOUND', scenePackage: 'STALE', runtime: 'ERROR', executionProject: 'MISSING', motion: 'PROTOTYPE', sequencer: 'MISSING' })
      })
    return () => {
      cancelled = true
    }
  }, [projectId])

  const engine = status?.engine ?? 'ERROR'
  return (
    <div data-testid="hvs-unreal-execution">
      <h2>HIGH-FIDELITY ENGINE</h2>
      <p data-testid="hvs-unreal-engine">Unreal Engine: {status ? ENGINE_LABEL[engine] : '…'}</p>
      <p data-testid="hvs-unreal-execution-project">Execution project: {status?.executionProject === 'READY' ? 'READY' : 'MISSING'}</p>
      <p data-testid="hvs-unreal-previs">Browser previs: Three.js</p>
      <p data-testid="hvs-unreal-binding">Character binding: {status?.characterBinding === 'BOUND' ? 'BOUND' : 'NOT BOUND'}</p>
      <p data-testid="hvs-unreal-motion">Motion: {status?.motion === 'TAKE 3 IMPORTED' ? 'TAKE 3 IMPORTED' : (status ? 'PROTOTYPE' : '…')}</p>
      <p data-testid="hvs-unreal-sequencer">Sequencer: {status?.sequencer === 'READY' ? 'READY' : 'MISSING'}</p>
      <p data-testid="hvs-unreal-package">Scene package: {status?.scenePackage ?? 'STALE'}</p>
    </div>
  )
}
