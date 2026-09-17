'use client'

/**
 * War Room command icons — compact, dependency-free inline SVG set (lucide-react is not
 * installed; these follow the lucide stroke style: 24×24 viewBox, stroke 2, round caps).
 * Used to replace text-heavy Council controls with War Room-native command glyphs.
 * Every consumer must pair these with a title tooltip + aria-label; the glyphs never
 * carry meaning alone.
 */
import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function Base({ size = 14, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  )
}

/** Direct — single-operator lightning decree. */
export function IconDirect(props: IconProps) {
  return <Base {...props}><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" /></Base>
}

/** Stable Group — a small, seated group (two figures). */
export function IconStableGroup(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </Base>
  )
}

/** Full Council — the full chamber grid (nine seats). */
export function IconFullCouncil(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </Base>
  )
}

/** Controls — settings gear. */
export function IconSettings(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </Base>
  )
}

/** Expand Chat — maximize into full view. */
export function IconExpand(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M8 3H5a2 2 0 0 0-2 2v3" />
      <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
      <path d="M3 16v3a2 2 0 0 0 2 2h3" />
      <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
    </Base>
  )
}

/** Collapse Chat — restore to normal dashboard. */
export function IconCollapse(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M8 3v3a2 2 0 0 1-2 2H3" />
      <path d="M21 8h-3a2 2 0 0 1-2-2V3" />
      <path d="M3 16h3a2 2 0 0 1 2 2v3" />
      <path d="M16 21v-3a2 2 0 0 1 2-2h3" />
    </Base>
  )
}

/** Minimize the floating Council chat to its header bar. */
export function IconMinimize(props: IconProps) {
  return <Base {...props}><path d="M5 12h14" /></Base>
}

/** Restore the floating Council chat from its minimized header bar. */
export function IconRestore(props: IconProps) {
  return <Base {...props}><path d="m18 15-6-6-6 6" /></Base>
}

/** Jump to the latest Council message. */
export function IconJumpToLatest(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12 5v14" />
      <path d="m19 12-7 7-7-7" />
    </Base>
  )
}

/** Sessions — the saved-conversation list rail. */
export function IconSessions(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M4 6h16" />
      <path d="M4 12h16" />
      <path d="M4 18h10" />
    </Base>
  )
}

/** Inspector — the right-side detail/evidence panel. */
export function IconInspector(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M15 4v16" />
    </Base>
  )
}

/** Navigate — compass for the Navigation Agent. */
export function IconNavigate(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="12" cy="12" r="10" />
      <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
    </Base>
  )
}

/** Learn — open book for the World Learning Agent. */
export function IconLearn(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      <path d="M8 7h8" />
      <path d="M8 11h6" />
    </Base>
  )
}

/** Integrate — linked nodes for Cross-Agent Integration. */
export function IconIntegrate(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="6" cy="6" r="3" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="12" cy="18" r="3" />
      <path d="M8.5 7.5 10.5 15" />
      <path d="M15.5 7.5 13.5 15" />
    </Base>
  )
}

/** Media — equalizer bars (playing indicator). */
export function IconRadio(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M4 10v4" />
      <path d="M8 7v10" />
      <path d="M12 4v16" />
      <path d="M16 7v10" />
      <path d="M20 10v4" />
    </Base>
  )
}

/** Media — broadcast beacon matching the approved War Room Media player glyph. */
export function IconBroadcast(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="12" cy="16" r="1.6" fill="currentColor" stroke="none" />
      <path d="M8.2 12.6a5.2 5.2 0 0 1 7.6 0" />
      <path d="M5.4 9.8a9 9 0 0 1 13.2 0" />
      <path d="M12 16V8.5" />
    </Base>
  )
}

/** Camera — traffic-camera discovery and inspect. Lucide camera body, stroke-only. */
export function IconCamera(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
      <circle cx="12" cy="13" r="3" />
    </Base>
  )
}

/** Nearby — compact inventory glyph. */
export function IconNearby(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="12" cy="12" r="3" />
      <circle cx="12" cy="12" r="8" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
    </Base>
  )
}
