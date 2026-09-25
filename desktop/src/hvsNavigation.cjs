/**
 * Installed War Room owns Higher Vision Studios routes.
 * file:///higher-vision-studios… is rewritten to the owned UI origin (:3848).
 * Owned UI navigations stay in the main BrowserWindow — never the guest browser.
 */
'use strict'

const HVS_PATH = '/higher-vision-studios'

function parseUrl(raw) {
  try {
    return new URL(String(raw || ''))
  } catch {
    return null
  }
}

function defaultPort(protocol) {
  return protocol === 'https:' ? '443' : '80'
}

function isOwnedUiOrigin(raw, localUiOrigin) {
  const url = parseUrl(raw)
  const origin = parseUrl(localUiOrigin)
  if (!url || !origin) return false
  const urlPort = url.port || defaultPort(url.protocol)
  const originPort = origin.port || defaultPort(origin.protocol)
  return url.protocol === origin.protocol && url.hostname === origin.hostname && urlPort === originPort
}

function isHvsAppPath(raw) {
  const url = parseUrl(raw)
  if (!url) return false
  return url.pathname === HVS_PATH || url.pathname.startsWith(`${HVS_PATH}/`)
}

function rewriteFileHvsToInstalledUi(raw, localUiOrigin) {
  const url = parseUrl(raw)
  if (!url || url.protocol !== 'file:') return null
  let decoded = url.pathname || ''
  try {
    decoded = decodeURIComponent(decoded)
  } catch {
    /* keep raw pathname */
  }
  const idx = decoded.indexOf(HVS_PATH)
  if (idx === -1) return null
  const rest = decoded.slice(idx)
  return `${String(localUiOrigin || '').replace(/\/$/, '')}${rest}${url.search || ''}${url.hash || ''}`
}

module.exports = {
  HVS_PATH,
  isOwnedUiOrigin,
  isHvsAppPath,
  rewriteFileHvsToInstalledUi,
}
