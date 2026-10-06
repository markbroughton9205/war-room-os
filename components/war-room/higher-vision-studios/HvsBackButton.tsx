'use client'

import Link from 'next/link'
import { HVS_CANONICAL_PATH } from '@/lib/media-command/navigation'

/**
 * Global HVS escape to the Higher Vision Studios home route.
 * Explicit canonical path only — never native history navigation.
 */
export function HvsBackButton({
  onNavigate,
}: {
  onNavigate?: () => void
}) {
  return (
    <Link
      href={HVS_CANONICAL_PATH}
      data-testid="hvs-studio-back"
      className="hvs-v3-back"
      aria-label="Back to Higher Vision Studios"
      title="Back to Higher Vision Studios"
      onClick={() => onNavigate?.()}
    >
      <span aria-hidden="true">←</span>
      <span className="hvs-v3-back-label">BACK</span>
    </Link>
  )
}
