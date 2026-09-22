'use client'

import { useEffect, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'

import { updateApplicationActivity } from '@/lib/ui/applicationActivity'

export function ApplicationActivityGovernor({ children }: { children: ReactNode }) {
  const pathname = usePathname()

  useEffect(() => {
    const update = () => updateApplicationActivity(pathname || '')
    update()
    window.addEventListener('focus', update)
    window.addEventListener('blur', update)
    document.addEventListener('visibilitychange', update)
    return () => {
      window.removeEventListener('focus', update)
      window.removeEventListener('blur', update)
      document.removeEventListener('visibilitychange', update)
    }
  }, [pathname])

  return children
}
