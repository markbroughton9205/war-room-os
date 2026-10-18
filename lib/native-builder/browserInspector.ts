/**
 * PASS 001 compatibility surface for Foundry browser tools.
 *
 * The persistent Chromium service lives in foundryBrowserService.ts (PASS 003). This module
 * re-exports the same function signatures existing proofs already import, plus inspectLocalPage
 * (the original one-shot convenience that opens a tab, inspects, and closes the tab — it no
 * longer kills the shared browser process).
 */
export {
  assertSafeBrowserTarget,
  browserClick,
  browserClose,
  browserConsole,
  browserFind,
  browserNavigate,
  browserNetwork,
  browserOpen,
  browserScreenshot,
  browserType,
  getPlaywrightAvailability,
  resetPlaywrightAvailabilityForTests,
  type BrowserToolError,
  type BrowserToolOk,
  type BrowserToolResult,
} from './foundryBrowserService'

import { browserClose, browserConsole, browserNavigate, browserOpen, browserScreenshot } from './foundryBrowserService'

export type BrowserInspectionResult =
  | {
      visualVerification: 'VERIFIED'
      url: string
      title: string
      status: number | null
      screenshotPath: string
      consoleErrors: string[]
    }
  | { visualVerification: 'VISUAL_VERIFICATION_NOT_AVAILABLE'; reason: string }

export async function inspectLocalPage(
  input: { url: string; waitForSelector?: string; fullPage?: boolean },
  ctx: { repairId: string },
): Promise<BrowserInspectionResult> {
  if (!input.url) return { visualVerification: 'VISUAL_VERIFICATION_NOT_AVAILABLE', reason: 'No url provided.' }
  const opened = await browserOpen({ repairId: ctx.repairId })
  if (!opened.ok) return { visualVerification: 'VISUAL_VERIFICATION_NOT_AVAILABLE', reason: opened.error }
  const sessionId = opened.result.sessionId
  try {
    const nav = await browserNavigate({ sessionId, url: input.url, waitForSelector: input.waitForSelector })
    if (!nav.ok) return { visualVerification: 'VISUAL_VERIFICATION_NOT_AVAILABLE', reason: nav.error }
    const shot = await browserScreenshot({ sessionId, repairId: ctx.repairId, fullPage: input.fullPage })
    const consoleResult = await browserConsole({ sessionId })
    const consoleErrors = consoleResult.ok
      ? consoleResult.result.entries.filter(e => e.kind === 'error').map(e => e.text)
      : []
    return {
      visualVerification: 'VERIFIED',
      url: nav.result.url,
      title: nav.result.title,
      status: nav.result.status,
      screenshotPath: shot.ok ? shot.result.path : '',
      consoleErrors,
    }
  } catch (error) {
    return { visualVerification: 'VISUAL_VERIFICATION_NOT_AVAILABLE', reason: error instanceof Error ? error.message : String(error) }
  } finally {
    await browserClose({ sessionId })
  }
}
