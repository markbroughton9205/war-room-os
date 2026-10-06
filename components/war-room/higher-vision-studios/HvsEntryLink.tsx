'use client'

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import Link from 'next/link'
import { HVS_CANONICAL_PATH, isInstalledRelativeHref, readHvsResumeHref } from '@/lib/media-command/navigation'

export function HvsEntryLink({
  className,
  children,
  testId = 'nav-higher-vision-studios',
  style,
  ariaLabel = 'Higher Vision Studios',
  href,
}: {
  className?: string
  children: ReactNode
  testId?: string
  style?: CSSProperties
  ariaLabel?: string
  href?: string
}) {
  const fallback = href && isInstalledRelativeHref(href) ? href : HVS_CANONICAL_PATH
  const [resolved, setResolved] = useState(fallback)
  useEffect(() => {
    queueMicrotask(() => {
      if (href && isInstalledRelativeHref(href)) {
        setResolved(href)
        return
      }
      const resume = readHvsResumeHref()
      setResolved(isInstalledRelativeHref(resume) ? resume : HVS_CANONICAL_PATH)
    })
  }, [href])
  return (
    <Link
      href={resolved}
      data-testid={testId}
      data-hvs-internal-route="1"
      className={className}
      style={style}
      aria-label={ariaLabel}
    >
      {children}
    </Link>
  )
}
