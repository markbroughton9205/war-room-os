import type { OperatorGap } from '../gapFinder'
import { selfAuditGap } from './gapFactory'
import type { SelfAuditContext } from './types'

const NARROW_VIEWPORT_PX = 640
const TIGHT_TOUCH_TARGET_PX = 36

export function auditMobileLayout(ctx: SelfAuditContext): OperatorGap[] {
  const gaps: OperatorGap[] = []
  const width = ctx.viewportWidthPx

  if (ctx.viewportNarrow || (width != null && width < NARROW_VIEWPORT_PX)) {
    gaps.push(
      selfAuditGap({
        id: 'self-audit-mobile-narrow-viewport',
        title: 'Narrow viewport — dock and console squeeze council',
        plainLanguage: 'On a phone-sized screen, the bottom dock and command console cover much of the council.',
        meaning: 'Readable council area is reduced; dock panels may overlap content.',
        area: 'Layout',
        category: 'Mobile Layout Risk',
        kind: 'mobile',
        severity: 'low',
        recommendedFix: 'Close dock panels; rotate to landscape or use desktop for long sessions.',
        cursorCommand: 'Audit live-room-shell CSS padding and --live-room-bottom-reserved under 640px.',
      }),
    )
  }

  if (ctx.activeDockPanelId) {
    gaps.push(
      selfAuditGap({
        id: 'self-audit-mobile-dock-panel-open',
        title: 'Dock panel open on small screen',
        plainLanguage: 'A feature dock panel is open — on mobile it stacks over the council column.',
        meaning: `Panel “${ctx.activeDockPanelId}” consumes vertical space above the console.`,
        area: 'Layout',
        category: 'Mobile Layout Risk',
        kind: 'mobile',
        severity: 'low',
        recommendedFix: 'Close the dock panel when reading long council transcripts on mobile.',
        cursorCommand: 'Verify DockPanel max-height and scroll on narrow breakpoints in DockPanel.tsx.',
      }),
    )
  }

  if (width != null && width < 400) {
    gaps.push(
      selfAuditGap({
        id: 'self-audit-mobile-touch-targets',
        title: 'Very narrow width — dock icons may be hard to tap',
        plainLanguage: `Viewport ~${width}px — dock icons target ~${TIGHT_TOUCH_TARGET_PX}px; mis-taps are more likely.`,
        meaning: 'Feature dock uses compact 36–40px targets without extra mobile spacing.',
        area: 'Layout',
        category: 'Mobile Layout Risk',
        kind: 'mobile',
        severity: 'low',
        recommendedFix: 'Use left nav on large screens; on mobile close panels before tapping dock icons.',
        cursorCommand: 'Increase min touch target to 44px in FeatureDock for max-width sm breakpoint.',
      }),
    )
  }

  return gaps
}
