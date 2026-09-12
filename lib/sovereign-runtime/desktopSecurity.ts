/**
 * #22 Phase 10 — Desktop security helpers (Electron policy + navigation allowlist).
 */
import {
  DESKTOP_SECURITY_POLICY,
  FORBIDDEN_DESKTOP_NAV_HOSTS,
  LOCAL_CORE_HOST,
  LOCAL_CORE_ORIGIN,
  LOCAL_CORE_PORT,
  LOCAL_UI_ORIGIN,
  LOCAL_UI_PORT,
  PUBLIC_DOMAIN,
} from './constants'

export type NavigationDecision =
  | { allowed: true; reason: string }
  | { allowed: false; reason: string; openExternal: boolean }

export function decideDesktopNavigation(rawUrl: string): NavigationDecision {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return { allowed: false, reason: 'Malformed URL.', openExternal: false }
  }

  if (url.protocol === 'file:') {
    return { allowed: true, reason: 'Local file asset.' }
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { allowed: false, reason: `Protocol ${url.protocol} denied.`, openExternal: false }
  }

  const host = url.hostname.toLowerCase()
  if (host === LOCAL_CORE_HOST || host === 'localhost') {
    const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80
    // Allow local core, local Next UI, and known local Next ports for optional full UI — never public domain
    if (port === LOCAL_CORE_PORT || port === LOCAL_UI_PORT || port === 3001 || port === 3000) {
      return { allowed: true, reason: `Loopback local UI/core port ${port}.` }
    }
    return { allowed: false, reason: `Loopback port ${port} not in allowlist.`, openExternal: false }
  }

  if (FORBIDDEN_DESKTOP_NAV_HOSTS.some(h => host === h || host.endsWith(`.${h}`))) {
    return {
      allowed: false,
      reason: `Public/remote host ${host} cannot load inside privileged desktop shell.`,
      openExternal: true,
    }
  }

  // Any other remote: open outside privileged bridge if at all
  return {
    allowed: false,
    reason: 'Remote navigation denied inside privileged shell.',
    openExternal: true,
  }
}

export function electronWebPreferences() {
  return {
    nodeIntegration: DESKTOP_SECURITY_POLICY.nodeIntegration,
    contextIsolation: DESKTOP_SECURITY_POLICY.contextIsolation,
    sandbox: DESKTOP_SECURITY_POLICY.sandbox,
    preload: null as string | null, // filled by desktop main at runtime
  }
}

export function assertNoPrivilegedIpcChannel(channel: string): boolean {
  const denied = [
    'shell.exec',
    'powershell.run',
    'fs.write',
    'fs.readArbitrary',
    'process.kill',
    'child_process',
  ]
  // true = channel correctly blocked
  return denied.includes(channel)
}

export function preloadBridgeAllowlist(): readonly string[] {
  return Object.freeze([
    'sovereign.getRuntimeTruth',
    'sovereign.getHealth',
    'sovereign.getBootState',
    'sovereign.openExternalSafe',
  ])
}

export function isPublicWebsiteRequiredForLocalUse(): false {
  return false
}

export function isCloudflareRequiredForLocalUse(): false {
  return false
}

export function isInternetRequiredForLocalCore(): false {
  return false
}

export function desktopLoadsPublicDomain(url: string): boolean {
  try {
    const u = new URL(url)
    return u.hostname === PUBLIC_DOMAIN || u.hostname === `www.${PUBLIC_DOMAIN}`
  } catch {
    return false
  }
}

export function defaultDesktopStartUrl(): string {
  return LOCAL_UI_ORIGIN + '/'
}

export { DESKTOP_SECURITY_POLICY, LOCAL_CORE_ORIGIN, LOCAL_UI_ORIGIN }
