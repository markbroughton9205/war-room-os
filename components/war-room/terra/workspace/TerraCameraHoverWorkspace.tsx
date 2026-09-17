'use client'

import { useEffect, useState } from 'react'
import type { TerraGeoFeature } from '@/lib/terra/types'
import { TerraCameraHoverCard } from '../TerraCameraHoverCard'
import { TerraWorkspacePanel } from './TerraWorkspacePanel'
import { useTerraWorkspaceLayoutApi } from './TerraWorkspaceLayoutProvider'

export function TerraCameraHoverWorkspace({
  feature,
  x,
  y,
  onOpen,
  onDismiss,
}: {
  feature: TerraGeoFeature
  x: number
  y: number
  onOpen: () => void
  onDismiss: () => void
}) {
  const [grabbed, setGrabbed] = useState(false)
  const api = useTerraWorkspaceLayoutApi()

  useEffect(() => {
    setGrabbed(false)
  }, [feature.id])

  const pin = () => {
    const size = { width: 288, height: 240 }
    api.store.ensurePanel('camera_hover', api.getViewport(), size)
    api.store.move('camera_hover', Math.max(8, x - 20), Math.max(8, y + 8), api.getViewport(), size, true)
    setGrabbed(true)
  }

  if (!grabbed) {
    return (
      <TerraCameraHoverCard
        feature={feature}
        x={x}
        y={y}
        onOpen={onOpen}
        onDismiss={onDismiss}
        onPin={pin}
      />
    )
  }

  return (
    <TerraWorkspacePanel id="camera_hover" title="Camera">
      <TerraCameraHoverCard
        feature={feature}
        x={0}
        y={0}
        positioned={false}
        onOpen={onOpen}
        onDismiss={() => {
          setGrabbed(false)
          onDismiss()
        }}
      />
    </TerraWorkspacePanel>
  )
}
