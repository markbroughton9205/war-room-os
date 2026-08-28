#!/usr/bin/env node
/**
 * Terra Foundation (Phase G). CesiumJS ships its Workers/Assets/ThirdParty/Widgets as static
 * files that must be served from a public URL at runtime (CESIUM_BASE_URL) — this is standard,
 * required CesiumJS deployment practice, not a War Room-specific requirement. Vite projects (like
 * upstream God's Eye View) get this for free via vite-plugin-cesium; Next.js has no equivalent
 * plugin, so this script copies the same four directories from node_modules/cesium/Build/Cesium
 * into public/cesium/ before dev/build. public/cesium/ is gitignored (~23MB of vendor binary
 * assets) — this script is the reproducible source of truth, run automatically via package.json's
 * predev/prebuild hooks (and safe to re-run any time; it's a plain recursive copy).
 *
 * Also copies Cesium.js itself (the prebuilt UMD/global bundle) alongside those directories —
 * scoped production fix for a Turbopack minifier bug: re-minifying this already-minified file
 * corrupts an embedded Basis-transcoder byte string into invalid JavaScript ("Octal escape
 * sequences are not allowed in template strings"), production-build-only. Loading this exact file
 * as a plain <script> tag (see components/war-room/terra/loadCesiumRuntime.ts) keeps Turbopack
 * from ever touching Cesium's JS, matching Cesium's own recommended integration for bundlers
 * without a dedicated plugin. Dev mode is unaffected (Turbopack doesn't run that minifier there).
 */
import { cp, mkdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const source = path.join(repoRoot, 'node_modules', 'cesium', 'Build', 'Cesium')
const dest = path.join(repoRoot, 'public', 'cesium')

const DIRS = ['Assets', 'ThirdParty', 'Widgets', 'Workers']
const FILES = ['Cesium.js']

async function main() {
  if (!existsSync(source)) {
    console.error(`[copy-cesium-assets] cesium package not found at ${source} — run "pnpm install" first.`)
    process.exit(1)
  }
  await mkdir(dest, { recursive: true })
  for (const dir of DIRS) {
    const from = path.join(source, dir)
    const to = path.join(dest, dir)
    if (!existsSync(from)) {
      console.warn(`[copy-cesium-assets] expected directory missing, skipping: ${from}`)
      continue
    }
    await rm(to, { recursive: true, force: true })
    await cp(from, to, { recursive: true })
  }
  for (const file of FILES) {
    const from = path.join(source, file)
    const to = path.join(dest, file)
    if (!existsSync(from)) {
      console.warn(`[copy-cesium-assets] expected file missing, skipping: ${from}`)
      continue
    }
    await cp(from, to)
  }
  console.log(`[copy-cesium-assets] copied ${DIRS.join(', ')}, ${FILES.join(', ')} -> public/cesium/`)
}

main().catch(error => {
  console.error('[copy-cesium-assets] failed:', error)
  process.exit(1)
})
