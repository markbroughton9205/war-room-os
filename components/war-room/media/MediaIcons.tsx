export function MediaIcon({
  name,
  className,
}: {
  name: 'play' | 'pause' | 'volume' | 'muted' | 'expand' | 'close' | 'intel' | 'source' | 'prev' | 'next'
  className?: string
}) {
  const common = {
    width: 14,
    height: 14,
    viewBox: '0 0 24 24',
    fill: 'none' as const,
    stroke: 'currentColor',
    strokeWidth: 2,
    'aria-hidden': true as const,
  }
  if (name === 'prev') {
    return (
      <svg {...common} className={className}>
        <path d="M6 6v12" />
        <path d="M18 6v12L8 12z" fill="currentColor" stroke="none" />
      </svg>
    )
  }
  if (name === 'next') {
    return (
      <svg {...common} className={className}>
        <path d="M18 6v12" />
        <path d="M6 6v12l10-6z" fill="currentColor" stroke="none" />
      </svg>
    )
  }
  if (name === 'play') {
    return (
      <svg {...common} className={className}>
        <path d="M8 5v14l11-7z" fill="currentColor" stroke="none" />
      </svg>
    )
  }
  if (name === 'pause') {
    return (
      <svg {...common} className={className}>
        <rect x="6" y="5" width="4" height="14" fill="currentColor" stroke="none" />
        <rect x="14" y="5" width="4" height="14" fill="currentColor" stroke="none" />
      </svg>
    )
  }
  if (name === 'muted') {
    return (
      <svg {...common} className={className}>
        <path d="M11 5 6 9H3v6h3l5 4V5z" />
        <path d="m22 9-6 6" />
        <path d="m16 9 6 6" />
      </svg>
    )
  }
  if (name === 'volume') {
    return (
      <svg {...common} className={className}>
        <path d="M11 5 6 9H3v6h3l5 4V5z" />
        <path d="M16 9.5a5 5 0 0 1 0 5" />
        <path d="M19 7a8 8 0 0 1 0 10" />
      </svg>
    )
  }
  if (name === 'expand') {
    return (
      <svg {...common} className={className}>
        <rect x="4" y="6" width="16" height="12" rx="1" />
      </svg>
    )
  }
  if (name === 'close') {
    return (
      <svg {...common} className={className}>
        <path d="M6 6l12 12" />
        <path d="M18 6 6 18" />
      </svg>
    )
  }
  if (name === 'intel') {
    return (
      <svg {...common} className={className}>
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18" />
        <path d="M12 3a14 14 0 0 1 0 18" />
        <path d="M12 3a14 14 0 0 0 0 18" />
      </svg>
    )
  }
  return (
    <svg {...common} className={className}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 5v2" />
      <path d="M12 17v2" />
      <path d="m7 7 1.5 1.5" />
      <path d="m15.5 15.5 1.5 1.5" />
      <path d="M5 12h2" />
      <path d="M17 12h2" />
    </svg>
  )
}
