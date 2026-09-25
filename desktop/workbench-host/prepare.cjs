/**
 * Prepare the OpenVSCode Server runtime under desktop/runtime/workbench/.
 * Does not vendor Code-OSS source into git. Does not download Microsoft VS Code binaries.
 */
'use strict'

const { spawnSync } = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..', '..')
const HOST_DIR = __dirname
const RUNTIME = path.join(ROOT, 'desktop', 'runtime', 'workbench')
const CACHE = path.join(RUNTIME, 'cache')
const EXTRACT = path.join(RUNTIME, 'extract')
const DEST = path.join(RUNTIME, 'openvscode-server')
const PROVENANCE = JSON.parse(fs.readFileSync(path.join(HOST_DIR, 'provenance.json'), 'utf8'))

function sha256File(file) {
  const hash = crypto.createHash('sha256')
  hash.update(fs.readFileSync(file))
  return hash.digest('hex')
}

function overlayProduct(productPath) {
  const product = JSON.parse(fs.readFileSync(productPath, 'utf8'))
  product.nameShort = 'Foundry'
  product.nameLong = 'Foundry Workbench'
  product.applicationName = 'foundry'
  product.dataFolderName = '.foundry-workbench'
  product.win32NameVersion = 'Foundry Workbench'
  product.win32DirName = 'Foundry Workbench'
  product.win32RegValueName = 'FoundryWorkbench'
  product.win32AppUserModelId = 'Foundry.Workbench'
  product.darwinBundleName = 'Foundry Workbench'
  product.serverGreeting = ['Foundry Workbench']
  product.urlProtocol = 'foundry'
  product.enableTelemetry = false
  product.extensionsGallery = {
    serviceUrl: '',
    itemUrl: '',
    resourceUrlTemplate: '',
    extensionUrlTemplate: '',
    controlUrl: '',
    recommendationsUrl: '',
    nlsBaseUrl: '',
    publisherUrl: '',
  }
  product.extensionEnabledApiProposals = {
    ...(product.extensionEnabledApiProposals || {}),
    'foundry.foundry-adapter': ['terminalDataWriteEvent'],
  }
  delete product.extensionTips
  delete product.extensionImportantTips
  fs.writeFileSync(productPath, `${JSON.stringify(product, null, 2)}\n`)
}

function alreadyPrepared() {
  const productPath = path.join(DEST, 'product.json')
  const bin = path.join(DEST, 'bin', 'openvscode-server')
  if (!fs.existsSync(bin) || !fs.existsSync(productPath)) return false
  try {
    const product = JSON.parse(fs.readFileSync(productPath, 'utf8'))
    return product.nameShort === 'Foundry'
      && product.nameLong === 'Foundry Workbench'
      && product.applicationName === 'foundry'
      && product.win32DirName === 'Foundry Workbench'
      && product.urlProtocol === 'foundry'
  } catch {
    return false
  }
}

function main() {
  fs.mkdirSync(CACHE, { recursive: true })
  const tarball = path.join(CACHE, PROVENANCE.asset)
  if (!fs.existsSync(tarball)) {
    throw new Error(`Missing workbench tarball at ${tarball}. Download the official Gitpod OpenVSCode Server linux-x64 asset first.`)
  }
  const actual = sha256File(tarball)
  if (actual !== PROVENANCE.assetSha256) {
    throw new Error(`Workbench tarball sha256 mismatch. expected=${PROVENANCE.assetSha256} actual=${actual}`)
  }
  if (fs.existsSync(path.join(DEST, 'bin', 'openvscode-server')) && fs.existsSync(path.join(DEST, 'product.json')) && process.env.FOUNDRY_WORKBENCH_REPREPARE !== '1') {
    overlayProduct(path.join(DEST, 'product.json'))
    try {
      const pkgPath = path.join(DEST, 'package.json')
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
        pkg.name = 'Foundry Workbench'
        fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
      }
    } catch { /* overlay best-effort */ }
    console.log(`FOUNDRY_WORKBENCH_PREPARED ${DEST}`)
    return
  }
  fs.rmSync(EXTRACT, { recursive: true, force: true })
  fs.mkdirSync(EXTRACT, { recursive: true })
  const tar = spawnSync('tar', ['--no-same-owner', '-xzf', tarball, '-C', EXTRACT], { encoding: 'utf8' })
  if (tar.status !== 0) {
    throw new Error(tar.stderr || tar.stdout || 'tar extract failed')
  }
  const extracted = fs.readdirSync(EXTRACT).map(name => path.join(EXTRACT, name)).find(item => fs.statSync(item).isDirectory())
  if (!extracted) throw new Error('extract did not produce a directory')
  fs.rmSync(DEST, { recursive: true, force: true })
  fs.renameSync(extracted, DEST)
  overlayProduct(path.join(DEST, 'product.json'))
  fs.writeFileSync(path.join(RUNTIME, 'PROVENANCE.json'), `${JSON.stringify({
    ...PROVENANCE,
    preparedAt: new Date().toISOString(),
    runtimePath: DEST,
  }, null, 2)}\n`)
  const bin = path.join(DEST, 'bin', 'openvscode-server')
  if (!fs.existsSync(bin)) throw new Error(`missing ${bin}`)
  console.log(`FOUNDRY_WORKBENCH_PREPARED ${DEST}`)
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

module.exports = { overlayProduct, RUNTIME, DEST }
