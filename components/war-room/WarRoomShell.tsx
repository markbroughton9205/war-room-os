import type { ReactNode } from 'react'
import { MatrixBackground } from './MatrixBackground'
import { WarRoomChrome } from './WarRoomChrome'

export function WarRoomShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#020617] font-sans text-slate-100 antialiased">
      <MatrixBackground />
      <WarRoomChrome>{children}</WarRoomChrome>
    </div>
  )
}
