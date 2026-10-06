'use client'

import type { ReactNode } from 'react'

import { MediaHost } from '@/components/war-room/media/MediaHost'
import { MediaPlaybackProvider } from '@/components/war-room/media/MediaPlaybackProvider'
import { ManualCopyProvider } from '@/components/war-room/operator/ManualCopyProvider'
import { ApplicationActivityGovernor } from '@/components/war-room/ApplicationActivityGovernor'
import { WarRoomBrowserProvider } from '@/components/war-room/browser/WarRoomBrowserProvider'
import { CouncilSourceNavigationProvider } from '@/components/council/CouncilSourceNavigation'

export function ClientProviders({ children }: { children: ReactNode }) {
  return (
    <ApplicationActivityGovernor>
      <ManualCopyProvider>
        <MediaPlaybackProvider>
          <WarRoomBrowserProvider>
            <CouncilSourceNavigationProvider>
              {children}
              <MediaHost />
            </CouncilSourceNavigationProvider>
          </WarRoomBrowserProvider>
        </MediaPlaybackProvider>
      </ManualCopyProvider>
    </ApplicationActivityGovernor>
  )
}
