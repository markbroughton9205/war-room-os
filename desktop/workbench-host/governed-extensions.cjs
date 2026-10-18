/**
 * W6 governed user-extension install into the Workbench-owned extensions dir.
 * Never installs from Microsoft Marketplace. Never replaces foundry.foundry-adapter.
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { storedExtensionRecord, isStoredExtension, countFoundryAdapterCopies, ADAPTER_PUBLISHER_ID } = require('./install-adapter.cjs')

function posixPath(filePath) {
  return String(filePath || '').replace(/\\/g, '/')
}

function extensionRecordId(item) {
  if (!item) return ''
  if (item.identifier && typeof item.identifier.id === 'string') return item.identifier.id
  if (typeof item.identifier === 'string') return item.identifier
  return ''
}

function catalogFiles(stateDir) {
  return [
    path.join(stateDir, 'extensions', 'extensions.json'),
    path.join(stateDir, 'user-data', 'User', 'extensions.json'),
  ]
}

function userRecord(dest, publisherId, version, folderId) {
  const posix = posixPath(dest)
  return {
    identifier: { id: publisherId },
    version,
    location: {
      $mid: 1,
      fsPath: dest,
      external: `file://${posix}`,
      path: posix,
      scheme: 'file',
    },
    relativeLocation: folderId,
    metadata: {
      isApplicationScoped: false,
      isMachineScoped: false,
      isBuiltin: false,
      pinned: true,
      source: 'vsix',
      isPreReleaseVersion: false,
    },
  }
}

function mergeCatalog(file, publisherId, version, dest, folderId) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  let current = []
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (Array.isArray(parsed)) current = parsed.filter(item => isStoredExtension(item))
  } catch {
    current = []
  }
  current = current.filter(item => extensionRecordId(item) !== publisherId)
  current.push(userRecord(dest, publisherId, version, folderId))
  fs.writeFileSync(file, `${JSON.stringify(current)}\n`)
}

function folderIdFor(publisherId, version) {
  return `${publisherId}-${version}`
}

function countPublisherCopies(stateDir, publisherId) {
  const extensionsDir = path.join(stateDir, 'extensions')
  if (!fs.existsSync(extensionsDir)) return 0
  let count = 0
  const prefix = `${publisherId}-`
  for (const name of fs.readdirSync(extensionsDir)) {
    if (name.startsWith(prefix) && fs.statSync(path.join(extensionsDir, name)).isDirectory()) count += 1
  }
  return count
}

function installUserExtension(stateDir, sourceDir, publisherId, version) {
  if (publisherId === ADAPTER_PUBLISHER_ID) throw new Error('ADAPTER_PROTECTED')
  const extensionsDir = path.join(stateDir, 'extensions')
  fs.mkdirSync(extensionsDir, { recursive: true })
  const prefix = `${publisherId}-`
  for (const name of fs.readdirSync(extensionsDir)) {
    if (name.startsWith(prefix) && name !== folderIdFor(publisherId, version)) {
      fs.rmSync(path.join(extensionsDir, name), { recursive: true, force: true })
    }
  }
  const dest = path.join(extensionsDir, folderIdFor(publisherId, version))
  fs.cpSync(sourceDir, dest, { recursive: true })
  for (const file of catalogFiles(stateDir)) {
    mergeCatalog(file, publisherId, version, dest, folderIdFor(publisherId, version))
  }
  return { dest, copyCount: countPublisherCopies(stateDir, publisherId) }
}

function removeUserExtension(stateDir, publisherId, version) {
  if (publisherId === ADAPTER_PUBLISHER_ID) return false
  const extensionsDir = path.join(stateDir, 'extensions')
  if (!fs.existsSync(extensionsDir)) return false
  let removed = false
  for (const name of fs.readdirSync(extensionsDir)) {
    if (name === folderIdFor(publisherId, version) || (!version && name.startsWith(`${publisherId}-`))) {
      fs.rmSync(path.join(extensionsDir, name), { recursive: true, force: true })
      removed = true
    }
  }
  for (const file of catalogFiles(stateDir)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (!Array.isArray(parsed)) continue
      const next = parsed.filter(item => isStoredExtension(item) && extensionRecordId(item) !== publisherId)
      fs.writeFileSync(file, `${JSON.stringify(next)}\n`)
    } catch { /* ignore */ }
  }
  return removed
}

function disableExtensionArgs(stateDir) {
  const file = path.join(stateDir, 'disabled-extensions.json')
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    const ids = Array.isArray(parsed.ids) ? parsed.ids : []
    return ids.filter(id => id && id !== ADAPTER_PUBLISHER_ID).flatMap(id => ['--disable-extension', id])
  } catch {
    return []
  }
}

function setUserExtensionCatalogEnabled(stateDir, publisherId, enabled, version, dest) {
  if (publisherId === ADAPTER_PUBLISHER_ID) return false
  if (enabled) {
    if (!dest || !version) return false
    for (const file of catalogFiles(stateDir)) {
      mergeCatalog(file, publisherId, version, dest, folderIdFor(publisherId, version))
    }
    return true
  }
  for (const file of catalogFiles(stateDir)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (!Array.isArray(parsed)) continue
      const next = parsed.filter(item => isStoredExtension(item) && extensionRecordId(item) !== publisherId)
      fs.writeFileSync(file, `${JSON.stringify(next)}\n`)
    } catch { /* ignore */ }
  }
  return true
}

function countFoundryAdapterCopiesForState(stateDir) {
  return countFoundryAdapterCopies(path.join(stateDir, 'extensions'))
}

module.exports = {
  installUserExtension,
  removeUserExtension,
  countPublisherCopies,
  countFoundryAdapterCopies: countFoundryAdapterCopiesForState,
  disableExtensionArgs,
  setUserExtensionCatalogEnabled,
  folderIdFor,
}
