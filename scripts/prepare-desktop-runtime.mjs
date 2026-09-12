/**
 * Phase 11D — Prepare packaged runtime tree under desktop/runtime/
 * - Next standalone + static + public/cesium
 * - Bundled local Core (CJS) for ELECTRON_RUN_AS_NODE / require-from-main
 * Never copies .env / secrets.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const runtimeRoot = path.join(repoRoot, 'desktop', 'runtime')
const uiRoot = path.join(runtimeRoot, 'ui')
const coreDir = path.join(runtimeRoot, 'core')

const FORBIDDEN_COPY = [
  '.env',
  '.env.local',
  '.env.production',
  '.env.development',
  'service_role',
]

function assertNoSecrets(dir) {
  if (!fs.existsSync(dir)) return
  const stack = [dir]
  while (stack.length) {
    const cur = stack.pop()
    for (const ent of fs.readdirSync(cur, { withFileTypes: true })) {
      const p = path.join(cur, ent.name)
      const lower = ent.name.toLowerCase()
      if (FORBIDDEN_COPY.some(f => lower === f || lower.startsWith('.env'))) {
        throw new Error(`Refusing to package secret-like file: ${p}`)
      }
      if (ent.isDirectory() && ent.name !== 'node_modules') stack.push(p)
    }
  }
}

function rmrf(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true })
}

/**
 * dereference is required: pnpm's standalone tree is a symlink farm into node_modules/.pnpm.
 * Preserving symlinks would leave the installed app pointing back at the developer checkout.
 */
function copyDir(src, dest, dereference = true) {
  fs.mkdirSync(dest, { recursive: true })
  fs.cpSync(src, dest, { recursive: true, dereference })
}

function mustExist(p, label) {
  if (!fs.existsSync(p)) throw new Error(`Missing ${label}: ${p}`)
}

console.log('=== prepare-desktop-runtime ===')

const standalone = path.join(repoRoot, '.next', 'standalone')
const staticDir = path.join(repoRoot, '.next', 'static')
const publicDir = path.join(repoRoot, 'public')
mustExist(path.join(repoRoot, '.next', 'BUILD_ID'), '.next/BUILD_ID')
mustExist(standalone, '.next/standalone (run pnpm run build with output:standalone)')
mustExist(staticDir, '.next/static')
mustExist(publicDir, 'public')

rmrf(runtimeRoot)
fs.mkdirSync(coreDir, { recursive: true })

console.log('Copying Next standalone → desktop/runtime/ui')
copyDir(standalone, uiRoot)
// Standalone NFT may over-trace; strip non-runtime trees if present.
for (const drop of [
  '.git',
  'work',
  'ops',
  'tests',
  'docs',
  'model-lab',
  'desktop',
  'WR-CLAUDE-CODE-COUNCIL-PRODUCTION-001',
  'WR-CLOUD-COUNCIL-FINAL-GATE-001',
  'WR-COUNCIL-PROVIDER-RUNTIME-REPAIR-001',
  'WR-COUNCIL-SESSION-ORCHESTRATION-REBUILD-001',
  'WR-LIVE-COUNCIL-ORCHESTRATION-001',
]) {
  const p = path.join(uiRoot, drop)
  if (fs.existsSync(p)) rmrf(p)
}

/**
 * pnpm's standalone output resolves transitive deps through node_modules/.pnpm symlinks.
 * Once dereferenced those lookups fail (e.g. `Cannot find module '@next/env'`), so flatten
 * every .pnpm package into runtime/ui/node_modules and drop the .pnpm store afterwards.
 */
function hoistPnpmStore() {
  const nm = path.join(uiRoot, 'node_modules')
  const store = path.join(nm, '.pnpm')
  if (!fs.existsSync(store)) return
  let hoisted = 0
  const place = (src, dest) => {
    if (fs.existsSync(dest)) return
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.cpSync(src, dest, { recursive: true, dereference: true })
    hoisted += 1
  }
  for (const pkgDir of fs.readdirSync(store)) {
    const inner = path.join(store, pkgDir, 'node_modules')
    if (!fs.existsSync(inner)) continue
    for (const ent of fs.readdirSync(inner, { withFileTypes: true })) {
      if (ent.name === '.bin') continue
      const src = path.join(inner, ent.name)
      if (ent.name.startsWith('@')) {
        for (const scoped of fs.readdirSync(src)) {
          place(path.join(src, scoped), path.join(nm, ent.name, scoped))
        }
      } else {
        place(src, path.join(nm, ent.name))
      }
    }
  }
  rmrf(store)
  console.log(`Hoisted ${hoisted} packages out of pnpm store`)
}
hoistPnpmStore()

