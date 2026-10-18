/**
 * War Room Browser Broker — shared Chromium execution for Council and Foundry.
 *
 * Architecture seam:
 *   Council request → liveChat / runLiveResearchRouter → runCouncilBrowserResearch → BrowserBroker
 *   Foundry request → engineerTools → executeFoundryBrowserTool → BrowserBroker
 *   Shared engine: Playwright Chromium owned by lib/browser-broker (not Electron BrowserView,
 *   not Tavily/Firecrawl HTTP search).
 */
export { classifyBrowserAction } from './actionClassifier'
export {
  BrowserBroker,
  getBrowserBroker,
  resetBrowserBrokerForTests,
} from './broker'
export { runCouncilBrowserResearch, councilBrowserExtract, councilNeedsTrustedProfile } from './councilClient'
export { browserBrokerDataDirs, playwrightTmpDir, withPlaywrightTmpDir } from './paths'
export { planScreenshot, SCREENSHOT_LIMITS } from './screenshotPolicy'
export { createTrustedProfile, listProfiles, loadProfile, deleteTrustedProfile } from './profileStore'
export { evaluateOriginAccess } from './originPolicy'
export { capabilityFor } from './capabilityTable'
export { detectHumanInteractionRequired } from './humanSignals'
export type {
  BrowserActionClassification,
  BrowserActionKind,
  BrowserActionRequest,
  BrowserActionVerdict,
  BrowserBrokerDiagnostics,
  BrowserBrokerHealth,
  BrowserCitation,
  BrowserOwner,
  BrowserSessionKind,
  BrowserStatusSnapshot,
} from './types'
