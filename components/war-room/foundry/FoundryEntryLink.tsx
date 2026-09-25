'use client'

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import Link from 'next/link'
import { FOUNDRY_CANONICAL_PATH, readFoundryResumeHref } from '@/lib/native-builder/foundryNavigation'

/** Home-screen Foundry entry that restores the last project/session/mission. */
export function FoundryEntryLink({
  className,
  children,
  testId = 'nav-foundry',
  style,
  ariaLabel = 'Foundry',
}: {
  className?: string
  children: ReactNode
  testId?: string
  style?: CSSProperties
  ariaLabel?: string
}) {
  const [href, setHref] = useState(FOUNDRY_CANONICAL_PATH)
  useEffect(() => {
    queueMicrotask(() => setHref(readFoundryResumeHref()))
  }, [])
  return (
    <Link href={href} data-testid={testId} className={className} style={style} aria-label={ariaLabel}>
      {children}
    </Link>
  )
}
