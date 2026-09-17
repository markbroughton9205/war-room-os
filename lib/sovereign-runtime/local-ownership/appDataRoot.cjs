/**
 * Canonical War Room OS application-data root.
 * Used by Electron (CJS) and by lib/sovereign-runtime/local-ownership/paths.ts.
 * Do not add a third independent implementation.
 *
 * WINDOWS: %LOCALAPPDATA%\War Room OS
 * MACOS:   ~/Library/Application Support/War Room OS
 * LINUX:   $XDG_DATA_HOME/war-room-os or ~/.local/share/war-room-os
 *
 * WAR_ROOM_LOCAL_DATA_DIR, when set, is the root on every platform.
 */
'use strict'

const os = require('node:os')
const path = require('node:path')

const WINDOWS_PRODUCT_DIR = 'War Room OS'
const LINUX_PRODUCT_DIR = 'war-room-os'
const DARWIN_PRODUCT_DIR = 'War Room OS'

function resolveAppDataRoot(options) {
  const env = options?.env || process.env
  const platform = options?.platform || process.platform
  const homedir = options?.homedir || os.homedir()
  const rawOverride = options && Object.prototype.hasOwnProperty.call(options, 'override')
    ? options.override
    : env.WAR_ROOM_LOCAL_DATA_DIR
  const override = rawOverride == null ? '' : String(rawOverride).trim()
  if (override) return path.resolve(override)

  if (platform === 'win32') {
    const base = String(env.LOCALAPPDATA || '').trim() || path.join(homedir, 'AppData', 'Local')
    return path.join(base, WINDOWS_PRODUCT_DIR)
  }
  if (platform === 'darwin') {
    return path.join(homedir, 'Library', 'Application Support', DARWIN_PRODUCT_DIR)
  }
  const dataHome = String(env.XDG_DATA_HOME || '').trim() || path.join(homedir, '.local', 'share')
  return path.join(dataHome, LINUX_PRODUCT_DIR)
}

function resolveAppDataPaths(options) {
  const root = resolveAppDataRoot(options)
  const data = path.join(root, 'data')
  return {
    root,
    data,
    logs: path.join(root, 'logs'),
    cache: path.join(root, 'cache'),
    exports: path.join(root, 'exports'),
    runtime: path.join(root, 'runtime'),
  }
}

module.exports = {
  WINDOWS_PRODUCT_DIR,
  LINUX_PRODUCT_DIR,
  DARWIN_PRODUCT_DIR,
  resolveAppDataRoot,
  resolveAppDataPaths,
}
