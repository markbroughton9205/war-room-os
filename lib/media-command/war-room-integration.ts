/**
 * HVS-WAR-ROOM-INTEGRATION-01 — installed War Room owns Higher Vision Studios.
 * Internal Next.js routes only. Installed UI :3848. Core :3847.
 * Never file:///. Never a required :3001 destination for normal use.
 */
import { LOCAL_CORE_ORIGIN, LOCAL_CORE_PORT, LOCAL_UI_ORIGIN, LOCAL_UI_PORT } from '@/lib/sovereign-runtime/constants'
import { HVS_CANONICAL_PATH, isInstalledRelativeHref } from './navigation'

export const HVS_INSTALLED_UI_ORIGIN = LOCAL_UI_ORIGIN
export const HVS_INSTALLED_CORE_ORIGIN = LOCAL_CORE_ORIGIN
export const HVS_INSTALLED_UI_PORT = LOCAL_UI_PORT
export const HVS_INSTALLED_CORE_PORT = LOCAL_CORE_PORT
export const HVS_DEV_ONLY_PORT = 3001
export const HVS_UNAVAILABLE_HEADLINE = 'HIGHER VISION STUDIOS UNAVAILABLE'
export const HVS_UNAVAILABLE_BODY = 'War Room UI runtime is not ready.'
export const HVS_UNAVAILABLE_RETRY = 'RETRY'

export function isHvsAppPathname(pathname: string | null | undefined): boolean {
  if (!pathname) return false
  return pathname === HVS_CANONICAL_PATH || pathname.startsWith(`${HVS_CANONICAL_PATH}/`)
}

export function isHvsInternalHref(href: string): boolean {
  if (!isInstalledRelativeHref(href)) return false
  const path = href.split('?')[0]
  return isHvsAppPathname(path)
}

function defaultPort(protocol: string): string {
  return protocol === 'https:' ? '443' : '80'
}

export function isOwnedUiOrigin(raw: string, uiOrigin = LOCAL_UI_ORIGIN): boolean {
  try {
    const url = new URL(raw)
    const origin = new URL(uiOrigin)
    const urlPort = url.port || defaultPort(url.protocol)
    const originPort = origin.port || defaultPort(origin.protocol)
    return url.protocol === origin.protocol && url.hostname === origin.hostname && urlPort === originPort
  } catch {
    return false
  }
}

export function rewriteFileHvsToInstalledUi(raw: string, uiOrigin = LOCAL_UI_ORIGIN): string | null {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'file:') return null
    const decoded = decodeURIComponent(url.pathname || '')
    const idx = decoded.indexOf(HVS_CANONICAL_PATH)
    if (idx === -1) return null
    const rest = decoded.slice(idx)
    return `${uiOrigin.replace(/\/$/, '')}${rest}${url.search}${url.hash}`
  } catch {
    return null
  }
}

export function hvsInstalledUrl(pathnameAndQuery: string, uiOrigin = LOCAL_UI_ORIGIN): string {
  const path = pathnameAndQuery.startsWith('/') ? pathnameAndQuery : `/${pathnameAndQuery}`
  return `${uiOrigin.replace(/\/$/, '')}${path}`
}

export function isBrokenHvsOrigin(protocol: string | null | undefined): boolean {
  return protocol === 'file:'
}
