'use client'

import type { ReactNode } from 'react'

import { ManualCopyProvider } from '@/components/war-room/operator/ManualCopyProvider'

export function ClientProviders({ children }: { children: ReactNode }) {
  return <ManualCopyProvider>{children}</ManualCopyProvider>
}
