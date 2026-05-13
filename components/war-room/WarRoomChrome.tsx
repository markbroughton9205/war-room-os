'use client'

import type { ReactNode } from 'react'
import { Sidebar } from './Sidebar'
import { StatusBar } from './StatusBar'
import { CommandBar } from './CommandBar'

export function WarRoomChrome({ children }: { children: ReactNode }) {
  return (
    <div className="relative z-10 flex min-h-screen flex-col">
      <div className="flex min-h-0 flex-1 flex-row">
        <Sidebar />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <main className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">{children}</main>
            <CommandBar />
          </div>
        </div>
      </div>
      <StatusBar />
    </div>
  )
}
