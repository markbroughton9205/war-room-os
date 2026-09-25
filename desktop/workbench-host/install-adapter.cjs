/**
 * Copy the Foundry-owned adapter into the Workbench-owned extensions-dir
 * as the single user copy, and register it in the VS Code 1.109 stored-extension
 * catalog so the extension host activates it instead of marking it removed.
 * Not OpenVSX. Not Microsoft Marketplace. Not a builtin duplicate.
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')

const ADAPTER_ID = 'foundry.foundry-adapter-0.3.0'
const ADAPTER_PUBLISHER_ID = 'foundry.foundry-adapter'
const ADAPTER_VERSION = '0.3.0'
const SOURCE = path.join(__dirname, 'extensions', 'foundry-adapter')
const RUNTIME_EXTENSIONS = path.join(__dirname, '..', 'runtime', 'workbench', 'openvscode-server', 'extensions')

function writeBridge(dir, stateDir) {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'foundry-bridge.json'), `${JSON.stringify({
    stateDir,
    apiOrigin: 'http://127.0.0.1:3848',
    adapter: ADAPTER_ID,
    marketplace: false,
    openvsx: false,
  }, null, 2)}\n`)
}

function clearObsolete(extensionsDir) {
  const obsoletePath = path.join(extensionsDir, '.obsolete')
  try { fs.unlinkSync(obsoletePath) } catch { /* none */ }
}

function posixPath(filePath) {
  return String(filePath || '').replace(/\\/g, '/')
}

function storedExtensionRecord(dest) {
  const posix = posixPath(dest)
  return {
    identifier: { id: ADAPTER_PUBLISHER_ID },
    version: ADAPTER_VERSION,
    location: {
      $mid: 1,
      fsPath: dest,
      external: `file://${posix}`,
      path: posix,
      scheme: 'file',
    },
    relativeLocation: ADAPTER_ID,
    metadata: {
      isApplicationScoped: false,
      isMachineScoped: false,
      isBuiltin: false,
      pinned: true,
      source: 'vsix',
    },
  }
}

function isStoredExtension(item) {
  const identifier = item && item.identifier
  const location = item && item.location
  return Boolean(
    item &&
    identifier &&
    typeof identifier === 'object' &&
    typeof identifier.id === 'string' &&
    typeof item.version === 'string' &&
    item.version &&
    location &&
    typeof location === 'object' &&
    typeof location.scheme === 'string' &&
    typeof location.path === 'string',
  )
}

function extensionRecordId(item) {
  if (!item) return ''
  if (item.identifier && typeof item.identifier.id === 'string') return item.identifier.id
  if (typeof item.identifier === 'string') return item.identifier
  return ''
}

function writeStoredExtensionCatalog(file, dest) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  let current = []
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (Array.isArray(parsed)) {
      current = parsed.filter(item => isStoredExtension(item) && extensionRecordId(item) !== ADAPTER_PUBLISHER_ID && extensionRecordId(item) !== ADAPTER_ID)
    }
  } catch {
    current = []
  }
  current.push(storedExtensionRecord(dest))
  fs.writeFileSync(file, `${JSON.stringify(current)}\n`)
}

function writeExtensionsManifest(extensionsDir, dest, stateDir) {
  writeStoredExtensionCatalog(path.join(extensionsDir, 'extensions.json'), dest)
  if (stateDir) {
    writeStoredExtensionCatalog(path.join(stateDir, 'user-data', 'User', 'extensions.json'), dest)
  }
}

function removeBuiltinDuplicate() {
  if (!fs.existsSync(RUNTIME_EXTENSIONS)) return false
  const builtin = path.join(RUNTIME_EXTENSIONS, 'foundry-adapter')
  if (!fs.existsSync(builtin)) return false
  fs.rmSync(builtin, { recursive: true, force: true })
  return true
}

function countFoundryAdapterCopies(extensionsDir) {
  let count = 0
  if (fs.existsSync(extensionsDir)) {
    for (const name of fs.readdirSync(extensionsDir)) {
      if (/^foundry\.foundry-adapter-\d+\.\d+\.\d+$/.test(name) && fs.statSync(path.join(extensionsDir, name)).isDirectory()) {
        count += 1
      }
    }
  }
  if (fs.existsSync(path.join(RUNTIME_EXTENSIONS, 'foundry-adapter'))) count += 1
  return count
}

function installFoundryAdapter(extensionsDir, stateDir) {
  fs.mkdirSync(extensionsDir, { recursive: true })
  clearObsolete(extensionsDir)
  for (const name of fs.readdirSync(extensionsDir)) {
    if (/^foundry\.foundry-adapter-\d+\.\d+\.\d+$/.test(name) && name !== ADAPTER_ID) {
      fs.rmSync(path.join(extensionsDir, name), { recursive: true, force: true })
    }
  }
  const dest = path.join(extensionsDir, ADAPTER_ID)
  fs.cpSync(SOURCE, dest, { recursive: true })
  removeBuiltinDuplicate()
  writeExtensionsManifest(extensionsDir, dest, stateDir)
  clearObsolete(extensionsDir)
  writeBridge(extensionsDir, stateDir)
  writeBridge(dest, stateDir)
  const copyCount = countFoundryAdapterCopies(extensionsDir)
  if (stateDir) {
    writeBridge(stateDir, stateDir)
    fs.writeFileSync(path.join(stateDir, 'adapter-install.json'), `${JSON.stringify({
      adapterId: ADAPTER_PUBLISHER_ID,
      folderId: ADAPTER_ID,
      version: ADAPTER_VERSION,
      dest,
      copyCount,
      builtinDuplicate: false,
      catalog: [
        path.join(extensionsDir, 'extensions.json'),
        path.join(stateDir, 'user-data', 'User', 'extensions.json'),
      ],
      at: new Date().toISOString(),
    }, null, 2)}\n`)
  }
  return { dest, adapterId: ADAPTER_ID, publisherId: ADAPTER_PUBLISHER_ID, version: ADAPTER_VERSION, copyCount }
}

module.exports = {
  installFoundryAdapter,
  ADAPTER_ID,
  ADAPTER_PUBLISHER_ID,
  ADAPTER_VERSION,
  SOURCE,
  RUNTIME_EXTENSIONS,
  storedExtensionRecord,
  writeStoredExtensionCatalog,
  countFoundryAdapterCopies,
  isStoredExtension,
}
