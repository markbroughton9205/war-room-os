import { WarRoomUiModeProvider } from '@/components/war-room/WarRoomUiModeContext'
import { HvsShell } from '@/components/war-room/higher-vision-studios/HvsShell'
import type { ReactNode } from 'react'

export const dynamic = 'force-dynamic'

export default function HigherVisionStudiosLayout({ children }: { children: ReactNode }) {
  return (
    <WarRoomUiModeProvider>
      <HvsShell>{children}</HvsShell>
    </WarRoomUiModeProvider>
  )
}
