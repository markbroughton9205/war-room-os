/**
 * MAIN/CORE-only Windows USER environment overlay.
 * Explorer.exe caches logon env, so newly set HKCU\Environment values are missing from
 * processes launched from the Start Menu until this overlay runs.
 * Never logs values. Never expose this module to the renderer.
 */
'use strict'

const { execFileSync } = require('node:child_process')

const SKIP = new Set([
  'PATH',
  'PATHEXT',
  'COMSPEC',
  'SYSTEMROOT',
  'WINDIR',
  'TEMP',
  'TMP',
  'NODE_ENV',
  'PORT',
  'HOSTNAME',
])

const ALWAYS = new Set([
  'AISSTREAM_API_KEY',
  'BARENTSWATCH_CLIENT_ID',
  'BARENTSWATCH_CLIENT_SECRET',
  'AISHUB_USERNAME',
  'TERRA_AIS_CATCHER_INGEST_TOKEN',
  'WAR_ROOM_COMMANDER_USER_ID',
  'COUNCIL_ROUTING_MODE',
  'COUNCIL_SEAT_BACKEND_POLICY',
  'OLLAMA_BASE_URL',
])

const SECRET_NAME = /(_API_KEY|_CLIENT_SECRET|_CLIENT_ID|_TOKEN|_SECRET)$/i

function shouldOverlay(name) {
  if (!name || SKIP.has(String(name).toUpperCase())) return false
  if (ALWAYS.has(name)) return true
  const upper = String(name).toUpperCase()
  if (ALWAYS.has(upper)) return true
  return SECRET_NAME.test(name)
}

function parseRegQuery(raw) {
  const out = {}
  for (const line of String(raw || '').split(/\r?\n/)) {
    const match = line.match(/^\s+(\S+)\s+REG_(?:SZ|EXPAND_SZ)\s+(.*)$/)
    if (!match) continue
    out[match[1]] = match[2]
  }
  return out
}

function expand(value, env) {
  return String(value).replace(/%([^%]+)%/g, (_, name) => {
    if (Object.prototype.hasOwnProperty.call(env, name) && env[name] != null) return String(env[name])
    const upper = name.toUpperCase()
    if (Object.prototype.hasOwnProperty.call(env, upper) && env[upper] != null) return String(env[upper])
    return `%${name}%`
  })
}

function readWindowsUserEnvironment() {
  if (process.platform !== 'win32') return {}
  try {
    const raw = execFileSync('reg.exe', ['query', 'HKCU\\Environment'], {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return parseRegQuery(raw)
  } catch {
    return {}
  }
}

function mergeWindowsUserEnvironment(baseEnv) {
  const merged = { ...baseEnv }
  const user = readWindowsUserEnvironment()
  const overlayNames = []
  for (const [name, value] of Object.entries(user)) {
    if (!shouldOverlay(name)) continue
    const trimmed = String(value || '').trim()
    if (!trimmed) continue
    merged[name] = expand(trimmed, merged)
    overlayNames.push(name)
  }
  return { env: merged, overlayNames }
}

function applyWindowsUserEnvironmentToProcess() {
  const { overlayNames } = mergeWindowsUserEnvironment(process.env)
  const user = readWindowsUserEnvironment()
  for (const name of overlayNames) {
    const trimmed = String(user[name] || '').trim()
    if (!trimmed) continue
    process.env[name] = expand(trimmed, process.env)
  }
  return overlayNames
}

function presenceSummary(names = ['AISSTREAM_API_KEY', 'BARENTSWATCH_CLIENT_ID', 'BARENTSWATCH_CLIENT_SECRET']) {
  return names.map(name => {
    const value = process.env[name]
    const present = Boolean(value && String(value).trim())
    return present ? `${name}=PRESENT len=${String(value).trim().length}` : `${name}=MISSING`
  }).join(' ')
}

module.exports = {
  readWindowsUserEnvironment,
  mergeWindowsUserEnvironment,
  applyWindowsUserEnvironmentToProcess,
  presenceSummary,
}
