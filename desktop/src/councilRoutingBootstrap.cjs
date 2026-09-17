/**
 * MAIN/UI-child only. Applies Council routing preference for packaged runtime.
 * Never reads checkout .env.local. Never logs values. No API keys in this file.
 *
 * Order:
 * 1. explicit packaged AppData council-runtime.json
 * 2. existing process.env.COUNCIL_ROUTING_MODE (Windows USER overlay / spawn)
 * 3. canonical default AUTO
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { resolveAppDataPaths } = require('./appDataRoot.cjs')

const ALLOWED = new Set(['AUTO', 'LOCAL_ONLY', 'LOCAL_FIRST', 'HYBRID', 'EXTERNAL_ONLY'])

function dataDir() {
  return resolveAppDataPaths().data
}

function configPath() {
  if (typeof process.env.WAR_ROOM_COUNCIL_RUNTIME_CONFIG_PATH === 'string') {
    const override = process.env.WAR_ROOM_COUNCIL_RUNTIME_CONFIG_PATH.trim()
    if (!override) return null
    return path.resolve(override)
  }
  return path.join(dataDir(), 'council-runtime.json')
}

function readPackagedRoutingMode() {
  const filePath = configPath()
  if (!filePath) return null
  try {
    if (!fs.existsSync(filePath)) return null
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    const raw = String(parsed?.routingMode || parsed?.COUNCIL_ROUTING_MODE || '')
      .trim()
      .toUpperCase()
    if (ALLOWED.has(raw)) return raw
  } catch {
    /* ignore malformed / missing */
  }
  return null
}

function applyCouncilRoutingDefault() {
  const packaged = readPackagedRoutingMode()
  if (packaged) {
    process.env.COUNCIL_ROUTING_MODE = packaged
    return 'packaged'
  }
  const existing = process.env.COUNCIL_ROUTING_MODE && String(process.env.COUNCIL_ROUTING_MODE).trim()
  if (existing) return 'env'
  process.env.COUNCIL_ROUTING_MODE = 'AUTO'
  return 'default'
}

module.exports = {
  readPackagedRoutingMode,
  applyCouncilRoutingDefault,
}