// pnpm does not always hoist @swc/helpers into standalone/node_modules — vendor it.
function vendorSwcHelpers() {
  const dest = path.join(uiRoot, 'node_modules', '@swc', 'helpers')
  if (fs.existsSync(dest)) return
  const pnpmRoot = path.join(repoRoot, 'node_modules', '.pnpm')
  if (!fs.existsSync(pnpmRoot)) throw new Error('Missing node_modules/.pnpm — cannot vendor @swc/helpers')
  const hit = fs
    .readdirSync(pnpmRoot)
    .find(name => name.startsWith('@swc+helpers@'))
  if (!hit) throw new Error('Cannot locate @swc+helpers in pnpm store')
  const src = path.join(pnpmRoot, hit, 'node_modules', '@swc', 'helpers')
  mustExist(src, '@swc/helpers source')
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  copyDir(src, dest)
  console.log('Vendored @swc/helpers →', dest)
}
vendorSwcHelpers()

const uiStatic = path.join(uiRoot, '.next', 'static')
fs.mkdirSync(path.dirname(uiStatic), { recursive: true })
copyDir(staticDir, uiStatic)
const uiPublic = path.join(uiRoot, 'public')
copyDir(publicDir, uiPublic)

// Diagnostic renderer for Core fallback
copyDir(path.join(repoRoot, 'desktop', 'renderer'), path.join(runtimeRoot, 'renderer'))

assertNoSecrets(uiRoot)

// Bundle Core with esbuild (desktop local install)
const esbuildBin = path.join(repoRoot, 'desktop', 'node_modules', 'esbuild', 'bin', 'esbuild')
const esbuildCmd = fs.existsSync(esbuildBin)
  ? esbuildBin
  : path.join(repoRoot, 'node_modules', 'esbuild', 'bin', 'esbuild')

if (!fs.existsSync(esbuildCmd) && !fs.existsSync(esbuildCmd + '.exe')) {
  console.log('esbuild not found in desktop — installing electron-builder tooling peers via npm in desktop…')
  const inst = spawnSync('npm', ['install', '--save-dev', 'esbuild@0.25.0', 'electron-builder@26.0.12'], {
    cwd: path.join(repoRoot, 'desktop'),
    stdio: 'inherit',
    shell: true,
  })
  if (inst.status !== 0) throw new Error('Failed to install esbuild/electron-builder in desktop/')
}

const esbuildJs = path.join(repoRoot, 'desktop', 'node_modules', 'esbuild', 'bin', 'esbuild')
const entry = path.join(repoRoot, 'desktop', 'runtime-src', 'start-core-entry.mjs')
mustExist(entry, 'desktop/runtime-src/start-core-entry.mjs')

const outFile = path.join(coreDir, 'server.cjs')
const bundle = spawnSync(
  process.execPath,
  [
    esbuildJs,
    entry,
    '--bundle',
    '--platform=node',
    '--format=cjs',
    `--outfile=${outFile}`,
    `--alias:@=${repoRoot}`,
    '--external:electron',
    '--external:onnxruntime-node',
    '--external:@huggingface/transformers',
    `--alias:server-only=${path.join(repoRoot, 'desktop', 'runtime-src', 'server-only-stub.cjs')}`,
    '--packages=bundle',
    '--banner:js=const __import_meta_url = require("url").pathToFileURL(__filename).href;',
  ],
  { cwd: repoRoot, encoding: 'utf8', shell: false },
)
if (bundle.status !== 0) {
  console.error(bundle.stderr || bundle.stdout)
  throw new Error('Core esbuild bundle failed')
}

fs.writeFileSync(
  path.join(runtimeRoot, 'windowsUserEnv.cjs'),
  fs.readFileSync(path.join(repoRoot, 'desktop', 'src', 'windowsUserEnv.cjs'), 'utf8'),
)

// Boot script is written at BUILD time: the installed resources directory may be read-only.
const uiServerJs = path.join(uiRoot, 'server.js')
mustExist(uiServerJs, 'runtime/ui/server.js (Next standalone entry)')
fs.writeFileSync(
  path.join(runtimeRoot, 'boot-ui.cjs'),
  [
    "'use strict'",
    '// Packaged Next standalone entry. Spawned with a RELATIVE argv path because',
    '// Electron in ELECTRON_RUN_AS_NODE mode mis-parses absolute Windows paths containing spaces.',
    "const path = require('node:path')",
    "try { require('./windowsUserEnv.cjs').applyWindowsUserEnvironmentToProcess() } catch { /* overlay is best-effort */ }",
    "const serverPath = path.join(__dirname, 'ui', 'server.js')",
    'process.chdir(path.dirname(serverPath))',
    'require(serverPath)',
    '',
  ].join('\n'),
)

