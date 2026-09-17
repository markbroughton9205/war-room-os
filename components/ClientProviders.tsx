'use client'

import type { ReactNode } from 'react'

import { MediaHost } from '@/components/war-room/media/MediaHost'
import { MediaPlaybackProvider } from '@/components/war-room/media/MediaPlaybackProvider'
import { ManualCopyProvider } from '@/components/war-room/operator/ManualCopyProvider'

export function ClientProviders({ children }: { children: ReactNode }) {
  return (
    <ManualCopyProvider>
      <MediaPlaybackProvider>
        {children}
        <MediaHost />
      </MediaPlaybackProvider>
    </ManualCopyProvider>
  )
}
