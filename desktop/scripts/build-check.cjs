/**
 * Desktop foundation build check — no public domain wrapper.
 */
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const required = [
  'src/main.cjs',
  'src/preload.cjs',
  'renderer/index.html',
  'renderer/app.js',
  'renderer/styles.css',
  'package.json',
]

const missing = required.filter(f => !fs.existsSync(path.join(root, f)))
const mainSrc = fs.readFileSync(path.join(root, 'src/main.cjs'), 'utf8')
const loadsPublic = /loadURL\(\s*['"]https:\/\/warroomos\.com/i.test(mainSrc)
const loadsLocal = /3847|LOCAL_CORE_ORIGIN|127\.0\.0\.1/.test(mainSrc)
const secure =
  /nodeIntegration:\s*false/.test(mainSrc) &&
  /contextIsolation:\s*true/.test(mainSrc) &&
  /sandbox:\s*true/.test(mainSrc)

const result = {
  ok: missing.length === 0 && !loadsPublic && loadsLocal && secure,
  missing,
  loadsPublic,
  loadsLocal,
  secure,
  technology: 'electron',
  rationale:
    'Electron chosen for Phase 10 foundation: Windows support, existing Node/Next stack, contextIsolation/sandbox without Rust toolchain (Tauri research ≠ implementation). Future macOS-capable.',
}

console.log(JSON.stringify(result, null, 2))
if (!result.ok) process.exitCode = 1