// Launcher wrappers
fs.writeFileSync(
  path.join(runtimeRoot, 'start-ui.cjs'),
  `/**
 * Packaged Next UI launcher — ELECTRON_RUN_AS_NODE=1
 * CRITICAL: argv must avoid absolute paths with spaces (Electron node mode
 * on Windows splits them). Always spawn the relative boot script with cwd=runtimeRoot.
 */
const path = require('node:path')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const { mergeWindowsUserEnvironment, applyWindowsUserEnvironmentToProcess } = require('./windowsUserEnv.cjs')

function findServer(root) {
  const p = path.join(root, 'ui', 'server.js')
  return fs.existsSync(p) ? p : null
}

function startUi(opts) {
  try { applyWindowsUserEnvironmentToProcess() } catch { /* overlay is best-effort */ }
  const runtimeRoot = opts.runtimeRoot
  const electronExec = opts.electronExec
  if (!fs.existsSync(path.join(runtimeRoot, 'boot-ui.cjs'))) {
    throw new Error('Packaged runtime/boot-ui.cjs missing — rerun prepare-desktop-runtime')
  }
  if (!findServer(runtimeRoot)) {
    throw new Error('Packaged Next server.js not found under runtime/ui')
  }
  const child = spawn(electronExec, ['boot-ui.cjs'], {
    cwd: runtimeRoot,
    env: {
      ...mergeWindowsUserEnvironment(process.env).env,
      ELECTRON_RUN_AS_NODE: '1',
      PORT: '3848',
      HOSTNAME: '127.0.0.1',
      WAR_ROOM_RUNTIME_SURFACE: 'DESKTOP_LOCAL',
      WAR_ROOM_PACKAGED: '1',
      NODE_ENV: 'production',
    },
    stdio: opts.stdio || 'ignore',
    windowsHide: true,
  })
  return child
}

module.exports = { startUi, findServer }
`,
)


fs.writeFileSync(
  path.join(runtimeRoot, 'start-core.cjs'),
  `/**
 * Packaged Core launcher — prefer in-process require; spawn fallback with ELECTRON_RUN_AS_NODE.
 */
const path = require('node:path')
const { spawn } = require('node:child_process')
const { applyWindowsUserEnvironmentToProcess, mergeWindowsUserEnvironment } = require('./windowsUserEnv.cjs')
try { applyWindowsUserEnvironmentToProcess() } catch { /* overlay is best-effort */ }

async function startCoreInProcess(opts) {
  try { applyWindowsUserEnvironmentToProcess() } catch { /* overlay is best-effort */ }
  const bundlePath = path.join(opts.runtimeRoot, 'core', 'server.cjs')
  const mod = require(bundlePath)
  if (typeof mod.startPackagedCore !== 'function') {
    throw new Error('startPackagedCore export missing from core/server.cjs')
  }
  return mod.startPackagedCore({
    rendererDir: path.join(opts.runtimeRoot, 'renderer'),
    localDataDir: opts.localDataDir || null,
  })
}

function startCoreChild(opts) {
  try { applyWindowsUserEnvironmentToProcess() } catch { /* overlay is best-effort */ }
  const entryRel = path.join('core', 'server.cjs')
  const child = spawn(opts.electronExec, [entryRel, '--serve'], {
    cwd: opts.runtimeRoot,
    env: {
      ...mergeWindowsUserEnvironment(process.env).env,
      ELECTRON_RUN_AS_NODE: '1',
      WAR_ROOM_RUNTIME_SURFACE: 'DESKTOP_LOCAL',
      WAR_ROOM_PACKAGED: '1',
    },
    stdio: 'ignore',
    windowsHide: true,
  })
  return child
}

module.exports = { startCoreInProcess, startCoreChild }
`,
)

const meta = {
  prepared_at: new Date().toISOString(),
  ui_root: 'desktop/runtime/ui',
  core_bundle: 'desktop/runtime/core/server.cjs',
  secrets_bundled: false,
  repo_independent: true,
}
fs.writeFileSync(path.join(runtimeRoot, 'RUNTIME_MANIFEST.json'), JSON.stringify(meta, null, 2))
console.log(JSON.stringify({ ok: true, ...meta }, null, 2))
